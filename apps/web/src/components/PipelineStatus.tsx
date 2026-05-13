import { type DetailedProcessingStatus } from '../hooks/useProcessingStatus'
import clsx from 'clsx'

const STEPS: { type: string; label: string }[] = [
  { type: 'transcript', label: 'Transcrevendo áudio' },
  { type: 'document',   label: 'Gerando documento' },
  { type: 'done',       label: 'Concluído' },
]

const TYPE_ORDER = ['transcript', 'document', 'done', 'unknown'] as const

type StepVisualState = 'done' | 'waiting' | 'processing' | 'error' | 'inactive'

function resolveStepState(
  stepType: string,
  status: DetailedProcessingStatus
): StepVisualState {
  if (status === 'idle') return 'inactive'

  const [stateStr, typeStr] = status.split(':') as [string, string]
  const currentIdx = TYPE_ORDER.indexOf(typeStr as typeof TYPE_ORDER[number])
  const thisIdx    = TYPE_ORDER.indexOf(stepType as typeof TYPE_ORDER[number])

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
  return (
    <div className={clsx(
      'w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 transition-all',
      {
        'bg-jade-500':                     state === 'done' || state === 'processing',
        'bg-amber-500 animate-pulse':      state === 'waiting',
        'bg-rose-500':                     state === 'error',
        'bg-ink-200':                      state === 'inactive',
      }
    )}>
      {state === 'done' && (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M2.5 6.5L5.5 9.5L10.5 4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      {(state === 'waiting' || state === 'processing') && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          className="animate-spin"
        >
          <path d="M6 1A5 5 0 0 1 11 6" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
      )}
      {state === 'error' && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 3L9 9M9 3L3 9" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
      )}
      {state === 'inactive' && (
        <span className="w-1.5 h-1.5 rounded-full bg-ink-400" />
      )}
    </div>
  )
}

interface Props {
  status: DetailedProcessingStatus
}

export function PipelineStatus({ status }: Props) {
  if (status === 'idle') return null

  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-soft px-6 py-4">
      <div className="flex items-center gap-0">
        {STEPS.map(({ type, label }, i) => {
          const state = resolveStepState(type, status)
          const prevState = i > 0 ? resolveStepState(STEPS[i - 1].type, status) : null
          const connectorDone = prevState === 'done'

          return (
            <div key={type} className="flex items-center">
              {i > 0 && (
                <div className={clsx(
                  'h-0.5 w-10 rounded-full transition-colors',
                  connectorDone ? 'bg-jade-500' : 'bg-ink-100'
                )} />
              )}
              <div className="flex items-center gap-2">
                <StepIndicator state={state} />
                <span className={clsx('text-sm whitespace-nowrap', {
                  'text-jade-800 font-medium': state === 'done' || state === 'processing',
                  'text-amber-800 font-medium': state === 'waiting',
                  'text-rose-700 font-medium':  state === 'error',
                  'text-ink-400':               state === 'inactive',
                })}>
                  {label}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {status.startsWith('error:') && (
      <p className="text-xs text-rose-500 mt-2">
        {status === 'error:transcript' && 'Erro ao transcrever áudio. Sorry :('}
        {status === 'error:document' && 'Erro ao gerar documento. Tente reprocessar o arquivo.'}
        {!['error:transcript', 'error:document'].includes(status) && 'Ocorreu um erro no processamento. Já estamos investigando.'}
      </p>
      )}
    </div>
  )
}