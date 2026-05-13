import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutGrid, Settings, LogOut, Mic } from 'lucide-react'
import clsx from 'clsx'
import { useAuthStore } from '../../store/auth'

export function Sidebar() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const navItems = [
    { to: '/', icon: LayoutGrid, label: 'Sessões' },
    { to: '/settings', icon: Settings, label: 'Configurações' },
  ]

  return (
    <aside className="w-56 shrink-0 h-screen sticky top-0 flex flex-col bg-white border-r border-ink-100">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-2.5 border-b border-ink-100">
        <div className="w-8 h-8 rounded-xl bg-ink-900 flex items-center justify-center">
          <Mic className="w-4 h-4 text-white" strokeWidth={2} />
        </div>
        <span className="font-display font-semibold text-ink-900 text-lg tracking-tight">nebula</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all',
                isActive
                  ? 'bg-ink-900 text-white'
                  : 'text-ink-600 hover:text-ink-900 hover:bg-ink-50'
              )
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="px-3 pb-4 border-t border-ink-100 pt-3 flex flex-col gap-0.5">
        <div className="px-3 py-2 flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-ink-200 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-ink-600">
              {user?.username?.[0]?.toUpperCase()}
            </span>
          </div>
          <span className="text-sm font-medium text-ink-700 truncate">{user?.username}</span>
        </div>
        <button
          onClick={() => logout()}
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-ink-500 hover:text-ink-900 hover:bg-ink-50 transition-all w-full"
        >
          <LogOut className="w-4 h-4" />
          Sair
        </button>
      </div>
    </aside>
  )
}
