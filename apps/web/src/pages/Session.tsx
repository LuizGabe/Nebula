import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, MessageSquare, Mic, BookOpen, CheckCircle2, Trash2, Pencil } from 'lucide-react'
import { sessions as sessionsApi, type Session } from '../api/client'
import { RecordingPanel } from '../components/RecordingPanel'
import { PipelineStatus } from '../components/PipelineStatus'
import { TranscriptViewer } from '../components/TranscriptViewer'
import { DocumentEditor } from '../components/DocumentEditor'
import { QADrawer } from '../components/QADrawer'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/misc'
import { Spinner } from '../components/ui/misc'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { safeDate } from '@/utils/SafeDate'
import { DetailedProcessingStatus, useProcessingStatus } from '@/hooks/useProcessingStatus'

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

  const isEnded = session?.status === 'ENDED' || ended

  const processingStatus: DetailedProcessingStatus = useProcessingStatus(id || '', isEnded)

  const handleRename = async () => {
    if (!id || !renameValue.trim()) return
    await sessionsApi.rename(id, renameValue.trim())
    setSession((s) => s ? { ...s, title: renameValue.trim() } : s)
    setRenaming(false)
  }

  const handleDelete = async () => {
    if (!id || !confirm('Excluir esta sessão? Esta ação não pode ser desfeita.')) return
    await sessionsApi.delete(id)
    navigate('/')
  }

  useEffect(() => {
    if (!id) return
    sessionsApi.get(id).then((data) => {
      const session = data.session
      setSession(session)
      if (session.status === 'ENDED') setEnded(true)
      setLoading(false)
    }).catch(() => navigate('/'))
  }, [id, navigate])

  const handleEnd = async () => {
    if (!id) return
    try {
      await sessionsApi.end(id)
      setEnded(true)
      setSession((s) => s ? { ...s, status: 'ENDED' } : s)
    } catch { }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner className="w-8 h-8" />
      </div>
    )
  }

  if (!session) return null

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Back */}
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Sessões
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant={session.mode === 'MEETING' ? 'ink' : 'default'}>
              {session.mode === 'MEETING'
                ? <><Mic className="w-3 h-3" /> Reunião</>
                : <><BookOpen className="w-3 h-3" /> Aula</>
              }
            </Badge>
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
                {session.title || (session.mode === 'MEETING' ? 'Reunião sem título' : 'Aula sem título')}
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
              ? format(safeDate(session.createdAt)!, "d 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })
              : '—'
            }
          </p>
          <p className="text-sm text-ink-400 mt-1">
            Id: {session.id}
          </p>
        </div>

        {isEnded && (
          <Button
            variant="secondary"
            onClick={() => setShowQA(true)}
          >
            <MessageSquare className="w-4 h-4" />
            Perguntar
          </Button>
        )}
        <Button variant="ghost" onClick={handleDelete} className="text-rose-500 hover:text-rose-700 hover:bg-rose-50">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Content stack */}
      <div className="flex flex-col gap-4 items-center">
        {/* Recording panel — always shown while active */}
        {!isEnded && (
          <div className="fade-in w-full max-w-4xl">
            <RecordingPanel
              sessionId={session.id}
              onEnd={handleEnd}
            />
          </div>
        )}

        {/* Pipeline status — shown after ending */}
          <div className="fade-in w-full max-w-4xl">
            
        {isEnded && processingStatus !== 'idle' && (
            <PipelineStatus status={processingStatus} />
        )}
            {
              session.title?.includes('[testes]') && (
                <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
                  <p className="text-sm text-yellow-800">⚠️ Sessão para testes</p>
                  <div className="mt-2 p-3 bg-yellow-100 border border-yellow-300 rounded font-mono text-xs text-yellow-900 max-h-40 overflow-y-auto">
                    <div>Session ID: {session.id}</div>
                    <div>Status: {session.status}</div>
                    <div>Mode: {session.mode}</div>
                    <div>Processing: {processingStatus}</div>
                  </div>
                </div>
              )
            }
          </div>

        {/* Transcript — shown after session ended */}
        {isEnded && (
          <div className="fade-in w-full max-w-4xl">
            <TranscriptViewer sessionId={session.id} />
          </div>
        )}

        {/* Document — shown after session ended */}
        {isEnded && (
          <div className="fade-in w-full max-w-4xl">
            <DocumentEditor
              sessionId={session.id}
              onReprocessed={() => setReprocessTrigger((n) => n + 1)}
            />
          </div>
        )}
      </div>

      {/* QA Drawer */}
      {
        showQA && (
          <QADrawer sessionId={session.id} onClose={() => setShowQA(false)} />
        )
      }
    </div >
  )
}