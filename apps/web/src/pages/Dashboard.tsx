import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { ChevronRight, FilePlus2, Folder, FolderPlus, Mic, Pencil, Plus, Search, X } from 'lucide-react'
import { folders as foldersApi, sessions as sessionsApi, type Folder as FolderItem, type Session } from '../api/client'
import type { AppLayoutContext } from '../components/layout/AppLayout'
import { Button, IconButton } from '../components/ui/Button'
import { Badge } from '../components/ui/misc'
import { Skeleton } from '../components/ui/Skeleton'
import { folderPath, librarySessions, normalizeSearch, notebookColor, openNotebook, sessionLabels, sessionPending } from '../utils/library'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const sessionCount = (count: number) => `${count} ${count === 1 ? 'sessão' : 'sessões'}`
function formatDate(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : 'Data indisponível'
}
function SessionRow({ session, folders, onChanged }: { session: Session; folders: FolderItem[]; onChanged: () => void }) {
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState('')
  const labels = sessionLabels(session)
  const path = folderPath(session.folderId, folders).map(folder => folder.name).join(' / ') || 'Sem caderno'
  const move = async (folderId: string) => {
    setMoving(true); setError('')
    try { await sessionsApi.update(session.id, { folderId: folderId || null }); onChanged() }
    catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível mover a sessão.') }
    finally { setMoving(false) }
  }
  return <li className="border-b border-line last:border-b-0">
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:gap-5">
      <Link to={`/sessions/${session.id}`} draggable onDragStart={event => { event.dataTransfer.setData('application/x-nebula-session', session.id); event.dataTransfer.effectAllowed = 'move' }} className="min-w-0 flex-1 rounded-lg p-2 -m-2 hover:bg-hover">
        <h3 className="break-words text-base font-medium text-primary">{session.title || `${session.prompt?.name ?? 'Sessão'} sem título`}</h3>
        <div className="mt-1 flex min-w-0 items-start gap-1.5 text-xs text-secondary">
          <Folder aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: notebookColor(session.folder?.color ?? folders.find(folder => folder.id === session.folderId)?.color) }} />
          <span className="break-words">{path}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
          <time dateTime={session.createdAt}>{formatDate(session.createdAt)}</time>
          <span>Template: {session.prompt?.name ?? 'Não informado'}</span>
        </div>
      </Link>
      <div className="flex shrink-0 flex-col gap-1 text-xs text-secondary sm:w-52">
        <div>
          <Badge variant={session.status === 'ERROR' ? 'rose' : sessionPending(session) ? 'amber' : 'ink'}>{labels.capture}</Badge>
        </div>
        <span>{labels.transcript}</span>
        <span>{labels.document}</span>
      </div>
      <details className="w-full shrink-0 text-xs sm:w-32">
        <summary className="min-h-11 cursor-pointer rounded-lg border border-line px-3 py-3 text-secondary hover:bg-hover">Organizar<span className="sr-only"> {session.title || 'sessão'}</span>
        </summary>
        <label className="mt-2 block text-secondary">Mover para<select aria-label={`Mover ${session.title || 'sessão'} para caderno`} disabled={moving} value={session.folderId ?? ''} onChange={event => void move(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface p-2 text-primary">
          <option value="">Sem caderno</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folderPath(folder.id, folders).map(item => item.name).join(' / ')}</option>)}</select>
        </label>
      </details>
    </div>
    {error && <p role="alert" className="pb-3 text-sm text-rose-700">{error}</p>}
  </li>
}

export function DashboardPage() {
  const [sessionList, setSessionList] = useState<Session[]>([])
  const [folderList, setFolderList] = useState<FolderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [loaded, setLoaded] = useState(false)
  const inFlight = useRef(false)
  const queued = useRef(false)
  const alive = useRef(false)
  const { openNewSession } = useOutletContext<AppLayoutContext>()
  const [searchParams] = useSearchParams()
  const selectedId = searchParams.get('folder')
  const isRoot = selectedId === 'root'
  const selected = folderList.find(folder => folder.id === selectedId)
  const missing = !!selectedId && !isRoot && !selected
  const path = folderPath(selected?.id ?? null, folderList)
  const scopeName = isRoot ? 'Sem caderno' : selected?.name ?? 'Biblioteca'
  const scopeText = isRoot ? 'Sem caderno' : selected ? `${selected.name} e subcadernos` : 'Toda a biblioteca'
  const destination = selected?.id ?? null
  const load = useCallback(async () => {
    if (inFlight.current) { queued.current = true; return }
    inFlight.current = true
    try {
      const [sessionRes, folderRes] = await Promise.allSettled([sessionsApi.list(), foldersApi.list()])
      if (sessionRes.status === 'rejected' || folderRes.status === 'rejected') throw new Error('Library refresh failed')
      if (!alive.current) return
      setSessionList(sessionRes.value.sessions ?? []); setFolderList(folderRes.value.folders ?? [])
      setLoadError(''); setLoaded(true)
    } catch { if (alive.current) setLoadError('Não foi possível atualizar a biblioteca. Os dados exibidos podem estar desatualizados.') }
    finally {
      inFlight.current = false
      if (alive.current) {
        setLoading(false)
        if (queued.current) { queued.current = false; void load() }
      }
    }
  }, [])
  useEffect(() => {
    alive.current = true
    void load()
    const refresh = () => { void load() }
    window.addEventListener('nebula:sessions-changed', refresh)
    return () => { alive.current = false; window.removeEventListener('nebula:sessions-changed', refresh) }
  }, [load])
  const pending = sessionList.some(sessionPending)
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => { if (!document.hidden && !inFlight.current) void load() }, 15000)
    return () => window.clearInterval(timer)
  }, [pending, load])
  const shown = librarySessions(sessionList, folderList, selectedId, query)
  const children = isRoot ? [] : folderList.filter(folder => folder.parentId === (selected?.id ?? null))
  const searching = !!normalizeSearch(query)
  const changed = () => window.dispatchEvent(new Event('nebula:sessions-changed'))

  return <div className="nebula-page mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
    <header className="mb-5 space-y-4">
      {selectedId && <nav aria-label="Caminho do caderno">
        <ol className="flex flex-wrap items-center gap-2 text-sm text-secondary">
          <li>
            <Link to="/" className="rounded hover:text-primary">Biblioteca</Link>
          </li>{path.map(folder => <li key={folder.id} className="flex min-w-0 items-center gap-2">
            <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0" />
            <Link to={`/?folder=${folder.id}`} aria-current={folder.id === selectedId ? 'page' : undefined} className="break-words rounded hover:text-primary">{folder.name}</Link>
          </li>)}{isRoot && <li aria-current="page">/ Sem caderno</li>}</ol>
      </nav>}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">{selected && <Folder aria-hidden="true" className="h-6 w-6 shrink-0" style={{ color: notebookColor(selected.color) }} />}<h1 className="break-words text-2xl font-semibold tracking-tight text-primary">{missing && loaded ? 'Caderno indisponível' : scopeName}</h1>{selected && <IconButton label="Editar caderno" onClick={() => openNotebook({ folder: selected })}>
          <Pencil className="h-4 w-4" />
        </IconButton>}</div>
        {!missing && <div className="flex flex-wrap gap-2">
          <Button onClick={() => openNotebook({ parentId: selected?.id ?? null })}>
            <FolderPlus className="h-4 w-4" />{selected ? 'Novo subcaderno' : 'Novo caderno'}</Button>
          <Button variant="primary" onClick={() => openNewSession(destination)}>
            <Plus className="h-4 w-4" />Nova sessão</Button>
        </div>}
      </div>
      {!missing && <div>
        <label htmlFor="library-search" className="mb-1.5 block text-xs text-secondary">Buscar por título ou template · {scopeText}</label>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:border-focus">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-subtle" />
          <input id="library-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Buscar em ${scopeText.toLocaleLowerCase('pt-BR')}…`} className="min-h-11 min-w-0 flex-1 bg-transparent text-sm text-primary outline-none" />{query && <IconButton label="Limpar busca" onClick={() => setQuery('')}>
            <X className="h-4 w-4" />
          </IconButton>}</div>
      </div>}
    </header>
    {loadError && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">
      <span>{loadError}</span>
      <Button onClick={() => void load()}>Tentar novamente</Button>
    </div>}
    {loading ? <div role="status" aria-label="Carregando biblioteca" className="space-y-3">{[0, 1, 2].map(id => <Skeleton key={id} className="h-20" />)}</div>
      : missing && loaded ? <p className="text-secondary">Este caderno não existe ou foi removido. <Link to="/" className="underline">Voltar à biblioteca</Link>
      </p>
        : !loaded ? null : <>
          {!searching && !isRoot && <section aria-labelledby="notebooks-heading" className="mb-7">
            <h2 id="notebooks-heading" className="mb-3 text-sm font-semibold text-secondary">{selected ? 'Subcadernos diretos' : 'Cadernos'}</h2>
            <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">{!selectedId && <Link to="/?folder=root" className="flex min-h-14 items-center gap-3 rounded-lg border-b border-line px-2 py-3 hover:bg-hover">
              <Folder className="h-5 w-5 shrink-0 text-secondary" />
              <span className="min-w-0 flex-1 text-sm text-primary">Sem caderno</span>
              <span className="text-xs text-subtle">{sessionCount(librarySessions(sessionList, folderList, 'root').length)}</span>
            </Link>}{children.map(folder => <div key={folder.id} className="flex items-center gap-1 border-b border-line">
              <Link to={`/?folder=${folder.id}`} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 hover:bg-hover">
                <Folder aria-hidden="true" className="h-5 w-5 shrink-0" style={{ color: notebookColor(folder.color) }} />
                <span className="min-w-0 flex-1 break-words text-sm text-primary">{folder.name}</span>
                <span className="shrink-0 text-xs text-subtle">{sessionCount(librarySessions(sessionList, folderList, folder.id).length)}</span>
              </Link>
              <IconButton label={`Nova sessão em ${folder.name}`} onClick={() => openNewSession(folder.id)}>
                <FilePlus2 className="h-4 w-4" />
              </IconButton>
            </div>)}</div>{children.length === 0 && <p className="mt-2 text-xs text-subtle">{selected ? 'Nenhum subcaderno direto.' : 'Crie cadernos para organizar reuniões e aulas.'}</p>}</section>}
          <section aria-labelledby="sessions-heading">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="sessions-heading" className="text-base font-semibold text-primary">{searching ? 'Resultados da busca' : selected ? 'Sessões do ramo' : isRoot ? 'Sessões sem caderno' : 'Todas as sessões'} <span className="text-sm font-normal text-subtle">({shown.length})</span>
              </h2>
              <span className="text-xs text-subtle">Mais recentes · por criação</span>
            </div>
            {selected && <p className="mb-3 text-xs text-secondary">Inclui sessões deste caderno e de todos os subcadernos. O caminho indica onde cada sessão está organizada.</p>}
            {pending && <p className="mb-3 text-xs text-subtle">Há trabalho pendente. A biblioteca verifica atualizações a cada 15 segundos enquanto está visível.</p>}
            {shown.length ? <ul>{shown.map(session => <SessionRow key={session.id} session={session} folders={folderList} onChanged={changed} />)}</ul> : <div className="rounded-xl border border-line py-10 text-center">
              <Mic aria-hidden="true" className="mx-auto h-8 w-8 text-subtle" />
              <h3 className="mt-3 font-medium text-primary">{searching ? 'Nenhuma sessão encontrada' : selected ? 'Este caderno ainda está vazio' : isRoot ? 'Nenhuma sessão sem caderno' : 'Sua biblioteca ainda está vazia'}</h3>
              <p className="mt-1 text-sm text-secondary">{searching ? 'Tente outro título ou nome de template neste escopo.' : 'Crie uma sessão para começar.'}</p>{!searching && <Button variant="primary" className="mt-4" onClick={() => openNewSession(destination)}>
                <Plus className="h-4 w-4" />Nova sessão</Button>}</div>}
          </section>
        </>}
  </div>
}
