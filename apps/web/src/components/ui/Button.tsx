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
        aria-busy={loading || undefined}
        className={clsx(
          'nebula-button inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200 select-none',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          {
            // variants
            'bg-action text-on-action hover:bg-action-hover active:scale-[0.98]': variant === 'primary',
            'bg-surface text-primary border border-line hover:border-line hover:bg-muted active:scale-[0.98]': variant === 'secondary',
            'text-secondary hover:text-primary hover:bg-hover active:scale-[0.98]': variant === 'ghost',
            'bg-danger text-danger-contrast hover:opacity-90 active:scale-[0.98]': variant === 'danger',
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

export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'children'> & { label: string; children: React.ReactNode }>(
  ({ label, children, className, ...props }, ref) => <Button ref={ref} variant="ghost" size="sm" {...props} aria-label={label} data-tooltip={label} className={clsx('nebula-icon-button relative p-2', className)}>{children}</Button>
)
IconButton.displayName = 'IconButton'
