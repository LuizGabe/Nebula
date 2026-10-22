import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Mic, Upload, Youtube } from 'lucide-react'
import clsx from 'clsx'
import {
  folders as foldersApi,
  prompts as promptsApi,
  sessions as sessionsApi,
  type DocumentDetailLevel,
  type DocumentFormality,
  type DocumentTranscriptionMode,
  type Folder as FolderItem,
  type Prompt,
  type Session,
  type SessionInputSource,
} from '../api/client'
import { Button } from './ui/Button'
import { youtubeUrlSchema, normalizeYouTubeUrl } from '../utils/youtubeUrl'
import { useAuthStore } from '../store/auth'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { Toggle } from './ui/Toggle'

type FolderNode = FolderItem & { children: FolderNode[] }

const FORMALITY_OPTIONS: Array<{ value: DocumentFormality; label: string }> = [
  { value: 'informal', label: 'Informal' },
  { value: 'neutral', label: 'Neutra' },
  { value: 'formal', label: 'Formal' },
]

const DETAIL_OPTIONS: Array<{ value: DocumentDetailLevel; label: string }> = [
  { value: 'concise', label: 'Conciso' },
  { value: 'balanced', label: 'Equilibrado' },
  { value: 'detailed', label: 'Detalhado' },
]

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl border border-ink-100 bg-ink-50 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            'rounded-lg px-2 py-1.5 text-xs font-medium transition-all',
            value === option.value ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-500 hover:text-ink-900'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function CheckboxRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <Toggle checked={checked} onChange={onChange} label={label} />
  )
}

function buildFolderTree(folderList: FolderItem[]) {
  const nodes = new Map<string, FolderNode>()
  const roots: FolderNode[] = []

  folderList.forEach((folder) => nodes.set(folder.id, { ...folder, children: [] }))
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  const sort = (items: FolderNode[]) => {
    items.sort((a, b) => a.name.localeCompare(b.name))
    items.forEach((item) => sort(item.children))
  }
  sort(roots)

  return roots
}

function FolderTreeItem({
  node,
  selectedFolderId,
  depth,
  onSelect,
}: {
  node: FolderNode
  selectedFolderId: string | null
  depth: number
  onSelect: (folderId: string) => void
}) {
  const [open, setOpen] = useState(true)
  const selected = selectedFolderId === node.id
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div className="flex items-center gap-1" style={{ paddingLeft: depth * 14 }}>
        <button
          type="button"
          disabled={!hasChildren}
          onClick={() => setOpen((value) => !value)}
          className="h-8 w-6 shrink-0 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-800 hover:bg-ink-50 disabled:hover:bg-transparent"
          title={open ? 'Recolher' : 'Expandir'}
        >
          {hasChildren ? (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : null}
        </button>
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className={clsx(
            'min-w-0 flex-1 h-8 px-2 rounded-lg flex items-center gap-2 text-left text-sm transition-all',
            selected ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900 hover:bg-ink-50'
          )}
        >
          {selected ? <FolderOpen className="w-4 h-4 shrink-0" /> : <Folder className="w-4 h-4 shrink-0" />}
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {open && node.children.map((child) => (
        <FolderTreeItem
          key={child.id}
          node={child}
          selectedFolderId={selectedFolderId}
          depth={depth + 1}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export function NewSessionModal({
  initialFolderId,
  onClose,
  onCreate,
}: {
  initialFolderId?: string | null
  onClose: () => void
  onCreate: (session: Session, source: SessionInputSource) => void
}) {
  const dialogRef = useDialogFocus(onClose)
  const [promptList, setPromptList] = useState<Prompt[]>([])
  const [folderList, setFolderList] = useState<FolderItem[]>([])
  const [promptId, setPromptId] = useState('')
  const [folderId, setFolderId] = useState<string | null>(initialFolderId ?? null)
  const [title, setTitle] = useState('')
  const [sessionContext, setSessionContext] = useState('')
  const [instructionsOverride, setInstructionsOverride] = useState<string | null>(null)
  const [formalityOverride, setFormalityOverride] = useState<DocumentFormality | null>(null)
  const [detailLevelOverride, setDetailLevelOverride] = useState<DocumentDetailLevel | null>(null)
  const [useTitleOverride, setUseTitleOverride] = useState<boolean | null>(null)
  const [useHeadingsOverride, setUseHeadingsOverride] = useState<boolean | null>(null)
  const [useSubheadingsOverride, setUseSubheadingsOverride] = useState<boolean | null>(null)
  const [preferListsOverride, setPreferListsOverride] = useState<boolean | null>(null)
  const [preferTablesOverride, setPreferTablesOverride] = useState<boolean | null>(null)
  const [includeAudioCitationsOverride, setIncludeAudioCitationsOverride] = useState<boolean | null>(null)
  const [transcriptionModeOverride, setTranscriptionModeOverride] = useState<DocumentTranscriptionMode | null>(null)
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState<SessionInputSource>('microphone')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [error, setError] = useState('')
  const username = useAuthStore((state) => state.user?.username)

  useEffect(() => {
    setFolderId(initialFolderId ?? null)
  }, [initialFolderId])

  useEffect(() => {
    promptsApi.list()
      .then(({ prompts }) => {
        setPromptList(prompts)
        setPromptId(prompts.find((prompt) => prompt.isDefault)?.id ?? prompts[0]?.id ?? '')
      })
      .catch(() => setPromptList([]))

    foldersApi.list()
      .then(({ folders }) => setFolderList(folders ?? []))
      .catch(() => setFolderList([]))
  }, [])

  const folderTree = useMemo(() => buildFolderTree(folderList), [folderList])
  const selectedTemplate = promptList.find((prompt) => prompt.id === promptId)
  const effectiveFormality = formalityOverride ?? selectedTemplate?.formality ?? 'neutral'
  const effectiveDetailLevel = detailLevelOverride ?? selectedTemplate?.detailLevel ?? 'balanced'
  const effectiveUseTitle = useTitleOverride ?? selectedTemplate?.useTitle ?? true
  const effectiveUseHeadings = useHeadingsOverride ?? selectedTemplate?.useHeadings ?? true
  const effectiveUseSubheadings = useSubheadingsOverride ?? selectedTemplate?.useSubheadings ?? true
  const effectivePreferLists = preferListsOverride ?? selectedTemplate?.preferLists ?? true
  const effectivePreferTables = preferTablesOverride ?? selectedTemplate?.preferTables ?? false
  const effectiveIncludeAudioCitations = includeAudioCitationsOverride ?? selectedTemplate?.includeAudioCitations ?? true
  const effectiveTranscriptionMode = transcriptionModeOverride ?? selectedTemplate?.transcriptionMode ?? 'MEETING'

  useEffect(() => {
    setInstructionsOverride(null)
    setFormalityOverride(null)
    setDetailLevelOverride(null)
    setUseTitleOverride(null)
    setUseHeadingsOverride(null)
    setUseSubheadingsOverride(null)
    setPreferListsOverride(null)
    setPreferTablesOverride(null)
    setIncludeAudioCitationsOverride(null)
    setTranscriptionModeOverride(null)
  }, [promptId])

  const handleCreate = async () => {
    if (!promptId || loading) return
    setError('')
    if (source === 'youtube') {
      const parsed = youtubeUrlSchema.safeParse(youtubeUrl)
      if (!parsed.success) {
        setError(parsed.error.issues[0].message)
        return
      }
    }
    setLoading(true)
    try {
      const { session } = await sessionsApi.create({
        ...(source === 'youtube' ? { youtubeUrl: normalizeYouTubeUrl(youtubeUrl)! } : {}),
        promptId,
        title: title.trim() || undefined,
        folderId,
        sessionContext: sessionContext.trim() || undefined,
        instructionsOverride: instructionsOverride?.trim() || null,
        formalityOverride,
        detailLevelOverride,
        useTitleOverride,
        useHeadingsOverride,
        useSubheadingsOverride,
        preferListsOverride,
        preferTablesOverride,
        includeAudioCitationsOverride,
        transcriptionModeOverride,
      })
      onCreate(session, source)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nao foi possivel criar a sessao')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-ink-950/30 backdrop-blur-md flex items-center justify-center z-50 px-4"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Nova sessão" className="nebula-modal bg-white/90 backdrop-blur-xl rounded-[32px] shadow-float border border-white/80 p-6 sm:p-8 w-full max-w-3xl max-h-[90vh] overflow-y-auto fade-in">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="font-display font-semibold text-xl text-ink-900">Nova sessao</h2>
            <p className="text-sm text-ink-400 mt-1">Escolha a fonte do audio, o prompt e o caderno.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-5">
          <div className="flex flex-col gap-4">
            <fieldset disabled={loading}>
              <legend className="mb-2 text-sm font-medium text-ink-700">Fonte do audio</legend>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'microphone', label: 'Microfone', Icon: Mic },
                  { value: 'upload', label: 'Arquivo', Icon: Upload },
                  { value: 'youtube', label: 'YouTube', Icon: Youtube },
                ] as const).map(({ value, label, Icon }) => (
                  <button key={value} type="button" aria-pressed={source === value}
                    onClick={() => { setSource(value); setError('') }}
                    className={clsx('flex items-center justify-center gap-2 rounded-xl border px-2 py-3 text-sm', source === value ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 text-ink-600 hover:bg-ink-50')}>
                    <Icon className="h-4 w-4" />{label}
                  </button>
                ))}
              </div>
              {source === 'youtube' && (
                <label className="mt-3 block text-sm text-ink-700">
                  Link do video
                  <input type="url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    onKeyDown={(event) => event.key === 'Enter' && handleCreate()}
                    className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm outline-none focus:border-ink-400" />
                  <span className="mt-1 block text-xs text-ink-400">Videos de ate {username === 'luizgabe' ? 300 : 30} minutos. O audio sera transcrito e o documento sera gerado automaticamente.</span>
                </label>
              )}
              {source === 'upload' && <p className="mt-2 text-xs text-ink-400">Selecione e envie seu arquivo na proxima etapa.</p>}
            </fieldset>
            <div>
              <p className="text-sm font-medium text-ink-700 mb-2">Prompt</p>
              <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto pr-1">
                {promptList.map((prompt) => (
                  <button
                    key={prompt.id}
                    type="button"
                    onClick={() => setPromptId(prompt.id)}
                    className={clsx(
                      'flex items-center justify-between gap-3 py-2.5 px-4 rounded-xl border text-sm font-medium transition-all',
                      promptId === prompt.id
                        ? 'border-ink-900 bg-ink-900 text-white'
                        : 'border-ink-200 text-ink-600 hover:border-ink-400 hover:bg-ink-50'
                    )}
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
                onChange={(event) => setTitle(event.target.value)}
                placeholder="ex: Aula de arquitetura"
                onKeyDown={(event) => event.key === 'Enter' && handleCreate()}
                className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 placeholder:text-ink-400 transition-all"
              />
            </div>

            <div>
              <p className="text-sm font-medium text-ink-700 mb-2">
                Contexto da sessao <span className="text-ink-400 font-normal">(opcional)</span>
              </p>
              <textarea
                value={sessionContext}
                onChange={(event) => setSessionContext(event.target.value)}
                placeholder="ex: reuniao semanal do produto, turma, cliente ou objetivo"
                rows={3}
                className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 placeholder:text-ink-400 transition-all resize-y"
              />
            </div>

            {selectedTemplate && (
              <div className="rounded-2xl border border-ink-100 bg-ink-50/60 p-4">
                <div className="mb-3">
                  <p className="text-sm font-medium text-ink-700">Ajustes desta sessao</p>
                  <p className="text-xs text-ink-400">Alteracoes aqui nao modificam o template original.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-ink-500">Formalidade</p>
                    <Segmented value={effectiveFormality} options={FORMALITY_OPTIONS} onChange={setFormalityOverride} />
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-ink-500">Nivel de detalhe</p>
                    <Segmented value={effectiveDetailLevel} options={DETAIL_OPTIONS} onChange={setDetailLevelOverride} />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  <CheckboxRow checked={effectiveUseTitle} label="Usar titulo principal" onChange={setUseTitleOverride} />
                  <CheckboxRow checked={effectiveUseHeadings} label="Organizar em secoes" onChange={setUseHeadingsOverride} />
                  <CheckboxRow checked={effectiveUseSubheadings} label="Usar subsecoes" onChange={setUseSubheadingsOverride} />
                  <CheckboxRow checked={effectivePreferLists} label="Preferir listas" onChange={setPreferListsOverride} />
                  <CheckboxRow checked={effectivePreferTables} label="Preferir tabelas" onChange={setPreferTablesOverride} />
                  <CheckboxRow checked={effectiveIncludeAudioCitations} label="Referenciar momentos do audio" onChange={setIncludeAudioCitationsOverride} />
                </div>

                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium text-ink-500">Modo de transcricao</p>
                  <select
                    value={effectiveTranscriptionMode}
                    onChange={(event) => setTranscriptionModeOverride(event.target.value as DocumentTranscriptionMode)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 transition-all"
                  >
                    <option value="MEETING">Reuniao</option>
                    <option value="CLASS">Aula</option>
                  </select>
                </div>

                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium text-ink-500">Instrucoes so para esta sessao</p>
                  <textarea
                    value={instructionsOverride ?? ''}
                    onChange={(event) => setInstructionsOverride(event.target.value || null)}
                    placeholder={selectedTemplate.instructions}
                    rows={3}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 placeholder:text-ink-300 transition-all resize-y"
                  />
                </div>
              </div>
            )}

          </div>

          <div className="border border-ink-100 rounded-2xl p-3 bg-ink-50/60 min-h-[260px]">
            <p className="text-sm font-medium text-ink-700 px-1 mb-2">Caderno</p>
            <button
              type="button"
              onClick={() => setFolderId(null)}
              className={clsx(
                'w-full h-8 px-2 rounded-lg flex items-center gap-2 text-left text-sm transition-all mb-1',
                folderId === null ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900 hover:bg-white'
              )}
            >
              <Folder className="w-4 h-4 shrink-0" />
              <span className="truncate">/root</span>
            </button>

            <div className="max-h-64 overflow-y-auto pr-1">
              {folderTree.map((node) => (
                <FolderTreeItem
                  key={node.id}
                  node={node}
                  selectedFolderId={folderId}
                  depth={0}
                  onSelect={setFolderId}
                />
              ))}
            </div>
          </div>
        </div>

        {error && <p role="alert" className="mt-4 text-sm text-rose-500">{error}</p>}
        <div className="flex gap-2 mt-6">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" className="flex-1" loading={loading} disabled={!promptId} onClick={handleCreate}>
            {source === 'youtube' ? 'Importar video' : 'Criar sessao'}
          </Button>
        </div>
      </div>
    </div>
  )
}
