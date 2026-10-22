import { uploads, sessions } from '../api/client'
import { audioExtension, recordingStore, reconstructRecording } from './recordingStore'

export async function uploadRecording(sessionId: string, ownerId: string) {
  const manifest = await recordingStore.recordings.get(sessionId)
  if (!manifest || manifest.ownerId !== ownerId) throw new Error('Gravação local não encontrada.')
  if (manifest.uploaded) return
  const blob = await reconstructRecording(sessionId)
  if (!blob.size || blob.size > 1000 * 1024 * 1024) throw new Error('Áudio vazio ou acima do limite de 1 GB.')
  const { url, alreadyUploaded } = await uploads.presignedUrl(sessionId, 'recording.' + audioExtension(blob.type), blob.type, blob.size, manifest.transcribe, 'recording-' + manifest.createdAt)
  if (!alreadyUploaded) await uploads.uploadToMinio(url, blob)
  if (!manifest.transcribe) await sessions.end(sessionId)
  await recordingStore.transaction('rw', recordingStore.chunks, recordingStore.recordings, async () => {
    await recordingStore.chunks.where('sessionId').equals(sessionId).modify({ status: 'uploaded' })
    await recordingStore.recordings.update(sessionId, { uploaded: true })
  })
}
