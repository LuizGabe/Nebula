/** Resolve unindexed recordings before exposing a playback timeline. */
export function resolveAudioDuration(audio: HTMLAudioElement, signal: AbortSignal): Promise<number> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  if (Number.isFinite(audio.duration) && audio.duration > 0) return Promise.resolve(audio.duration)

  return new Promise((resolve, reject) => {
    const position = audio.currentTime
    const cleanup = () => {
      clearTimeout(timeout)
      audio.removeEventListener('durationchange', check)
      audio.removeEventListener('seeked', check)
      audio.removeEventListener('error', fail)
      signal.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const fail = () => {
      cleanup()
      try { audio.currentTime = position } catch { /* The source may no longer be available. */ }
      reject(new Error('Nao foi possivel determinar a duracao do audio. Tente novamente.'))
    }
    const check = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.seeking) return
      const duration = audio.duration
      cleanup()
      // WebM from MediaRecorder can omit Duration. Seeking past EOF makes the
      // browser inspect the last packet without playing the entire recording.
      audio.currentTime = Math.min(position, duration)
      resolve(duration)
    }
    const timeout = setTimeout(fail, 60_000)
    audio.addEventListener('durationchange', check)
    audio.addEventListener('seeked', check)
    audio.addEventListener('error', fail)
    signal.addEventListener('abort', abort, { once: true })
    try {
      audio.currentTime = Number.MAX_SAFE_INTEGER
    } catch {
      fail()
    }
  })
}
