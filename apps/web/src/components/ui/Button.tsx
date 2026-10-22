import { forwardRef } from 'react'
import clsx from 'clsx'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={clsx(
          'nebula-button inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200 select-none',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          {
            // variants
            'bg-ink-900 text-ink-50 hover:bg-ink-800 active:scale-[0.98]': variant === 'primary',
            'bg-white text-ink-800 border border-ink-200 hover:border-ink-300 hover:bg-ink-50 active:scale-[0.98]': variant === 'secondary',
            'text-ink-600 hover:text-ink-900 hover:bg-ink-100 active:scale-[0.98]': variant === 'ghost',
            'bg-rose-500 text-white hover:bg-rose-700 active:scale-[0.98]': variant === 'danger',
            // sizes
            'text-xs px-3 py-1.5': size === 'sm',
            'text-sm px-4 py-2': size === 'md',
            'text-base px-6 py-3': size === 'lg',
          },
          className
        )}
        {...props}
      >
        {loading && (
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
