import { Outlet } from 'react-router-dom'
import { Sidebar } from '../ui/Sidebar'

export function AppLayout() {
  return (
    <div className="flex min-h-screen bg-ink-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
