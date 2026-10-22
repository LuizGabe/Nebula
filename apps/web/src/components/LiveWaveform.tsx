import { useEffect, useRef } from 'react'

export function LiveWaveform({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const pathRef = useRef<SVGPathElement>(null)
  useEffect(() => {
    if (!analyser || !active) { pathRef.current?.setAttribute('d', 'M0 32 L600 32'); return }
    const samples = new Float32Array(analyser.fftSize)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let last = 0
    const draw = (time: number) => {
      if (!reduced.matches || time - last > 250) {
        analyser.getFloatTimeDomainData(samples)
        let d = ''
        for (let i = 0; i < 200; i++) {
          const value = samples[Math.floor(i * samples.length / 200)]
          d += `${i ? ' L' : 'M'}${i * 600 / 199} ${32 + value * 30}`
        }
        pathRef.current?.setAttribute('d', d)
        last = time
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [analyser, active])
  return <svg viewBox="0 0 600 64" className="h-16 w-full rounded-xl bg-jade-50" role="img" aria-label={active ? 'Forma de onda do microfone' : 'Gravação pausada'}>
    <path ref={pathRef} d="M0 32 L600 32" fill="none" stroke="currentColor" strokeWidth="2" className="text-jade-600" />
  </svg>
}
