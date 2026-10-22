import { useEffect, useRef, type ReactNode } from 'react'
export function MenuSurface({ children, className = '', onClose, label }: { children: ReactNode; className?: string; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose); close.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const menu = ref.current!
    let restoreFocus = true
    const items = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    items()[0]?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); previous?.focus(); return }
      const options = items(); const current = options.indexOf(document.activeElement as HTMLButtonElement)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && options.length) {
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
        options[next].focus()
      }
    }
    menu.addEventListener('keydown', keydown)
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) { restoreFocus = false; close.current() } }
    document.addEventListener('pointerdown', outside)
    return () => { menu.removeEventListener('keydown', keydown); document.removeEventListener('pointerdown', outside); if (restoreFocus && previous?.isConnected) previous.focus() }
  }, [])
  return <div ref={ref} role="group" aria-label={label} className={'nebula-menu ' + className}>{children}</div>
}
