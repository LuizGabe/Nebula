import { useRef, useState, useCallback } from 'react'
import { chunks as chunksApi } from '../api/client'

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped'

interface UseRecorderOptions {
  sessionId: string
  onError?: (e: Error) => void
}

export function useRecorder({ sessionId, onError }: UseRecorderOptions) {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const chunkIndexRef = useRef(0)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startTimeRef = useRef<number>(0)

  // unix ms
  const nextChunkStartRef = useRef<number>(0)

  const stopTimer = () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
  }

  const startTimer = () => {
    stopTimer()

    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
  }

  const uploadChunk = useCallback(
    async (
      blob: Blob,
      index: number,
      tsStart: number,
      tsEnd: number
    ) => {
      try {
        const { url, key } = await chunksApi.presignedUrl(
          sessionId,
          index,
          tsStart,
          tsEnd
        )

        await chunksApi.uploadToMinio(url, blob)
      } catch (e) {
        onError?.(e as Error)
      }
    },
    [sessionId, onError]
  )

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })

      streamRef.current = stream

      const now = Date.now()

      startTimeRef.current = now
      nextChunkStartRef.current = now

      const mr = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      })

      mediaRecorderRef.current = mr

      mr.ondataavailable = (e) => {
        if (e.data.size <= 0) return

        const idx = chunkIndexRef.current++

        const tsStart = nextChunkStartRef.current
        const tsEnd = Date.now()

        // próximo chunk começa exatamente onde esse terminou
        nextChunkStartRef.current = tsEnd

        uploadChunk(
          e.data,
          idx,
          tsStart,
          tsEnd
        )
      }

      mr.start(5000)

      setState('recording')
      startTimer()
    } catch (e) {
      onError?.(e as Error)
    }
  }, [uploadChunk, onError])

  const pause = useCallback(() => {
    mediaRecorderRef.current?.pause()

    stopTimer()

    setState('paused')
  }, [])

  const resume = useCallback(() => {
    mediaRecorderRef.current?.resume()

    startTimeRef.current =
      Date.now() - elapsed * 1000

    // evita gap no timestamp
    nextChunkStartRef.current = Date.now()

    startTimer()

    setState('recording')
  }, [elapsed])

  const stop = useCallback(() => {
    mediaRecorderRef.current?.stop()

    streamRef.current
      ?.getTracks()
      .forEach((t) => t.stop())

    stopTimer()

    setState('stopped')
  }, [])

  const reset = useCallback(() => {
    stop()

    chunkIndexRef.current = 0

    setElapsed(0)

    setState('idle')
  }, [stop])

  return {
    state,
    elapsed,
    start,
    pause,
    resume,
    stop,
    reset,
  }
}