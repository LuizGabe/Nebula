import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Clock, GitBranch, RefreshCw, Server, XCircle } from 'lucide-react'
import { system, type QueueHealth, type ServiceHealth, type ServiceHealthStatus, type SystemStatus } from '../api/client'
import { Spinner } from '../components/ui/misc'

const statusCopy: Record<ServiceHealthStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  healthy: { label: 'Saudavel', className: 'bg-jade-50 text-jade-700 border-jade-100', icon: CheckCircle2 },
  degraded: { label: 'Degradado', className: 'bg-amber-50 text-amber-700 border-amber-100', icon: AlertTriangle },
  down: { label: 'Indisponivel', className: 'bg-rose-50 text-rose-700 border-rose-100', icon: XCircle },
  inactive: { label: 'Inativo', className: 'bg-ink-50 text-ink-500 border-ink-100', icon: Clock },
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function overallCopy(status: SystemStatus['status']) {
  if (status === 'healthy') return 'Todos os servicos principais estao respondendo.'
  if (status === 'degraded') return 'Alguns servicos estao com alerta, mas o sistema pode seguir operando.'
  return 'Um servico critico esta indisponivel.'
}

function StatusPill({ status }: { status: ServiceHealthStatus }) {
  const copy = statusCopy[status]
  const Icon = copy.icon
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${copy.className}`}>
      <Icon className="h-3.5 w-3.5" />
      {copy.label}
    </span>
  )
}

function ServiceCard({ service }: { service: ServiceHealth }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-ink-400" />
            <h2 className="truncate text-sm font-semibold text-ink-900">{service.label}</h2>
          </div>
          <p className="mt-2 line-clamp-2 text-sm text-ink-500">{service.message}</p>
        </div>
        <StatusPill status={service.status} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-xl bg-ink-50 px-3 py-2">
          <p className="text-ink-400">Latencia</p>
          <p className="mt-1 font-semibold text-ink-800">{service.latencyMs}ms</p>
        </div>
        <div className="rounded-xl bg-ink-50 px-3 py-2">
          <p className="text-ink-400">Breaker</p>
          <p className="mt-1 font-semibold text-ink-800">{service.breaker.state}</p>
        </div>
        <div className="rounded-xl bg-ink-50 px-3 py-2">
          <p className="text-ink-400">Falhas</p>
          <p className="mt-1 font-semibold text-ink-800">{service.breaker.failures}</p>
        </div>
      </div>

      <p className="mt-3 text-xs text-ink-400">Ultima checagem: {formatTime(service.checkedAt)}</p>
    </div>
  )
}

function QueueRow({ name, queue }: { name: string; queue: QueueHealth }) {
  return (
    <div className="grid grid-cols-[1fr_repeat(4,64px)] items-center gap-2 rounded-xl border border-ink-100 bg-white px-3 py-2 text-sm">
      <span className="truncate font-medium text-ink-800">{name}</span>
      <span className="text-right text-ink-500">{queue.waiting}</span>
      <span className="text-right text-ink-500">{queue.active}</span>
      <span className="text-right text-ink-500">{queue.completed}</span>
      <span className="text-right text-rose-600">{queue.failed}</span>
    </div>
  )
}

export function StatusPage() {
  const [data, setData] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const response = await system.status()
      setData(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar status')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = window.setInterval(() => load(true), 10_000)
    return () => window.clearInterval(interval)
  }, [load])

  const queues = useMemo(() => {
    const bullmq = data?.services.find((service) => service.id === 'bullmq')
    return bullmq?.details?.queues ?? {}
  }, [data])

  const counts = useMemo(() => {
    const services = data?.services ?? []
    return {
      healthy: services.filter((service) => service.status === 'healthy').length,
      degraded: services.filter((service) => service.status === 'degraded').length,
      down: services.filter((service) => service.status === 'down').length,
      inactive: services.filter((service) => service.status === 'inactive').length,
    }
  }, [data])

  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-ink-500" />
            <p className="text-sm font-medium text-ink-500">Status operacional</p>
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold text-ink-900">Servicos do Nebula</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-500">
            {data ? overallCopy(data.status) : 'Aguardando status dos servicos.'}
          </p>
        </div>

        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-4 text-sm font-medium text-ink-700 hover:border-ink-300 hover:bg-ink-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {data && (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Geral</p>
              <p className="mt-2 text-2xl font-semibold text-ink-900">{data.status}</p>
            </div>
            <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Saudaveis</p>
              <p className="mt-2 text-2xl font-semibold text-jade-700">{counts.healthy}</p>
            </div>
            <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Alertas</p>
              <p className="mt-2 text-2xl font-semibold text-amber-700">{counts.degraded + counts.inactive}</p>
            </div>
            <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Indisponiveis</p>
              <p className="mt-2 text-2xl font-semibold text-rose-700">{counts.down}</p>
            </div>
          </section>

          <section className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            {data.services.map((service) => (
              <ServiceCard key={service.id} service={service} />
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
            <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-ink-400" />
                <h2 className="text-sm font-semibold text-ink-900">Conexoes</h2>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {data.connections.map((connection) => (
                  <div key={`${connection.from}-${connection.to}-${connection.label}`} className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 text-sm">
                    <span className="font-medium text-ink-800">{connection.from}</span>
                    <span className="text-ink-300">{'->'}</span>
                    <span className="font-medium text-ink-800">{connection.to}</span>
                    <span className="ml-auto truncate text-xs text-ink-400">{connection.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink-900">Filas BullMQ</h2>
                <div className="grid grid-cols-4 gap-2 text-right text-xs font-medium text-ink-400">
                  <span className="w-16">Wait</span>
                  <span className="w-16">Active</span>
                  <span className="w-16">Done</span>
                  <span className="w-16">Fail</span>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {Object.entries(queues).length > 0 ? (
                  Object.entries(queues).map(([name, queue]) => (
                    <QueueRow key={name} name={name} queue={queue} />
                  ))
                ) : (
                  <p className="rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-500">
                    Nenhuma metrica de fila disponivel.
                  </p>
                )}
              </div>
            </div>
          </section>

          <p className="text-xs text-ink-400">
            Atualizado as {formatTime(data.checkedAt)}. Uptime da API: {data.uptimeSec}s.
          </p>
        </>
      )}
    </div>
  )
}
