import { IconButton } from './Button'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppearanceStore } from '../../store/appearance'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Moon, Sun, PanelLeftClose, PanelLeftOpen, UserRound, Activity, Check, ChevronDown, ChevronRight, FilePlus2, Folder, FolderPlus, LayoutGrid, LogOut, Menu, Mic, Pencil, Plus, Settings, Trash2, X } from 'lucide-react'
import nebulaIcon from '../../assets/nebula-icon.svg'
import { NebulaWordmark } from './NebulaWordmark'
import clsx from 'clsx'
import { folders, sessions, type Folder as FolderItem, type Session } from '../../api/client'
import { useAuthStore } from '../../store/auth'

type FolderNode = FolderItem & { children: FolderNode[]; sessions: Session[] }
type DeleteFolderTarget = { id: string; name: string; sessionCount: number; folderCount: number }

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

function countFolderContents(node: FolderNode): { folders: number; sessions: number } {
  return node.children.reduce(
    (totals, child) => {
      const childTotals = countFolderContents(child)
      return {
        folders: totals.folders + 1 + childTotals.folders,
        sessions: totals.sessions + child.sessions.length + childTotals.sessions,
      }
    },
    { folders: 0, sessions: node.sessions.length }
  )
}

function TreeFolder({
  node,
  depth,
  onChanged,
  onMoveSession,
  onDeleteFolder,
}: {
  node: FolderNode
  depth: number
  onChanged: () => Promise<void>
  onMoveSession: (sessionId: string, folderId: string) => Promise<void>
  onDeleteFolder: (target: DeleteFolderTarget) => void
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)
  const [creatingChild, setCreatingChild] = useState(false)
  const [childName, setChildName] = useState('')
  const [dropActive, setDropActive] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(node.name)
  const hasChildren = node.children.length > 0 || node.sessions.length > 0

  useEffect(() => {
    setEditName(node.name)
  }, [node.name])

  const createChild = async () => {
    if (!childName.trim()) return
    await folders.create({ name: childName.trim(), parentId: node.id })
    setChildName('')
    setCreatingChild(false)
    setOpen(true)
    await onChanged()
  }

  const saveName = async () => {
    const nextName = editName.trim()
    if (!nextName || nextName === node.name) {
      setEditName(node.name)
      setEditing(false)
      return
    }
    await folders.update(node.id, { name: nextName })
    setEditing(false)
    await onChanged()
  }

  const requestDelete = () => {
    const totals = countFolderContents(node)
    onDeleteFolder({
      id: node.id,
      name: node.name,
      sessionCount: totals.sessions,
      folderCount: totals.folders,
    })
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
          className="w-5 h-7 flex items-center justify-center rounded-md text-subtle hover:text-secondary hover:bg-muted"
          disabled={!hasChildren}
          title={open ? 'Recolher' : 'Expandir'}
        >
          {hasChildren ? (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : null}
        </button>
        {editing ? (
          <div className="min-w-0 flex-1 h-7 flex items-center gap-1">
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') {
                  setEditName(node.name)
                  setEditing(false)
                }
              }}
              className="min-w-0 flex-1 h-7 px-2 rounded-lg border border-line text-xs outline-none focus:border-line"
            />
            <button
              onClick={saveName}
              className="w-7 h-7 flex items-center justify-center rounded-md text-jade-700 hover:bg-jade-50"
              title="Salvar"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setEditName(node.name)
                setEditing(false)
              }}
              className="w-7 h-7 flex items-center justify-center rounded-md text-subtle hover:text-secondary hover:bg-muted"
              title="Cancelar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => navigate(`/?folder=${node.id}`)}
            className="min-w-0 flex-1 h-7 flex items-center gap-2 px-2 rounded-lg text-xs font-medium text-secondary hover:text-primary hover:bg-muted"
          >
            <Folder className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{node.name}</span>
          </button>
        )}
        <button
          onClick={() => setCreatingChild(true)}
          className="w-6 h-7 flex items-center justify-center rounded-md text-subtle hover:text-secondary hover:bg-muted opacity-0 group-hover/folder:opacity-100 transition-opacity"
          title="Nova subpasta"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setEditing(true)}
          className="w-6 h-7 flex items-center justify-center rounded-md text-subtle hover:text-secondary hover:bg-muted opacity-0 group-hover/folder:opacity-100 transition-opacity"
          title="Editar pasta"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={requestDelete}
          className="w-6 h-7 flex items-center justify-center rounded-md text-subtle hover:text-rose-700 hover:bg-rose-50 opacity-0 group-hover/folder:opacity-100 transition-opacity"
          title="Excluir pasta"
        >
          <Trash2 className="w-3.5 h-3.5" />
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
                className="min-w-0 flex-1 h-7 px-2 rounded-lg border border-line text-xs outline-none focus:border-line"
              />
              <button
                onClick={createChild}
                className="w-7 h-7 rounded-lg flex items-center justify-center bg-action text-on-action disabled:opacity-40"
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
              onDeleteFolder={onDeleteFolder}
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
              className="w-full h-7 flex items-center gap-2 pr-2 rounded-lg text-xs text-subtle hover:text-primary hover:bg-muted cursor-grab active:cursor-grabbing"
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
}: {
  sessions: Session[]
  onMoveSession: (sessionId: string, folderId: string | null) => Promise<void>
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
          className="w-5 h-7 flex items-center justify-center rounded-md text-subtle hover:text-secondary hover:bg-muted"
          disabled={!hasChildren}
          title={open ? 'Recolher' : 'Expandir'}
        >
          {hasChildren ? (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : null}
        </button>
        <button
          onClick={() => navigate('/?folder=root')}
          className="min-w-0 flex-1 h-7 flex items-center gap-2 px-2 rounded-lg text-xs font-medium text-secondary hover:text-primary hover:bg-muted"
        >
          <Folder className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Sem caderno</span>
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
          className="w-full h-7 flex items-center gap-2 pr-2 rounded-lg text-xs text-subtle hover:text-primary hover:bg-muted cursor-grab active:cursor-grabbing"
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
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => { setIsMobile(media.matches); if (!media.matches) setMobileOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const { collapsed, toggleSidebar, theme, toggleTheme } = useAppearanceStore()
  useEffect(() => setMobileOpen(false), [location.pathname, location.search])
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [folderList, setFolderList] = useState<FolderItem[]>([])
  const [sessionList, setSessionList] = useState<Session[]>([])
  const [creating, setCreating] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DeleteFolderTarget | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const drawerRef = useDialogFocus(() => setMobileOpen(false), isMobile && mobileOpen && !deleteTarget)
  const deleteRef = useDialogFocus(() => { if (!deleting) setDeleteTarget(null) }, Boolean(deleteTarget))
  useEffect(() => {
    const main = document.getElementById('nebula-main')
    if (!main) return
    main.inert = isMobile && mobileOpen
    return () => { main.inert = false }
  }, [isMobile, mobileOpen])

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

  const deleteFolder = async (sessionAction: 'moveToRoot' | 'delete') => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      await folders.delete(deleteTarget.id, { sessionAction })
      setDeleteTarget(null)
      await loadTree()
      window.dispatchEvent(new Event('nebula:sessions-changed'))
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Não foi possível excluir o caderno.')
    } finally {
      setDeleting(false)
    }
  }

  const label = (text: string) => <><span className="nebula-nav-label">{text}</span><span aria-hidden="true" className="nebula-tooltip">{text}</span></>
  return (
    <>
      <div className="nebula-mobile-bar">
        <IconButton label="Abrir navegação" aria-expanded={mobileOpen} aria-controls="nebula-navigation" onClick={() => setMobileOpen(true)} className="nebula-icon-button"><Menu className="h-5 w-5" /></IconButton>
        <NavLink to="/" aria-label="Nebula — biblioteca"><NebulaWordmark /></NavLink>
      </div>
      <div className="nebula-nav-backdrop" data-open={mobileOpen} onClick={() => setMobileOpen(false)} />
      <div id="nebula-navigation" ref={drawerRef} tabIndex={-1} role={isMobile ? 'dialog' : undefined} aria-modal={isMobile && mobileOpen ? true : undefined} aria-label="Navegação principal" data-collapsed={collapsed} data-mobile-open={mobileOpen} className="nebula-sidebar" onClick={event => { if ((event.target as HTMLElement).closest('a')) setMobileOpen(false) }}>
        <div className="nebula-brand-row">
          <NavLink to="/" onClick={() => setMobileOpen(false)} aria-label="Nebula — biblioteca" className="flex min-w-0 items-center gap-2">
            <img src={nebulaIcon} alt="" className="h-8 w-8 shrink-0" />
            <span className="nebula-brand-name"><NebulaWordmark /></span>
          </NavLink>
          <IconButton label={collapsed ? 'Expandir navegação' : 'Recolher navegação'} aria-expanded={!collapsed} onClick={toggleSidebar} className="nebula-icon-button ml-auto hidden md:inline-flex" title={collapsed ? 'Expandir navegação' : 'Recolher navegação'}>{collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}</IconButton>
          <IconButton label="Fechar navegação" onClick={() => setMobileOpen(false)} className="nebula-icon-button ml-auto md:hidden"><X className="h-5 w-5" /></IconButton>
        </div>
        <nav aria-label="Biblioteca" className="flex flex-col gap-2 px-2">
          <button type="button" aria-label="Nova sessão" onClick={() => { setMobileOpen(false); onNewSession?.(null) }} className="nebula-nav-item nebula-nav-create"><FilePlus2 />{label('Nova sessão')}</button>
          <NavLink to="/" end aria-label="Biblioteca" className="nebula-nav-item"><LayoutGrid />{label('Biblioteca')}</NavLink>
          <button type="button" aria-label="Expandir cadernos" onClick={toggleSidebar} className="nebula-nav-item hidden" style={!isMobile && collapsed ? { display: 'flex' } : undefined}><Folder />{label('Cadernos')}</button>
        </nav>
        <div className="nebula-folders">
          <div className="mb-2 flex items-center justify-between gap-2 px-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Cadernos</p>
            <button type="button" onClick={() => setCreating(true)} className="nebula-icon-button text-secondary" aria-label="Novo caderno" title="Novo caderno"><FolderPlus className="h-4 w-4" /></button>
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
              className="min-w-0 flex-1 h-8 px-2 rounded-lg border border-line text-xs outline-none focus:border-line"
            />
            <button
              onClick={createFolder}
              className="w-8 h-8 rounded-lg flex items-center justify-center bg-action text-on-action disabled:opacity-40"
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
          />
          {tree.map((node) => (
            <TreeFolder
              key={node.id}
              node={node}
              depth={0}
              onChanged={loadTree}
              onMoveSession={moveSessionToFolder}
              onDeleteFolder={setDeleteTarget}
            />
          ))}
        </div>
      </div>

        <nav aria-label="Preferências e conta" className="nebula-nav-footer flex flex-col gap-1">
          <NavLink to="/settings" aria-label="Configurações" className="nebula-nav-item"><Settings />{label('Configurações')}</NavLink>
          <NavLink to="/status" aria-label="Status operacional" className="nebula-nav-item"><Activity />{label('Status operacional')}</NavLink>
          <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'} className="nebula-nav-item">{theme === 'dark' ? <Sun /> : <Moon />}{label(theme === 'dark' ? 'Tema claro' : 'Tema escuro')}</button>
          <NavLink to="/settings?section=account" aria-label="Conta" className="nebula-nav-item"><UserRound /><span className="nebula-nav-label truncate">{user?.username ?? 'Conta'}</span><span className="nebula-tooltip" aria-hidden="true">Conta</span></NavLink>
          <button type="button" onClick={() => logout()} aria-label="Sair" className="nebula-nav-item"><LogOut />{label('Sair')}</button>
        </nav>
      </div>

      {deleteTarget && createPortal(
        <div className="fixed inset-0 z-overlay flex items-center justify-center bg-overlay/40 px-4">
          <div ref={deleteRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Excluir caderno" className="nebula-surface w-full max-w-md rounded-2xl bg-surface p-5 shadow-float border border-line">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-primary">Excluir pasta</h2>
                <p className="mt-1 text-sm text-subtle">
                  Escolha o que fazer com as sessoes dentro de "{deleteTarget.name}".
                </p>
              </div>
              <button
                onClick={() => setDeleteTarget(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-subtle hover:text-primary hover:bg-muted"
                title="Fechar"
                disabled={deleting}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-muted px-3 py-2 text-sm text-secondary">
              {deleteTarget.sessionCount} sessoes e {deleteTarget.folderCount} subpastas serao afetadas.
            </div>

            {deleteError && <p role="alert" className="mt-3 text-sm text-rose-700">{deleteError}</p>}
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => deleteFolder('moveToRoot')}
                disabled={deleting}
                className="w-full rounded-xl border border-line px-4 py-3 text-left text-sm font-medium text-secondary hover:border-jade-300 hover:bg-jade-50 hover:text-jade-900 disabled:opacity-50"
              >
                Preservar sessões em “Sem caderno”
              </button>
              <button
                onClick={() => deleteFolder('delete')}
                disabled={deleting}
                className="w-full rounded-xl border border-rose-100 px-4 py-3 text-left text-sm font-medium text-rose-700 hover:border-rose-300 hover:bg-rose-50 disabled:opacity-50"
              >
                Excluir pasta e sessoes
              </button>
            </div>
          </div>
        </div>
      , document.body)}

    </>
  )
}
