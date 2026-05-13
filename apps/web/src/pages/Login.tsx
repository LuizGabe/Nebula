import { useEffect, useState } from 'react'
import { redirect, useNavigate } from 'react-router-dom'
import { Mic } from 'lucide-react'
import { auth } from '../api/client'
import { useAuthStore } from '../store/auth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/misc'

export function LoginPage() {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { setUser, user, loading: authLoading, fetchMe } = useAuthStore()
  const navigate = useNavigate()

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
    <div className="min-h-screen bg-ink-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 rounded-2xl bg-ink-900 flex items-center justify-center mb-4 shadow-card">
            <Mic className="w-7 h-7 text-white" strokeWidth={2} />
          </div>
          <h1 className="font-display text-3xl font-semibold text-ink-900 tracking-tight">nebula</h1>
          <p className="text-sm text-ink-500 mt-1">gravação e transcrição de áudio</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-ink-100 shadow-card p-6">
          {/* Tabs */}
          <div className="flex bg-ink-50 rounded-xl p-1 mb-6">
            {(['login', 'register'] as const).map((t) => (
              <button
                key={t}
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
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
            <Input
              label="Senha"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              error={error || undefined}
            />
            <Button type="submit" variant="primary" size="lg" loading={loading} className="mt-1 w-full">
              {tab === 'login' ? 'Entrar' : 'Criar conta'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
