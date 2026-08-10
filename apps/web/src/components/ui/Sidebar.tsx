import { useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, FilePlus2, Folder, FolderPlus, LayoutGrid, LogOut, Mic, Plus, Settings } from 'lucide-react'
import clsx from 'clsx'
import { folders, sessions, type Folder as FolderItem, type Session } from '../../api/client'
import { useAuthStore } from '../../store/auth'

type FolderNode = FolderItem & { children: FolderNode[]; sessions: Session[] }

function buildTree(folderList: FolderItem[], sessionList: Session[]) {
  const nodes = new Map<string, FolderNode>()
  const roots: FolderNode[] = []

  folderList.forEach((folder) => nodes.set(folder.id, { ...folder, children: [], sessions: [] }))
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  sessionList.forEach((session) => {
    if (session.folderId && nodes.has(session.folderId)) {
      nodes.get(session.folderId)!.sessions.push(session)
    }
  })

  const sortNodes = (items: FolderNode[]) => {
    items.sort((a, b) => a.name.localeCompare(b.name))
    items.forEach((item) => {
      item.children.sort((a, b) => a.name.localeCompare(b.name))
      item.sessions.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      sortNodes(item.children)
    })
  }
  sortNodes(roots)

  return roots
}

function TreeFolder({
  node,
  depth,
  onChanged,
  onMoveSession,
  onNewSession,
}: {
  node: FolderNode
  depth: number
  onChanged: () => Promise<void>
  onMoveSession: (sessionId: string, folderId: string) => Promise<void>
  onNewSession?: (folderId?: string | null) => void
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)
  const [creatingChild, setCreatingChild] = useState(false)
  const [childName, setChildName] = useState('')
  const [dropActive, setDropActive] = useState(false)
  const hasChildren = node.children.length > 0 || node.sessions.length > 0

  const createChild = async () => {
    if (!childName.trim()) return
    await folders.create({ name: childName.trim(), parentId: node.id })
    setChildName('')
    setCreatingChild(false)
    setOpen(true)
    await onChanged()
  }

  return (
    <div>
      <div
        className={clsx(
          'group/folder flex items-center gap-1 rounded-lg',
          dropActive && 'bg-jade-50 ring-1 ring-jade-200'
        )}
        style={{ paddingLeft: depth * 10 }}
        onDragOver={(event) => {
          event.preventDefault()
          setDropActive(true)
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={async (event) => {
          event.preventDefault()
          setDropActive(false)
          const sessionId = event.dataTransfer.getData('application/x-nebula-session')
          if (!sessionId) return
          await onMoveSession(sessionId, node.id)
          setOpen(true)
        }}
      >
        <button
          onClick={() => setOpen((value) => !value)}
          className="w-5 h-7 flex items-center justify-center rounded-md text-ink-400 hover:text-ink-700 hover:bg-ink-50"
          disabled={!hasChildren}
          title={open ? 'Recolher' : 'Expandir'}
        >
          {hasChildren ? (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : null}
        </button>
        <button
          onClick={() => navigate(`/?folder=${node.id}`)}
          className="min-w-0 flex-1 h-7 flex items-center gap-2 px-2 rounded-lg text-xs font-medium text-ink-600 hover:text-ink-900 hover:bg-ink-50"
        >
          <Folder className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        <button
          onClick={() => setCreatingChild(true)}
          className="w-6 h-7 flex items-center justify-center rounded-md text-ink-300 hover:text-ink-700 hover:bg-ink-50 opacity-0 group-hover/folder:opacity-100 transition-opacity"
          title="Nova subpasta"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onNewSession?.(node.id)}
          className="w-6 h-7 flex items-center justify-center rounded-md text-ink-400 hover:text-ink-700 hover:bg-ink-50 transition-colors"
          title="Nova sessao nesta pasta"
        >
          <FilePlus2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <div>
          {creatingChild && (
            <div className="mb-1 flex items-center gap-1" style={{ paddingLeft: depth * 10 + 31 }}>
              <input
                autoFocus
                value={childName}
                onChange={(e) => setChildName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createChild()
                  if (e.key === 'Escape') setCreatingChild(false)
                }}
                placeholder="Subpasta"
                className="min-w-0 flex-1 h-7 px-2 rounded-lg border border-ink-200 text-xs outline-none focus:border-ink-400"
              />
              <button
                onClick={createChild}
                className="w-7 h-7 rounded-lg flex items-center justify-center bg-ink-900 text-white disabled:opacity-40"
                disabled={!childName.trim()}
                title="Criar subpasta"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {node.children.map((child) => (
            <TreeFolder
              key={child.id}
              node={child}
              depth={depth + 1}
              onChanged={onChanged}
              onMoveSession={onMoveSession}
              onNewSession={onNewSession}
            />
          ))}
          {node.sessions.map((session) => (
            <button
              key={session.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-nebula-session', session.id)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onClick={() => navigate(`/sessions/${session.id}`)}
              className="w-full h-7 flex items-center gap-2 pr-2 rounded-lg text-xs text-ink-500 hover:text-ink-900 hover:bg-ink-50 cursor-grab active:cursor-grabbing"
              style={{ paddingLeft: depth * 10 + 31 }}
            >
              <Mic className="w-3 h-3 shrink-0" />
              <span className="truncate">{session.title || session.prompt?.name || 'Sessao'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function RootFolder({
  sessions: looseSessions,
  onMoveSession,
  onNewSession,
}: {
  sessions: Session[]
  onMoveSession: (sessionId: string, folderId: string | null) => Promise<void>
  onNewSession?: (folderId?: string | null) => void
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)
  const [dropActive, setDropActive] = useState(false)
  const hasChildren = looseSessions.length > 0

  return (
    <div>
      <div
        className={clsx(
          'group/folder flex items-center gap-1 rounded-lg',
          dropActive && 'bg-jade-50 ring-1 ring-jade-200'
        )}
        onDragOver={(event) => {
          event.preventDefault()
          setDropActive(true)
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={async (event) => {
          event.preventDefault()
          setDropActive(false)
          const sessionId = event.dataTransfer.getData('application/x-nebula-session')
          if (!sessionId) return
          await onMoveSession(sessionId, null)
          setOpen(true)
        }}
      >
        <button
          onClick={() => setOpen((value) => !value)}
          className="w-5 h-7 flex items-center justify-center rounded-md text-ink-400 hover:text-ink-700 hover:bg-ink-50"
          disabled={!hasChildren}
          title={open ? 'Recolher' : 'Expandir'}
        >
          {hasChildren ? (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : null}
        </button>
        <button
          onClick={() => navigate('/?folder=root')}
          className="min-w-0 flex-1 h-7 flex items-center gap-2 px-2 rounded-lg text-xs font-medium text-ink-600 hover:text-ink-900 hover:bg-ink-50"
        >
          <Folder className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">/root</span>
        </button>
        <button
          onClick={() => onNewSession?.(null)}
          className="w-6 h-7 flex items-center justify-center rounded-md text-ink-400 hover:text-ink-700 hover:bg-ink-50 transition-colors"
          title="Nova sessao em /root"
        >
          <FilePlus2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && looseSessions.map((session) => (
        <button
          key={session.id}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-nebula-session', session.id)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onClick={() => navigate(`/sessions/${session.id}`)}
          className="w-full h-7 flex items-center gap-2 pr-2 rounded-lg text-xs text-ink-500 hover:text-ink-900 hover:bg-ink-50 cursor-grab active:cursor-grabbing"
          style={{ paddingLeft: 31 }}
        >
          <Mic className="w-3 h-3 shrink-0" />
          <span className="truncate">{session.title || session.prompt?.name || 'Sessao'}</span>
        </button>
      ))}
    </div>
  )
}

export function Sidebar({ onNewSession }: { onNewSession?: (folderId?: string | null) => void }) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [folderList, setFolderList] = useState<FolderItem[]>([])
  const [sessionList, setSessionList] = useState<Session[]>([])
  const [creating, setCreating] = useState(false)
  const [folderName, setFolderName] = useState('')

  const loadTree = async () => {
    const [folderRes, sessionRes] = await Promise.all([folders.list(), sessions.list()])
    setFolderList(folderRes.folders ?? [])
    setSessionList(sessionRes.sessions ?? [])
  }

  useEffect(() => {
    loadTree().catch(() => {
      setFolderList([])
      setSessionList([])
    })
  }, [])

  useEffect(() => {
    const refresh = () => {
      loadTree().catch(() => undefined)
    }
    window.addEventListener('nebula:sessions-changed', refresh)
    return () => window.removeEventListener('nebula:sessions-changed', refresh)
  }, [])

  const tree = useMemo(() => buildTree(folderList, sessionList), [folderList, sessionList])
  const looseSessions = sessionList.filter((session) => !session.folderId)

  const createFolder = async () => {
    if (!folderName.trim()) return
    await folders.create({ name: folderName.trim() })
    setFolderName('')
    setCreating(false)
    await loadTree()
  }

  const moveSessionToFolder = async (sessionId: string, folderId: string | null) => {
    await sessions.update(sessionId, { folderId })
    await loadTree()
  }

  return (
    <aside className="w-64 shrink-0 h-screen sticky top-0 flex flex-col bg-white border-r border-ink-100">
      <div className="px-5 py-5 flex items-center gap-2.5 border-b border-ink-100">
        <div className="w-8 h-8 rounded-xl bg-ink-900 flex items-center justify-center">
          <Mic className="w-4 h-4 text-white" strokeWidth={2} />
        </div>
        <span className="font-display font-semibold text-ink-900 text-lg tracking-tight">nebula</span>
      </div>

      <nav className="px-3 py-4 flex flex-col gap-0.5 border-b border-ink-100">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all',
              isActive ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900 hover:bg-ink-50'
            )
          }
        >
          <LayoutGrid className="w-4 h-4" />
          Sessoes
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all',
              isActive ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900 hover:bg-ink-50'
            )
          }
        >
          <Settings className="w-4 h-4" />
          Configuracoes
        </NavLink>
        <button
          onClick={() => onNewSession?.(null)}
          className="mt-2 flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium bg-jade-600 text-white hover:bg-jade-700 transition-all"
        >
          <FilePlus2 className="w-4 h-4" />
          Nova sessao
        </button>
      </nav>

      <div className="flex-1 min-h-0 px-3 py-4 overflow-y-auto">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Cadernos</p>
          <button
            onClick={() => setCreating(true)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-900 hover:bg-ink-50"
            title="Nova pasta"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>

        {creating && (
          <div className="mb-3 flex items-center gap-1">
            <input
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFolder()
                if (e.key === 'Escape') setCreating(false)
              }}
              placeholder="Nome da pasta"
              className="min-w-0 flex-1 h-8 px-2 rounded-lg border border-ink-200 text-xs outline-none focus:border-ink-400"
            />
            <button
              onClick={createFolder}
              className="w-8 h-8 rounded-lg flex items-center justify-center bg-ink-900 text-white disabled:opacity-40"
              disabled={!folderName.trim()}
              title="Criar"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          <RootFolder
            sessions={looseSessions}
            onMoveSession={moveSessionToFolder}
            onNewSession={onNewSession}
          />
          {tree.map((node) => (
            <TreeFolder
              key={node.id}
              node={node}
              depth={0}
              onChanged={loadTree}
              onMoveSession={moveSessionToFolder}
              onNewSession={onNewSession}
            />
          ))}
        </div>
      </div>

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
