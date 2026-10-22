import { useId } from 'react'

export function Toggle({ checked, onChange, label, disabled = false }: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  const labelId = useId()
  return <button type="button" role="switch" aria-checked={checked} aria-labelledby={labelId}
    disabled={disabled} onClick={() => onChange(!checked)}
    className="nebula-follow-switch flex min-h-11 w-full items-center justify-between gap-4 rounded-xl px-2 py-2 text-left text-sm text-secondary disabled:opacity-50">
    <span id={labelId}>{label}</span>
    <span aria-hidden="true" className="nebula-switch-track shrink-0"><span /></span>
  </button>
}
