import { useEffect, useState } from 'react'
import { Settings, Check, Loader2, ChevronDown } from 'lucide-react'
import { llm, LLMModel, users } from '../api/client'
import { useAuthStore } from '../store/auth'
import { Button } from '../components/ui/Button'

export function SettingsPage() {
  const { user, setUser } = useAuthStore()
  const [models, setModels] = useState<LLMModel[]>([])
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)

  useEffect(() => {
    llm.models()
      .then((res) => {
        setModels(res.models ?? [])
        const current = user?.config?.defaultModel ?? ''
        setSelected(current)
        console.log('Modelos disponíveis:', res.models)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user])

  const save = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await users.updateConfig(selected)
      if (user) setUser({ ...user, config: { ...user.config, defaultModel: selected } })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {2
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-9 h-9 rounded-xl bg-ink-100 flex items-center justify-center">
          <Settings className="w-5 h-5 text-ink-600" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900 tracking-tight">Configurações</h1>
          <p className="text-sm text-ink-400">Preferências do sistema</p>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl border border-ink-100 shadow-soft divide-y divide-ink-50">
        <div className="px-6 py-5">
          <h2 className="font-medium text-ink-800 text-sm mb-0.5">Modelo LLM padrão</h2>
          <p className="text-xs text-ink-400 mb-4">
            Modelo usado para gerar documentos e responder perguntas sobre sessões.
            Pode ser sobrescrito por sessão via campo <code className="font-mono bg-ink-50 px-1 rounded">config</code> do usuário.
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-ink-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando modelos...
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {/* Dropdown */}
              <div className="relative flex-1 max-w-xs">
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border border-ink-200 bg-white text-sm text-ink-900 hover:border-ink-300 transition-all"
                >
                  <span className="font-mono truncate">
                    {selected
                      ? models.find(m => m.id === selected)?.label ?? selected
                      : <span className="text-ink-400">Selecione um modelo</span>
                    }
                  </span>
                  <ChevronDown className="w-4 h-4 text-ink-400 shrink-0" />
                </button>

                {showDropdown && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                    <div className="absolute left-0 top-full mt-1 bg-white border border-ink-100 rounded-xl shadow-float z-20 w-full py-1 max-h-48 overflow-y-auto">
                      {models.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-ink-400">Nenhum modelo disponível</p>
                      ) : (
                        models.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => { setSelected(m.id); setShowDropdown(false) }}
                            className="w-full text-left px-3 py-2 text-xs font-mono hover:bg-ink-50 flex items-center justify-between gap-3 text-ink-700"
                          >
                            <span>{m.label}</span>
                            <span className="text-ink-300 text-xs">{m.provider}</span>
                            {selected === m.id && <Check className="w-3 h-3 text-jade-500 shrink-0" />}
                            
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>

              <Button
                variant={saved ? 'ghost' : 'primary'}
                onClick={save}
                loading={saving}
                disabled={!selected || saving}
              >
                {saved ? (
                  <><Check className="w-4 h-4 text-jade-500" /> Salvo</>
                ) : 'Salvar'}
              </Button>
            </div>
          )}
        </div>

        {/* User info */}
        <div className="px-6 py-5">
          <h2 className="font-medium text-ink-800 text-sm mb-3">Conta</h2>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-ink-100 flex items-center justify-center">
              <span className="text-sm font-semibold text-ink-600">
                {user?.username?.[0]?.toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-ink-800">{user?.username}</p>
              <p className="text-xs text-ink-400">Usuário local</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}