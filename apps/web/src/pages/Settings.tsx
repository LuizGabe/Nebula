import { MenuSurface } from '../components/ui/MenuSurface'
import { TemplateManager } from '../components/TemplateManager'
import { useDraftGuard } from '../hooks/useDraftGuard'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BookOpen, Check, ChevronDown, Loader2, Settings, SlidersHorizontal, User, Wand2 } from 'lucide-react'
import clsx from 'clsx'
import {
  llm,
  LLMModel,
  type LLMModelStatus,
  users,
} from '../api/client'
import { useAuthStore } from '../store/auth'
import { Button } from '../components/ui/Button'

type Section = 'templates' | 'model' | 'docs' | 'account'

export function SettingsPage() {
  const { user, setUser } = useAuthStore()
  const [section, setSection] = useState<Section>('templates')
  const [searchParams, setSearchParams] = useSearchParams()
  const [templateDirty, setTemplateDirty] = useState(false)
  const [templateBusy, setTemplateBusy] = useState(false)
  const draftGuard = useDraftGuard(templateDirty, templateBusy)
  useEffect(() => {
    const next = searchParams.get('section')
    if (next === 'account' || next === 'templates' || next === 'model' || next === 'docs') setSection(next)
  }, [searchParams])
  const [models, setModels] = useState<LLMModel[]>([])
  const [modelStatus, setModelStatus] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string>('')
  const [loadingModels, setLoadingModels] = useState(true)
  const [savingModel, setSavingModel] = useState(false)
  const [savedModel, setSavedModel] = useState(false)
  const [modelError, setModelError] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

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

  const sections = [
    { id: 'templates' as const, label: 'Templates', icon: Wand2 },
    { id: 'model' as const, label: 'Modelo', icon: SlidersHorizontal },
    { id: 'docs' as const, label: 'Guia', icon: BookOpen },
    { id: 'account' as const, label: 'Conta', icon: User },
  ]

  return (
    <div className="nebula-page max-w-6xl mx-auto px-4 py-8 sm:px-8 sm:py-10">
      <div className="nebula-page-header flex items-center gap-3 mb-8">
        <div className="w-9 h-9 rounded-xl bg-hover flex items-center justify-center">
          <Settings className="w-5 h-5 text-secondary" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold text-primary tracking-tight">Configurações</h1>
          <p className="text-sm text-subtle">Templates, modelo e conta</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)] gap-6">
        <aside className="nebula-surface bg-surface rounded-2xl border border-line shadow-soft p-2 h-max flex gap-1 overflow-x-auto lg:block">
          {sections.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => draftGuard.request(() => setSearchParams({ section: item.id }))}
                aria-pressed={section === item.id}
                className={clsx(
                  'shrink-0 flex items-center gap-3 px-3 py-2.5 rounded-xl whitespace-nowrap lg:w-full text-sm font-medium transition-all',
                  section === item.id ? 'bg-action text-on-action' : 'text-secondary hover:text-primary hover:bg-muted'
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            )
          })}
        </aside>

        <section className="nebula-surface bg-surface rounded-2xl border border-line shadow-soft">
          {section === 'model' && (
            <div className="px-6 py-5">
              <h2 className="font-medium text-primary text-sm mb-0.5">Modelo LLM padrao</h2>
              <p className="text-xs text-subtle mb-4">Modelo usado para gerar documentos e responder perguntas.</p>

              {modelError && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{modelError}</p>}
              {loadingModels ? (
                <div className="flex items-center gap-2 text-sm text-subtle">
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
                    <div className="relative min-w-0 flex-1 max-w-sm">
                      <button
                        onClick={() => onlineModels.length > 0 && setShowDropdown(!showDropdown)}
                        disabled={onlineModels.length === 0}
                        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border border-line bg-surface text-sm text-primary hover:border-line transition-all disabled:cursor-not-allowed disabled:bg-muted disabled:text-subtle"
                      >
                        <span className="font-mono truncate">
                          {selectedModel?.label ?? (onlineModels.length > 0 ? 'Selecione um modelo online' : 'Nenhum modelo online')}
                        </span>
                        <ChevronDown className="w-4 h-4 text-subtle shrink-0" />
                      </button>

                      {showDropdown && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                          <MenuSurface label="Modelos disponíveis" onClose={() => setShowDropdown(false)} className="absolute left-0 top-full mt-1 w-full py-1 max-h-56 overflow-y-auto">
                            {onlineModels.map((model) => (
                              <button
                                key={model.id}
                                onClick={() => { setSelected(model.id); setShowDropdown(false) }}
                                className="w-full text-left px-3 py-2 text-xs font-mono hover:bg-muted flex items-center justify-between gap-3 text-secondary"
                              >
                                <span>{model.label}</span>
                                <span className="text-jade-600 text-xs">online</span>
                                {selected === model.id && <Check className="w-3 h-3 text-jade-500 shrink-0" />}
                              </button>
                            ))}
                          </MenuSurface>
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

          {section === 'templates' && <TemplateManager onDirtyChange={setTemplateDirty} onBusyChange={setTemplateBusy} guard={draftGuard.request} />}

          {section === 'docs' && (
            <div className="px-6 py-5">
              <h2 className="font-medium text-primary text-sm mb-0.5">Como personalizar seus documentos</h2>
              <p className="text-xs text-subtle mb-5">Templates definem a estrutura e o estilo do documento. O Nebula injeta automaticamente transcricao, contexto e regras internas.</p>

              <div className="space-y-4 text-sm text-secondary">
                <div className="rounded-xl border border-line px-3 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle mb-2">Markdown</h3>
                  <p className="text-xs leading-5 text-subtle">Todo documento gerado e Markdown. Essa regra pertence a plataforma e nao pode ser desativada por template.</p>
                </div>
                <div className="rounded-xl border border-line px-3 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle mb-2">Contexto vs instrucoes</h3>
                  <p className="text-xs leading-5 text-subtle">Contexto descreve a sessao. Instrucoes descrevem como transformar a transcricao em documento.</p>
                </div>
                <div className="rounded-xl border border-line px-3 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle mb-2">Referencias de audio</h3>
                  <p className="text-xs leading-5 text-subtle">O switch de audio controla internamente se o modelo pode usar marcadores como [audio:00:12]. Nao e necessario escrever esses detalhes nas instrucoes.</p>
                </div>
              </div>
            </div>
          )}

          {section === 'account' && (
            <div className="px-6 py-5">
              <h2 className="font-medium text-primary text-sm mb-3">Conta</h2>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-hover flex items-center justify-center">
                  <span className="text-sm font-semibold text-secondary">{user?.username?.[0]?.toUpperCase()}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-primary">{user?.username}</p>
                  <p className="text-xs text-subtle">Usuario local</p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
      {draftGuard.dialog}
    </div>
  )
}
