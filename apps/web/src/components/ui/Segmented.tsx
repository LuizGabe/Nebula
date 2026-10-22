import clsx from 'clsx'
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label?: string
}) {
  return <div role="group" aria-label={label} className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-muted p-1">
    {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}
      className={clsx('min-h-9 min-w-0 break-words rounded-lg px-1 py-2 text-xs font-medium transition-colors', value === option.value ? 'bg-surface text-primary shadow-soft ring-1 ring-line' : 'text-secondary hover:text-primary hover:bg-hover')}>
      {option.label}
    </button>)}
  </div>
}
