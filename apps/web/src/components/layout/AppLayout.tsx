import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
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
  const collapsed = useAppearanceStore(state => state.collapsed)
  const [newSessionFolderId, setNewSessionFolderId] = useState<string | null | undefined>(undefined)

  const openNewSession = (folderId?: string | null) => {
    setNewSessionFolderId(folderId ?? null)
  }

  return (
    <div data-collapsed={collapsed} className="nebula-shell flex min-h-screen">
      <CaptureNavigationGuard />
      <Sidebar onNewSession={openNewSession} />
      <RecordingRecovery />
      <main id="nebula-main" className="nebula-main">
        <ActiveRecordingNotice />
        <Outlet context={{ openNewSession } satisfies AppLayoutContext} />
      </main>
      {newSessionFolderId !== undefined && (
        <NewSessionModal
          initialFolderId={newSessionFolderId}
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
