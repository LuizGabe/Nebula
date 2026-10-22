import { LiveWaveform } from './LiveWaveform'
import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Pause, Play, Upload, X, Radio } from 'lucide-react'
import clsx from 'clsx'
import { useRecorder } from '../hooks/useRecorder'
import { type SelectedTranscriptionEngine, sessions, uploads } from '../api/client'
import { Button } from './ui/Button'
import { useBrowserSpeechTranscription } from '@/hooks/useBrowserSpeechTranscription'
import { type LiveTranscription } from '@/hooks/useProcessingStatus'

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

interface Props {
  inputSource?: 'microphone' | 'upload'
  sessionId: string
  transcriptionEngine: SelectedTranscriptionEngine | null
  onUploadStarted?: () => void
  onBrowserLive?: (items: LiveTranscription[]) => void
  disabled?: boolean
}

export function RecordingPanel({
  inputSource,
  sessionId,
  transcriptionEngine,
  onUploadStarted,
  onBrowserLive,
  disabled,
}: Props) {
  const [recordError, setRecordError] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const useBrowserSpeech = transcriptionEngine?.mode === 'web_speech'
  const browserSpeech = useBrowserSpeechTranscription({
    sessionId,
    enabled: useBrowserSpeech,
    onError: (error) => setRecordError(error.message),
  })
  const { state, elapsed, analyser, saved, uploaded, start, pause, resume, stop, getAudioTrack } = useRecorder({
    sessionId,
    transcribe: !useBrowserSpeech,
    deviceId,
    onError: (error) => setRecordError(error.message),
  })
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const isRecording = state === 'recording'
  const isPaused = state === 'paused' || state === 'interrupted'
  const isStopped = uploaded
  const isSaving = (state === 'finalizing' || state === 'uploading' || state === 'requestingPermission')
  const isIdle = state === 'idle' && !uploaded
  const liveEngineLabel = transcriptionEngine?.label ?? 'verificando motor'
  const browserUnavailable = useBrowserSpeech && !browserSpeech.supported

  useEffect(() => {
    const refresh = () => {
      void navigator.mediaDevices?.enumerateDevices().then((items) => {
        setDevices(items.filter((device) => device.kind === 'audioinput'))
      }).catch(() => {})
    }
    refresh()
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh)
  }, [isRecording])

  useEffect(() => {
    if (!useBrowserSpeech) return
    onBrowserLive?.(browserSpeech.liveItems)
  }, [browserSpeech.liveItems, onBrowserLive, useBrowserSpeech])

  const handleStart = async () => {
    setRecordError('')
    if (!await start()) return
    if (useBrowserSpeech) {
      const started = browserSpeech.start(true, getAudioTrack())
      if (!started) {
        pause()
        setRecordError('Web Speech API indisponivel neste navegador')
        return
      }
    }
  }

  const handlePause = () => {
    if (useBrowserSpeech) browserSpeech.pause()
    pause()
  }

  const handleResume = async () => {
    if (useBrowserSpeech && !await browserSpeech.resume()) return
    setRecordError('')
    await resume()
  }

  const handleEnd = async () => {
    try {
      pause()
      if (useBrowserSpeech) {
        await browserSpeech.stop()
      }
      await stop()

      onUploadStarted?.()
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setUploadFile(file)
    e.target.value = ''
  }

  const handleUpload = async () => {
    if (!uploadFile) return
    setUploadState('uploading')
    setUploadError('')
    try {
      const { url, key } = await uploads.presignedUrl(
        sessionId,
        uploadFile.name,
        uploadFile.type,
        uploadFile.size
      )
      await uploads.uploadToMinio(url, uploadFile)
      setUploadState('done')
      setUploadFile(null)
      onUploadStarted?.()
    } catch (e: any) {
      setUploadState('error')
      setUploadError(e.message ?? 'Erro no upload')
    }
  }

  const ACCEPTED = '.mp3,.wav,.webm,.ogg,.m4a,audio/*'

  return (
    <div className="nebula-recorder rounded-[32px] border border-white/80 shadow-card p-6 sm:p-8">
      <div className="flex flex-col gap-8 md:flex-row">
        {/* ── Live recording side ── */}
        <div className={clsx('nebula-recording-stage min-w-0 flex-1 flex flex-col gap-5', inputSource === 'upload' && 'hidden')}>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-ink-500" />
              <span className="text-sm font-medium text-ink-700">Estúdio de gravação</span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-ink-100 bg-ink-50 px-2 py-1 text-xs font-medium text-ink-500">
              <Radio className={clsx('w-3 h-3', useBrowserSpeech ? 'text-sky-500' : 'text-jade-500')} />
              {liveEngineLabel}
            </div>
          </div>

          {/* Timer */}
          <label className="flex flex-col gap-1 text-xs text-ink-500">
            Microfone
            <select
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
              disabled={!isIdle && !isStopped}
              className="w-full rounded-lg border border-ink-200 bg-white px-2 py-2 text-sm text-ink-700 disabled:opacity-60"
            >
              <option value="">Padrao do sistema</option>
              {devices.filter((device) => device.deviceId !== 'default').map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>{device.label || `Microfone ${index + 1}`}</option>
              ))}
            </select>
          </label>
          <LiveWaveform analyser={analyser} active={isRecording} />
          <div className="flex flex-wrap justify-center gap-3 text-xs" role="status">
            <span className={saved ? 'text-jade-700' : 'text-ink-400'}>{saved ? '✓ ' : '○ '}Salvo no Dispositivo</span>
            <span className={uploaded ? 'text-jade-700' : 'text-ink-400'}>{uploaded ? '✓ ' : '○ '}Enviado para Nuvem</span>
          </div>
          <div className="flex items-center justify-center gap-3">
            {(isRecording || isPaused || isSaving || isStopped) && (
              <div className="flex items-center gap-2">
                {isRecording && (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                  </span>
                )}
                <span className="font-sans text-5xl tracking-tight font-medium text-ink-900 tabular-nums">
                  {formatTime(elapsed)}
                </span>
              </div>
            )}
            {isIdle && (
              <span className="font-sans text-5xl tracking-tight font-medium text-ink-400 tabular-nums">00:00</span>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            {isIdle && (
              <Button variant="danger" size="lg" className="nebula-record-pill" onClick={handleStart} disabled={disabled || !transcriptionEngine || browserUnavailable}>
                <Mic className="w-4 h-4" />
                Iniciar gravação
              </Button>
            )}

            {isRecording && (
              <>
                <Button variant="secondary" onClick={handlePause}>
                  <Pause className="w-4 h-4" />
                  Pausar
                </Button>
                <Button variant="danger" onClick={handleEnd}>
                  <Square className="w-4 h-4" />
                  Encerrar
                </Button>
              </>
            )}

            {isPaused && (
              <>
                <Button variant="secondary" onClick={handleResume}>
                  <Play className="w-4 h-4" />
                  Retomar
                </Button>
                <Button variant="danger" onClick={handleEnd}>
                  <Square className="w-4 h-4" />
                  Encerrar
                </Button>
              </>
            )}

            {isSaving && <span role="status" className="text-sm text-ink-500">{state === 'requestingPermission' ? 'Aguardando permissão do microfone…' : state === 'uploading' ? 'Enviando áudio para a nuvem…' : 'Finalizando e salvando áudio…'}</span>}
            {(state === 'recoverable' || state === 'failed') && (
              <>
                <Button variant="primary" onClick={handleEnd}>Tentar finalizar novamente</Button>
                {!saved && <Button variant="secondary" onClick={handleStart}>Tentar gravar</Button>}
              </>
            )}
            {isStopped && !recordError && (
              <span className="text-sm text-ink-400">Gravação encerrada</span>
            )}
          </div>
          {recordError && <p className="text-xs text-rose-500">{recordError}</p>}
          {useBrowserSpeech && isRecording && (
            <p className="text-xs text-ink-500">{browserSpeech.recognitionStatus}</p>
          )}
          {browserUnavailable && (
            <p className="text-xs text-rose-500">Web Speech API indisponivel neste navegador.</p>
          )}
        </div>

        {/* Divider */}
        {!inputSource && <div className="h-px bg-ink-200/60 self-stretch md:h-auto md:w-px" />}

        {/* ── Upload side ── */}
        <div className={clsx('flex-1 flex flex-col gap-4', inputSource === 'microphone' && 'hidden')}>
          <div className="flex items-center gap-2 mb-1">
            <Upload className="w-4 h-4 text-ink-500" />
            <span className="text-sm font-medium text-ink-700">Enviar arquivo</span>
          </div>

          {!uploadFile ? (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={disabled || isStopped || isSaving || isRecording || isPaused}
              className={clsx(
                'flex flex-col items-center justify-center gap-3 min-h-44 rounded-2xl border border-dashed text-sm transition-all',
                disabled || isStopped || isSaving || isRecording || isPaused
                  ? 'border-ink-100 text-ink-300 cursor-not-allowed'
                  : 'border-ink-200 text-ink-500 hover:border-jade-400 hover:text-jade-500 hover:bg-jade-50 cursor-pointer'
              )}
            >
              <Upload className="w-5 h-5" />
              <span>mp3, wav, webm, ogg, m4a</span>
            </button>
          ) : (
            <div className="rounded-xl border border-ink-200 p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-800 truncate">{uploadFile.name}</p>
                <p className="text-xs text-ink-400">{(uploadFile.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              <button aria-label="Remover arquivo selecionado" onClick={() => setUploadFile(null)} className="text-ink-400 hover:text-ink-700">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <input ref={fileRef} type="file" accept={ACCEPTED} className="hidden" onChange={handleFileSelect} />

          {uploadError && <p className="text-xs text-rose-500">{uploadError}</p>}

          {uploadState === 'done' ? (
            <span className="text-sm text-jade-500 font-medium">Upload concluído!</span>
          ) : (
            <Button
              variant="primary"
              onClick={handleUpload}
              loading={uploadState === 'uploading'}
              disabled={!uploadFile || disabled}
            >
              <Upload className="w-4 h-4" />
              Enviar e processar
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
