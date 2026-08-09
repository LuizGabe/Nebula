import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { Activity, AlertCircle, ArrowRight, Calendar, Clock, Folder, FolderOpen, Layers, Mic, Plus } from 'lucide-react'
import { folders as foldersApi, sessions as sessionsApi, type Folder as FolderItem, type Session } from '../api/client'
import type { AppLayoutContext } from '../components/layout/AppLayout'
import { Button } from '../components/ui/Button'
import { Badge, Spinner } from '../components/ui/misc'
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
  return format(date, "d MMM, HH:mm", { locale: ptBR })
}

function statusBadge(session: Session) {
  if (session.status === 'IN_PROGRESS') {
    return <Badge variant="amber">Transcrevendo</Badge>
  }
  if (session.status === 'ACTIVE') {
    return <Badge variant="rose">Ativa</Badge>
  }
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
    <div className="bg-white border border-ink-100 rounded-2xl p-4 shadow-soft">
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
      className="group w-full text-left bg-white rounded-2xl border border-ink-100 shadow-soft hover:shadow-card hover:border-ink-200 transition-all duration-200 p-5 flex flex-col gap-3"
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

function NotebookCard({
  folder,
  sessions,
  childCount,
  onOpen,
  onNewSession,
}: {
  folder: FolderItem
  sessions: Session[]
  childCount: number
  onOpen: () => void
  onNewSession: () => void
}) {
  const navigate = useNavigate()
  const latest = latestSession(sessions)
  const recent = [...sessions].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 2)

  return (
    <article className="bg-white rounded-2xl border border-ink-100 shadow-soft hover:shadow-card hover:border-ink-200 transition-all p-5">
      <button onClick={onOpen} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="w-11 h-11 rounded-2xl bg-jade-50 text-jade-700 flex items-center justify-center shrink-0">
            <FolderOpen className="w-5 h-5" />
          </div>
          <ArrowRight className="w-4 h-4 text-ink-300" />
        </div>
        <h3 className="font-display font-semibold text-lg text-ink-900 mt-4 truncate">{folder.name}</h3>
        <p className="text-sm text-ink-400 mt-1">
          {sessions.length} sessao{sessions.length !== 1 ? 'es' : ''} · {childCount} subpasta{childCount !== 1 ? 's' : ''}
        </p>
      </button>

      <div className="mt-4 min-h-[72px] flex flex-col gap-2">
        {recent.length > 0 ? recent.map((session) => (
          <button
            key={session.id}
            onClick={() => navigate(`/sessions/${session.id}`)}
            className="h-8 px-2 rounded-lg bg-ink-50 hover:bg-ink-100 flex items-center justify-between gap-2 text-xs text-ink-500"
          >
            <span className="truncate">{session.title || session.prompt?.name || 'Sessao'}</span>
            <span className="shrink-0">{formatSessionDate(session.createdAt)}</span>
          </button>
        )) : (
          <div className="h-[72px] rounded-xl bg-ink-50 flex items-center px-3">
            <p className="text-xs text-ink-400">Caderno pronto para receber aulas, reunioes ou audios soltos.</p>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-ink-100 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-400 truncate">
          {latest ? `Ultima: ${formatSessionDate(latest.createdAt)}` : 'Sem atividade ainda'}
        </p>
        <Button variant="secondary" size="sm" onClick={onNewSession}>
          <Plus className="w-3.5 h-3.5" />
          Sessao
        </Button>
      </div>
    </article>
  )
}

function AlertPanel({
  active,
  processing,
  unfiled,
}: {
  active: number
  processing: number
  unfiled: number
}) {
  const items = [
    active > 0 ? `${active} sessao${active !== 1 ? 'es' : ''} ainda ativa${active !== 1 ? 's' : ''}` : null,
    processing > 0 ? `${processing} audio${processing !== 1 ? 's' : ''} em processamento` : null,
    unfiled > 0 ? `${unfiled} sessao${unfiled !== 1 ? 'es' : ''} sem caderno` : null,
  ].filter(Boolean)

  if (items.length === 0) return null

  return (
    <div className="bg-white border border-amber-100 rounded-2xl p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
          <AlertCircle className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-ink-900">Pontos que merecem atencao</p>
          <p className="text-sm text-ink-500 mt-1">{items.join(' · ')}</p>
        </div>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const [sessionList, setSessionList] = useState<Session[]>([])
  const [folderList, setFolderList] = useState<FolderItem[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const { openNewSession } = useOutletContext<AppLayoutContext>()
  const [searchParams] = useSearchParams()
  const selectedFolderId = searchParams.get('folder')

  const load = async () => {
    const [sessionRes, folderRes] = await Promise.all([sessionsApi.list(), foldersApi.list()])
    setSessionList(sessionRes.sessions ?? [])
    setFolderList(folderRes.folders ?? [])
  }

  useEffect(() => {
    load()
      .catch(() => {
        setSessionList([])
        setFolderList([])
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

  const selectedFolder = folderList.find((folder) => folder.id === selectedFolderId)
  const selectedSessions = useMemo(() => {
    if (!selectedFolderId) return sessionList
    return sessionsInFolder(selectedFolderId, sessionList, folderList)
  }, [selectedFolderId, sessionList, folderList])
  const recentSessions = [...sessionList].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 4)
  const rootFolders = folderList.filter((folder) => !folder.parentId)
  const childFolders = selectedFolderId ? folderList.filter((folder) => folder.parentId === selectedFolderId) : rootFolders
  const activeCount = sessionList.filter((session) => session.status === 'ACTIVE').length
  const processingCount = sessionList.filter((session) => session.status === 'IN_PROGRESS').length
  const readyCount = sessionList.filter((session) => session.status === 'ENDED').length
  const unfiledSessions = sessionList.filter((session) => !session.folderId)

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          {selectedFolder && (
            <button onClick={() => navigate('/')} className="text-sm text-ink-400 hover:text-ink-800 mb-2">
              Sessoes / {selectedFolder.name}
            </button>
          )}
          <h1 className="font-display text-2xl font-semibold text-ink-900 tracking-tight">
            {selectedFolder ? selectedFolder.name : 'Painel principal'}
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            {selectedFolder
              ? `${selectedSessions.length} sessao${selectedSessions.length !== 1 ? 'es' : ''} neste caderno e subpastas`
              : 'Visao rapida das sessoes, cadernos e itens que estao em andamento.'}
          </p>
        </div>
        <Button variant="primary" onClick={() => openNewSession(selectedFolderId)}>
          <Plus className="w-4 h-4" />
          Nova sessao
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="w-8 h-8" />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {!selectedFolder && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <MetricCard label="Sessoes" value={sessionList.length} icon={Mic} detail="Tudo que ja foi criado" />
                <MetricCard label="Processando" value={processingCount} icon={Activity} detail="Audios aguardando resultado" />
                <MetricCard label="Cadernos" value={folderList.length} icon={Layers} detail="Pastas e subpastas" />
                <MetricCard label="Prontas" value={readyCount} icon={Clock} detail="Documentos finalizados" />
              </div>

              <AlertPanel active={activeCount} processing={processingCount} unfiled={unfiledSessions.length} />

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
                  {selectedFolder ? 'Subpastas' : 'Cadernos'}
                </h2>
                <p className="text-sm text-ink-400">
                  {selectedFolder ? 'Entre nas divisões deste caderno.' : 'Organize aulas e reunioes por tema, turma ou cliente.'}
                </p>
              </div>
            </div>

            {childFolders.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {childFolders.map((folder) => {
                  const folderSessions = sessionsInFolder(folder.id, sessionList, folderList)
                  const childCount = folderList.filter((item) => item.parentId === folder.id).length
                  return (
                    <NotebookCard
                      key={folder.id}
                      folder={folder}
                      sessions={folderSessions}
                      childCount={childCount}
                      onOpen={() => navigate(`/?folder=${folder.id}`)}
                      onNewSession={() => openNewSession(folder.id)}
                    />
                  )
                })}
              </div>
            ) : (
              <div className="bg-white border border-ink-100 rounded-2xl p-8 text-center shadow-soft">
                <Folder className="w-9 h-9 mx-auto text-ink-300" />
                <p className="font-medium text-ink-700 mt-3">{selectedFolder ? 'Nenhuma subpasta' : 'Nenhum caderno ainda'}</p>
                <p className="text-sm text-ink-400 mt-1">Use a barra lateral para criar a estrutura dos seus estudos e reunioes.</p>
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between gap-4 mb-3">
              <h2 className="font-display font-semibold text-lg text-ink-900">
                {selectedFolder ? 'Sessoes deste caderno' : 'Sessoes sem caderno'}
              </h2>
            </div>

            {(selectedFolder ? selectedSessions : unfiledSessions).length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {(selectedFolder ? selectedSessions : unfiledSessions).map((session) => (
                  <SessionCard key={session.id} session={session} />
                ))}
              </div>
            ) : (
              <div className="bg-white border border-ink-100 rounded-2xl p-8 text-center shadow-soft">
                <Mic className="w-9 h-9 mx-auto text-ink-300" />
                <p className="font-medium text-ink-700 mt-3">Nenhuma sessao aqui</p>
                <p className="text-sm text-ink-400 mt-1">Crie uma nova sessao ja conectada ao lugar certo.</p>
                <Button variant="primary" className="mt-4" onClick={() => openNewSession(selectedFolderId)}>
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
