import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AudioRecorderService } from '../src/services/AudioRecorderService'
import { recordingStore, reconstructRecording, discardRecording } from '../src/services/recordingStore'

class Track {
  onended: (() => void) | null = null
  stop() {}
}
class Stream {
  track = new Track()
  getAudioTracks() { return [this.track] }
  getTracks() { return [this.track] }
}
class Recorder extends EventTarget {
  static last: Recorder
  static isTypeSupported(type: string) { return type === 'audio/mp4' }
  state = 'inactive'
  mimeType = 'audio/mp4'
  timeslice = 0
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(..._args: unknown[]) { super(); Recorder.last = this }
  start(timeslice: number) { this.timeslice = timeslice; this.state = 'recording' }
  pause() { this.state = 'paused' }
  resume() { this.state = 'recording' }
  chunk(text: string) { this.ondataavailable?.({ data: new Blob([text]) }) }
  stop() { this.state = 'inactive'; this.chunk('-tail'); this.dispatchEvent(new Event('stop')) }
}
class Context {
  createMediaStreamDestination() { return { stream: new Stream() } }
  createAnalyser() { return { fftSize: 1024 } }
  createMediaStreamSource() { return { connect() {}, disconnect() {} } }
  async resume() {}
  async close() {}
}
const locks = new Set<string>()
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  mediaDevices: { getUserMedia: async () => new Stream() },
  storage: { persist: async () => true },
  locks: { request: async (key: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
    if (locks.has(key)) return callback(null)
    locks.add(key)
    try { await callback({}) } finally { locks.delete(key) }
  } },
} })
Object.assign(globalThis, { MediaRecorder: Recorder, AudioContext: Context })
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 30)) }

test('recovers ordered persisted chunks with their header and negotiates MP4', async () => {
  const service = new AudioRecorderService('recovery', 'owner', async () => {})
  assert.equal(await service.start(true), true)
  assert.equal(Recorder.last.timeslice, 1000)
  Recorder.last.chunk('HEADER'); Recorder.last.chunk('-body')
  await settle()
  assert.equal(service.snapshot.saved, true)
  assert.equal((await reconstructRecording('recovery')).type, 'audio/mp4')
  assert.equal(await (await reconstructRecording('recovery')).text(), 'HEADER-body')
  // Another reader can recover without access to the service's memory.
  assert.equal(await recordingStore.chunks.where('status').equals('pending').count(), 2)
  await service.stop()
  assert.equal(await (await reconstructRecording('recovery')).text(), 'HEADER-body-tail')
  await discardRecording('recovery')
})
test('failed upload retains audio and allows retry without duplicating chunks', async () => {
  let attempts = 0
  const service = new AudioRecorderService('retry', 'owner', async () => { if (++attempts === 1) throw new Error('offline') })
  await service.start(true); Recorder.last.chunk('HEADER')
  await assert.rejects(service.stop(), /offline/)
  assert.equal(service.snapshot.state, 'recoverable')
  assert.equal(await recordingStore.chunks.where('sessionId').equals('retry').count(), 2)
  await service.stop()
  assert.equal(service.snapshot.uploaded, true)
  assert.equal(await recordingStore.chunks.where('sessionId').equals('retry').count(), 2)
  await discardRecording('retry')
})
test('device interruption recovers paused and does not override voluntary pause', async () => {
  const service = new AudioRecorderService('hardware', 'owner', async () => {})
  await service.start(true)
  service.pause()
  assert.equal(service.snapshot.state, 'paused')
  const originalTrack = service.getAudioTrack()!
  originalTrack.onended?.(new Event('ended'))
  await settle()
  assert.equal(service.snapshot.state, 'paused')
  assert.notEqual(service.getAudioTrack(), originalTrack)
  await service.resume()
  assert.equal(service.snapshot.state, 'recording')
  await service.stop(); await discardRecording('hardware')
})
test('missing header or middle chunk is rejected instead of producing corrupt audio', async () => {
  await recordingStore.chunks.add({ sessionId: 'gap', chunkIndex: 1, blob: new Blob(['body']), mimeType: 'audio/webm', timestamp: 0, status: 'pending' })
  await assert.rejects(reconstructRecording('gap'), /fragmentos ausentes/)
  await discardRecording('gap')
})
test('a storage failure pauses capture and retries the uncommitted fragment on finalization', async () => {
  const service = new AudioRecorderService('quota', 'owner', async () => {})
  await service.start(true)
  const original = recordingStore.chunks.add.bind(recordingStore.chunks)
  let fail = true
  recordingStore.chunks.add = (async (...args: Parameters<typeof original>) => {
    if (fail) { fail = false; throw new Error('QuotaExceededError') }
    return original(...args)
  }) as typeof recordingStore.chunks.add
  try {
    Recorder.last.chunk('HEADER')
    await settle()
    assert.equal(service.snapshot.state, 'failed')
    assert.equal(Recorder.last.state, 'paused')
    assert.equal(service.snapshot.saved, false)
    await service.stop()
    assert.equal(await (await reconstructRecording('quota')).text(), 'HEADER-tail')
  } finally { recordingStore.chunks.add = original; await discardRecording('quota') }
})
