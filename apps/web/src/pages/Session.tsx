import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ChevronRight, FileText, Folder, MessageSquare, Pencil, Trash2, X } from 'lucide-react'
import { folders as foldersApi, prompts as promptsApi, sessions as sessionsApi, system as systemApi, type Folder as FolderItem, type Prompt, type SelectedTranscriptionEngine, type Session, type SessionAudioMedia } from '../api/client'
import { TemplateSwitchDialog } from '../components/TemplateSwitchDialog'
import { emptyOverrides, hasOverrides } from '../utils/templates'
import { RecordingPanel } from '../components/RecordingPanel'
import { TranscriptProductivity } from '../components/TranscriptProductivity'
import { RecordingMilestones } from '../components/RecordingMilestones'
import { SessionAudioPlayer, type SessionAudioPlayerHandle } from '../components/SessionAudioPlayer'
import { PipelineStatus } from '../components/PipelineStatus'
import { TranscriptViewer } from '../components/TranscriptViewer'
import { DocumentEditor } from '../components/DocumentEditor'
import { QADrawer } from '../components/QADrawer'
import { Button } from '../components/ui/Button'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { Badge } from '../components/ui/misc'
import { SessionSkeleton } from '../components/ui/Skeleton'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { safeDate } from '@/utils/SafeDate'
import { type LiveTranscription, useSessionEvents } from '@/hooks/useProcessingStatus'

export function SessionPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [ended, setEnded] = useState(false)
  const [showQA, setShowQA] = useState(false)
  const [showPromptModal, setShowPromptModal] = useState(false)
  const [promptBusy, setPromptBusy] = useState(false)
  const [promptError, setPromptError] = useState('')
  const [confirmPromptSwitch, setConfirmPromptSwitch] = useState(false)
  const promptSaveLock = useRef(false)
  const promptDialogRef = useDialogFocus(() => { if (!promptSaveLock.current) setShowPromptModal(false) }, showPromptModal)
  const [reprocessTrigger, setReprocessTrigger] = useState(0)
  const [promptList, setPromptList] = useState<Prompt[]>([])
  const [folderList, setFolderList] = useState<FolderItem[]>([])
  const [promptDraftId, setPromptDraftId] = useState('')
  const [processingHint, setProcessingHint] = useState(false)
  const [transcriptionEngine, setTranscriptionEngine] = useState<SelectedTranscriptionEngine | null>(null)
  const [browserLiveText, setBrowserLiveText] = useState<LiveTranscription[]>([])
  const [audioMedia, setAudioMedia] = useState<SessionAudioMedia[]>([])
  const [activeAudio, setActiveAudio] = useState<SessionAudioMedia | null>(null)
  const [pendingSeek, setPendingSeek] = useState<number | null>(null)
  const [audioError, setAudioError] = useState('')
  const audioRef = useRef<SessionAudioPlayerHandle | null>(null)

  const isEnded = session?.status === 'ENDED' || session?.status === 'IN_PROGRESS' || session?.status === 'ERROR' || ended
  const { status, liveText, transcriptionProgress, transcriptVersion, documentVersion, audioVersion, processingMessage, errorMessage, sourceTitle } = useSessionEvents(id || '', isEnded)
  const visibleStatus = status === 'idle' && processingHint ? 'waiting:transcript' : status

  useEffect(() => {
    if (sourceTitle) setSession((current) => current && !current.title?.trim() ? { ...current, title: sourceTitle } : current)
  }, [sourceTitle, session?.id])

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
        setPromptDraftId(loaded.promptId ?? promptRes.prompts?.[0]?.id ?? '')
        if (loaded.status === 'ENDED' || loaded.status === 'IN_PROGRESS') setEnded(true)
        setLoading(false)
      })
      .catch(() => navigate('/'))

    systemApi.transcriptionEngine()
      .then(setTranscriptionEngine)
      .catch(() => setTranscriptionEngine({
        mode: 'web_speech',
        label: 'Google Speech-to-Text',
        activeWorkers: [],
        browserFallback: {
          id: 'web-speech',
          name: 'Google Speech-to-Text',
          provider: 'browser',
          active: true,
          acceptingStreams: true,
          message: 'Web Speech API do navegador',
        },
      }))
  }, [id, navigate])

  const loadAudioMedia = useCallback(async () => {
    if (!id) return []
    try {
      const result = await sessionsApi.audioMedia(id)
      const next = result.audioMedia ?? []
      setAudioMedia(next)
      return next
    } catch {
      setAudioMedia([])
      return []
    }
  }, [id])

  useEffect(() => {
    loadAudioMedia()
  }, [loadAudioMedia, transcriptVersion, audioVersion])

  const savePromptChange = async (reset = false) => {
    if (!id || !session || promptSaveLock.current) return
    promptSaveLock.current = true; setPromptBusy(true); setPromptError(''); setConfirmPromptSwitch(false)
    try {
      const { session: updated } = await sessionsApi.update(id, { promptId: promptDraftId, ...(reset ? emptyOverrides : {}) })
      setSession(current => current ? { ...current, ...updated } : updated)
      setShowPromptModal(false)
    } catch (error) { setPromptError(error instanceof Error ? error.message : 'Não foi possível trocar o template.') }
    finally { promptSaveLock.current = false; setPromptBusy(false) }
  }
  const handlePromptChange = () => {
    if (session && promptDraftId !== session.promptId && hasOverrides(session)) setConfirmPromptSwitch(true)
    else void savePromptChange()
  }
  useEffect(() => {
    if (!showPromptModal) return
    promptsApi.list().then(result => { setPromptList(result.prompts); setPromptError('') }).catch(() => setPromptError('Não foi possível carregar os templates. Feche e abra novamente para tentar de novo.'))
  }, [showPromptModal])

  const handleUploadStarted = () => {
    setProcessingHint(true)
    setEnded(true)
    setBrowserLiveText([])
    setSession((current) => current ? { ...current, status: 'IN_PROGRESS' } : current)
    void loadAudioMedia()
  }

  const visibleLiveText = browserLiveText.length > 0 ? browserLiveText : liveText
  const playerAudio = audioMedia.find((media) => media.source === 'UPLOAD') ?? activeAudio ?? audioMedia[0]

  const seekAudio = useCallback(async (seconds: number) => {
    setAudioError('')
    const latestMedia = audioMedia.length > 0 ? audioMedia : await loadAudioMedia()
    const targetMs = Math.max(0, Math.floor(seconds * 1000))
    const fullUpload = latestMedia.find((media) => media.source === 'UPLOAD')
    let cumulativeStart = 0
    const streamTimeline = latestMedia
      .filter((media) => media.source === 'STREAM')
      .sort((left, right) => (left.chunkIndex ?? 0) - (right.chunkIndex ?? 0))
      .map((media) => {
        const duration = media.timestampStart != null && media.timestampEnd != null
          ? Math.max(0, media.timestampEnd - media.timestampStart)
          : 5000
        const start = media.timestampStart ?? cumulativeStart
        const item = { media, start, end: media.timestampEnd ?? start + duration }
        cumulativeStart = item.end
        return item
      })
    const chunk = streamTimeline.find((item) => targetMs >= item.start && targetMs <= item.end)
    const media = fullUpload ?? chunk?.media ?? latestMedia[0]

    if (!media) {
      setAudioError('Nenhum audio disponivel para esta sessao')
      return
    }

    const relativeSeconds = media.source === 'STREAM' && chunk
      ? Math.max(0, (targetMs - chunk.start) / 1000)
      : seconds

    const audio = audioRef.current
    if (!audio || activeAudio?.id !== media.id) {
      setPendingSeek(relativeSeconds)
      setActiveAudio(media)
      return
    }

    audio.seekTo(relativeSeconds)
  }, [activeAudio?.id, audioMedia, loadAudioMedia])

  const folderPath = useMemo(() => {
    if (!session?.folderId) return []

    const byId = new Map(folderList.map((folder) => [folder.id, folder]))
    const path: FolderItem[] = []
    const seen = new Set<string>()
    let current: FolderItem | undefined = byId.get(session.folderId) ?? session.folder ?? undefined

    while (current && !seen.has(current.id)) {
      path.unshift(current)
      seen.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }

    return path
  }, [folderList, session])

  if (loading) {
    return (
      <SessionSkeleton />
    )
  }

  if (!session) return null

  const promptName = session.prompt?.name ?? 'Documento'

  return (
    <div className="nebula-page nebula-session max-w-7xl mx-auto px-4 pb-44 pt-8 sm:px-8 sm:pt-10">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-subtle hover:text-primary mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Sessoes
      </Link>

      <div className="nebula-page-header flex flex-wrap items-start justify-between gap-3 mb-8">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge variant="ink">
              <FileText className="w-3 h-3" />
              {promptName}
            </Badge>
            <button
              onClick={() => {
                setPromptDraftId(session.promptId ?? promptList[0]?.id ?? '')
                setShowPromptModal(true)
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-subtle hover:text-primary hover:bg-muted transition-colors"
              title="Trocar template"
            >
              <Pencil className="w-3 h-3" />
              Trocar template
            </button>
            {session.status === 'ERROR' || status.startsWith('error:') ? <Badge variant="rose">Erro no processamento</Badge> : session.status === 'IN_PROGRESS' || processingHint ? <Badge variant="amber">Processando</Badge> : isEnded ? (
              <Badge variant="jade">
                <CheckCircle2 className="w-3 h-3" />
                Encerrada
              </Badge>
            ) : (
              <Badge variant="rose">
                <span className="relative flex h-1.5 w-1.5">
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
                className="font-display text-2xl font-semibold text-primary tracking-tight bg-transparent border-b-2 border-line outline-none w-full"
              />
              <Button size="sm" variant="primary" onClick={handleRename}>Salvar</Button>
              <Button size="sm" variant="secondary" onClick={() => setRenaming(false)}>Cancelar</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-1 group">
              <h1 className="font-display text-2xl font-semibold text-primary tracking-tight break-words">
                {session.title || `${promptName} sem titulo`}
              </h1>
              <button
                aria-label="Renomear sessão"
                onClick={() => { setRenameValue(session.title ?? ''); setRenaming(true) }}
                className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-subtle hover:text-secondary p-1 rounded-lg"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}

          <p className="text-sm text-subtle mt-1">
            {safeDate(session.createdAt)
              ? format(safeDate(session.createdAt)!, "d 'de' MMMM 'de' yyyy 'as' HH:mm", { locale: ptBR })
              : '-'
            }
          </p>
          <details className="mt-2 text-xs text-subtle"><summary className="cursor-pointer hover:text-secondary">Detalhes da sessão</summary><p className="mt-1 break-all select-all">ID: {session.id}</p></details>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-subtle">
            <Folder className="w-3.5 h-3.5" />
            <button
              onClick={() => navigate('/?folder=root')}
              className="rounded-md px-1.5 py-0.5 font-medium text-subtle hover:bg-muted hover:text-primary"
            >
              Sem caderno
            </button>
            {folderPath.map((folder) => (
              <span key={folder.id} className="inline-flex min-w-0 items-center gap-1.5">
                <ChevronRight className="w-3 h-3 text-subtle" />
                <button
                  onClick={() => navigate(`/?folder=${folder.id}`)}
                  className="rounded-md px-1.5 py-0.5 font-medium text-subtle hover:bg-muted hover:text-primary"
                >
                  {folder.name}
                </button>
              </span>
            ))}
          </div>
        </div>

        {isEnded && (
          <Button variant="secondary" onClick={() => setShowQA(true)}>
            <MessageSquare className="w-4 h-4" />
            Perguntar
          </Button>
        )}
        <Button variant="ghost" aria-label="Excluir sessão" onClick={handleDelete} className="text-rose-500 hover:text-rose-700 hover:bg-rose-50">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-5 items-center">
        {isEnded && <div className="w-full max-w-4xl"><RecordingMilestones sessionId={session.id} media={audioMedia} complete={session.status === 'ENDED' || status === 'done' || status.endsWith(':document')} /></div>}
        {!isEnded && (
          <div className="fade-in w-full max-w-4xl">
            <RecordingPanel
              inputSource={searchParams.get('source') === 'upload' ? 'upload' : searchParams.get('source') === 'microphone' ? 'microphone' : undefined}
              sessionId={session.id}
              transcriptionEngine={transcriptionEngine}
              onUploadStarted={handleUploadStarted}
              onBrowserLive={setBrowserLiveText}
            />
          </div>
        )}

        {isEnded && visibleStatus !== 'idle' && (
          <div className="fade-in w-full max-w-4xl">
            <PipelineStatus status={visibleStatus} message={processingMessage} errorMessage={errorMessage} />
          </div>
        )}

        {session.title?.includes('[testes]') && (
          <div className="fade-in w-full max-w-4xl mt-4 p-4 bg-amber-50 border border-amber-200 rounded">
            <p className="text-sm text-amber-800">Sessao para testes</p>
            <div className="mt-2 p-3 bg-amber-100 border border-amber-300 rounded font-mono text-xs text-amber-900 max-h-40 overflow-y-auto">
              <div>Session ID: {session.id}</div>
              <div>Status: {session.status}</div>
              <div>Template: {promptName}</div>
              <div>Processing: {visibleStatus}</div>
              <div>Live Text: {liveText ? 'tem conteudo' : 'null'}</div>
            </div>
          </div>
        )}

        {(isEnded || browserLiveText.length > 0) && (
          <div className="fade-in w-full max-w-4xl">
            <TranscriptViewer
              sessionId={session.id}
              liveText={visibleLiveText}
              transcriptionProgress={transcriptionProgress}
              transcriptionComplete={session.status === 'ENDED' || status === 'done' || status.endsWith(':document')}
              reloadToken={transcriptVersion}
              onSeekTo={seekAudio}
            />
          </div>
        )}

        {isEnded && (
          <div className="fade-in w-full max-w-4xl">
            <DocumentEditor
              sessionId={session.id}
              reloadToken={documentVersion}
              onReprocessed={() => setReprocessTrigger((n) => n + 1)}
              onSeekTo={seekAudio}
            />
            <div className="mt-4"><TranscriptProductivity sessionId={session.id} reloadToken={documentVersion + transcriptVersion} onSeekTo={seekAudio} /></div>
          </div>
        )}
      </div>

      {playerAudio && (
        <div className="nebula-audio-dock fixed right-0 bottom-0 z-player px-3 py-3 sm:px-6">
          <div className="mx-auto flex max-w-4xl flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-subtle">
                Áudio da sessão
                {playerAudio.source === 'STREAM' && playerAudio.chunkIndex != null ? ` · Parte ${playerAudio.chunkIndex + 1}` : ''}
                {playerAudio.source === 'UPLOAD' ? ' · Áudio completo' : ''}
              </p>
              {audioError && <p className="text-xs text-rose-500">{audioError}</p>}
            </div>
            <SessionAudioPlayer
              key={`${playerAudio.id}:${playerAudio.url}`}
              ref={audioRef}
              src={playerAudio.url}
              sessionId={session.id}
              mediaId={playerAudio.id}
              offsetMs={playerAudio.source === 'STREAM' ? (playerAudio.timestampStart ?? 0) : 0}
              pendingSeek={pendingSeek}
              onSeekHandled={() => setPendingSeek(null)}
              onError={setAudioError}
            />
          </div>
        </div>
      )}

      {showQA && (
        <QADrawer sessionId={session.id} onClose={() => setShowQA(false)} />
      )}

      {showPromptModal && (
        <div
          className="fixed inset-0 z-overlay flex items-center justify-center bg-overlay/30 px-4 backdrop-blur-md"
          onClick={(event) => { if (event.target === event.currentTarget && !promptBusy) setShowPromptModal(false) }}
        >
          <div ref={promptDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Trocar template" className="nebula-modal w-full max-w-md rounded-3xl border border-line/80 bg-surface p-6 shadow-float backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-primary">Trocar template</h2>
                <p className="text-xs text-subtle">Escolha o template usado para esta sessao.</p>
              </div>
              <button
                disabled={promptBusy} onClick={() => setShowPromptModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-subtle hover:text-primary hover:bg-muted"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto">
              {promptError && <p role="alert" className="text-sm text-rose-700">{promptError}</p>}
              {session.prompt?.capabilities?.canUse === false && <p className="text-sm text-secondary">O template associado ficou indisponível. Os documentos foram preservados. Escolha outro para futuras gerações.</p>}
              {promptList.map((prompt) => (
                <button
                  key={prompt.id}
                  disabled={promptBusy} onClick={() => setPromptDraftId(prompt.id)}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all ${promptDraftId === prompt.id
                    ? 'border-line bg-action text-on-action'
                    : 'border-line text-secondary hover:border-line hover:bg-muted'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{prompt.name}</span>
                    <span className="block truncate text-xs opacity-70">{prompt.isPublic ? 'Publico' : 'Privado'}</span>
                  </span>
                  {prompt.isDefault && <span className="text-xs opacity-70">padrao</span>}
                </button>
              ))}
            </div>

            <div className="mt-5 flex gap-2">
              <Button variant="secondary" className="flex-1" disabled={promptBusy} onClick={() => setShowPromptModal(false)}>Cancelar</Button>
              <Button variant="primary" className="flex-1" loading={promptBusy} disabled={!promptList.some(item => item.id === promptDraftId && item.capabilities?.canUse !== false)} onClick={handlePromptChange}>Salvar</Button>
            </div>
          </div>
        </div>
      )}
      {confirmPromptSwitch && <TemplateSwitchDialog onCancel={() => { setConfirmPromptSwitch(false); setPromptDraftId(session?.promptId ?? '') }} onKeep={() => void savePromptChange(false)} onReset={() => void savePromptChange(true)} />}
    </div>
  )
}
