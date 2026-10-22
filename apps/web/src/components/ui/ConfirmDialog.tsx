import { createPortal } from 'react-dom'
import { useDialogFocus } from '../../hooks/useDialogFocus'
import { Button } from './Button'

export function ConfirmDialog({ title, children, onCancel, actions }: {
  title: string
  children: React.ReactNode
  onCancel: () => void
  actions: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[]
}) {
  const ref = useDialogFocus(onCancel)
  return createPortal(<div className="fixed inset-0 z-overlay flex items-center justify-center bg-overlay/60 p-4">
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 text-primary shadow-float">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="my-4 text-sm leading-6 text-secondary">{children}</div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" onClick={onCancel}>Cancelar</Button>
        {actions.map(action => <Button key={action.label} type="button" variant={action.danger ? 'danger' : 'primary'} onClick={action.onClick} disabled={action.disabled}>{action.label}</Button>)}
      </div>
    </div>
  </div>, document.body)
}
