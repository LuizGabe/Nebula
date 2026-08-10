import { useEffect, useState } from 'react'
import { Check, ChevronDown, Loader2, Pencil, Plus, Save, Settings, SlidersHorizontal, Trash2, User, Wand2 } from 'lucide-react'
import clsx from 'clsx'
import { llm, LLMModel, type LLMModelStatus, prompts, type Prompt, users } from '../api/client'
import { useAuthStore } from '../store/auth'
import { Button } from '../components/ui/Button'

const EMPTY_PROMPT = {
  name: '',
  content: '',
  isDefault: false,
  isPublic: false,
}

type Section = 'prompts' | 'model' | 'account'

export function SettingsPage() {
  const { user, setUser } = useAuthStore()
  const [section, setSection] = useState<Section>('prompts')
  const [models, setModels] = useState<LLMModel[]>([])
  const [modelStatus, setModelStatus] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string>('')
  const [loadingModels, setLoadingModels] = useState(true)
  const [savingModel, setSavingModel] = useState(false)
  const [savedModel, setSavedModel] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)

  const [promptList, setPromptList] = useState<Prompt[]>([])
  const [loadingPrompts, setLoadingPrompts] = useState(true)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState(EMPTY_PROMPT)

  const loadPrompts = async () => {
    setLoadingPrompts(true)
    try {
      const res = await prompts.list()
      setPromptList(res.prompts ?? [])
    } finally {
      setLoadingPrompts(false)
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

    loadPrompts().catch(() => setPromptList([]))

    const source = llm.status()
    source.addEventListener('message', (event) => {
      const data = JSON.parse(event.data) as { models?: LLMModelStatus[] }
      const nextStatus = Object.fromEntries((data.models ?? []).map((model) => [model.id, model.available]))
      setModelStatus(nextStatus)

      setSelected((current) => {
        if (current && nextStatus[current] === false) return ''
        return current
      })
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
    try {
      await users.updateConfig(selected)
      if (user) setUser({ ...user, config: { ...user.config, defaultModel: selected } })
      setSavedModel(true)
      setTimeout(() => setSavedModel(false), 2000)
    } finally {
      setSavingModel(false)
    }
  }

  const startEdit = (prompt: Prompt) => {
    setEditingId(prompt.id)
    setDraft({
      name: prompt.name,
      content: prompt.content,
      isDefault: prompt.isDefault,
      isPublic: prompt.isPublic,
    })
  }

  const resetPromptForm = () => {
    setEditingId(null)
    setDraft(EMPTY_PROMPT)
  }

  const savePrompt = async () => {
    if (!draft.name.trim() || !draft.content.trim()) return
    setSavingPrompt(true)
    try {
      if (editingId) {
        await prompts.update(editingId, draft)
      } else {
        await prompts.create(draft)
      }
      resetPromptForm()
      await loadPrompts()
    } finally {
      setSavingPrompt(false)
    }
  }

  const deletePrompt = async (prompt: Prompt) => {
    if (!confirm(`Remover o prompt "${prompt.name}"?`)) return
    await prompts.delete(prompt.id)
    if (editingId === prompt.id) resetPromptForm()
    await loadPrompts()
  }

  const sections = [
    { id: 'prompts' as const, label: 'Prompts', icon: Wand2 },
    { id: 'model' as const, label: 'Modelo', icon: SlidersHorizontal },
    { id: 'account' as const, label: 'Usuario', icon: User },
  ]

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-9 h-9 rounded-xl bg-ink-100 flex items-center justify-center">
          <Settings className="w-5 h-5 text-ink-600" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900 tracking-tight">Configuracoes</h1>
          <p className="text-sm text-ink-400">Ajustes de prompts, modelo e conta</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px,1fr] gap-6">
        <aside className="bg-white rounded-2xl border border-ink-100 shadow-soft p-2 h-max">
          {sections.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                  section === item.id
                    ? 'bg-ink-900 text-white'
                    : 'text-ink-600 hover:text-ink-900 hover:bg-ink-50'
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            )
          })}
        </aside>

        <section className="bg-white rounded-2xl border border-ink-100 shadow-soft">
          {section === 'model' && (
            <div className="px-6 py-5">
              <h2 className="font-medium text-ink-800 text-sm mb-0.5">Modelo LLM padrao</h2>
              <p className="text-xs text-ink-400 mb-4">Modelo usado para gerar documentos e responder perguntas.</p>

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

          {section === 'prompts' && (
            <div className="px-6 py-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="font-medium text-ink-800 text-sm mb-0.5">Prompts de documento</h2>
                  <p className="text-xs text-ink-400">Tipos disponiveis para sessoes novas e existentes.</p>
                </div>
                <Button size="sm" variant="secondary" onClick={resetPromptForm}>
                  <Plus className="w-4 h-4" />
                  Novo
                </Button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[300px,1fr] gap-5">
                <div className="border border-ink-100 rounded-xl overflow-hidden">
                  {loadingPrompts ? (
                    <div className="p-4 flex items-center gap-2 text-sm text-ink-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Carregando...
                    </div>
                  ) : promptList.length === 0 ? (
                    <p className="p-4 text-sm text-ink-400">Nenhum prompt cadastrado.</p>
                  ) : (
                    promptList.map((prompt) => (
                      <div key={prompt.id} className="p-3 border-b border-ink-50 last:border-b-0 flex items-center gap-2">
                        <button className="flex-1 text-left min-w-0" onClick={() => startEdit(prompt)}>
                          <p className="text-sm font-medium text-ink-800 truncate">{prompt.name}</p>
                          <p className="text-xs text-ink-400">
                            {prompt.isDefault ? 'Padrao' : 'Personalizado'} / {prompt.isPublic ? 'Publico' : 'Privado'}
                          </p>
                        </button>
                        <button className="p-1.5 rounded-lg text-ink-400 hover:text-ink-800 hover:bg-ink-50" onClick={() => startEdit(prompt)} title="Editar">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button className="p-1.5 rounded-lg text-rose-400 hover:text-rose-700 hover:bg-rose-50" onClick={() => deletePrompt(prompt)} title="Remover">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
                    placeholder="Nome do prompt"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 placeholder:text-ink-400 transition-all"
                  />
                  <textarea
                    value={draft.content}
                    onChange={(e) => setDraft((current) => ({ ...current, content: e.target.value }))}
                    placeholder="Prompt de sistema usado na geracao do documento"
                    rows={12}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 placeholder:text-ink-400 transition-all resize-y"
                  />
                  <label className="inline-flex items-center gap-2 text-sm text-ink-700">
                    <input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft((current) => ({ ...current, isDefault: e.target.checked }))} className="h-4 w-4 rounded border-ink-300" />
                    Usar como padrao para novas sessoes
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-ink-700">
                    <input type="checkbox" checked={draft.isPublic} onChange={(e) => setDraft((current) => ({ ...current, isPublic: e.target.checked }))} className="h-4 w-4 rounded border-ink-300" />
                    Tornar publico para outros usuarios
                  </label>
                  <div className="flex items-center gap-2">
                    <Button variant="primary" onClick={savePrompt} loading={savingPrompt} disabled={!draft.name.trim() || !draft.content.trim()}>
                      <Save className="w-4 h-4" />
                      {editingId ? 'Salvar prompt' : 'Criar prompt'}
                    </Button>
                    {editingId && <Button variant="secondary" onClick={resetPromptForm}>Cancelar</Button>}
                  </div>
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
