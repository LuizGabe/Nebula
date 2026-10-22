import { ConfirmDialog } from './ui/ConfirmDialog'
export function TemplateSwitchDialog({ onKeep, onReset, onCancel }: { onKeep: () => void; onReset: () => void; onCancel: () => void }) {
  return <ConfirmDialog title="Trocar template?" onCancel={onCancel} actions={[{ label: 'Manter ajustes', onClick: onKeep }, { label: 'Usar valores do novo template', onClick: onReset }]}>
    <p>Esta sessão tem ajustes personalizados. Manter ajustes preserva apenas os campos que você alterou, incluindo instruções específicas. Os demais campos herdam do novo template.</p>
  </ConfirmDialog>
}
