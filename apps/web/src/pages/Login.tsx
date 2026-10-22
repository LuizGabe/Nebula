import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import nebulaIcon from '../assets/nebula-icon.svg'
import { NebulaWordmark } from '../components/ui/NebulaWordmark'
import { auth } from '../api/client'
import { useAuthStore } from '../store/auth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/misc'

export function LoginPage() {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const { setUser, user, loading: authLoading, fetchMe } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) {
      navigate('/', { replace: true })
      return
    }

    fetchMe().catch(() => { })
  }, [fetchMe, navigate, user])

  useEffect(() => {
    if (!authLoading && user) {
      navigate('/', { replace: true })
    }
  }, [authLoading, navigate, user])

  const handle = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const fn = tab === 'login' ? auth.login : auth.register
      const user = await fn(username, password)
      setUser(user.user)
      navigate('/')
    } catch (err: any) {
      setError(err.message ?? 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="nebula-login min-h-screen bg-ink-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <img src={nebulaIcon} alt="" className="mb-4 h-16 w-16 object-contain" />
          <h1 className="font-display text-3xl font-semibold text-ink-900 tracking-tight"><NebulaWordmark /></h1>
          <p className="text-sm text-ink-500 mt-1">gravação e transcrição de áudio</p>
        </div>

        {/* Card */}
        <div className="nebula-surface rounded-[32px] border border-white/80 shadow-card p-7 sm:p-8">
          {/* Tabs */}
          <div className="flex bg-ink-50 rounded-xl p-1 mb-6">
            {(['login', 'register'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                disabled={loading}
                onClick={() => { setTab(t); setError('') }}
                className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-all ${tab === t
                    ? 'bg-white text-ink-900 shadow-soft'
                    : 'text-ink-500 hover:text-ink-700'
                  }`}
              >
                {t === 'login' ? 'Entrar' : 'Cadastrar'}
              </button>
            ))}
          </div>

          <form onSubmit={handle} className="flex flex-col gap-4">
            <Input
              label="Usuário"
              placeholder="seu-usuario"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
            <Input
              label="Senha"
              type={showPassword ? 'text' : 'password'}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              error={error || undefined}
            />
            <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)} className="inline-flex items-center gap-2 self-end text-xs text-ink-500 hover:text-ink-900">
              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            </button>
            <Button type="submit" variant="primary" size="lg" loading={loading} className="mt-1 w-full">
              {tab === 'login' ? 'Entrar' : 'Criar conta'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
