import { useContext, useEffect, useRef } from 'react'
import { UNSAFE_NavigationContext, useLocation } from 'react-router-dom'
import { activeRecordings, getRecorder } from '../services/AudioRecorderService'
import { uploadRecording } from '../services/recordingUpload'
import { useAuthStore } from '../store/auth'
function captureBeingLeft(destination?: string) {
  const ownerId = useAuthStore.getState().user?.id
  return activeRecordings().find(item => item.ownerId === ownerId &&
    getRecorder(item.sessionId, item.ownerId, uploadRecording).usesBrowserTranscription &&
    window.location.pathname === '/sessions/' + item.sessionId &&
    destination !== '/sessions/' + item.sessionId)
}
export function confirmCaptureNavigation(destination?: string) {
  return !captureBeingLeft(destination) || window.confirm('Sair desta sessão pode parar a transcrição ao vivo do navegador. O áudio continuará sendo gravado e permanecerá salvo neste dispositivo. Para manter a transcrição ao vivo, escolha Cancelar e permaneça nesta sessão. Deseja sair?')
}
export function CaptureNavigationGuard() {
  const { navigator } = useContext(UNSAFE_NavigationContext)
  const location = useLocation()
  const current = useRef(location.pathname)
  const index = useRef<number>(window.history.state?.idx ?? 0)
  useEffect(() => { current.current = location.pathname; index.current = window.history.state?.idx ?? 0 }, [location])
  useEffect(() => {
    const push = navigator.push; const replace = navigator.replace
    const pathname = (to: Parameters<typeof push>[0]) => typeof to === 'string' ? new URL(to, window.location.href).pathname : to.pathname ?? current.current
    navigator.push = (...args) => { if (confirmCaptureNavigation(pathname(args[0]))) push.apply(navigator, args) }
    navigator.replace = (...args) => { if (confirmCaptureNavigation(pathname(args[0]))) replace.apply(navigator, args) }
    // Browser back/forward bypass navigator.push. Restore the history entry if declined.
    let restoring = false
    const pop = (event: PopStateEvent) => {
      if (restoring) { restoring = false; return }
      const ownerId = useAuthStore.getState().user?.id
      const active = activeRecordings().find(item => item.ownerId === ownerId && current.current === '/sessions/' + item.sessionId && getRecorder(item.sessionId, item.ownerId, uploadRecording).usesBrowserTranscription)
      if (!active || window.location.pathname === current.current) return
      if (!window.confirm('Voltar ou avançar pode parar a transcrição ao vivo. O áudio continuará sendo gravado. Deseja sair da sessão?')) {
        const next = event.state?.idx
        if (typeof next === 'number' && next !== index.current) { event.stopImmediatePropagation(); restoring = true; window.history.go(index.current - next) }
      }
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (!activeRecordings().some(item => item.ownerId === useAuthStore.getState().user?.id)) return
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('popstate', pop, true)
    window.addEventListener('beforeunload', unload)
    return () => { navigator.push = push; navigator.replace = replace; window.removeEventListener('popstate', pop, true); window.removeEventListener('beforeunload', unload) }
  }, [navigator])
  return null
}
