import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useAuthStore } from '../store/auth'
import { getRecorder } from '../services/AudioRecorderService'
import { uploadRecording } from '../services/recordingUpload'
export type { RecorderState } from '../services/AudioRecorderService'
interface UseRecorderOptions { sessionId: string; transcribe?: boolean; deviceId?: string; onError?: (e: Error) => void }
export function useRecorder({ sessionId, transcribe = true, deviceId, onError }: UseRecorderOptions) {
  const ownerId = useAuthStore(s => s.user?.id) ?? ''
  const service = getRecorder(sessionId, ownerId, uploadRecording)
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot)
  useEffect(() => { if (snapshot.error) onError?.(new Error(snapshot.error)) }, [snapshot.error])
  const start = useCallback(() => service.start(transcribe, deviceId), [service, transcribe, deviceId])
  return { ...snapshot, start, pause: service.pause, resume: service.resume, stop: service.stop, getAudioTrack: service.getAudioTrack }
}
