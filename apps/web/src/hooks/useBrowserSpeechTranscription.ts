import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  persistFinal?: boolean
  onError?: (error: Error) => void
}

export function useBrowserSpeechTranscription({ sessionId, enabled, persistFinal = true, onError }: UseBrowserSpeechTranscriptionOptions) {
  const [liveItems, setLiveItems] = useState<LiveTranscription[]>([])
  const [interimText, setInterimText] = useState('')
  const [running, setRunning] = useState(false)
  const recognitionRef = useRef<any | null>(null)
  const startedAtRef = useRef(0)
  const chunkIndexRef = useRef(WEB_SPEECH_CHUNK_OFFSET)
  const pendingSavesRef = useRef<Promise<unknown>[]>([])
  const failedSavesRef = useRef<(() => Promise<unknown>)[]>([])
  const shouldRunRef = useRef(false)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const endPromiseRef = useRef<Promise<void>>(Promise.resolve())
  const interimRef = useRef('')
  const audioTrackRef = useRef<MediaStreamTrack | undefined>(undefined)
  const [recognitionStatus, setRecognitionStatus] = useState('')
  const [recognitionWarning, setRecognitionWarning] = useState('')
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const supported = useMemo(() => getSpeechRecognition() != null, [])

  const elapsedMs = useCallback(() => Math.max(0, Date.now() - startedAtRef.current), [])
  const reportStatus = useCallback((stage: string, errorCode?: string) => {
    void transcripts.browserStatus(sessionId, stage, errorCode).catch(() => {})
  }, [sessionId])

  const saveSegment = useCallback((text: string, timestampStart: number, timestampEnd: number) => {
    const cleanText = text.trim()
    if (!cleanText) return Promise.resolve()

    const item: LiveTranscription = {
      text: cleanText,
      timestamp_start_ms: timestampStart,
      timestamp_end_ms: Math.max(timestampEnd, timestampStart),
    }

    setLiveItems((current) => [...current, item])
    if (!persistFinal) return Promise.resolve()

    const segment = {
      text: cleanText,
      timestampStart: item.timestamp_start_ms,
      timestampEnd: item.timestamp_end_ms,
      chunkIndex: chunkIndexRef.current++,
    }
    const persist = (): Promise<unknown> => transcripts.createManual(sessionId, segment).catch((error) => {
      failedSavesRef.current.push(persist)
      onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)))
    })
    const save = persist()

    pendingSavesRef.current.push(save)
    return save
  }, [sessionId, persistFinal])

  const start = useCallback((reset = true, audioTrack?: MediaStreamTrack) => {
    if (!enabled || !supported || shouldRunRef.current) return false
    if (recognitionRef.current) return false

    const Recognition = getSpeechRecognition()
    if (!Recognition) return false

    const recognition = new Recognition()
    recognition.lang = 'pt-BR'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    if (audioTrack) audioTrackRef.current = audioTrack
    const begin = () => {
      setRecognitionStatus('Conectando ao reconhecimento de voz...')
      reportStatus('starting')
      resultTimerRef.current = setTimeout(() => {
        resultTimerRef.current = null
        reportStatus('error', 'recognition-timeout')
        setRecognitionWarning('O servico de voz nao retornou texto. Pause e retome para reconectar.')
        onErrorRef.current?.(new Error('O reconhecimento de voz nao retornou texto. Verifique se o microfone capta sua voz e pause/retome para reconectar.'))
      }, 15000)
      const track = audioTrackRef.current
      if (track?.kind === 'audio' && track.readyState === 'live') {
        try {
          recognition.start(track)
          return
        } catch (error) {
          // Some Chrome builds expose the overload but reject captured tracks.
          if ((error as { name?: string }).name !== 'InvalidStateError') throw error
          reportStatus('starting', 'audio-track-rejected')
        }
      }
      audioTrackRef.current = undefined
      recognition.start()
    }
    recognition.onstart = () => {
      setRunning(true)
      setRecognitionStatus('Reconhecimento conectado. Aguardando fala...')
      reportStatus('listening')
    }
    recognition.onaudiostart = () => {
      setRecognitionStatus('Microfone conectado. Aguardando fala...')
      reportStatus('audio')
    }
    recognition.onspeechstart = () => {
      setRecognitionStatus('Fala detectada. Transcrevendo...')
      reportStatus('speech')
    }

    if (reset || startedAtRef.current === 0) startedAtRef.current = Date.now()
    if (reset) {
      setLiveItems([])
      setInterimText('')
      interimRef.current = ''
      setRecognitionWarning('')
    }

    recognition.onresult = (event: any) => {
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current)
      resultTimerRef.current = null
      setRecognitionStatus('Transcrevendo fala...')
      setRecognitionWarning('')
      reportStatus('result')
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

      interimRef.current = interim.trim()
      setInterimText(interimRef.current)
    }

    recognition.onerror = (event: any) => {
      if (event?.error === 'no-speech') {
        setRecognitionStatus('Nenhuma fala detectada. Verifique se o microfone selecionado capta sua voz.')
        setRecognitionWarning('Nenhuma fala detectada. Verifique se o microfone selecionado capta sua voz.')
        reportStatus('error', 'no-speech')
        return
      }
      if (event?.error === 'aborted' && !shouldRunRef.current) return
      shouldRunRef.current = false
      setRecognitionStatus('Reconhecimento de voz interrompido.')
      reportStatus('error', event?.error ?? 'unknown')
      const messages: Record<string, string> = {
        'not-allowed': 'Permita o acesso ao microfone no navegador e tente novamente.',
        'service-not-allowed': 'O reconhecimento de voz foi bloqueado pelo navegador. Tente usar o Google Chrome.',
        'audio-capture': 'Nao foi possivel acessar o microfone. Verifique o dispositivo selecionado.',
        network: 'Falha de conexao com o reconhecimento de voz do navegador. Verifique a internet e retome a transcricao.',
      }
      onErrorRef.current?.(new Error(messages[event?.error] ?? `Web Speech: ${event?.error ?? 'erro desconhecido'}`))
    }

    let resolveEnd: () => void = () => {}
    const prepareEnd = () => {
      endPromiseRef.current = new Promise<void>((resolve) => { resolveEnd = resolve })
    }
    recognition.onend = () => {
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current)
      resultTimerRef.current = null
      reportStatus('end')
      resolveEnd()
      setRunning(false)
      if (recognitionRef.current !== recognition) return
      if (interimRef.current.trim()) {
        const end = elapsedMs()
        void saveSegment(interimRef.current, Math.max(0, end - 4000), end)
        interimRef.current = ''
        setInterimText('')
      }
      if (shouldRunRef.current) {
        restartTimerRef.current = setTimeout(() => {
          restartTimerRef.current = null
          if (!shouldRunRef.current) return
          try {
            prepareEnd()
            begin()
          } catch (error) {
            resolveEnd()
            shouldRunRef.current = false
            recognitionRef.current = null
            onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)))
          }
        }, 300)
      } else {
        recognitionRef.current = null
      }
    }

    try {
      recognitionRef.current = recognition
      shouldRunRef.current = true
      prepareEnd()
      begin()
      return true
    } catch (error) {
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current)
      resultTimerRef.current = null
      resolveEnd()
      shouldRunRef.current = false
      recognitionRef.current = null
      reportStatus('error', (error as { name?: string }).name ?? 'start-failed')
      onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)))
      return false
    }
  }, [elapsedMs, enabled, reportStatus, saveSegment, supported])

  const stop = useCallback(async () => {
    shouldRunRef.current = false
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
      recognitionRef.current = null
    }
    try {
      recognitionRef.current?.stop()
      await endPromiseRef.current
    } catch {
      recognitionRef.current = null
    }
    // stop() can deliver one last final result before onend.
    const finalInterim = interimRef.current.trim()
    interimRef.current = ''
    setInterimText('')
    if (finalInterim) {
      const end = elapsedMs()
      await saveSegment(finalInterim, Math.max(0, end - 4000), end)
    }
    await Promise.allSettled(pendingSavesRef.current)
    pendingSavesRef.current = []
    const retries = failedSavesRef.current.splice(0)
    await Promise.all(retries.map((retry) => retry()))
    setRunning(false)
    if (failedSavesRef.current.length) throw new Error('Nao foi possivel salvar a transcricao. Tente encerrar novamente.')
  }, [elapsedMs, saveSegment])

  const pause = useCallback(() => {
    shouldRunRef.current = false
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
      recognitionRef.current = null
    }
    try {
      recognitionRef.current?.stop()
    } catch {
      recognitionRef.current = null
    }
    setRunning(false)
  }, [])

  const resume = useCallback(async () => {
    await endPromiseRef.current
    return start(false)
  }, [start])

  useEffect(() => () => {
    shouldRunRef.current = false
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current)
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current)
    recognitionRef.current?.abort()
  }, [sessionId])

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
    recognitionStatus: recognitionWarning || recognitionStatus,
    liveItems: displayItems,
    start,
    stop,
    pause,
    resume,
  }
}
