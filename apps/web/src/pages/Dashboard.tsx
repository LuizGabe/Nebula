import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Mic, BookOpen, Calendar } from 'lucide-react'
import { sessions as sessionsApi, type Session, type SessionMode } from '../api/client'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/misc'
import { Spinner } from '../components/ui/misc'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { safeDate } from '@/utils/SafeDate'
import { PipelineStatus } from '@/components/PipelineStatus'

function NewSessionModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (s: Session) => void
}) {
  const [mode, setMode] = useState<SessionMode>('MEETING')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)

  const handle = async () => {
    setLoading(true)
    try {
      const s = await sessionsApi.create(mode, title || undefined)
      onCreate(s)
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
        <h2 className="font-display font-semibold text-xl text-ink-900 mb-5">Nova sessão</h2>

        <div className="flex flex-col gap-4">
          {/* Mode */}
          <div>
            <p className="text-sm font-medium text-ink-700 mb-2">Tipo</p>
            <div className="flex gap-2">
              {(['MEETING', 'CLASS'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border text-sm font-medium transition-all ${mode === m
                      ? 'border-ink-900 bg-ink-900 text-white'
                      : 'border-ink-200 text-ink-600 hover:border-ink-400 hover:bg-ink-50'
                    }`}
                >
                  {m === 'MEETING' ? <><Mic className="w-4 h-4" /> Reunião</> : <><BookOpen className="w-4 h-4" /> Aula</>}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <p className="text-sm font-medium text-ink-700 mb-2">Título <span className="text-ink-400 font-normal">(opcional)</span></p>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ex: Daily de segunda-feira"
              onKeyDown={(e) => e.key === 'Enter' && handle()}
              className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 placeholder:text-ink-400 transition-all"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" className="flex-1" loading={loading} onClick={handle}>
            Criar sessão
          </Button>
        </div>
      </div>
    </div>
  )
}

function SessionCard({ session }: { session: Session }) {
  const navigate = useNavigate()
  const isActive = session.status === 'ACTIVE'

  return (
    <button
      onClick={() => navigate(`/sessions/${session.id}`)}
      className="group w-full text-left bg-white rounded-2xl border border-ink-100 shadow-soft hover:shadow-card hover:border-ink-200 transition-all duration-200 p-5 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-ink-900 truncate">
            {session.title || (session.mode === 'MEETING' ? 'Reunião sem título' : 'Aula sem título')}
          </p>
          <p className="text-xs text-ink-400 mt-0.5 flex items-center gap-1.5">
            <Calendar className="w-3 h-3" />
            {safeDate(session.createdAt)
              ? format(safeDate(session.createdAt)!, "d 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })
              : '—'
            }
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Badge variant={session.mode === 'MEETING' ? 'ink' : 'default'}>
            {session.mode === 'MEETING' ? 'Reunião' : 'Aula'}
          </Badge>
          {isActive && (
            <Badge variant="rose">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500" />
              </span>
              Ativa
            </Badge>
          )}
          {
            !isActive && (
              <Badge variant="orange">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500" />
                </span>
                Encerrada
              </Badge>
            )
          }
        </div>
      </div>

      {/* Preview placeholder */}
      <div className="h-10 rounded-lg bg-ink-50 flex items-center px-3">
        <p className="text-xs text-ink-400 line-clamp-2">
          {isActive ? 'Sessão em andamento...' : 'Clique para ver a transcrição e o documento gerado'}
        </p>
      </div>
    </button>
  )
}

export function DashboardPage() {
  const [sessionList, setSessionList] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    sessionsApi.list().then((s: any) => {
      // API pode retornar array direto ou { sessions: [] } ou { data: [] }
      const list = Array.isArray(s) ? s : (s.sessions ?? s.data ?? [])
      setSessionList(list)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleCreate = (s: Session) => {
    setShowModal(false)
    navigate(`/sessions/${s.id}`)
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900 tracking-tight">Sessões</h1>
          <p className="text-sm text-ink-500 mt-0.5">{sessionList.length} Sess{sessionList.length !== 1 ? 'ões' : 'ão'}</p>
        </div>
        <Button variant="primary" onClick={() => setShowModal(true)}>
          <Plus className="w-4 h-4" />
          Nova sessão
        </Button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="w-8 h-8" />
        </div>
      ) : sessionList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-ink-100 flex items-center justify-center">
            <Mic className="w-8 h-8 text-ink-400" />
          </div>
          <div>
            <p className="font-medium text-ink-700">Nenhuma sessão ainda</p>
            <p className="text-sm text-ink-400 mt-1">Crie sua primeira sessão para começar a gravar</p>
          </div>
          <Button variant="primary" onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            Nova sessão
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessionList.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}

      {showModal && (
        <NewSessionModal onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}
    </div>
  )
}