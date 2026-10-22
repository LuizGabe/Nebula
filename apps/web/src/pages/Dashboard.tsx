import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { Activity, AlertCircle, ArrowRight, Calendar, Clock, FilePlus2, Folder, Layers, Mic, Plus, Search, X } from 'lucide-react'
import { folders as foldersApi, sessions as sessionsApi, type Folder as FolderItem, type Session } from '../api/client'
import type { AppLayoutContext } from '../components/layout/AppLayout'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/misc'
import { Skeleton } from '../components/ui/Skeleton'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { safeDate } from '@/utils/SafeDate'

function childFolderIds(folderId: string, folderList: FolderItem[]) {
  const ids = new Set<string>([folderId])
  let changed = true

  while (changed) {
    changed = false
    folderList.forEach((folder) => {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id)
        changed = true
      }
    })
  }

  return ids
}

function sessionsInFolder(folderId: string, sessionList: Session[], folderList: FolderItem[]) {
  const ids = childFolderIds(folderId, folderList)
  return sessionList.filter((session) => session.folderId && ids.has(session.folderId))
}

function latestSession(sessionList: Session[]) {
  return [...sessionList].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0]
}

function formatSessionDate(value: string) {
  const date = safeDate(value)
  if (!date) return '-'
  return format(date, 'd MMM, HH:mm', { locale: ptBR })
}

function statusBadge(session: Session) {
  if (session.status === 'ERROR') return <Badge variant="rose">Erro</Badge>
  if (session.status === 'IN_PROGRESS') return <Badge variant="amber">Transcrevendo</Badge>
  if (session.status === 'ACTIVE') return <Badge variant="rose">Ativa</Badge>
  return <Badge variant="jade">Pronta</Badge>
}

function MetricCard({
  label,
  value,
  icon: Icon,
  detail,
}: {
  label: string
  value: number
  icon: typeof Activity
  detail: string
}) {
  return (
    <div className="nebula-surface bg-white border border-ink-100 rounded-2xl p-4 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink-500">{label}</p>
        <div className="w-9 h-9 rounded-xl bg-ink-50 flex items-center justify-center text-ink-500">
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-2xl font-display font-semibold text-ink-900 mt-3">{value}</p>
      <p className="text-xs text-ink-400 mt-1">{detail}</p>
    </div>
  )
}

function SessionCard({ session }: { session: Session }) {
  const navigate = useNavigate()
  const promptName = session.prompt?.name ?? 'Documento'

  return (
    <button
      onClick={() => navigate(`/sessions/${session.id}`)}
      className="nebula-surface group w-full text-left bg-white rounded-2xl border border-ink-100 shadow-soft hover:shadow-card hover:border-ink-200 transition-all duration-200 p-5 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-ink-900 truncate">
            {session.title || `${promptName} sem titulo`}
          </p>
          <p className="text-xs text-ink-400 mt-0.5 flex items-center gap-1.5">
            <Calendar className="w-3 h-3" />
            {formatSessionDate(session.createdAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Badge variant="ink">{promptName}</Badge>
          {statusBadge(session)}
        </div>
      </div>

      <div className="h-10 rounded-lg bg-ink-50 flex items-center px-3">
        <p className="text-xs text-ink-400 line-clamp-2">
          {session.status === 'IN_PROGRESS'
            ? 'Audio recebido e aguardando atualizacoes do processamento.'
            : 'Abra para ver transcricao, documento e historico.'}
        </p>
      </div>
    </button>
  )
}

function NotebookRow({
  name,
  sessions,
  childCount,
  onOpen,
  onNewSession,
}: {
  name: string
  sessions: Session[]
  childCount: number
  onOpen: () => void
  onNewSession: () => void
}) {
  const latest = latestSession(sessions)

  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 border-b border-ink-100 last:border-b-0 hover:bg-ink-50 transition-colors">
      <button onClick={onOpen} className="min-w-0 flex-1 flex items-center gap-3 text-left">
        <div className="w-8 h-8 rounded-lg bg-jade-50 text-jade-700 flex items-center justify-center shrink-0">
          <Folder className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-900 truncate">{name}</p>
          <p className="text-xs text-ink-400 truncate">
            {sessions.length} sessao{sessions.length !== 1 ? 'es' : ''} - {childCount} subpasta{childCount !== 1 ? 's' : ''}
          </p>
        </div>
      </button>

      <div className="hidden md:block w-40 text-xs text-ink-400 truncate">
        {latest ? `Ultima: ${formatSessionDate(latest.createdAt)}` : 'Sem atividade'}
      </div>

      <button
        onClick={onNewSession}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-900 hover:bg-white border border-transparent hover:border-ink-200 transition-all"
        title="Nova sessao neste caderno"
      >
        <FilePlus2 className="w-4 h-4" />
      </button>
      <button
        onClick={onOpen}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-300 hover:text-ink-900 hover:bg-white border border-transparent hover:border-ink-200 transition-all"
        title="Abrir caderno"
      >
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}

function AlertPanel({
  active,
  processing,
  root,
}: {
  active: number
  processing: number
  root: number
}) {
  const items = [
    active > 0 ? `${active} sessao${active !== 1 ? 'es' : ''} ainda ativa${active !== 1 ? 's' : ''}` : null,
    processing > 0 ? `${processing} audio${processing !== 1 ? 's' : ''} em processamento` : null,
    root > 0 ? `${root} sessao${root !== 1 ? 'es' : ''} em /root` : null,
  ].filter(Boolean)

  if (items.length === 0) return null

  return (
    <div className="nebula-surface bg-white border border-amber-100 rounded-2xl p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
          <AlertCircle className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-ink-900">Pontos que merecem atencao</p>
          <p className="text-sm text-ink-500 mt-1">{items.join(' - ')}</p>
        </div>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const [sessionList, setSessionList] = useState<Session[]>([])
  const [folderList, setFolderList] = useState<FolderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const { openNewSession } = useOutletContext<AppLayoutContext>()
  const [searchParams] = useSearchParams()
  const selectedFolderId = searchParams.get('folder')
  const isRootFolder = selectedFolderId === 'root'

  const load = async () => {
    setLoadError('')
    const [sessionRes, folderRes] = await Promise.all([sessionsApi.list(), foldersApi.list()])
    setSessionList(sessionRes.sessions ?? [])
    setFolderList(folderRes.folders ?? [])
  }

  useEffect(() => {
    load()
      .catch(() => {
        setLoadError('Não foi possível carregar suas sessões. Tente novamente.')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const refresh = () => {
      load().catch(() => undefined)
    }
    window.addEventListener('nebula:sessions-changed', refresh)
    return () => window.removeEventListener('nebula:sessions-changed', refresh)
  }, [])

  const selectedFolder = isRootFolder ? null : folderList.find((folder) => folder.id === selectedFolderId)
  const selectedSessions = useMemo(() => {
    if (isRootFolder) return sessionList.filter((session) => !session.folderId)
    if (!selectedFolderId) return sessionList
    return sessionsInFolder(selectedFolderId, sessionList, folderList)
  }, [isRootFolder, selectedFolderId, sessionList, folderList])
  const recentSessions = [...sessionList].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 4)
  const rootFolders = folderList.filter((folder) => !folder.parentId)
  const childFolders = selectedFolderId && !isRootFolder
    ? folderList.filter((folder) => folder.parentId === selectedFolderId)
    : rootFolders
  const activeCount = sessionList.filter((session) => session.status === 'ACTIVE').length
  const processingCount = sessionList.filter((session) => session.status === 'IN_PROGRESS').length
  const readyCount = sessionList.filter((session) => session.status === 'ENDED').length
  const rootSessions = sessionList.filter((session) => !session.folderId)
  const selectedName = isRootFolder ? '/root' : selectedFolder?.name
  const selectedModalFolderId = isRootFolder ? null : selectedFolderId
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  const scopedSessions = (normalizedQuery ? selectedSessions : selectedFolder || isRootFolder ? selectedSessions : rootSessions)
    .filter(session => !normalizedQuery || [session.title, session.prompt?.name].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(normalizedQuery))

  return (
    <div className="nebula-page px-4 py-8 sm:px-8 sm:py-10 max-w-7xl mx-auto">
      <div className="nebula-page-header flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          {(selectedFolder || isRootFolder) && (
            <button onClick={() => navigate('/')} className="text-sm text-ink-400 hover:text-ink-800 mb-2">
              Sessoes / {selectedName}
            </button>
          )}
          <h1 className="font-display text-2xl font-semibold text-ink-900 tracking-tight">
            {selectedName ?? 'Sua biblioteca'}
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            {selectedFolder || isRootFolder
              ? `${selectedSessions.length} sessao${selectedSessions.length !== 1 ? 'es' : ''} neste caderno`
              : 'Suas conversas, ideias e documentos. Tudo em um só lugar.'}
          </p>
        </div>
        <Button variant="primary" onClick={() => openNewSession(selectedModalFolderId)}>
          <Plus className="w-4 h-4" />
          Nova sessao
        </Button>
      </div>

      {loadError && <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">{loadError}<Button size="sm" onClick={() => { setLoading(true); void load().catch(() => setLoadError('Não foi possível carregar suas sessões. Tente novamente.')).finally(() => setLoading(false)) }}>Tentar novamente</Button></div>}
      {loading ? (
        <div role="status" aria-label="Carregando sessões" className="grid gap-4 py-6 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {!selectedFolder && !isRootFolder && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <MetricCard label="Sessoes" value={sessionList.length} icon={Mic} detail="Tudo que ja foi criado" />
                <MetricCard label="Processando" value={processingCount} icon={Activity} detail="Audios aguardando resultado" />
                <MetricCard label="Cadernos" value={folderList.length} icon={Layers} detail="Pastas e subpastas" />
                <MetricCard label="Prontas" value={readyCount} icon={Clock} detail="Documentos finalizados" />
              </div>

              <AlertPanel active={activeCount} processing={processingCount} root={rootSessions.length} />

              {recentSessions.length > 0 && (
                <section>
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <h2 className="font-display font-semibold text-lg text-ink-900">Continuar de onde parou</h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    {recentSessions.map((session) => (
                      <SessionCard key={session.id} session={session} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          <section>
            <div className="flex items-center justify-between gap-4 mb-3">
              <div>
                <h2 className="font-display font-semibold text-lg text-ink-900">
                  {selectedFolder || isRootFolder ? 'Subpastas' : 'Cadernos'}
                </h2>
                <p className="text-sm text-ink-400">
                  {selectedFolder || isRootFolder
                    ? 'Entre nas divisoes deste caderno.'
                    : 'Organize aulas e reunioes por tema, turma ou cliente.'}
                </p>
              </div>
            </div>

            {(!isRootFolder && (childFolders.length > 0 || (!selectedFolder && rootSessions.length > 0))) ? (
              <div className="nebula-surface bg-white border border-ink-100 rounded-2xl shadow-soft overflow-hidden">
                {!selectedFolder && rootSessions.length > 0 && (
                  <NotebookRow
                    name="/root"
                    sessions={rootSessions}
                    childCount={0}
                    onOpen={() => navigate('/?folder=root')}
                    onNewSession={() => openNewSession(null)}
                  />
                )}
                {childFolders.map((folder) => {
                  const folderSessions = sessionsInFolder(folder.id, sessionList, folderList)
                  const childCount = folderList.filter((item) => item.parentId === folder.id).length
                  return (
                    <NotebookRow
                      key={folder.id}
                      name={folder.name}
                      sessions={folderSessions}
                      childCount={childCount}
                      onOpen={() => navigate(`/?folder=${folder.id}`)}
                      onNewSession={() => openNewSession(folder.id)}
                    />
                  )
                })}
              </div>
            ) : (
              <div className="nebula-surface bg-white border border-ink-100 rounded-2xl p-8 text-center shadow-soft">
                <Folder className="w-9 h-9 mx-auto text-ink-300" />
                <p className="font-medium text-ink-700 mt-3">{selectedFolder || isRootFolder ? 'Nenhuma subpasta' : 'Nenhum caderno ainda'}</p>
                <p className="text-sm text-ink-400 mt-1">Use a barra lateral para criar a estrutura dos seus estudos e reunioes.</p>
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between gap-4 mb-3">
              <h2 className="font-display font-semibold text-lg text-ink-900">
                {normalizedQuery ? 'Resultados da busca' : selectedFolder || isRootFolder ? 'Sessões deste caderno' : 'Sessões sem caderno'}
              </h2>
            </div>

            <div className="mb-4 flex items-center gap-2 rounded-2xl border border-ink-200/70 bg-white/70 px-4 py-2.5 shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
              <Search className="h-4 w-4 shrink-0 text-ink-400" />
              <input aria-label="Buscar sessões por título ou template" placeholder={selectedFolder || isRootFolder ? 'Buscar neste caderno…' : 'Buscar em todas as sessões…'} value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none" />
              {query && <button type="button" aria-label="Limpar busca" className="nebula-icon-button text-ink-500" onClick={() => setQuery('')}><X className="h-4 w-4" /></button>}
            </div>
            {scopedSessions.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {scopedSessions.map((session) => (
                  <SessionCard key={session.id} session={session} />
                ))}
              </div>
            ) : (
              <div className="nebula-surface bg-white border border-ink-100 rounded-2xl p-8 text-center shadow-soft">
                <Mic className="w-9 h-9 mx-auto text-ink-300" />
                <p className="font-medium text-ink-700 mt-3">{normalizedQuery ? 'Nenhuma sessão encontrada' : 'Nenhuma sessão aqui'}</p>
                <p className="text-sm text-ink-400 mt-1">{normalizedQuery ? 'Tente outro título ou nome de template.' : 'Crie sua primeira sessão neste espaço.'}</p>
                <Button variant="primary" className="mt-4" onClick={() => openNewSession(selectedModalFolderId)}>
                  <Plus className="w-4 h-4" />
                  Nova sessao
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
