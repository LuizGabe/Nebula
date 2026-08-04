import { useEffect, useState, useRef } from 'react'
import { sessions } from '@/api/client'

// Enum espelhando SessionEventType do backend
export type SessionEventType =
  | 'CHUNK_RECEIVED'
  | 'CHUNK_QUEUED'
  | 'CHUNK_TRANSCRIPTION_STARTED'
  | 'CHUNK_TRANSCRIPTION_PROGRESS'
  | 'CHUNK_TRANSCRIBED'
  | 'CHUNK_FAILED'
  | 'UPLOAD_RECEIVED'
  | 'UPLOAD_QUEUED'
  | 'UPLOAD_TRANSCRIPTION_STARTED'
  | 'UPLOAD_TRANSCRIPTION_PROGRESS'
  | 'UPLOAD_TRANSCRIBED'
  | 'UPLOAD_FAILED'
  | 'DOCUMENT_QUEUED'
  | 'DOCUMENT_GENERATING'
  | 'DOCUMENT_READY'
  | 'DOCUMENT_FAILED'

export interface LiveTranscription {
  text: string
  timestamp_start_ms: number
  timestamp_end_ms: number
}

export type ProcessingPhase = 'transcript' | 'document'
export type ProcessingState = 'waiting' | 'processing' | 'done' | 'error'

export type DetailedProcessingStatus =
  | `${ProcessingState}:${ProcessingPhase}`
  | 'idle'
  | 'done'
  | 'error:unknown'

type StatusEventPayload = {
  type: SessionEventType
  data: string
}

function mapEventToStatus(eventType: SessionEventType): DetailedProcessingStatus {
  switch (eventType) {
    case 'CHUNK_RECEIVED':
    case 'CHUNK_QUEUED':
    case 'UPLOAD_RECEIVED':
    case 'UPLOAD_QUEUED':
      return 'waiting:transcript'

    case 'CHUNK_TRANSCRIPTION_STARTED':
    case 'UPLOAD_TRANSCRIPTION_STARTED':
      return 'processing:transcript'

    case 'CHUNK_TRANSCRIBED':
    case 'UPLOAD_TRANSCRIBED':
      return 'done:transcript'

    case 'CHUNK_FAILED':
    case 'UPLOAD_FAILED':
      return 'error:transcript'

    case 'DOCUMENT_QUEUED':
      return 'waiting:document'

    case 'DOCUMENT_GENERATING':
      return 'processing:document'

    case 'DOCUMENT_READY':
      return 'done'

    case 'DOCUMENT_FAILED':
      return 'error:document'

    default:
      return 'error:unknown'
  }
}

export function useSessionEvents(sessionId: string, enabled: boolean) {
  const [status, setStatus] = useState<DetailedProcessingStatus>('idle')
  const [liveText, setLiveText] = useState<LiveTranscription[] | null>(null)
  const [transcriptionProgress, setTranscriptionProgress] = useState<[number, number] | null>(null) // [total, current]
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!enabled) return

    const eventSource = sessions.status(sessionId)
    eventSourceRef.current = eventSource

    eventSource.addEventListener('progress', (event) => {
      if (!event.data) return

      const eventParsed = JSON.parse(event.data) as StatusEventPayload
      const type = eventParsed.type as SessionEventType
      console.log('Received event', { type, data: eventParsed.data })

      const payload = typeof eventParsed.data === 'string'
        ? JSON.parse(eventParsed.data)
        : eventParsed.data

      if (type === 'UPLOAD_TRANSCRIPTION_STARTED') {
        setTranscriptionProgress([payload.totalChunks, 0])
      }

      if (type === 'CHUNK_TRANSCRIPTION_PROGRESS' || type === 'UPLOAD_TRANSCRIPTION_PROGRESS') {
        setLiveText((prev) => [...(prev || []), {
          text: payload.text,
          timestamp_start_ms: payload.timestampStartMs,
          timestamp_end_ms: payload.timestampEndMs,
        }])
        setTranscriptionProgress((prev) => prev ? [prev[0], payload.chunkIndex + 1] : null)
        setStatus('processing:transcript')
        return
      }

      if (!eventParsed?.type) return

      const newStatus = mapEventToStatus(eventParsed.type)
      setStatus(newStatus)

      if (type === 'CHUNK_TRANSCRIBED' || type === 'UPLOAD_TRANSCRIBED') {
        setLiveText(null)
        setTranscriptionProgress(null)
      }
    })

    eventSource.addEventListener('error', () => {
      setStatus('error:unknown')
      eventSource.close()
    })

    return () => {
      eventSource.close()
    }
  }, [sessionId, enabled])

  return { status, liveText, transcriptionProgress }
}