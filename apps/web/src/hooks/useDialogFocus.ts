import { useEffect, useRef } from 'react'
// A small stack coordinates the existing local overlays, including a mobile drawer.
const dialogs: { token: symbol; element: HTMLDivElement; previous: HTMLElement | null }[] = []
let previousOverflow = ''
export function useDialogFocus(onClose: () => void, enabled = true) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!enabled || !ref.current) return
    const dialog = ref.current
    const token = Symbol('dialog')
    let previous = document.activeElement as HTMLElement | null
    if (!dialogs.length) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden' }
    // React mounts child effects before parent effects. A parent dialog must
    // remain below an already mounted nested dialog in the focus stack.
    const nested = dialogs.findIndex(item => dialog.contains(item.element))
    if (nested >= 0 && previous && dialog.contains(previous)) previous = dialogs[nested].previous
    if (nested >= 0) dialogs.splice(nested, 0, { token, element: dialog, previous })
    else dialogs.push({ token, element: dialog, previous })
    const isTop = () => dialogs[dialogs.length - 1]?.token === token && !document.querySelector('dialog[open]')
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    )).filter(element => !element.closest('[hidden], [inert]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
    if (isTop()) (focusable()[0] ?? dialog).focus()
    const keydown = (event: KeyboardEvent) => {
      if (!isTop()) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const items = focusable(); const first = items[0]; const last = items[items.length - 1]
      if (!first) { event.preventDefault(); dialog.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    const focusin = (event: FocusEvent) => { if (isTop() && !dialog.contains(event.target as Node)) (focusable()[0] ?? dialog).focus() }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', focusin)
    return () => {
      const wasTop = dialogs[dialogs.length - 1]?.token === token
      dialogs.splice(dialogs.findIndex(item => item.token === token), 1)
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', focusin)
      if (!dialogs.length) document.body.style.overflow = previousOverflow
      if (wasTop && previous?.isConnected && !document.querySelector('dialog[open]')) previous.focus()
    }
  }, [enabled])
  return ref
}
