import { discardRecording, recordingStore, type RecordingChunk } from './recordingStore'

export type RecorderState = 'idle' | 'requestingPermission' | 'recording' | 'paused' | 'interrupted' | 'finalizing' | 'uploading' | 'recoverable' | 'failed'
export interface RecorderSnapshot { state: RecorderState; elapsed: number; saved: boolean; uploaded: boolean; error: string; analyser: AnalyserNode | null }
const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/aac', 'audio/ogg']
const services = new Map<string, AudioRecorderService>()
const registryListeners = new Set<() => void>()
const notifyRegistry = () => registryListeners.forEach(listener => listener())
export const subscribeRecorders = (listener: () => void) => { registryListeners.add(listener); return () => { registryListeners.delete(listener) } }
export const activeRecordings = () => [...services.values()].filter(service => service.isActive()).map(service => ({ sessionId: service.sessionId, ownerId: service.ownerId, ...service.snapshot }))
export type RecordingUploader = (sessionId: string, ownerId: string) => Promise<void>
export function getRecorder(sessionId: string, ownerId: string, upload: RecordingUploader) {
  const key = ownerId + ':' + sessionId
  let service = services.get(key)
  if (!service) { service = new AudioRecorderService(sessionId, ownerId, upload); services.set(key, service) }
  return service
}
export function isRecordingActive(sessionId: string) {
  return [...services.values()].some(s => s.sessionId === sessionId && s.isActive())
}

// Capture survives React unmounts; finalization explicitly releases the microphone.
export class AudioRecorderService {
  snapshot: RecorderSnapshot = { state: 'idle', elapsed: 0, saved: false, uploaded: false, error: '', analyser: null }
  private listeners = new Set<() => void>()
  usesBrowserTranscription = false
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private writes: Promise<void> = Promise.resolve()
  private writeError: Error | null = null
  private failedWrites: RecordingChunk[] = []
  private index = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private startedAt = 0
  private accumulated = 0
  private stopping: Promise<void> | null = null
  private reconnecting = false
  private releaseLock: (() => void) | null = null
  constructor(readonly sessionId: string, readonly ownerId: string, private upload: RecordingUploader) {}
  isActive = () => this.releaseLock != null || this.snapshot.state === 'requestingPermission'
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.snapshot
  private update(patch: Partial<RecorderSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); notifyRegistry() }
  private fail(error: unknown, state: RecorderState = 'failed') { this.update({ state, error: error instanceof Error ? error.message : String(error) }) }
  getAudioTrack = () => this.stream?.getAudioTracks()[0]
  private freezeClock() {
    if (this.startedAt) this.accumulated += performance.now() - this.startedAt
    this.startedAt = 0
  }
  private async lock() {
    if (!navigator.locks) throw new Error('Este navegador não oferece bloqueio seguro da gravação entre abas.')
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request('nebula-recording:' + this.sessionId, { ifAvailable: true }, async lock => {
        if (!lock) { reject(new Error('Esta gravação está aberta em outra aba.')); return }
        await new Promise<void>(release => { this.releaseLock = release; resolve() })
      }).catch(reject)
    })
  }
  async start(transcribe: boolean, deviceId?: string) {
    if (this.snapshot.uploaded || !['idle', 'failed'].includes(this.snapshot.state) || this.recorder) return false
    this.usesBrowserTranscription = !transcribe
    this.update({ state: 'requestingPermission', error: '' })
    try {
      await this.lock()
      const previous = await recordingStore.recordings.get(this.sessionId)
      if (previous) {
        if (previous.ownerId !== this.ownerId || previous.uploaded || await recordingStore.chunks.where('sessionId').equals(this.sessionId).count()) throw new Error('Recupere ou descarte a gravação anterior antes de iniciar outra.')
        await discardRecording(this.sessionId)
      }
      const mimeType = formats.find(type => MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw new Error('Nenhum formato de gravação compatível neste navegador.')
      await recordingStore.recordings.add({ sessionId: this.sessionId, ownerId: this.ownerId, mimeType, transcribe, createdAt: Date.now(), uploaded: false })
      await navigator.storage?.persist?.().catch(() => false)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), noiseSuppression: true, echoCancellation: true, autoGainControl: true } })
      this.stream = stream
      this.context = new AudioContext()
      this.destination = this.context.createMediaStreamDestination()
      const analyser = this.context.createAnalyser()
      analyser.fftSize = 1024
      this.attach(stream, analyser)
      await this.context.resume()
      this.recorder = new MediaRecorder(this.destination.stream, { mimeType })
      this.recorder.ondataavailable = event => {
        if (!event.data.size) return
        const chunkIndex = this.index++
        const chunk: RecordingChunk = { sessionId: this.sessionId, chunkIndex, blob: event.data, mimeType, timestamp: Date.now(), status: 'pending' }
        this.writes = this.writes.then(async () => {
          await recordingStore.chunks.add(chunk)
          this.update({ saved: true })
        }).catch(error => {
          // Capture pauses on failure; retain just the uncommitted fragment for retry.
          this.failedWrites.push(chunk)
          this.writeError = error instanceof Error ? error : new Error(String(error))
          this.freezeClock()
          if (this.recorder?.state === 'recording') this.recorder.pause()
          this.update({ saved: false })
          this.fail(new Error('Falha ao salvar no dispositivo. Libere espaço e finalize a gravação.'))
        })
      }
      this.recorder.onerror = () => { this.freezeClock(); this.fail(new Error('Falha na captura; finalize para preservar o áudio.'), 'interrupted') }
      this.recorder.start(1000)
      this.startedAt = performance.now()
      this.timer = setInterval(() => this.update({ elapsed: Math.floor((this.accumulated + (this.startedAt ? performance.now() - this.startedAt : 0)) / 1000) }), 1000)
      this.update({ state: 'recording', analyser })
      return true
    } catch (error) { this.release(); if (this.recorder?.state === 'inactive') this.recorder = null; this.fail(error); return false }
  }
  private attach(stream: MediaStream, analyser: AnalyserNode) {
    this.source?.disconnect()
    if (this.stream !== stream) this.stream?.getTracks().forEach(t => { t.onended = null; t.stop() })
    this.stream = stream
    this.source = this.context!.createMediaStreamSource(stream)
    this.source.connect(this.destination!)
    this.source.connect(analyser)
    stream.getAudioTracks().forEach(track => { track.onended = () => { void this.reconnect() } })
  }
  private async reconnect() {
    if (this.reconnecting || !['recording', 'paused', 'interrupted'].includes(this.snapshot.state)) return
    this.reconnecting = true
    this.freezeClock()
    if (this.recorder?.state === 'recording') this.recorder.pause()
    this.update({ state: 'interrupted', error: 'Microfone desconectado. Tentando reconectar…' })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true } })
      if (this.snapshot.state !== 'interrupted' || !this.context) { stream.getTracks().forEach(t => t.stop()); return }
      this.attach(stream, this.snapshot.analyser!)
      this.update({ state: 'paused', error: 'Microfone reconectado. Selecione Retomar para continuar.' })
    } catch { this.update({ error: 'Microfone indisponível. Reconecte e tente novamente ou finalize o áudio salvo.' }) }
    finally { this.reconnecting = false }
  }
  pause = () => {
    if (this.snapshot.state !== 'recording' || this.recorder?.state !== 'recording') return
    this.recorder.pause(); this.freezeClock(); this.update({ state: 'paused' })
  }
  resume = async () => {
    if (this.snapshot.state === 'interrupted') { await this.reconnect(); return }
    if (this.snapshot.state !== 'paused' || this.recorder?.state !== 'paused') return
    await this.context?.resume()
    this.recorder.resume(); this.startedAt = performance.now(); this.update({ state: 'recording', error: '' })
  }
  private release() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.source?.disconnect()
    this.stream?.getTracks().forEach(t => { t.onended = null; t.stop() })
    this.stream = null
    void this.context?.close().catch(() => {})
    this.context = null
    this.releaseLock?.(); this.releaseLock = null
    notifyRegistry()
  }
  stop = (): Promise<void> => {
    if (this.stopping) return this.stopping
    if (this.snapshot.uploaded) return Promise.resolve()
    this.stopping = this.finalize().finally(() => { this.stopping = null })
    return this.stopping
  }
  private async finalize() {
    try {
      if (!this.releaseLock) await this.lock()
      this.update({ state: 'finalizing', error: '' }); this.freezeClock()
      if (this.recorder && this.recorder.state !== 'inactive') {
        const stopped = new Promise<void>(resolve => this.recorder!.addEventListener('stop', () => resolve(), { once: true }))
        this.recorder.stop(); await stopped
      }
      await this.writes
      if (this.failedWrites.length) {
        for (const chunk of this.failedWrites) await recordingStore.chunks.put(chunk)
        this.failedWrites = []; this.writeError = null
        this.update({ saved: true })
      }
      if (this.writeError) throw this.writeError
      this.update({ state: 'uploading', analyser: null })
      await this.upload(this.sessionId, this.ownerId)
      this.update({ state: 'idle', uploaded: true })
    } catch (error) { this.fail(error, 'recoverable'); throw error }
    finally { this.release() }
  }
}
