import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Calendar, FileText, FolderOpen, Mic, Plus } from 'lucide-react'
import { folders as foldersApi, prompts as promptsApi, sessions as sessionsApi, type Folder, type Prompt, type Session } from '../api/client'
import { Button } from '../components/ui/Button'
import { Badge, Spinner } from '../components/ui/misc'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { safeDate } from '@/utils/SafeDate'

function NewSessionModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (s: Session) => void
}) {
  const [promptList, setPromptList] = useState<Prompt[]>([])
  const [folderList, setFolderList] = useState<Folder[]>([])
  const [promptId, setPromptId] = useState('')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchParams] = useSearchParams()

  useEffect(() => {
    promptsApi.list()
      .then(({ prompts }) => {
        setPromptList(prompts)
        setPromptId(prompts.find((p) => p.isDefault)?.id ?? prompts[0]?.id ?? '')
      })
      .catch(() => setPromptList([]))

    foldersApi.list()
      .then(({ folders }) => {
        setFolderList(folders)
        setFolderId(searchParams.get('folder'))
      })
      .catch(() => setFolderList([]))
  }, [])

  const handle = async () => {
    if (!promptId) return
    setLoading(true)
    try {
      const { session } = await sessionsApi.create(promptId, title || undefined, folderId)
      onCreate(session)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-float border border-ink-100 p-6 w-full max-w-md fade-in">
        <h2 className="font-display font-semibold text-xl text-ink-900 mb-5">Nova sessao</h2>

        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-ink-700 mb-2">Prompt</p>
            <div className="grid grid-cols-1 gap-2">
              {promptList.map((prompt) => (
                <button
                  key={prompt.id}
                  onClick={() => setPromptId(prompt.id)}
                  className={`flex items-center justify-between gap-3 py-2.5 px-4 rounded-xl border text-sm font-medium transition-all ${promptId === prompt.id
                    ? 'border-ink-900 bg-ink-900 text-white'
                    : 'border-ink-200 text-ink-600 hover:border-ink-400 hover:bg-ink-50'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 shrink-0" />
                    <span className="truncate">{prompt.name}</span>
                  </span>
                  {prompt.isDefault && <span className="text-xs opacity-70">padrao</span>}
                </button>
              ))}
              {promptList.length === 0 && (
                <p className="text-sm text-ink-400">Nenhum prompt cadastrado.</p>
              )}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-ink-700 mb-2">
              Titulo <span className="text-ink-400 font-normal">(opcional)</span>
            </p>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ex: Daily de segunda-feira"
              onKeyDown={(e) => e.key === 'Enter' && handle()}
              className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 placeholder:text-ink-400 transition-all"
            />
          </div>

          <div>
            <p className="text-sm font-medium text-ink-700 mb-2">Pasta</p>
            <select
              value={folderId ?? ''}
              onChange={(e) => setFolderId(e.target.value || null)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 transition-all"
            >
              <option value="">Sem pasta</option>
              {folderList.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" className="flex-1" loading={loading} disabled={!promptId} onClick={handle}>
            Criar sessao
          </Button>
        </div>
      </div>
    </div>
  )
}

function SessionCard({ session }: { session: Session }) {
  const navigate = useNavigate()
  const isActive = session.status === 'ACTIVE'
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
            {safeDate(session.createdAt)
              ? format(safeDate(session.createdAt)!, "d 'de' MMMM 'de' yyyy 'as' HH:mm", { locale: ptBR })
              : '-'
            }
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Badge variant="ink">{promptName}</Badge>
          {isActive ? (
            <Badge variant="rose">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500" />
              </span>
              Ativa
            </Badge>
          ) : (
            <Badge variant="orange">
              <span className="relative flex h-1.5 w-1.5">
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500" />
              </span>
              Encerrada
            </Badge>
          )}
        </div>
      </div>

      <div className="h-10 rounded-lg bg-ink-50 flex items-center px-3">
        <p className="text-xs text-ink-400 line-clamp-2">
          {isActive ? 'Sessao em andamento...' : 'Clique para ver a transcricao e o documento gerado'}
        </p>
      </div>
    </button>
  )
}

export function DashboardPage() {
  const [sessionList, setSessionList] = useState<Session[]>([])
  const [folderList, setFolderList] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const selectedFolderId = searchParams.get('folder')

  useEffect(() => {
    Promise.all([sessionsApi.list(), foldersApi.list()])
      .then(([sessionRes, folderRes]) => {
        setSessionList(sessionRes.sessions ?? [])
        setFolderList(folderRes.folders ?? [])
      })
      .catch(() => {
        setSessionList([])
        setFolderList([])
      })
      .finally(() => setLoading(false))
  }, [])

  const handleCreate = (session: Session) => {
    setShowModal(false)
    navigate(`/sessions/${session.id}`)
  }

  const visibleSessions = selectedFolderId
    ? sessionList.filter((session) => session.folderId === selectedFolderId)
    : sessionList
  const selectedFolder = folderList.find((folder) => folder.id === selectedFolderId)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900 tracking-tight">
            {selectedFolder ? selectedFolder.name : 'Sessoes'}
          </h1>
          <p className="text-sm text-ink-500 mt-0.5 flex items-center gap-1.5">
            {selectedFolder && <FolderOpen className="w-3.5 h-3.5" />}
            {visibleSessions.length} sessao{visibleSessions.length !== 1 ? 'es' : ''}
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowModal(true)}>
          <Plus className="w-4 h-4" />
          Nova sessao
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="w-8 h-8" />
        </div>
      ) : visibleSessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-ink-100 flex items-center justify-center">
            <Mic className="w-8 h-8 text-ink-400" />
          </div>
          <div>
            <p className="font-medium text-ink-700">Nenhuma sessao ainda</p>
            <p className="text-sm text-ink-400 mt-1">Crie sua primeira sessao para comecar a gravar</p>
          </div>
          <Button variant="primary" onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            Nova sessao
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleSessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}

      {showModal && (
        <NewSessionModal onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}
    </div>
  )
}
