import { Check, Circle, Clock, Loader2, X } from 'lucide-react'
import { type DetailedProcessingStatus } from '../hooks/useProcessingStatus'
import clsx from 'clsx'

const STEPS: { type: string; label: string }[] = [
  { type: 'transcript', label: 'Transcrevendo áudio' },
  { type: 'document', label: 'Gerando documento' },
  { type: 'done', label: 'Concluído' },
]

const TYPE_ORDER = ['ingestion', 'transcript', 'document', 'done', 'unknown'] as const

type StepVisualState =
  | 'done'
  | 'waiting'
  | 'processing'
  | 'error'
  | 'inactive'

function resolveStepState(
  stepType: string,
  status: DetailedProcessingStatus
): StepVisualState {
  if (status === 'idle') return 'inactive'

  if (status === 'done') return 'done'

  const [stateStr, typeStr] = status.split(':') as [string, string]

  const currentIdx = TYPE_ORDER.indexOf(
    typeStr as typeof TYPE_ORDER[number]
  )

  const thisIdx = TYPE_ORDER.indexOf(
    stepType as typeof TYPE_ORDER[number]
  )

  if (stateStr === 'error') {
    if (typeStr === 'unknown') return 'error'
    if (thisIdx < currentIdx) return 'done'
    if (thisIdx === currentIdx) return 'error'
    return 'inactive'
  }

  if (thisIdx < currentIdx) return 'done'
  if (thisIdx === currentIdx) return stateStr as StepVisualState

  return 'inactive'
}

function StepIndicator({ state }: { state: StepVisualState }) {
  const Icon = state === 'done' ? Check : state === 'error' ? X : state === 'processing' ? Loader2 : state === 'waiting' ? Clock : Circle
  return <span aria-hidden="true" className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', {
    'bg-jade-50 text-jade-700': state === 'done',
    'bg-amber-50 text-amber-700': state === 'waiting' || state === 'processing',
    'bg-rose-50 text-rose-700': state === 'error',
    'bg-muted text-subtle': state === 'inactive',
  })}><Icon className={clsx('h-4 w-4', state === 'processing' && 'animate-spin')} /></span>
}

interface Props {
  status: DetailedProcessingStatus
  message?: string
  errorMessage?: string
}

export function PipelineStatus({ status, message, errorMessage }: Props) {
  if (status === 'idle') return null
  const steps = status.endsWith(':ingestion') ? [{ type: 'ingestion', label: 'Importando YouTube' }, ...STEPS] : STEPS

  const stateLabels: Record<StepVisualState, string> = { done: 'Concluído', waiting: 'Aguardando', processing: 'Em andamento', error: 'Falhou', inactive: 'Pendente' }
  return <div role="status" className="nebula-surface rounded-2xl border border-line px-4 py-4 sm:px-6">
    <ol className="flex flex-wrap items-start gap-4">
      {steps.map(({ type, label }) => {
        const state = resolveStepState(type, status)
        return <li key={type} className="flex min-w-0 items-center gap-2">
          <StepIndicator state={state} />
          <div><p className="text-sm font-medium text-primary">{label}</p><p className="text-xs text-subtle">{stateLabels[state]}</p></div>
        </li>
      })}
    </ol>
    {message && !status.startsWith('error:') && <p className="mt-3 text-sm text-secondary">{message}</p>}
    {status.startsWith('error:') && <p role="alert" className="mt-3 text-sm text-rose-700">{errorMessage || (status === 'error:transcript' ? 'Erro ao transcrever áudio. Tente novamente.' : status === 'error:document' ? 'Erro ao gerar documento. Tente gerar uma nova versão.' : 'Não foi possível acompanhar o processamento. Verifique a conexão e atualize a sessão.')}</p>}
  </div>
}
