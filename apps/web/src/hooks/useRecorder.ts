import { useRef, useState, useCallback, useEffect } from 'react'
import { uploads } from '../api/client'

export type RecorderState = 'idle' | 'recording' | 'paused' | 'saving' | 'stopped'

interface UseRecorderOptions {
  sessionId: string
  transcribe?: boolean
  deviceId?: string
  onError?: (e: Error) => void
}

export function useRecorder({ sessionId, transcribe = true, deviceId, onError }: UseRecorderOptions) {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [audioLevel, setAudioLevel] = useState(0)
  const meterRef = useRef<{ context: AudioContext; timer: ReturnType<typeof setInterval> } | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const partsRef = useRef<Blob[]>([])
  const recordingRef = useRef<Blob | null>(null)
  const saveRef = useRef<Promise<void> | null>(null)
  const uploadedRef = useRef(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const elapsedBeforePauseRef = useRef(0)
  const stopMeter = useCallback(() => {
    if (meterRef.current) {
      clearInterval(meterRef.current.timer)
      void meterRef.current.context.close().catch(() => {})
      meterRef.current = null
    }
    setAudioLevel(0)
  }, [])

  const stopTimer = () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
  }

  const startTimer = () => {
    stopTimer()
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((elapsedBeforePauseRef.current + Date.now() - startTimeRef.current) / 1000))
    }, 1000)
  }

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true })
      streamRef.current = stream
      partsRef.current = []
      recordingRef.current = null
      uploadedRef.current = false
      elapsedBeforePauseRef.current = 0
      setElapsed(0)

      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      mediaRecorderRef.current = mr
      mr.ondataavailable = (event) => {
        if (event.data.size > 0) {
          partsRef.current.push(event.data)
        } else {
          onError?.(new Error('O navegador entregou um fragmento de audio vazio. A gravacao sera verificada ao encerrar.'))
        }
      }
      mr.onerror = (event) => {
        const error = (event as Event & { error?: Error }).error
        onError?.(error ?? new Error('Falha na captura de audio'))
      }
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => onError?.(new Error('O microfone foi desconectado durante a gravacao'))
      })
      mr.start(5000)
      stopMeter()
      try {
        const context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        context.createMediaStreamSource(stream).connect(analyser)
        const samples = new Float32Array(analyser.fftSize)
        const timer = setInterval(() => {
          analyser.getFloatTimeDomainData(samples)
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
          setAudioLevel(Math.min(100, rms * 500))
        }, 100)
        meterRef.current = { context, timer }
        void context.resume().catch(() => {})
      } catch {
        // Meter support must not prevent audio capture.
      }
      startTimeRef.current = Date.now()
      setState('recording')
      startTimer()
      return true
    } catch (error) {
      stopMeter()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      onError?.(error instanceof Error ? error : new Error(String(error)))
      return false
    }
  }, [deviceId, onError, stopMeter])

  const pause = useCallback(() => {
    const mr = mediaRecorderRef.current
    if (mr?.state !== 'recording') return
    mr.pause()
    elapsedBeforePauseRef.current += Date.now() - startTimeRef.current
    setElapsed(Math.floor(elapsedBeforePauseRef.current / 1000))
    stopTimer()
    setState('paused')
  }, [])

  const resume = useCallback(() => {
    const mr = mediaRecorderRef.current
    if (mr?.state !== 'paused') return
    mr.resume()
    startTimeRef.current = Date.now()
    startTimer()
    setState('recording')
  }, [])

  const stop = useCallback((): Promise<void> => {
    if (saveRef.current) return saveRef.current
    if (uploadedRef.current) return Promise.resolve()

    const save = async () => {
      const mr = mediaRecorderRef.current
      if (!recordingRef.current) {
        if (mr && mr.state !== 'inactive') {
          setState('saving')
          const finished = new Promise<void>((resolve, reject) => {
            mr.addEventListener('stop', () => resolve(), { once: true })
            mr.addEventListener('error', (event) => {
              reject((event as Event & { error?: Error }).error ?? new Error('Falha ao finalizar a captura'))
            }, { once: true })
          })
          mr.stop()
          await finished
        }
        recordingRef.current = new Blob(partsRef.current, { type: 'audio/webm' })
        partsRef.current = []
      }

      stopTimer()
      stopMeter()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null

      const recording = recordingRef.current
      if (!recording?.size) throw new Error('A gravacao nao produziu audio. Verifique o microfone e tente novamente.')
      if (recording.size > 1000 * 1024 * 1024) throw new Error('A gravacao excede o limite de 1 GB para upload.')

      setState('saving')
      const { url } = await uploads.presignedUrl(sessionId, 'recording.webm', recording.type, recording.size, transcribe)
      await uploads.uploadToMinio(url, recording)
      uploadedRef.current = true
      recordingRef.current = null
      setState('stopped')
    }

    const pending = save().catch((error) => {
      setState('stopped')
      throw error
    }).finally(() => {
      saveRef.current = null
    })
    saveRef.current = pending
    return pending
  }, [sessionId, transcribe, stopMeter])

  useEffect(() => () => {
    stopMeter()
    if (intervalRef.current) clearInterval(intervalRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [stopMeter])

  const getAudioTrack = useCallback(() => streamRef.current?.getAudioTracks()[0], [])

  return { state, elapsed, audioLevel, start, pause, resume, stop, getAudioTrack }
}
