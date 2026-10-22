import clsx from 'clsx'
import { forwardRef, useId } from 'react'

// ── Badge ─────────────────────────────────────────────────────────────────────
interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'jade' | 'amber' | 'rose' | 'ink' | 'blue' | 'orange'
  className?: string
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
        {
          'bg-ink-100 text-ink-600': variant === 'default',
          'bg-jade-50 text-jade-700': variant === 'jade',
          'bg-amber-50 text-amber-700': variant === 'amber',
          'bg-rose-50 text-rose-700': variant === 'rose',
          'bg-ink-900 text-ink-50': variant === 'ink',
          'bg-blue-50 text-blue-700': variant === 'blue',
          'bg-orange-50 text-orange-700': variant === 'orange'
        },
        className
      )}
    >
      {children}
    </span>
  )
}

// ── Input ─────────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const errorId = `${inputId}-error`
    return (
    <div className="flex flex-col gap-1">
      {label && <label htmlFor={inputId} className="text-sm font-medium text-ink-700">{label}</label>}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={clsx(
          'w-full px-3.5 py-2.5 rounded-xl border text-sm bg-white text-ink-900 outline-none transition-all',
          'placeholder:text-ink-400',
          error
            ? 'border-rose-400 focus:ring-2 focus:ring-rose-200'
            : 'border-ink-200 focus:border-ink-400 focus:ring-2 focus:ring-ink-100',
          className
        )}
        {...props}
      />
      {error && <p id={errorId} role="alert" className="text-xs text-rose-500">{error}</p>}
    </div>
  )
  }
)
Input.displayName = 'Input'

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={clsx('animate-spin text-ink-400', className)}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ── Divider ───────────────────────────────────────────────────────────────────
export function Divider({ className }: { className?: string }) {
  return <hr className={clsx('border-ink-100', className)} />
}

// ── Empty State ───────────────────────────────────────────────────────────────
export function EmptyState({ title, description, action }: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <div className="w-12 h-12 rounded-2xl bg-ink-100 flex items-center justify-center mb-1">
        <svg className="w-6 h-6 text-ink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <p className="font-medium text-ink-700">{title}</p>
      {description && <p className="text-sm text-ink-400 max-w-xs">{description}</p>}
      {action}
    </div>
  )
}
