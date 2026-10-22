import { useCallback, useEffect, useRef, useState } from 'react'
import { Folder, Mic, Settings2, Upload, X, Youtube } from 'lucide-react'
import { ApiError, folders as foldersApi, prompts as promptsApi, sessions as sessionsApi, type Folder as FolderItem, type Prompt, type Session, type SessionInputSource } from '../api/client'
import { Button, IconButton } from './ui/Button'
import { TemplateOptionsFields } from './TemplateOptionsFields'
import { TemplateSwitchDialog } from './TemplateSwitchDialog'
import { emptyOverrides, effectiveOptions, hasOverrides, originLabel, type SessionOverrides } from '../utils/templates'
import { folderPath, notebookColor } from '../utils/library'
import { youtubeUrlSchema, normalizeYouTubeUrl } from '../utils/youtubeUrl'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { useDraftGuard } from '../hooks/useDraftGuard'

export function NewSessionModal({ initialFolderId, onClose, onCreate, onOpenSession, onManageTemplates, suspended = false }: {
  initialFolderId?: string | null
  onClose: () => void
  onCreate: (session: Session, source: SessionInputSource) => void
  onOpenSession?: (id: string) => void
  onManageTemplates?: () => void
  suspended?: boolean
}) {
  const [promptList, setPromptList] = useState<Prompt[]>([])
  const [folderList, setFolderList] = useState<FolderItem[]>([])
  const [promptId, setPromptId] = useState('')
  const [folderId, setFolderId] = useState<string | null>(initialFolderId ?? null)
  const [title, setTitle] = useState('')
  const [sessionContext, setSessionContext] = useState('')
  const [overrides, setOverrides] = useState<SessionOverrides>({ ...emptyOverrides })
  const [source, setSource] = useState<SessionInputSource>('microphone')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [limit, setLimit] = useState<number | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [loading, setLoading] = useState(false)
  const [promptError, setPromptError] = useState('')
  const [folderError, setFolderError] = useState('')
  const [optionsError, setOptionsError] = useState('')
  const [error, setError] = useState('')
  const [existingId, setExistingId] = useState('')
  const [switchTo, setSwitchTo] = useState<string | null>(null)
  const [templateTouched, setTemplateTouched] = useState(false)
  const initialized = useRef(false)
  const fetching = useRef(false)
  const alive = useRef(true)
  const createLock = useRef(false)
  const customized = hasOverrides(overrides)
  const dirty = !!title || !!sessionContext || !!youtubeUrl || source !== 'microphone' || folderId !== (initialFolderId ?? null) || customized || templateTouched
  const guard = useDraftGuard(dirty && !existingId, loading, !suspended)
  const close = () => { if (!createLock.current) guard.request(onClose) }
  const dialogRef = useDialogFocus(close, !suspended)
  const load = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    if (alive.current) setLoadingData(true)
    const [templates, folders, options] = await Promise.allSettled([promptsApi.list(), foldersApi.list(), sessionsApi.creationOptions()])
    fetching.current = false
    if (!alive.current) return
    if (templates.status === 'fulfilled') {
      setPromptList(templates.value.prompts); setPromptError('')
      if (!initialized.current) {
        initialized.current = true
        setPromptId(templates.value.defaultPromptId ?? templates.value.prompts.find(item => item.isDefault)?.id ?? '')
      }
    } else setPromptError('Não foi possível carregar os templates.')
    if (folders.status === 'fulfilled') { setFolderList(folders.value.folders); setFolderError('') }
    else setFolderError('Não foi possível carregar os cadernos. O destino escolhido foi mantido.')
    if (options.status === 'fulfilled') { setLimit(options.value.youtubeMaxDurationMinutes); setOptionsError('') }
    else setOptionsError('Não foi possível consultar o limite de importação da conta.')
    setLoadingData(false)
  }, [])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { if (!suspended) void load() }, [suspended, load])
  useEffect(() => {
    const refresh = () => { if (!suspended) void load() }
    window.addEventListener('nebula:templates-changed', refresh)
    return () => window.removeEventListener('nebula:templates-changed', refresh)
  }, [suspended, load])
  const template = promptList.find(item => item.id === promptId && item.capabilities?.canUse !== false)
  const selectedFolder = folderList.find(item => item.id === folderId)
  const unavailableFolder = !!folderId && !selectedFolder && !loadingData && !folderError
  const missingDestinationLabel = loadingData ? 'Carregando destino…' : folderError ? 'Destino preservado — consulta indisponível' : 'Destino indisponível'
  const destination = folderId ? folderPath(folderId, folderList).map(item => item.name).join(' / ') || missingDestinationLabel : 'Sem caderno'
  const options = effectiveOptions(template, overrides)
  const chooseTemplate = (id: string) => {
    if (id === promptId) return
    if (customized) setSwitchTo(id)
    else { setPromptId(id); setTemplateTouched(true) }
  }
  const confirmSwitch = (reset: boolean) => {
    if (reset) setOverrides({ ...emptyOverrides })
    setPromptId(switchTo!); setSwitchTo(null); setTemplateTouched(true)
  }
  const blocked = loadingData || !!promptError || !!folderError || unavailableFolder || !template || (source === 'youtube' && (!limit || !!optionsError)) || !!existingId
  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (blocked || createLock.current) return
    setError('')
    if (source === 'youtube') {
      const parsed = youtubeUrlSchema.safeParse(youtubeUrl)
      if (!parsed.success) { setError(parsed.error.issues[0].message); return }
    }
    createLock.current = true; setLoading(true)
    try {
      const { session } = await sessionsApi.create({
        promptId, folderId, title: title.trim() || undefined, sessionContext: sessionContext.trim() || undefined,
        ...overrides, instructionsOverride: overrides.instructionsOverride?.trim() || null,
        ...(source === 'youtube' ? { youtubeUrl: normalizeYouTubeUrl(youtubeUrl)! } : {}),
      })
      guard.bypass(() => onCreate(session, source))
    } catch (cause) {
      if (cause instanceof ApiError && cause.sessionId) setExistingId(cause.sessionId)
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar a sessão. Seu rascunho foi mantido.')
    } finally { createLock.current = false; setLoading(false) }
  }
  if (suspended) return guard.dialog
  return <div className="fixed inset-0 z-overlay flex items-center justify-center bg-overlay/50 p-3 sm:p-4" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Nova sessão" aria-busy={loading} className="nebula-modal max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto border border-line bg-surface p-5 text-primary sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Nova sessão</h2>
          <p className="mt-1 text-sm text-secondary">Escolha a fonte e o resultado esperado.</p>
        </div>
        <IconButton type="button" label="Fechar nova sessão" disabled={loading} onClick={close}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <form onSubmit={create}>
        <fieldset disabled={loading} className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Fonte do áudio</legend>
            <div className="grid grid-cols-3 gap-2">{([
              ['microphone', 'Microfone', Mic], ['upload', 'Arquivo', Upload], ['youtube', 'YouTube', Youtube],
            ] as const).map(([value, label, Icon]) => <button key={value} type="button" aria-pressed={source === value} onClick={() => { setSource(value); setError('') }} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-2 py-3 text-sm ${source === value ? 'border-focus bg-selection' : 'border-line hover:bg-hover'}`}>
              <Icon className="h-4 w-4 shrink-0" />{label}</button>)}</div>
            <p className="mt-2 text-xs leading-5 text-secondary">{source === 'microphone' ? 'Continuar ainda não liga o microfone. A gravação começa na próxima tela, quando você iniciar.' : source === 'upload' ? 'O arquivo será selecionado e enviado na próxima tela.' : 'Confirmar inicia a importação e o processamento do vídeo.'}</p>
            {source === 'youtube' && <label className="mt-3 block text-sm">Link do vídeo<input type="url" required maxLength={2048} value={youtubeUrl} onChange={event => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface p-3" />
              <span className="mt-1 block text-xs text-secondary">{limit ? `Vídeos de até ${limit} minutos para esta conta. A API valida o limite.` : 'Consultando limite de importação…'}</span>
            </label>}
          </fieldset>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="new-session-template" className="text-sm font-medium">Template</label>{onManageTemplates && <Button type="button" size="sm" variant="ghost" onClick={() => guard.bypass(onManageTemplates)}>
                <Settings2 className="h-4 w-4" />Gerenciar templates</Button>}</div>
            <select id="new-session-template" value={promptId} disabled={loadingData || !!promptError} onChange={event => chooseTemplate(event.target.value)} className="min-h-11 w-full rounded-lg border border-line bg-surface p-3">
              <option value="" disabled>{loadingData ? 'Carregando templates…' : 'Selecione um template'}</option>{promptId && !template && <option value={promptId} disabled>Template indisponível — escolha outro</option>}{(['platform', 'own', 'shared', 'legacy'] as const).map(origin => { const group = promptList.filter(item => item.origin === origin); return group.length > 0 && <optgroup key={origin} label={originLabel(group[0])}>{group.map(item => <option key={item.id} value={item.id}>{item.name}{item.isDefault ? ' · Seu padrão' : ''}</option>)}</optgroup> })}</select>
            {template && <div className="mt-2 text-xs leading-5 text-secondary">
              <p>{template.description || 'Este template define a estrutura e o estilo do documento.'}</p>
              <p className="mt-1 text-subtle">{originLabel(template)}</p>
            </div>}
            {!loadingData && !promptError && promptList.length === 0 && <p className="mt-2 text-sm text-secondary">Nenhum template disponível. Abra o gerenciamento para criar um.</p>}
            {!loadingData && promptId && !template && !promptError && <p role="alert" className="mt-2 text-sm text-rose-700">O template selecionado ficou indisponível. Seu rascunho foi mantido; escolha outro explicitamente.</p>}
          </div>
          <label className="block text-sm">Título <span className="text-xs text-subtle">(opcional, {title.length}/120)</span>
            <input maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder="Ex.: Reunião de planejamento" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface p-3" />
          </label>
          <div>
            <label htmlFor="new-session-folder" className="block text-sm">Destino</label>
            <div className="mt-1 flex items-center gap-2">
              <Folder aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: notebookColor(selectedFolder?.color) }} />
              <select id="new-session-folder" value={folderId ?? ''} disabled={loadingData || !!folderError} onChange={event => setFolderId(event.target.value || null)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface p-3">
                <option value="">Sem caderno</option>{folderId && !selectedFolder && <option value={folderId} disabled>{missingDestinationLabel}</option>}{folderList.map(item => <option key={item.id} value={item.id}>{folderPath(item.id, folderList).map(folder => folder.name).join(' / ')}</option>)}</select>
            </div>
            <p className="mt-1 break-words text-xs text-secondary">{destination}</p>{unavailableFolder && <p role="alert" className="mt-1 text-sm text-rose-700">O caderno recebido não está disponível. Escolha outro destino; a sessão ainda não foi criada.</p>}</div>
          <details className="rounded-xl border border-line p-3">
            <summary className="min-h-9 cursor-pointer text-sm font-medium">Contexto da sessão <span className="font-normal text-subtle">(opcional)</span>
            </summary>
            <p className="my-2 text-xs leading-5 text-secondary">Ajude a interpretar o áudio: objetivo, participantes ou tema. Ex.: reunião para decidir prioridades do trimestre, ou aula sobre redes de computadores.</p>
            <label className="block text-sm">Contexto <span className="text-xs text-subtle">({sessionContext.length}/4000)</span>
              <textarea maxLength={4000} rows={3} value={sessionContext} onChange={event => setSessionContext(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface p-3" />
            </label>
          </details>
          <details className="rounded-xl border border-line p-3">
            <summary className="min-h-9 cursor-pointer text-sm font-medium">Ajustes desta sessão <span className="font-normal text-subtle">· {customized ? 'Personalizado' : 'Do template'}</span>
            </summary>
            <p className="my-3 text-xs leading-5 text-secondary">Campos não alterados continuam herdando do template por referência. Estes ajustes locais não editam o template.</p>
            <TemplateOptionsFields value={options} onChange={(key, value) => setOverrides(current => ({ ...current, [`${key}Override`]: value }))} />
            <label className="mt-4 block text-sm">Instruções específicas <span className="text-xs text-subtle">({(overrides.instructionsOverride ?? '').length}/8000)</span>
              <textarea maxLength={8000} rows={4} value={overrides.instructionsOverride ?? ''} onChange={event => setOverrides(current => ({ ...current, instructionsOverride: event.target.value || null }))} placeholder="Vazio: herdar as instruções do template" className="mt-1 w-full rounded-lg border border-line bg-surface p-3" />
            </label>
            <p className="mt-1 text-xs leading-5 text-secondary">Quando preenchidas, substituem as instruções do template, em vez de acrescentá-las.</p>
            <Button type="button" size="sm" className="mt-3" disabled={!customized} onClick={() => setOverrides({ ...emptyOverrides })}>Restaurar ajustes do template</Button>
          </details>
        </fieldset>
        {loadingData && <p role="status" className="mt-3 text-sm text-secondary">Carregando opções…</p>}
        {(promptError || folderError || (source === 'youtube' && optionsError)) && <div role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          <p>{promptError}</p>
          <p>{folderError}</p>{source === 'youtube' && <p>{optionsError}</p>}<Button type="button" disabled={loading || loadingData} className="mt-2" onClick={() => void load()}>Tentar carregar novamente</Button>
        </div>}
        {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
        {existingId && <div className="mt-3 rounded-lg border border-line p-3 text-sm">
          <p>A sessão já foi criada, mas a importação falhou. Abra a sessão existente para conferir o estado. Não confirme uma nova criação para tentar novamente.</p>
          <Button type="button" className="mt-2" onClick={() => guard.bypass(() => onOpenSession?.(existingId))}>Abrir sessão existente</Button>
        </div>}
        {loading && <p role="status" className="mt-4 text-sm text-secondary">Criando sessão. Aguarde a resposta; o fechamento está bloqueado.</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" disabled={loading} onClick={close}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={loading} disabled={blocked}>{source === 'microphone' ? 'Continuar para gravação' : source === 'upload' ? 'Continuar para envio' : 'Importar vídeo'}</Button>
        </div>
      </form>
    </div>
    {guard.dialog}
    {switchTo && <TemplateSwitchDialog onCancel={() => setSwitchTo(null)} onKeep={() => confirmSwitch(false)} onReset={() => confirmSwitch(true)} />}
  </div>
}
