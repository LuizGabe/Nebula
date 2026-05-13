import { useEffect, useState, useRef } from 'react'
import { sessions } from '@/api/client'

type ProcessingState = 'waiting' | 'processing' | 'error'

type ProcessingType = 'transcript' | 'document'

export type DetailedProcessingStatus = `${ProcessingState}:${ProcessingType}` | 'idle' | 'done' | 'error:unknown'

type StatusEventPayload = {
  type: DetailedProcessingStatus
  data: string // JSON string, can be parsed into an object with more details if needed
}

export function useProcessingStatus(sessionId: string, enabled: boolean) {
  const [status, setStatus] = useState<DetailedProcessingStatus>('idle')
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!enabled) return

    const eventSource = sessions.status(sessionId)
    eventSourceRef.current = eventSource

    eventSource.addEventListener('progress', (event) => {
      if (!event.data) return  // ignora evento vazio
      
      const eventParsed = JSON.parse(event.data) as StatusEventPayload
      if (!eventParsed?.type) return  // ignora se não tem status

      const statusResponse = eventParsed.type
      setStatus(statusResponse)
    })

    eventSource.addEventListener('error', () => {
      setStatus('error:unknown')
      eventSource.close()
    })

    return () => {
      eventSource.close()
    }
  }, [sessionId, enabled])

  return status
}
