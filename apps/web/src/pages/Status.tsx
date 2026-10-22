import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, BrainCircuit, CheckCircle2, Clock, Database, GitBranch, HardDrive, Network, RefreshCw, Server, Workflow, XCircle, Zap } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { system, type QueueHealth, type ServiceHealth, type ServiceHealthStatus, type SystemStatus } from '../api/client'

const statusCopy: Record<ServiceHealthStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  healthy: { label: 'Saudavel', className: 'bg-jade-50 text-jade-700 border-jade-100', icon: CheckCircle2 },
  degraded: { label: 'Degradado', className: 'bg-amber-50 text-amber-700 border-amber-100', icon: AlertTriangle },
  down: { label: 'Indisponivel', className: 'bg-rose-50 text-rose-700 border-rose-100', icon: XCircle },
  inactive: { label: 'Inativo', className: 'bg-ink-50 text-ink-500 border-ink-100', icon: Clock },
}
const MIN_INITIAL_LOADING_MS = 700
type DiagramNodeStatus = ServiceHealthStatus | 'external'
type DiagramNode = {
  id: string
  x: number
  y: number
  label: string
  icon: typeof Server
  status: DiagramNodeStatus
  message: string
}

const nodeLayout: Record<string, { x: number; y: number; label: string; icon: typeof Server }> = {
  web: { x: 90, y: 190, label: 'Web', icon: Network },
  api: { x: 285, y: 190, label: 'API', icon: Server },
  postgres: { x: 490, y: 70, label: 'PostgreSQL', icon: Database },
  redis: { x: 490, y: 150, label: 'Redis', icon: Zap },
  minio: { x: 490, y: 230, label: 'MinIO', icon: HardDrive },
  bullmq: { x: 490, y: 310, label: 'BullMQ', icon: Workflow },
  groq_worker: { x: 710, y: 310, label: 'Groq worker', icon: Server },
  parakeet_worker: { x: 710, y: 150, label: 'faster-whisper', icon: Server },
  llm: { x: 710, y: 70, label: 'LLM', icon: BrainCircuit },
}

function statusTone(status: ServiceHealthStatus | 'external') {
  if (status === 'healthy') return { fill: '#edfaf4', stroke: '#22b584', text: '#0f5c3a', line: '#22b584' }
  if (status === 'degraded') return { fill: '#fff6e6', stroke: '#f08c1a', text: '#7a4200', line: '#f08c1a' }
  if (status === 'down') return { fill: '#fef0f3', stroke: '#e84e6a', text: '#8b1a2e', line: '#e84e6a' }
  if (status === 'inactive') return { fill: '#f6f6f8', stroke: '#bfc1ca', text: '#61636e', line: '#777985' }
  return { fill: '#ffffff', stroke: '#dcdee5', text: '#303138', line: '#bfc1ca' }
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
    <div className="nebula-surface rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
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

function ServiceDiagram({ data }: { data: SystemStatus }) {
  const servicesById = useMemo(() => {
    return new Map(data.services.map((service) => [service.id, service]))
  }, [data.services])

  const nodes = useMemo(() => {
    const ids = new Set<string>(['web'])
    data.connections.forEach((connection) => {
      ids.add(connection.from)
      ids.add(connection.to)
    })
    data.services.forEach((service) => ids.add(service.id))

    return Array.from(ids).map<DiagramNode>((id, index) => {
      const known = nodeLayout[id]
      const service = servicesById.get(id)
      return {
        id,
        x: known?.x ?? 160 + (index % 4) * 180,
        y: known?.y ?? 370 + Math.floor(index / 4) * 80,
        label: service?.label ?? known?.label ?? id,
        icon: known?.icon ?? Server,
        status: service?.status ?? 'external',
        message: service?.message ?? 'Interface do navegador',
      }
    })
  }, [data.connections, data.services, servicesById])

  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])

  return (
    <div className="nebula-surface rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-ink-400" />
          <h2 className="text-sm font-semibold text-ink-900">Conexoes</h2>
        </div>
        <span className="text-xs text-ink-400">{data.connections.length} links</span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl bg-ink-50 p-3">
        <svg className="h-[360px] min-w-[760px] w-full" viewBox="0 0 820 380" role="img" aria-label="Diagrama animado dos servicos conectados">
          <defs>
            <filter id="diagramShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#0f0f12" floodOpacity="0.09" />
            </filter>
          </defs>

          {data.connections.map((connection, index) => {
            const from = nodesById.get(connection.from)
            const to = nodesById.get(connection.to)
            if (!from || !to) return null
            const tone = statusTone(to.status)
            const midX = (from.x + to.x) / 2

            return (
              <g key={`${connection.from}-${connection.to}-${connection.label}`}>
                <path
                  d={`M ${from.x + 58} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x - 58} ${to.y}`}
                  fill="none"
                  stroke="#dcdee5"
                  strokeWidth="2"
                />
                <path
                  d={`M ${from.x + 58} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x - 58} ${to.y}`}
                  fill="none"
                  stroke={tone.line}
                  strokeDasharray="8 14"
                  strokeLinecap="round"
                  strokeWidth="3"
                  opacity="0.85"
                >
                  <animate attributeName="stroke-dashoffset" from="44" to="0" dur={`${1.7 + index * 0.12}s`} repeatCount="indefinite" />
                </path>
                <circle r="4" fill={tone.line}>
                  <animateMotion
                    dur={`${2.4 + index * 0.16}s`}
                    repeatCount="indefinite"
                    path={`M ${from.x + 58} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x - 58} ${to.y}`}
                  />
                </circle>
              </g>
            )
          })}

          {nodes.map((node) => {
            const tone = statusTone(node.status)
            const Icon = node.icon
            return (
              <g key={node.id} filter="url(#diagramShadow)">
                <circle cx={node.x} cy={node.y} r="33" fill={tone.fill} stroke={tone.stroke} strokeWidth="2">
                  {node.status === 'healthy' && (
                    <animate attributeName="r" values="33;37;33" dur="2.4s" repeatCount="indefinite" />
                  )}
                </circle>
                <foreignObject x={node.x - 12} y={node.y - 12} width="24" height="24">
                  <Icon className="h-6 w-6" style={{ color: tone.text }} />
                </foreignObject>
                <rect x={node.x - 58} y={node.y + 43} width="116" height="38" rx="10" fill="white" stroke="#eceef3" />
                <text x={node.x} y={node.y + 60} textAnchor="middle" className="fill-ink-900 text-[12px] font-semibold">
                  {node.label}
                </text>
                <text x={node.x} y={node.y + 74} textAnchor="middle" className="fill-ink-400 text-[10px]">
                  {node.status === 'external' ? 'interface' : statusCopy[node.status].label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`shimmer rounded-lg ${className}`} />
}

function ServiceCardSkeleton() {
  return (
    <div className="nebula-surface rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-4 w-4 rounded" />
            <SkeletonBlock className="h-4 w-32" />
          </div>
          <SkeletonBlock className="mt-3 h-3 w-full" />
          <SkeletonBlock className="mt-2 h-3 w-3/4" />
        </div>
        <SkeletonBlock className="h-7 w-24 rounded-full" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-xl bg-ink-50 px-3 py-2">
            <SkeletonBlock className="h-3 w-12" />
            <SkeletonBlock className="mt-2 h-4 w-10" />
          </div>
        ))}
      </div>

      <SkeletonBlock className="mt-4 h-3 w-40" />
    </div>
  )
}

function StatusPageSkeleton() {
  return (
    <div className="nebula-page mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <header className="nebula-page-header flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-5 w-5 rounded" />
            <SkeletonBlock className="h-4 w-36" />
          </div>
          <SkeletonBlock className="mt-3 h-9 w-full max-w-sm" />
          <SkeletonBlock className="mt-3 h-4 w-full max-w-xl" />
        </div>
        <SkeletonBlock className="h-10 w-32 rounded-xl" />
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="nebula-surface rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="mt-3 h-8 w-16" />
          </div>
        ))}
      </section>

      <section className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <ServiceCardSkeleton key={index} />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="nebula-surface rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-4 w-4 rounded" />
            <SkeletonBlock className="h-4 w-24" />
          </div>
          <div className="mt-4 rounded-xl bg-ink-50 p-3">
            <div className="relative h-[320px] min-w-[360px] overflow-hidden rounded-lg">
              <SkeletonBlock className="absolute left-[4%] top-[42%] h-16 w-16 rounded-full" />
              <SkeletonBlock className="absolute left-[29%] top-[42%] h-16 w-16 rounded-full" />
              <SkeletonBlock className="absolute left-[56%] top-[8%] h-16 w-16 rounded-full" />
              <SkeletonBlock className="absolute left-[56%] top-[34%] h-16 w-16 rounded-full" />
              <SkeletonBlock className="absolute left-[56%] top-[60%] h-16 w-16 rounded-full" />
              <SkeletonBlock className="absolute left-[82%] top-[8%] h-16 w-16 rounded-full" />
              <SkeletonBlock className="absolute left-[82%] top-[60%] h-16 w-16 rounded-full" />
              <SkeletonBlock className="absolute left-[17%] top-[49%] h-2 w-20" />
              <SkeletonBlock className="absolute left-[42%] top-[22%] h-2 w-24" />
              <SkeletonBlock className="absolute left-[42%] top-[49%] h-2 w-24" />
              <SkeletonBlock className="absolute left-[69%] top-[22%] h-2 w-24" />
              <SkeletonBlock className="absolute left-[69%] top-[72%] h-2 w-24" />
            </div>
          </div>
        </div>

        <div className="nebula-surface rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-4 w-56" />
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <SkeletonBlock key={index} className="h-10 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </section>
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
    const startedAt = performance.now()
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)

    const waitForInitialSkeleton = async () => {
      if (silent) return
      const remaining = MIN_INITIAL_LOADING_MS - (performance.now() - startedAt)
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining))
      }
    }

    try {
      const response = await system.status()
      await waitForInitialSkeleton()
      setData(response)
    } catch (err) {
      await waitForInitialSkeleton()
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
    return <StatusPageSkeleton />
  }

  return (
    <div className="nebula-page mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <header className="nebula-page-header flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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

        <Button variant="secondary"
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-4 text-sm font-medium text-ink-700 hover:border-ink-300 hover:bg-ink-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Atualizando…' : 'Atualizar'}
        </Button>
      </header>

      {error && (
        <div role="alert" className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {data && (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <div className="nebula-surface rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Geral</p>
              <p className="mt-2 text-2xl font-semibold text-ink-900">{data.status === 'healthy' ? 'Operacional' : data.status === 'degraded' ? 'Com alertas' : 'Indisponível'}</p>
            </div>
            <div className="nebula-surface rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Saudaveis</p>
              <p className="mt-2 text-2xl font-semibold text-jade-700">{counts.healthy}</p>
            </div>
            <div className="nebula-surface rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Alertas</p>
              <p className="mt-2 text-2xl font-semibold text-amber-700">{counts.degraded + counts.inactive}</p>
            </div>
            <div className="nebula-surface rounded-2xl border border-ink-100 bg-white p-4 shadow-soft">
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
            <ServiceDiagram data={data} />

            <div className="nebula-surface nebula-queue-panel min-w-0 overflow-x-auto rounded-2xl border border-ink-100 bg-white p-5 shadow-soft">
              <div className="flex min-w-[440px] items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink-900">Filas BullMQ</h2>
                <div className="grid grid-cols-4 gap-2 text-right text-xs font-medium text-ink-400">
                  <span className="w-16">Wait</span>
                  <span className="w-16">Active</span>
                  <span className="w-16">Done</span>
                  <span className="w-16">Fail</span>
                </div>
              </div>
              <div className="mt-4 flex min-w-[440px] flex-col gap-2">
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
