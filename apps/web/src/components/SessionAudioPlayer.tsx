import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Button } from './ui/Button'
import { Spinner } from './ui/misc'
import { resolveAudioDuration } from '../utils/audioDuration'

export interface SessionAudioPlayerHandle {
  seekTo: (seconds: number) => void
}

interface Props {
  src: string
  pendingSeek: number | null
  onSeekHandled: () => void
  onError: (message: string) => void
}

export const SessionAudioPlayer = forwardRef<SessionAudioPlayerHandle, Props>(
  ({ src, pendingSeek, onSeekHandled, onError }, ref) => {
    const audioRef = useRef<HTMLAudioElement>(null)
    const controllerRef = useRef<AbortController | null>(null)
    const durationRef = useRef(0)
    const queuedSeekRef = useRef<number | null>(null)
    const [duration, setDuration] = useState(0)
    const [failed, setFailed] = useState(false)

    useEffect(() => () => controllerRef.current?.abort(), [])

    const seekTo = useCallback((seconds: number) => {
      const audio = audioRef.current
      if (!audio || !durationRef.current) {
        queuedSeekRef.current = seconds
        return
      }
      audio.currentTime = Math.min(durationRef.current, Math.max(0, seconds))
      void audio.play().catch(() => onError('Nao foi possivel iniciar o audio'))
    }, [onError])

    useImperativeHandle(ref, () => ({ seekTo }), [seekTo])

    useEffect(() => {
      if (pendingSeek == null) return
      seekTo(pendingSeek)
      onSeekHandled()
    }, [pendingSeek, seekTo, onSeekHandled])

    const prepare = async () => {
      const audio = audioRef.current
      if (!audio) return
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      try {
        const total = await resolveAudioDuration(audio, controller.signal)
        if (controller.signal.aborted) return
        durationRef.current = total
        setDuration(total)
        if (queuedSeekRef.current != null) {
          const seconds = queuedSeekRef.current
          queuedSeekRef.current = null
          seekTo(seconds)
        }
      } catch (error) {
        if (controller.signal.aborted) return
        setFailed(true)
        onError(error instanceof Error ? error.message : 'Nao foi possivel carregar o audio')
      }
    }

    const retry = () => {
      controllerRef.current?.abort()
      durationRef.current = 0
      setDuration(0)
      setFailed(false)
      onError('')
      audioRef.current?.load()
    }

    return (
      <div className="w-full max-w-xl">
        <audio
          ref={audioRef}
          src={src}
          preload="auto"
          controls={duration > 0}
          aria-label="Audio da sessao"
          className={duration > 0 ? 'h-9 w-full' : 'hidden'}
          onLoadedMetadata={() => void prepare()}
          onError={() => {
            controllerRef.current?.abort()
            durationRef.current = 0
            setDuration(0)
            setFailed(true)
            onError('Nao foi possivel carregar o audio. Tente novamente.')
          }}
        />
        {duration === 0 && (failed ? (
          <Button size="sm" onClick={retry}>Tentar carregar audio novamente</Button>
        ) : (
          <p role="status" className="flex items-center gap-2 text-xs text-ink-500">
            <Spinner className="h-4 w-4" /> Carregando duracao total do audio...
          </p>
        ))}
      </div>
    )
  },
)

SessionAudioPlayer.displayName = 'SessionAudioPlayer'
