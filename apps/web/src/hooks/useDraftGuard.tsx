import { useContext, useEffect, useRef, useState } from 'react'
import { UNSAFE_NavigationContext, useLocation } from 'react-router-dom'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'

// Compose with the capture guard; never discard a draft as a side effect of routing.
export function useDraftGuard(dirty: boolean, blocked = false, active = true) {
  const { navigator } = useContext(UNSAFE_NavigationContext)
  const location = useLocation()
  const state = useRef({ dirty, blocked, active })
  state.current = { dirty, blocked, active }
  const bypassing = useRef(false)
  const leavingForLogout = useRef(false)
  const [pending, setPending] = useState<(() => void) | null>(null)
  const bypass = (action: () => void) => {
    bypassing.current = true
    try { action() } finally { bypassing.current = false }
  }
  const request = (action: () => void) => {
    if (state.current.blocked) return
    if (state.current.dirty && !bypassing.current) setPending(() => action)
    else bypass(action)
  }
  const requestRef = useRef(request); requestRef.current = request
  const index = useRef(window.history.state?.idx ?? 0)
  useEffect(() => { index.current = window.history.state?.idx ?? 0 }, [location])
  useEffect(() => {
    const push = navigator.push, replace = navigator.replace
    navigator.push = (...args) => {
      if (!state.current.active || bypassing.current || leavingForLogout.current) push.apply(navigator, args)
      else requestRef.current(() => push.apply(navigator, args))
    }
    navigator.replace = (...args) => {
      if (!state.current.active || bypassing.current || leavingForLogout.current) replace.apply(navigator, args)
      else requestRef.current(() => replace.apply(navigator, args))
    }
    let restoring = false, allowingPop = false
    const pop = (event: PopStateEvent) => {
      if (restoring) { restoring = false; event.stopImmediatePropagation(); return }
      if (allowingPop) { allowingPop = false; return }
      const next = event.state?.idx
      if (!state.current.active || (!state.current.dirty && !state.current.blocked) || typeof next !== 'number' || next === index.current) return
      event.stopImmediatePropagation()
      const delta = next - index.current
      restoring = true
      window.history.go(-delta)
      if (!state.current.blocked) requestRef.current(() => { allowingPop = true; window.history.go(delta) })
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (!state.current.dirty && !state.current.blocked) return
      event.preventDefault(); event.returnValue = ''
    }
    const logout = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const button = event.target.closest<HTMLButtonElement>('button[aria-label="Sair"]')
      if (!button) { leavingForLogout.current = false; return }
      if (bypassing.current || leavingForLogout.current) return
      if (!state.current.dirty && !state.current.blocked) return
      event.preventDefault(); event.stopImmediatePropagation()
      requestRef.current(() => { leavingForLogout.current = true; button.click() })
    }
    window.addEventListener('popstate', pop, true)
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', logout, true)
    return () => {
      navigator.push = push; navigator.replace = replace
      window.removeEventListener('popstate', pop, true); window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', logout, true)
    }
  }, [navigator])
  return {
    request, bypass, dialog: pending && <ConfirmDialog title="Descartar alterações?" onCancel={() => setPending(null)} actions={[{ label: 'Descartar alterações', danger: true, onClick: () => { const action = pending; setPending(null); bypass(action) } }]}>
      <p>Há alterações não salvas. Descartá-las para continuar?</p>
    </ConfirmDialog>
  }
}
