import Dexie, { type Table } from 'dexie'
export interface RecordingChunk {
  sessionId: string
  chunkIndex: number
  blob: Blob
  mimeType: string
  timestamp: number
  status: 'pending' | 'uploaded'
}
export interface RecordingManifest {
  sessionId: string
  ownerId: string
  mimeType: string
  transcribe: boolean
  createdAt: number
  uploaded: boolean
}
class RecordingDatabase extends Dexie {
  chunks!: Table<RecordingChunk, [string, number]>
  recordings!: Table<RecordingManifest, string>
  constructor() {
    super('nebula-recordings')
    this.version(1).stores({ chunks: '[sessionId+chunkIndex], sessionId, status', recordings: 'sessionId, ownerId' })
  }
}
export const recordingStore = new RecordingDatabase()
export function audioExtension(mime: string) {
  return mime.includes('mp4') ? 'm4a' : mime.includes('aac') ? 'aac' : mime.includes('ogg') ? 'ogg' : 'webm'
}
// A single recorder produces one container. Sorting preserves the original header.
export async function reconstructRecording(sessionId: string) {
  const chunks = await recordingStore.chunks.where('sessionId').equals(sessionId).sortBy('chunkIndex')
  if (!chunks.length || chunks.some((c, i) => c.chunkIndex !== i)) {
    throw new Error('Gravação incompleta: há fragmentos ausentes. Os dados locais foram preservados.')
  }
  return new Blob(chunks.map(c => c.blob), { type: chunks[0].mimeType })
}
export async function discardRecording(sessionId: string) {
  await recordingStore.transaction('rw', recordingStore.chunks, recordingStore.recordings, async () => {
    await recordingStore.chunks.where('sessionId').equals(sessionId).delete()
    await recordingStore.recordings.delete(sessionId)
  })
}
