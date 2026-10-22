import { useEffect, useId, useRef } from 'react'

export function LiveWaveform({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const pathRef = useRef<SVGPathElement>(null)
  const gradientId = useId()
  useEffect(() => {
    if (!analyser || !active) { pathRef.current?.setAttribute('d', 'M0 64 L600 64'); return }
    const samples = new Float32Array(analyser.fftSize)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let last = 0
    const draw = (time: number) => {
      if (!reduced.matches || time - last > 250) {
        analyser.getFloatTimeDomainData(samples)
        const points: [number, number][] = []
        for (let i = 0; i < 120; i++) {
          const value = samples[Math.floor(i * samples.length / 120)]
          const envelope = Math.sin(Math.PI * i / 119)
          points.push([i * 600 / 119, 64 + Math.max(-1, Math.min(1, value)) * 54 * envelope])
        }
        let d = `M${points[0][0]} ${points[0][1]}`
        for (let i = 1; i < points.length - 1; i++) {
          const [x, y] = points[i]
          const next = points[i + 1]
          d += ` Q${x} ${y} ${(x + next[0]) / 2} ${(y + next[1]) / 2}`
        }
        d += ' L600 64'
        pathRef.current?.setAttribute('d', d)
        last = time
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [analyser, active])
  return <svg viewBox="0 0 600 128" className="nebula-live-wave h-32 w-full" role="img" aria-label={active ? 'Forma de onda do microfone' : 'Microfone em espera'}>
    <defs>
      <linearGradient id={gradientId}>
        <stop offset="0%" stopColor="rgb(var(--focus))" stopOpacity="0.05" />
        <stop offset="25%" stopColor="rgb(var(--focus))" stopOpacity="0.65" />
        <stop offset="50%" stopColor="rgb(var(--focus))" />
        <stop offset="75%" stopColor="rgb(var(--focus))" stopOpacity="0.65" />
        <stop offset="100%" stopColor="rgb(var(--focus))" stopOpacity="0.05" />
      </linearGradient>
    </defs>
    <path d="M0 64 H600" stroke="rgb(var(--focus))" strokeOpacity="0.08" />
    <path ref={pathRef} d="M0 64 L600 64" fill="none" stroke={`url(#${gradientId})`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}
