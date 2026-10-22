import { useEffect, useState } from 'react'
import { BookOpen, Check, ChevronDown, Loader2, Pencil, Plus, Save, Settings, SlidersHorizontal, Trash2, User, Wand2 } from 'lucide-react'
import clsx from 'clsx'
import {
  llm,
  LLMModel,
  type DocumentDetailLevel,
  type DocumentFormality,
  type DocumentTranscriptionMode,
  type LLMModelStatus,
  prompts,
  type Prompt,
  users,
} from '../api/client'
import { useAuthStore } from '../store/auth'
import { Button } from '../components/ui/Button'
import { Toggle } from '../components/ui/Toggle'

type Section = 'templates' | 'model' | 'docs' | 'account'

type TemplateDraft = {
  name: string
  description: string
  instructions: string
  formality: DocumentFormality
  detailLevel: DocumentDetailLevel
  useTitle: boolean
  useHeadings: boolean
  useSubheadings: boolean
  preferLists: boolean
  preferTables: boolean
  includeAudioCitations: boolean
  transcriptionMode: DocumentTranscriptionMode
  isDefault: boolean
  isPublic: boolean
}

const EMPTY_TEMPLATE: TemplateDraft = {
  name: '',
  description: '',
  instructions: '',
  formality: 'neutral',
  detailLevel: 'balanced',
  useTitle: true,
  useHeadings: true,
  useSubheadings: true,
  preferLists: true,
  preferTables: false,
  includeAudioCitations: true,
  transcriptionMode: 'MEETING',
  isDefault: false,
  isPublic: false,
}

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
            'rounded-lg px-2 py-2 text-xs font-medium transition-all',
            value === option.value ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-500 hover:text-ink-900'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function CheckboxRow({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <Toggle checked={checked} onChange={onChange} label={label} />
  )
}

export function SettingsPage() {
  const { user, setUser } = useAuthStore()
  const [section, setSection] = useState<Section>('templates')
  const [models, setModels] = useState<LLMModel[]>([])
  const [modelStatus, setModelStatus] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string>('')
  const [loadingModels, setLoadingModels] = useState(true)
  const [savingModel, setSavingModel] = useState(false)
  const [savedModel, setSavedModel] = useState(false)
  const [modelError, setModelError] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const [templateList, setTemplateList] = useState<Prompt[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_TEMPLATE)
  const [templateError, setTemplateError] = useState<string | null>(null)

  const loadTemplates = async () => {
    setLoadingTemplates(true)
    try {
      const res = await prompts.list()
      setTemplateList(res.prompts ?? [])
    } finally {
      setLoadingTemplates(false)
    }
  }

  useEffect(() => {
    let closed = false

    llm.models()
      .then((res) => {
        if (closed) return
        setModels(res.models ?? [])
        setSelected(user?.config?.defaultModel ?? '')
      })
      .catch(() => { })
      .finally(() => setLoadingModels(false))

    loadTemplates().catch(() => setTemplateList([]))

    const source = llm.status()
    source.addEventListener('message', (event) => {
      const data = JSON.parse(event.data) as { models?: LLMModelStatus[] }
      const nextStatus = Object.fromEntries((data.models ?? []).map((model) => [model.id, model.available]))
      setModelStatus(nextStatus)
      setSelected((current) => (current && nextStatus[current] === false ? '' : current))
    })
    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) return
      setModelStatus({})
    })

    return () => {
      closed = true
      source.close()
    }
  }, [user])

  const onlineModels = models.filter((model) => modelStatus[model.id] === true || (model.provider === 'groq' && modelStatus[model.id] !== false))
  const selectedModel = onlineModels.find((model) => model.id === selected)
  const savedDefaultModel = user?.config?.defaultModel
  const savedModelIsOffline = Boolean(savedDefaultModel && modelStatus[savedDefaultModel] === false)

  const saveModel = async () => {
    if (!selected) return
    setSavingModel(true)
    setModelError('')
    try {
      await users.updateConfig(selected)
      if (user) setUser({ ...user, config: { ...user.config, defaultModel: selected } })
      setSavedModel(true)
      setTimeout(() => setSavedModel(false), 2000)
    } catch (error) {
      setModelError(error instanceof Error ? error.message : 'Não foi possível salvar o modelo.')
    } finally {
      setSavingModel(false)
    }
  }

  const startEdit = (template: Prompt) => {
    setEditingId(template.id)
    setDraft({
      name: template.name,
      description: template.description ?? '',
      instructions: template.instructions ?? '',
      formality: template.formality ?? 'neutral',
      detailLevel: template.detailLevel ?? 'balanced',
      useTitle: template.useTitle ?? true,
      useHeadings: template.useHeadings ?? true,
      useSubheadings: template.useSubheadings ?? true,
      preferLists: template.preferLists ?? true,
      preferTables: template.preferTables ?? false,
      includeAudioCitations: template.includeAudioCitations ?? true,
      transcriptionMode: template.transcriptionMode ?? 'MEETING',
      isDefault: template.isDefault,
      isPublic: template.isPublic,
    })
    setTemplateError(null)
  }

  const resetTemplateForm = () => {
    setEditingId(null)
    setDraft(EMPTY_TEMPLATE)
    setTemplateError(null)
  }

  const saveTemplate = async () => {
    if (!draft.name.trim() || !draft.instructions.trim()) return

    setSavingTemplate(true)
    setTemplateError(null)
    try {
      const payload = {
        ...draft,
        description: draft.description.trim() || null,
        instructions: draft.instructions.trim(),
      }
      if (editingId) {
        await prompts.update(editingId, payload)
      } else {
        await prompts.create(payload)
      }
      resetTemplateForm()
      await loadTemplates()
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Nao foi possivel salvar o template.')
    } finally {
      setSavingTemplate(false)
    }
  }

  const deleteTemplate = async (template: Prompt) => {
    if (!confirm(`Remover o template "${template.name}"?`)) return
    await prompts.delete(template.id)
    if (editingId === template.id) resetTemplateForm()
    await loadTemplates()
  }

  const sections = [
    { id: 'templates' as const, label: 'Templates', icon: Wand2 },
    { id: 'model' as const, label: 'Modelo', icon: SlidersHorizontal },
    { id: 'docs' as const, label: 'Guia', icon: BookOpen },
    { id: 'account' as const, label: 'Conta', icon: User },
  ]

  return (
    <div className="nebula-page max-w-6xl mx-auto px-4 py-8 sm:px-8 sm:py-10">
      <div className="nebula-page-header flex items-center gap-3 mb-8">
        <div className="w-9 h-9 rounded-xl bg-ink-100 flex items-center justify-center">
          <Settings className="w-5 h-5 text-ink-600" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900 tracking-tight">Configurações</h1>
          <p className="text-sm text-ink-400">Templates, modelo e conta</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)] gap-6">
        <aside className="nebula-surface bg-white rounded-2xl border border-ink-100 shadow-soft p-2 h-max">
          {sections.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                aria-pressed={section === item.id}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                  section === item.id ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900 hover:bg-ink-50'
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            )
          })}
        </aside>

        <section className="nebula-surface bg-white rounded-2xl border border-ink-100 shadow-soft">
          {section === 'model' && (
            <div className="px-6 py-5">
              <h2 className="font-medium text-ink-800 text-sm mb-0.5">Modelo LLM padrao</h2>
              <p className="text-xs text-ink-400 mb-4">Modelo usado para gerar documentos e responder perguntas.</p>

              {modelError && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{modelError}</p>}
              {loadingModels ? (
                <div className="flex items-center gap-2 text-sm text-ink-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando modelos...
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {savedModelIsOffline && (
                    <p className="max-w-xl rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      O modelo salvo esta offline agora. Selecione um modelo online para atualizar.
                    </p>
                  )}

                  <div className="flex items-center gap-3">
                    <div className="relative flex-1 max-w-sm">
                      <button
                        onClick={() => onlineModels.length > 0 && setShowDropdown(!showDropdown)}
                        disabled={onlineModels.length === 0}
                        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border border-ink-200 bg-white text-sm text-ink-900 hover:border-ink-300 transition-all disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400"
                      >
                        <span className="font-mono truncate">
                          {selectedModel?.label ?? (onlineModels.length > 0 ? 'Selecione um modelo online' : 'Nenhum modelo online')}
                        </span>
                        <ChevronDown className="w-4 h-4 text-ink-400 shrink-0" />
                      </button>

                      {showDropdown && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                          <div className="absolute left-0 top-full mt-1 bg-white border border-ink-100 rounded-xl shadow-float z-20 w-full py-1 max-h-56 overflow-y-auto">
                            {onlineModels.map((model) => (
                              <button
                                key={model.id}
                                onClick={() => { setSelected(model.id); setShowDropdown(false) }}
                                className="w-full text-left px-3 py-2 text-xs font-mono hover:bg-ink-50 flex items-center justify-between gap-3 text-ink-700"
                              >
                                <span>{model.label}</span>
                                <span className="text-jade-600 text-xs">online</span>
                                {selected === model.id && <Check className="w-3 h-3 text-jade-500 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <Button variant={savedModel ? 'ghost' : 'primary'} onClick={saveModel} loading={savingModel} disabled={!selected || !selectedModel || savingModel}>
                      {savedModel ? <><Check className="w-4 h-4 text-jade-500" /> Salvo</> : 'Salvar'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {section === 'templates' && (
            <div className="px-6 py-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="font-medium text-ink-800 text-sm mb-0.5">Templates de documento</h2>
                  <p className="text-xs text-ink-400">Configure como o documento final deve ser escrito.</p>
                </div>
                <Button size="sm" variant="secondary" onClick={resetTemplateForm}>
                  <Plus className="w-4 h-4" />
                  Novo
                </Button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)] gap-5">
                <div className="border border-ink-100 rounded-xl overflow-hidden h-max">
                  {loadingTemplates ? (
                    <div className="p-4 flex items-center gap-2 text-sm text-ink-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Carregando...
                    </div>
                  ) : templateList.length === 0 ? (
                    <p className="p-4 text-sm text-ink-400">Nenhum template cadastrado.</p>
                  ) : (
                    templateList.map((template) => (
                      <div key={template.id} className="p-3 border-b border-ink-50 last:border-b-0 flex items-center gap-2">
                        <button className="flex-1 text-left min-w-0" onClick={() => startEdit(template)}>
                          <p className="text-sm font-medium text-ink-800 truncate">{template.name}</p>
                          <p className="text-xs text-ink-400">
                            {template.isDefault ? 'Padrao' : 'Personalizado'} / {template.isPublic ? 'Publico' : 'Privado'}
                          </p>
                        </button>
                        <button className="p-1.5 rounded-lg text-ink-400 hover:text-ink-800 hover:bg-ink-50" onClick={() => startEdit(template)} title="Editar">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button className="p-1.5 rounded-lg text-rose-400 hover:text-rose-700 hover:bg-rose-50" onClick={() => deleteTemplate(template)} title="Remover">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex flex-col gap-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      aria-label="Nome do template"
                      value={draft.name}
                      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Nome do template"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 placeholder:text-ink-400 transition-all"
                    />
                    <select
                      aria-label="Tipo de transcrição"
                      value={draft.transcriptionMode}
                      onChange={(event) => setDraft((current) => ({ ...current, transcriptionMode: event.target.value as DocumentTranscriptionMode }))}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 transition-all"
                    >
                      <option value="MEETING">Transcricao: reuniao</option>
                      <option value="CLASS">Transcricao: aula</option>
                    </select>
                  </div>

                  <textarea
                    aria-label="Descrição do template"
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Descricao curta do uso deste template"
                    rows={2}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 placeholder:text-ink-400 transition-all resize-y"
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="mb-2 text-xs font-medium text-ink-500">Formalidade</p>
                      <Segmented value={draft.formality} options={FORMALITY_OPTIONS} onChange={(value) => setDraft((current) => ({ ...current, formality: value }))} />
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-medium text-ink-500">Nivel de detalhe</p>
                      <Segmented value={draft.detailLevel} options={DETAIL_OPTIONS} onChange={(value) => setDraft((current) => ({ ...current, detailLevel: value }))} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-xl border border-ink-100 bg-ink-50/60 p-3">
                    <CheckboxRow checked={draft.useTitle} label="Usar titulo principal" onChange={(value) => setDraft((current) => ({ ...current, useTitle: value }))} />
                    <CheckboxRow checked={draft.useHeadings} label="Organizar em secoes" onChange={(value) => setDraft((current) => ({ ...current, useHeadings: value }))} />
                    <CheckboxRow checked={draft.useSubheadings} label="Usar subsecoes quando apropriado" onChange={(value) => setDraft((current) => ({ ...current, useSubheadings: value }))} />
                    <CheckboxRow checked={draft.preferLists} label="Preferir listas quando apropriado" onChange={(value) => setDraft((current) => ({ ...current, preferLists: value }))} />
                    <CheckboxRow checked={draft.preferTables} label="Preferir tabelas quando ajudarem" onChange={(value) => setDraft((current) => ({ ...current, preferTables: value }))} />
                    <CheckboxRow checked={draft.includeAudioCitations} label="Referenciar momentos do audio" onChange={(value) => setDraft((current) => ({ ...current, includeAudioCitations: value }))} />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-ink-500">Instrucoes adicionais</label>
                    <textarea
                      aria-label="Instruções adicionais"
                      value={draft.instructions}
                      onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))}
                      placeholder="Descreva o foco, organizacao e criterios do documento final"
                      rows={9}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 placeholder:text-ink-400 transition-all resize-y leading-6"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <CheckboxRow checked={draft.isDefault} label="Padrao para novas sessoes" onChange={(value) => setDraft((current) => ({ ...current, isDefault: value }))} />
                    <CheckboxRow checked={draft.isPublic} label="Publico" onChange={(value) => setDraft((current) => ({ ...current, isPublic: value }))} />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="primary" onClick={saveTemplate} loading={savingTemplate} disabled={!draft.name.trim() || !draft.instructions.trim()}>
                      <Save className="w-4 h-4" />
                      {editingId ? 'Salvar template' : 'Criar template'}
                    </Button>
                    {editingId && <Button variant="secondary" onClick={resetTemplateForm}>Cancelar</Button>}
                  </div>
                  {templateError && (
                    <p className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{templateError}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {section === 'docs' && (
            <div className="px-6 py-5">
              <h2 className="font-medium text-ink-800 text-sm mb-0.5">Como personalizar seus documentos</h2>
              <p className="text-xs text-ink-400 mb-5">Templates definem a estrutura e o estilo do documento. O Nebula injeta automaticamente transcricao, contexto e regras internas.</p>

              <div className="space-y-4 text-sm text-ink-700">
                <div className="rounded-xl border border-ink-100 px-3 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-2">Markdown</h3>
                  <p className="text-xs leading-5 text-ink-500">Todo documento gerado e Markdown. Essa regra pertence a plataforma e nao pode ser desativada por template.</p>
                </div>
                <div className="rounded-xl border border-ink-100 px-3 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-2">Contexto vs instrucoes</h3>
                  <p className="text-xs leading-5 text-ink-500">Contexto descreve a sessao. Instrucoes descrevem como transformar a transcricao em documento.</p>
                </div>
                <div className="rounded-xl border border-ink-100 px-3 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-2">Referencias de audio</h3>
                  <p className="text-xs leading-5 text-ink-500">O switch de audio controla internamente se o modelo pode usar marcadores como [audio:00:12]. Nao e necessario escrever esses detalhes nas instrucoes.</p>
                </div>
              </div>
            </div>
          )}

          {section === 'account' && (
            <div className="px-6 py-5">
              <h2 className="font-medium text-ink-800 text-sm mb-3">Conta</h2>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-ink-100 flex items-center justify-center">
                  <span className="text-sm font-semibold text-ink-600">{user?.username?.[0]?.toUpperCase()}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-ink-800">{user?.username}</p>
                  <p className="text-xs text-ink-400">Usuario local</p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
