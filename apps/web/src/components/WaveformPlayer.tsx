import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { sessions } from '../api/client'
import { usePlaybackStore } from '../store/playback'
import { resolveAudioDuration } from '../utils/audioDuration'
import { Button } from './ui/Button'

export interface SessionAudioPlayerHandle { seekTo: (seconds: number) => void }
interface Props {
  src: string; sessionId: string; mediaId: string; offsetMs?: number
  pendingSeek: number | null; onSeekHandled: () => void; onError: (message: string) => void
}
export const WaveformPlayer = forwardRef<SessionAudioPlayerHandle, Props>(function WaveformPlayer(
  { src, sessionId, mediaId, offsetMs = 0, pendingSeek, onSeekHandled, onError }, ref,
) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const waveRef = useRef<HTMLDivElement>(null)
  const wave = useRef<WaveSurfer | null>(null)
  const queuedSeek = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [waveReady, setWaveReady] = useState(false)
  const duration = useRef(0)
  const metadataController = useRef<AbortController | null>(null)
  const onErrorRef = useRef(onError); onErrorRef.current = onError
  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio || !duration.current) { queuedSeek.current = seconds; return }
    audio.currentTime = Math.max(0, Math.min(duration.current, seconds))
    void audio.play().catch(() => onErrorRef.current('Não foi possível iniciar o áudio.'))
  }, [])
  useImperativeHandle(ref, () => ({ seekTo }), [seekTo])
  useEffect(() => {
    if (pendingSeek != null) { seekTo(pendingSeek); onSeekHandled() }
  }, [pendingSeek, onSeekHandled, seekTo])
  useEffect(() => {
    const audio = audioRef.current!
    const controller = new AbortController()
    let frame = 0
    let last = 0
    const clock = (now: number) => {
      if (now - last >= 40) { usePlaybackStore.getState().setTime(offsetMs + Math.round(audio.currentTime * 1000)); last = now }
      if (!audio.paused) frame = requestAnimationFrame(clock)
    }
    const tick = () => usePlaybackStore.getState().setTime(offsetMs + Math.round(audio.currentTime * 1000))
    const play = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(clock) }
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || target.closest('input, textarea, select, button, a, audio, [contenteditable="true"], dialog')) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (audio.paused) void audio.play().catch(() => onErrorRef.current('Não foi possível iniciar o áudio.'))
        else audio.pause()
      }
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault(); audio.currentTime = Math.max(0, Math.min(duration.current, audio.currentTime + (event.code === 'ArrowLeft' ? -5 : 5)))
      }
    }
    audio.addEventListener('play', play); audio.addEventListener('timeupdate', tick); audio.addEventListener('seeked', tick)
    window.addEventListener('keydown', keyboard)
    void sessions.peaks(sessionId, mediaId).then(result => {
      if (controller.signal.aborted || !result.peaks?.[0]?.length || !result.durationMs || !waveRef.current) return
      // Precomputed peaks: WaveSurfer never fetches/decodes the complete audio.
      wave.current = WaveSurfer.create({ container: waveRef.current, media: audio, peaks: result.peaks,
        duration: result.durationMs / 1000, height: 48, waveColor: '#a7d9ca', progressColor: '#23846a', cursorColor: '#142d26', barWidth: 2, barGap: 1 })
      setWaveReady(true)
    }).catch(() => { /* Native playback remains available for legacy media. */ })
    return () => {
      metadataController.current?.abort()
      controller.abort(); cancelAnimationFrame(frame); wave.current?.destroy(); wave.current = null
      audio.removeEventListener('play', play); audio.removeEventListener('timeupdate', tick); audio.removeEventListener('seeked', tick)
      window.removeEventListener('keydown', keyboard); usePlaybackStore.getState().setTime(-1)
    }
  }, [src, sessionId, mediaId, offsetMs])
  const prepare = async () => {
    const audio = audioRef.current
    if (!audio) return
    metadataController.current?.abort()
    const controller = new AbortController()
    metadataController.current = controller
    try {
      const total = await resolveAudioDuration(audio, controller.signal)
      if (controller.signal.aborted) return
      duration.current = total
      setReady(true)
      if (queuedSeek.current != null) { const seconds = queuedSeek.current; queuedSeek.current = null; seekTo(seconds) }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Falha ao carregar áudio') }
  }
  return <div className="w-full max-w-xl" aria-label="Player da sessão">
    <div ref={waveRef} className={waveReady ? 'h-12' : 'hidden'} aria-hidden="true" />
    <audio ref={audioRef} src={src} preload="metadata" controls className="h-9 w-full" aria-label="Áudio da sessão. Espaço reproduz ou pausa; setas avançam cinco segundos."
      onLoadedMetadata={() => void prepare()} onError={() => setError('Não foi possível carregar o áudio.')} />
    {!ready && !error && <div className="h-2 animate-pulse rounded bg-ink-100" role="status" aria-label="Carregando áudio" />}
    {error && <div role="alert" className="text-xs text-rose-700">{error} <Button size="sm" onClick={() => { setError(''); audioRef.current?.load() }}>Tentar novamente</Button></div>}
    {ready && !waveReady && <p className="text-xs text-ink-400">Forma de onda indisponível para este áudio.</p>}
  </div>
})
