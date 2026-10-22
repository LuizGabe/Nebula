import { type DetailedProcessingStatus } from '../hooks/useProcessingStatus'
import clsx from 'clsx'
import { motion, AnimatePresence } from 'framer-motion'

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
  return (
    <motion.div
      layout
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{
        scale: state === 'processing' ? [1, 1.08, 1] : 1,
        opacity: 1,
      }}
      transition={{
        duration: 0.35,
        scale: {
          repeat: state === 'processing' ? Infinity : 0,
          duration: 1.4,
        },
      }}
      className={clsx(
        'w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 transition-all',
        {
          'bg-jade-500 shadow-[0_0_14px_rgba(34,197,94,0.45)]':
            state === 'done' || state === 'processing',

          'bg-amber-500 animate-pulse':
            state === 'waiting',

          'bg-rose-500':
            state === 'error',

          'bg-ink-200':
            state === 'inactive',
        }
      )}
    >
      <AnimatePresence mode="wait">
        {state === 'done' && (
          <motion.svg
            key="done"
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0 }}
            transition={{ type: 'spring', stiffness: 300 }}
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
          >
            <path
              d="M2.5 6.5L5.5 9.5L10.5 4"
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.svg>
        )}

        {(state === 'waiting' || state === 'processing') && (
          <motion.svg
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, rotate: 360 }}
            exit={{ opacity: 0 }}
            transition={{
              rotate: {
                repeat: Infinity,
                duration: 1,
                ease: 'linear',
              },
            }}
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M6 1A5 5 0 0 1 11 6"
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </motion.svg>
        )}

        {state === 'error' && (
          <motion.svg
            key="error"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M3 3L9 9M9 3L3 9"
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </motion.svg>
        )}

        {state === 'inactive' && (
          <motion.span
            key="inactive"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="w-1.5 h-1.5 rounded-full bg-ink-400"
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

interface Props {
  status: DetailedProcessingStatus
  message?: string
  errorMessage?: string
}

export function PipelineStatus({ status, message, errorMessage }: Props) {
  if (status === 'idle') return null
  const steps = status.endsWith(':ingestion') ? [{ type: 'ingestion', label: 'Importando YouTube' }, ...STEPS] : STEPS

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.45,
        ease: 'easeOut',
      }}
      className="bg-white rounded-2xl border border-ink-100 shadow-soft px-6 py-4"
    >
      <div className="flex flex-wrap items-center gap-y-3">
        {steps.map(({ type, label }, i) => {
          const state = resolveStepState(type, status)

          const prevState =
            i > 0
              ? resolveStepState(steps[i - 1].type, status)
              : null

          const connectorDone = prevState === 'done'

          return (
            <motion.div
              key={type}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: i * 0.08,
              }}
              className="flex items-center"
            >
              {i > 0 && (
                <div className="relative h-0.5 w-10 rounded-full bg-ink-100 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{
                      width: connectorDone ? '100%' : '0%',
                    }}
                    transition={{
                      duration: 0.45,
                    }}
                    className="absolute inset-y-0 left-0 bg-jade-500"
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                <StepIndicator state={state} />

                <motion.span
                  layout
                  animate={{
                    opacity: state === 'inactive' ? 0.55 : 1,
                  }}
                  className={clsx(
                    'text-sm whitespace-nowrap transition-colors',
                    {
                      'text-jade-800 font-medium':
                        state === 'done' ||
                        state === 'processing',

                      'text-amber-800 font-medium':
                        state === 'waiting',

                      'text-rose-700 font-medium':
                        state === 'error',

                      'text-ink-400':
                        state === 'inactive',
                    }
                  )}
                >
                  {label}
                </motion.span>
              </div>
            </motion.div>
          )
        })}
      </div>

      {message && !status.startsWith('error:') && <p role="status" className="mt-2 text-xs text-ink-500">{message}</p>}

      <AnimatePresence>
        {status.startsWith('error:') && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-xs text-rose-500 mt-2"
          >
            {errorMessage || (status === 'error:transcript' &&
              'Erro ao transcrever áudio. Tente novamente.')}

            {!errorMessage && status === 'error:document' &&
              'Erro ao gerar documento. Tente reprocessar o arquivo.'}

            {!errorMessage && !['error:transcript', 'error:document'].includes(
              status
            ) &&
              'Ocorreu um erro no processamento. Já estamos investigando.'}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
