import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, FileText, FolderOpen, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { folders as foldersApi, prompts as promptsApi, sessions as sessionsApi, type Folder, type Prompt, type Session } from '../api/client'
import { RecordingPanel } from '../components/RecordingPanel'
import { PipelineStatus } from '../components/PipelineStatus'
import { TranscriptViewer } from '../components/TranscriptViewer'
import { DocumentEditor } from '../components/DocumentEditor'
import { QADrawer } from '../components/QADrawer'
import { Button } from '../components/ui/Button'
import { Badge, Spinner } from '../components/ui/misc'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { safeDate } from '@/utils/SafeDate'
import { useSessionEvents } from '@/hooks/useProcessingStatus'

export function SessionPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [ended, setEnded] = useState(false)
  const [showQA, setShowQA] = useState(false)
  const [reprocessTrigger, setReprocessTrigger] = useState(0)
  const [promptList, setPromptList] = useState<Prompt[]>([])
  const [folderList, setFolderList] = useState<Folder[]>([])
  const [processingHint, setProcessingHint] = useState(false)

  const isEnded = session?.status === 'ENDED' || ended
  const { status, liveText, transcriptionProgress } = useSessionEvents(id || '', isEnded)
  const visibleStatus = status === 'idle' && processingHint ? 'waiting:transcript' : status

  const handleRename = async () => {
    if (!id || !renameValue.trim()) return
    await sessionsApi.rename(id, renameValue.trim())
    setSession((current) => current ? { ...current, title: renameValue.trim() } : current)
    setRenaming(false)
  }

  const handleDelete = async () => {
    if (!id || !confirm('Excluir esta sessao? Esta acao nao pode ser desfeita.')) return
    await sessionsApi.delete(id)
    navigate('/')
  }

  useEffect(() => {
    if (!id) return
    Promise.all([sessionsApi.get(id), promptsApi.list(), foldersApi.list()])
      .then(([data, promptRes, folderRes]) => {
        const loaded = data.session
        setSession(loaded)
        setPromptList(promptRes.prompts ?? [])
        setFolderList(folderRes.folders ?? [])
        if (loaded.status === 'ENDED' || loaded.status === 'IN_PROGRESS') setEnded(true)
        setLoading(false)
      })
      .catch(() => navigate('/'))
  }, [id, navigate])

  const handleEnd = async () => {
    if (!id) return
    try {
      await sessionsApi.end(id)
      setEnded(true)
      setSession((current) => current ? { ...current, status: 'ENDED' } : current)
    } catch { }
  }

  const handlePromptChange = async (promptId: string) => {
    if (!id || !session) return
    const { session: updated } = await sessionsApi.update(id, { promptId })
    setSession((current) => current ? { ...current, ...updated } : updated)
  }

  const handleFolderChange = async (folderId: string) => {
    if (!id || !session) return
    const { session: updated } = await sessionsApi.update(id, { folderId: folderId || null })
    setSession((current) => current ? { ...current, ...updated } : updated)
  }

  const handleUploadStarted = () => {
    setProcessingHint(true)
    setEnded(true)
    setSession((current) => current ? { ...current, status: 'IN_PROGRESS' } : current)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner className="w-8 h-8" />
      </div>
    )
  }

  if (!session) return null

  const promptName = session.prompt?.name ?? 'Documento'

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Sessoes
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="ink">
              <FileText className="w-3 h-3" />
              {promptName}
            </Badge>
            {session.folder && (
              <Badge variant="ink">
                <FolderOpen className="w-3 h-3" />
                {session.folder.name}
              </Badge>
            )}
            {isEnded ? (
              <Badge variant="jade">
                <CheckCircle2 className="w-3 h-3" />
                Encerrada
              </Badge>
            ) : (
              <Badge variant="rose">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500" />
                </span>
                Ativa
              </Badge>
            )}
          </div>

          {renaming ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') setRenaming(false)
                }}
                className="font-display text-2xl font-semibold text-ink-900 tracking-tight bg-transparent border-b-2 border-ink-400 outline-none w-full"
              />
              <Button size="sm" variant="primary" onClick={handleRename}>Salvar</Button>
              <Button size="sm" variant="secondary" onClick={() => setRenaming(false)}>Cancelar</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-1 group">
              <h1 className="font-display text-2xl font-semibold text-ink-900 tracking-tight">
                {session.title || `${promptName} sem titulo`}
              </h1>
              <button
                onClick={() => { setRenameValue(session.title ?? ''); setRenaming(true) }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-400 hover:text-ink-700 p-1 rounded-lg"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}

          <p className="text-sm text-ink-400 mt-1">
            {safeDate(session.createdAt)
              ? format(safeDate(session.createdAt)!, "d 'de' MMMM 'de' yyyy 'as' HH:mm", { locale: ptBR })
              : '-'
            }
          </p>
          <p className="text-sm text-ink-400 mt-1">Id: {session.id}</p>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-500">Tipo de prompt</span>
              <select
                value={session.promptId ?? ''}
                onChange={(e) => handlePromptChange(e.target.value)}
                className="h-10 px-3 rounded-xl border border-ink-200 bg-white text-sm text-ink-800 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100"
              >
                {promptList.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>{prompt.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-500">Pasta</span>
              <select
                value={session.folderId ?? ''}
                onChange={(e) => handleFolderChange(e.target.value)}
                className="h-10 px-3 rounded-xl border border-ink-200 bg-white text-sm text-ink-800 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100"
              >
                <option value="">Sem pasta</option>
                {folderList.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {isEnded && (
          <Button variant="secondary" onClick={() => setShowQA(true)}>
            <MessageSquare className="w-4 h-4" />
            Perguntar
          </Button>
        )}
        <Button variant="ghost" onClick={handleDelete} className="text-rose-500 hover:text-rose-700 hover:bg-rose-50">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-4 items-center">
        {!isEnded && (
          <div className="fade-in w-full max-w-4xl">
            <RecordingPanel sessionId={session.id} onEnd={handleEnd} onUploadStarted={handleUploadStarted} />
          </div>
        )}

        {isEnded && visibleStatus !== 'idle' && (
          <div className="fade-in w-full max-w-4xl">
            <PipelineStatus status={visibleStatus} />
          </div>
        )}

        {session.title?.includes('[testes]') && (
          <div className="fade-in w-full max-w-4xl mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <p className="text-sm text-yellow-800">Sessao para testes</p>
            <div className="mt-2 p-3 bg-yellow-100 border border-yellow-300 rounded font-mono text-xs text-yellow-900 max-h-40 overflow-y-auto">
              <div>Session ID: {session.id}</div>
              <div>Status: {session.status}</div>
              <div>Prompt: {promptName}</div>
              <div>Processing: {visibleStatus}</div>
              <div>Live Text: {liveText ? 'tem conteudo' : 'null'}</div>
            </div>
          </div>
        )}

        {isEnded && (
          <div className="fade-in w-full max-w-4xl">
            <TranscriptViewer sessionId={session.id} liveText={liveText} transcriptionProgress={transcriptionProgress} />
          </div>
        )}

        {isEnded && (
          <div className="fade-in w-full max-w-4xl">
            <DocumentEditor
              sessionId={session.id}
              onReprocessed={() => setReprocessTrigger((n) => n + 1)}
            />
          </div>
        )}
      </div>

      {showQA && (
        <QADrawer sessionId={session.id} onClose={() => setShowQA(false)} />
      )}
    </div>
  )
}
