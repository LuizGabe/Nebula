import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Folder, X } from 'lucide-react'
import { folders, type FolderColor } from '../api/client'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { notebookColor, notebookColors, type NotebookRequest } from '../utils/library'
import { Button, IconButton } from './ui/Button'

export function NotebookDialog({ target, onClose }: { target: NotebookRequest; onClose: () => void }) {
  const [name, setName] = useState(target.folder?.name ?? '')
  const [color, setColor] = useState<FolderColor>(target.folder?.color ?? 'neutral')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const ref = useDialogFocus(() => { if (!saving) onClose() }, true)
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving || !name.trim()) return
    setSaving(true); setError('')
    try {
      if (target.folder) await folders.update(target.folder.id, { name: name.trim(), color })
      else await folders.create({ name: name.trim(), parentId: target.parentId ?? null, color })
      window.dispatchEvent(new Event('nebula:sessions-changed'))
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível salvar o caderno.')
    } finally { setSaving(false) }
  }
  return createPortal(<div className="fixed inset-0 z-overlay flex items-center justify-center bg-overlay/50 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-label={target.folder ? 'Editar caderno' : 'Novo caderno'} tabIndex={-1} className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-6 text-primary shadow-float">
      <form onSubmit={save}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{target.folder ? 'Editar caderno' : target.parentId ? 'Novo subcaderno' : 'Novo caderno'}</h2>
          <IconButton type="button" label="Fechar" disabled={saving} onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <fieldset disabled={saving} className="space-y-5">
          <label className="block text-sm">Nome<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} className="mt-2 block w-full rounded-lg border border-control-line bg-canvas px-3 py-2" />
          </label>
          <fieldset>
            <legend className="mb-2 text-sm">Cor do caderno</legend>
            <div className="flex flex-wrap gap-2">{notebookColors.map(option => <button key={option.id} type="button" aria-pressed={color === option.id} onClick={() => setColor(option.id)} className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm ${color === option.id ? 'border-focus bg-selection' : 'border-line hover:bg-hover'}`}>
              <Folder className="h-4 w-4" style={{ color: notebookColor(option.id) }} />{option.name}{color === option.id && <Check aria-hidden="true" className="h-4 w-4" />}</button>)}</div>
          </fieldset>
          <p className="text-xs text-subtle">A cor vale somente para este caderno. Subcadernos têm cores independentes.</p>
        </fieldset>
        {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim()}>Salvar caderno</Button>
        </div>
      </form>
    </div>
  </div>, document.body)
}
