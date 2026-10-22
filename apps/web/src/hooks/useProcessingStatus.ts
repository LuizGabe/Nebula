import { useEffect, useRef, useState } from 'react'
import { sessions } from '@/api/client'

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
  | 'DOCUMENT_SKIPPED'
  | 'DOCUMENT_FAILED'

export interface LiveTranscription {
  text: string
  timestamp_start_ms: number
  timestamp_end_ms: number
}

export type ProcessingPhase = 'ingestion' | 'transcript' | 'document'
export type ProcessingState = 'waiting' | 'processing' | 'done' | 'error'

export type DetailedProcessingStatus =
  | `${ProcessingState}:${ProcessingPhase}`
  | 'idle'
  | 'done'
  | 'error:unknown'

type RawStatusEvent = {
  type?: string
  status?: string
  event_type?: string
  data?: unknown
  payload?: unknown
}

type NormalizedEvent = {
  type: SessionEventType
  payload: Record<string, any>
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function asObject(value: unknown): Record<string, any> {
  const parsed = parseJson(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {}
}

function normalizeStatusEvent(raw: RawStatusEvent): NormalizedEvent | null {
  const type = raw.type ?? raw.status ?? raw.event_type
  if (!type) return null
  return {
    type: type as SessionEventType,
    payload: asObject(raw.data ?? raw.payload),
  }
}

function normalizeTranscriptionEvent(raw: Record<string, any>): NormalizedEvent | null {
  if (raw.status === 'completed') {
    return { type: 'UPLOAD_TRANSCRIBED', payload: raw }
  }

  if (typeof raw.text === 'string' && raw.text.trim()) {
    return {
      type: 'UPLOAD_TRANSCRIPTION_PROGRESS',
      payload: {
        text: raw.text,
        chunkIndex: raw.chunk_index ?? raw.chunkIndex ?? 0,
        timestampStartMs: raw.segment?.start_ms ?? raw.timestampStartMs ?? 0,
        timestampEndMs: raw.segment?.end_ms ?? raw.timestampEndMs ?? 0,
      },
    }
  }

  return null
}

function mapEventToStatus(eventType: SessionEventType): DetailedProcessingStatus {
  switch (eventType) {
    case 'CHUNK_RECEIVED':
    case 'CHUNK_QUEUED':
    case 'UPLOAD_RECEIVED':
    case 'UPLOAD_QUEUED':
      return 'waiting:transcript'

    case 'CHUNK_TRANSCRIPTION_STARTED':
    case 'CHUNK_TRANSCRIPTION_PROGRESS':
    case 'UPLOAD_TRANSCRIPTION_STARTED':
    case 'UPLOAD_TRANSCRIPTION_PROGRESS':
      return 'processing:transcript'

    case 'CHUNK_TRANSCRIBED':
    case 'UPLOAD_TRANSCRIBED':
    case 'DOCUMENT_QUEUED':
      return 'waiting:document'

    case 'CHUNK_FAILED':
    case 'UPLOAD_FAILED':
      return 'error:transcript'

    case 'DOCUMENT_GENERATING':
      return 'processing:document'

    case 'DOCUMENT_READY':
    case 'DOCUMENT_SKIPPED':
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
  const [transcriptionProgress, setTranscriptionProgress] = useState<[number, number] | null>(null)
  const [transcriptVersion, setTranscriptVersion] = useState(0)
  const [documentVersion, setDocumentVersion] = useState(0)
  const [audioVersion, setAudioVersion] = useState(0)
  const [processingMessage, setProcessingMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [sourceTitle, setSourceTitle] = useState('')
  const statusSourceRef = useRef<EventSource | null>(null)
  const transcriptionSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!enabled || !sessionId) return
    setStatus('idle')
    setErrorMessage('')
    setProcessingMessage('')
    setLiveText(null)
    setSourceTitle('')

    const applyEvent = (event: NormalizedEvent) => {
      const { type, payload } = event
      if (type === 'UPLOAD_RECEIVED' && payload.source === 'youtube' && payload.stage) {
        if (payload.title) setSourceTitle(String(payload.title))
        setProcessingMessage(payload.message ?? '')
        setErrorMessage('')
        setStatus(payload.stage === 'stored' ? 'waiting:transcript' : payload.stage === 'queued' ? 'waiting:ingestion' : 'processing:ingestion')
        if (payload.stage === 'stored') setAudioVersion((value) => value + 1)
        return
      }
      if (type === 'UPLOAD_FAILED' || type === 'CHUNK_FAILED' || type === 'DOCUMENT_FAILED') {
        setErrorMessage(String(payload.error ?? payload.reason ?? 'Falha no processamento. Tente novamente.'))
        setProcessingMessage('')
        setStatus(type === 'UPLOAD_FAILED' && payload.source === 'youtube' && payload.stage !== 'transcript' ? 'error:ingestion' : mapEventToStatus(type))
        return
      }
      setProcessingMessage('')
      setErrorMessage('')
      if (type === 'DOCUMENT_SKIPPED' && ['no_transcripts', 'too_large'].includes(payload.reason)) {
        setStatus(payload.reason === 'no_transcripts' ? 'error:transcript' : 'error:document')
        setErrorMessage(payload.reason === 'too_large' ? 'A transcricao excedeu o limite do modelo. Tente gerar o documento novamente.' : 'Nenhuma transcricao disponivel.')
        return
      }
      if (type === 'DOCUMENT_GENERATING' && payload.message) setProcessingMessage(String(payload.message))
      if (type === 'CHUNK_TRANSCRIPTION_PROGRESS' && payload.source === 'web_speech') {
        setTranscriptVersion((value) => value + 1)
        return
      }
      setStatus(mapEventToStatus(type))

      if (type === 'UPLOAD_TRANSCRIPTION_STARTED') {
        setTranscriptionProgress([payload.totalChunks ?? payload.total_chunks ?? 1, 0])
      }

      if (type === 'CHUNK_TRANSCRIPTION_PROGRESS' || type === 'UPLOAD_TRANSCRIPTION_PROGRESS') {
        const text = String(payload.text ?? '').trim()
        if (text) {
          setLiveText((prev) => [...(prev || []), {
            text,
            timestamp_start_ms: payload.timestampStartMs ?? payload.timestamp_start_ms ?? 0,
            timestamp_end_ms: payload.timestampEndMs ?? payload.timestamp_end_ms ?? 0,
          }])
        }

        setTranscriptionProgress((prev) => {
          const total = payload.totalChunks ?? payload.total_chunks ?? prev?.[0] ?? 1
          const current = payload.current ?? (payload.chunkIndex !== undefined ? payload.chunkIndex + 1 : prev?.[1] ?? 0)
          return [total, current]
        })
      }

      if (type === 'CHUNK_TRANSCRIBED' || type === 'UPLOAD_TRANSCRIBED') {
        setLiveText(null)
        setTranscriptionProgress(null)
        setTranscriptVersion((value) => value + 1)
      }

      if (type === 'DOCUMENT_READY' || type === 'DOCUMENT_SKIPPED') {
        setDocumentVersion((value) => value + 1)
      }
    }

    const statusSource = sessions.status(sessionId)
    const transcriptionSource = sessions.transcription(sessionId)
    statusSourceRef.current = statusSource
    transcriptionSourceRef.current = transcriptionSource

    statusSource.addEventListener('progress', (event) => {
      if (!event.data) return
      const normalized = normalizeStatusEvent(JSON.parse(event.data))
      if (normalized) applyEvent(normalized)
    })

    transcriptionSource.addEventListener('transcription', (event) => {
      if (!event.data) return
      const normalized = normalizeTranscriptionEvent(JSON.parse(event.data))
      if (normalized) applyEvent(normalized)
    })

    statusSource.addEventListener('error', () => {
      if (statusSource.readyState === EventSource.CLOSED) return
      setStatus((current) => current === 'idle' ? 'error:unknown' : current)
    })

    transcriptionSource.addEventListener('error', () => {
      if (transcriptionSource.readyState === EventSource.CLOSED) return
    })

    return () => {
      statusSource.close()
      transcriptionSource.close()
    }
  }, [sessionId, enabled])

  return { status, liveText, transcriptionProgress, transcriptVersion, documentVersion, audioVersion, processingMessage, errorMessage, sourceTitle }
}
