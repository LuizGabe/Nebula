import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../ui/Button'
import { NewSessionModal } from '../NewSessionModal'
import { Sidebar } from '../ui/Sidebar'
import { RecordingRecovery } from '../RecordingRecovery'
import { ActiveRecordingNotice } from '../ActiveRecordingNotice'
import { useAppearanceStore } from '../../store/appearance'
import { CaptureNavigationGuard } from '../CaptureNavigationGuard'

export type AppLayoutContext = {
  openNewSession: (folderId?: string | null) => void
}

export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [sessionSuspended, setSessionSuspended] = useState(false)
  const returnTo = useRef('/')
  useEffect(() => {
    if (sessionSuspended && location.pathname !== '/settings') setSessionSuspended(false)
  }, [location, sessionSuspended])
  const collapsed = useAppearanceStore(state => state.collapsed)
  const [newSessionFolderId, setNewSessionFolderId] = useState<string | null | undefined>(undefined)

  const openNewSession = (folderId?: string | null) => {
    if (newSessionFolderId !== undefined) { navigate(returnTo.current); return }
    setNewSessionFolderId(folderId ?? null)
  }

  return (
    <div data-collapsed={collapsed} className="nebula-shell min-h-screen md:flex">
      <CaptureNavigationGuard />
      <Sidebar onNewSession={openNewSession} />
      <RecordingRecovery />
      <main id="nebula-main" className="nebula-main">
        <ActiveRecordingNotice />
        {sessionSuspended && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-muted p-4 text-sm text-secondary"><p>O rascunho da nova sessão e seu destino estão preservados. Eles serão mantidos ao voltar.</p><Button onClick={() => navigate(returnTo.current)}>Voltar à nova sessão</Button></div>}
        <Outlet context={{ openNewSession } satisfies AppLayoutContext} />
      </main>
      {newSessionFolderId !== undefined && (
        <NewSessionModal
          initialFolderId={newSessionFolderId}
          suspended={sessionSuspended}
          onManageTemplates={() => {
            returnTo.current = location.pathname === '/settings' ? '/' : location.pathname + location.search
            setSessionSuspended(true)
            navigate('/settings?section=templates')
          }}
          onOpenSession={id => {
            setNewSessionFolderId(undefined)
            window.dispatchEvent(new Event('nebula:sessions-changed'))
            navigate(`/sessions/${id}`)
          }}
          onClose={() => setNewSessionFolderId(undefined)}
          onCreate={(session, source) => {
            setNewSessionFolderId(undefined)
            window.dispatchEvent(new Event('nebula:sessions-changed'))
            navigate(`/sessions/${session.id}?source=${source}`)
          }}
        />
      )}
    </div>
  )
}
