import { useCallback, useMemo, useRef, useState } from 'react'
import { transcripts } from '@/api/client'
import { type LiveTranscription } from '@/hooks/useProcessingStatus'

type SpeechRecognitionConstructor = new () => any

const WEB_SPEECH_CHUNK_OFFSET = 1_000_000

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null
}

interface UseBrowserSpeechTranscriptionOptions {
  sessionId: string
  enabled: boolean
  onError?: (error: Error) => void
}

export function useBrowserSpeechTranscription({ sessionId, enabled, onError }: UseBrowserSpeechTranscriptionOptions) {
  const [liveItems, setLiveItems] = useState<LiveTranscription[]>([])
  const [interimText, setInterimText] = useState('')
  const [running, setRunning] = useState(false)
  const recognitionRef = useRef<any | null>(null)
  const startedAtRef = useRef(0)
  const chunkIndexRef = useRef(WEB_SPEECH_CHUNK_OFFSET)
  const pendingSavesRef = useRef<Promise<unknown>[]>([])
  const supported = useMemo(() => getSpeechRecognition() != null, [])

  const elapsedMs = useCallback(() => Math.max(0, Date.now() - startedAtRef.current), [])

  const saveSegment = useCallback((text: string, timestampStart: number, timestampEnd: number) => {
    const cleanText = text.trim()
    if (!cleanText) return Promise.resolve()

    const item: LiveTranscription = {
      text: cleanText,
      timestamp_start_ms: timestampStart,
      timestamp_end_ms: Math.max(timestampEnd, timestampStart),
    }

    setLiveItems((current) => [...current, item])

    const save = transcripts.createManual(sessionId, {
      text: cleanText,
      timestampStart: item.timestamp_start_ms,
      timestampEnd: item.timestamp_end_ms,
      chunkIndex: chunkIndexRef.current++,
    }).catch((error) => {
      onError?.(error instanceof Error ? error : new Error(String(error)))
    })

    pendingSavesRef.current.push(save)
    return save
  }, [sessionId, onError])

  const start = useCallback((reset = true) => {
    if (!enabled || !supported || running) return false

    const Recognition = getSpeechRecognition()
    if (!Recognition) return false

    const recognition = new Recognition()
    recognition.lang = 'pt-BR'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    if (reset || startedAtRef.current === 0) startedAtRef.current = Date.now()
    if (reset) {
      setLiveItems([])
      setInterimText('')
    }

    recognition.onresult = (event: any) => {
      let interim = ''

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const text = String(result?.[0]?.transcript ?? '').trim()
        if (!text) continue

        if (result.isFinal) {
          const end = elapsedMs()
          void saveSegment(text, Math.max(0, end - 4000), end)
        } else {
          interim += `${text} `
        }
      }

      setInterimText(interim.trim())
    }

    recognition.onerror = (event: any) => {
      const message = event?.error ? `Web Speech: ${event.error}` : 'Erro no Web Speech'
      onError?.(new Error(message))
    }

    recognition.onend = () => {
      setRunning(false)
      recognitionRef.current = null
    }

    try {
      recognition.start()
      recognitionRef.current = recognition
      setRunning(true)
      return true
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)))
      return false
    }
  }, [elapsedMs, enabled, onError, running, saveSegment, supported])

  const stop = useCallback(async () => {
    const finalInterim = interimText.trim()
    setInterimText('')

    if (finalInterim) {
      const end = elapsedMs()
      await saveSegment(finalInterim, Math.max(0, end - 4000), end)
    }

    try {
      recognitionRef.current?.stop()
    } catch {
      recognitionRef.current = null
    }

    await Promise.allSettled(pendingSavesRef.current)
    pendingSavesRef.current = []
    setRunning(false)
  }, [elapsedMs, interimText, saveSegment])

  const pause = useCallback(() => {
    try {
      recognitionRef.current?.stop()
    } catch {
      recognitionRef.current = null
    }
    setRunning(false)
  }, [])

  const resume = useCallback(() => start(false), [start])

  const displayItems = useMemo(() => (
    interimText
      ? [
          ...liveItems,
          {
            text: interimText,
            timestamp_start_ms: Math.max(0, elapsedMs() - 1500),
            timestamp_end_ms: elapsedMs(),
          },
        ]
      : liveItems
  ), [elapsedMs, interimText, liveItems])

  return {
    supported,
    running,
    liveItems: displayItems,
    start,
    stop,
    pause,
    resume,
  }
}
