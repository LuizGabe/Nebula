import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Plus, Star, Trash2 } from 'lucide-react'
import { prompts, type Prompt } from '../api/client'
import { defaultOptions, originLabel, type TemplateOptions } from '../utils/templates'
import { Button } from './ui/Button'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Toggle } from './ui/Toggle'
import { TemplateOptionsFields } from './TemplateOptionsFields'

type Draft = TemplateOptions & { name: string; description: string; instructions: string; isPublic: boolean }
const empty: Draft = { ...defaultOptions, name: '', description: '', instructions: '', isPublic: false }
const toDraft = (template: Prompt): Draft => Object.fromEntries(Object.keys(empty).map(key => [key, template[key as keyof Prompt] ?? empty[key as keyof Draft]])) as Draft

export function TemplateManager({ onDirtyChange, onBusyChange, guard }: { onDirtyChange: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void; guard: (action: () => void) => void }) {
  const [list, setList] = useState<Prompt[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft>(empty)
  const baseline = useRef(JSON.stringify(empty))
  const [selected, setSelected] = useState<Prompt | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [removing, setRemoving] = useState<Prompt | null>(null)
  const dirty = JSON.stringify(draft) !== baseline.current
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  const load = useCallback(async () => {
    try { const result = await prompts.list(); setList(result.prompts); setLoadError('') }
    catch { setLoadError('Não foi possível carregar os templates. Tente novamente.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const select = (template: Prompt | null) => {
    const next = template ? toDraft(template) : { ...empty }
    baseline.current = JSON.stringify(next)
    setSelected(template); setDraft(next); setError('')
  }
  const canEdit = !selected || selected.capabilities?.canEdit === true
  const action = async (run: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await run() }
    catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível concluir a ação. Seu rascunho foi mantido.') }
    finally { lock.current = false; setBusy(false) }
  }
  const save = (event: React.FormEvent) => {
    event.preventDefault()
    if (!canEdit || !draft.name.trim() || !draft.instructions.trim()) return
    void action(async () => {
      const payload = { ...draft, name: draft.name.trim(), description: draft.description.trim() || null, instructions: draft.instructions.trim() }
      const result = selected ? await prompts.update(selected.id, payload) : await prompts.create(payload)
      select(result.prompt)
      window.dispatchEvent(new Event('nebula:templates-changed'))
      await load()
    })
  }
  return <div className="p-4 text-primary sm:p-6">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">Templates de documento</h2>
        <p className="mt-1 text-sm text-secondary">Escolha como transformar reuniões e aulas em documentos.</p>
      </div>
      <Button disabled={busy} onClick={() => guard(() => select(null))}>
        <Plus className="h-4 w-4" />Novo template</Button>
    </div>
    {loadError && <div role="alert" className="mb-4 rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">{loadError} <Button disabled={busy} onClick={() => void load()}>Tentar novamente</Button>
    </div>}
    {error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="grid gap-6 xl:grid-cols-[250px_minmax(0,1fr)]">
      <aside aria-label="Templates disponíveis" className="max-h-80 space-y-5 overflow-y-auto pr-1 xl:max-h-[70vh]">
        {loading ? <p role="status">Carregando templates…</p> : list.length === 0 && !loadError ? <p className="text-sm text-secondary">Nenhum template disponível. Crie seu primeiro template.</p> : (['platform', 'own', 'shared', 'legacy'] as const).map(origin => {
          const items = list.filter(item => item.origin === origin)
          return items.length > 0 && <section key={origin}>
            <h3 className="mb-2 text-xs font-semibold text-secondary">{originLabel(items[0])}</h3>
            <ul className="divide-y divide-line">{items.map(template => <li key={template.id}>
              <button disabled={busy} onClick={() => guard(() => select(template))} aria-pressed={selected?.id === template.id} className={`w-full rounded-lg px-2 py-3 text-left ${selected?.id === template.id ? 'bg-selection' : 'hover:bg-hover'}`}>
                <span className="block break-words text-sm font-medium">{template.name}</span>{template.description && <span className="mt-1 block text-xs text-secondary">{template.description}</span>}<span className="mt-1 block text-xs text-subtle">{originLabel(template)}{template.isDefault ? ' · Seu padrão' : ''}{template.isPublic ? ' · Público' : ''}</span>
              </button>
            </li>)}</ul>
          </section>
        })}
      </aside>
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{selected ? canEdit ? 'Editar template' : 'Template somente leitura' : 'Novo template'}</h3>{dirty && <span role="status" className="text-xs text-secondary">Alterações não salvas</span>}</div>
        {selected && <div className="mb-4 flex flex-wrap gap-2">
          {selected.capabilities?.canSetDefault && <Button disabled={busy || selected.isDefault} onClick={() => void action(async () => { await prompts.setDefault(selected.id); await load(); setSelected(current => current ? { ...current, isDefault: true } : null); window.dispatchEvent(new Event('nebula:templates-changed')) })}>
            <Star className="h-4 w-4" />{selected.isDefault ? 'Seu padrão' : 'Usar como padrão'}</Button>}
          {selected.capabilities?.canDuplicate && <Button disabled={busy} onClick={() => guard(() => { void action(async () => { const result = await prompts.duplicate(selected.id); select(result.prompt); await load(); window.dispatchEvent(new Event('nebula:templates-changed')) }) })}>
            <Copy className="h-4 w-4" />Duplicar</Button>}
          {selected.capabilities?.canDelete && <Button disabled={busy} variant="ghost" onClick={() => setRemoving(selected)}>
            <Trash2 className="h-4 w-4" />Excluir</Button>}
        </div>}
        {selected && <p className="mb-4 text-xs leading-5 text-secondary">{canEdit ? 'Mudanças neste template podem afetar futuras gerações de sessões que ainda herdam seus valores. Documentos salvos são preservados.' : 'Este template pode ser usado ou duplicado conforme suas permissões. Para personalizar, crie uma cópia.'}</p>}
        <form onSubmit={save} className="space-y-5">
          <fieldset disabled={busy || !canEdit} className={`space-y-5 ${!canEdit ? 'nebula-template-readonly' : ''}`}>
            <label className="block text-sm">Nome <span className="text-xs text-subtle">({draft.name.length}/80)</span>
              <input required maxLength={80} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface p-3" />
            </label>
            <label className="block text-sm">Descrição <span className="text-xs text-subtle">({draft.description.length}/500)</span>
              <textarea maxLength={500} rows={2} value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} className="mt-1 w-full rounded-lg border border-line bg-surface p-3" />
            </label>
            <TemplateOptionsFields value={draft} onChange={(key, value) => setDraft(current => ({ ...current, [key]: value }))} />
            <label className="block text-sm">Instruções <span className="text-xs text-subtle">({draft.instructions.length}/8000)</span>
              <textarea required maxLength={8000} rows={7} value={draft.instructions} onChange={event => setDraft(current => ({ ...current, instructions: event.target.value }))} className="mt-1 w-full rounded-lg border border-line bg-surface p-3 leading-6" />
            </label>
            {canEdit && <div>
              <Toggle label="Disponível publicamente" checked={draft.isPublic} onChange={isPublic => setDraft(current => ({ ...current, isPublic }))} />
              <p className="mt-2 text-xs leading-5 text-secondary">Público permite uso e duplicação por outras contas. Suas sessões e áudios continuam privados. Ao tornar privado, outras contas precisam escolher outro template para futuras gerações.</p>
            </div>}
          </fieldset>
          {canEdit && <Button type="submit" variant="primary" loading={busy} disabled={!draft.name.trim() || !draft.instructions.trim()}>{selected ? 'Salvar template' : 'Criar template'}</Button>}
        </form>
      </div>
    </div>
    {removing && <ConfirmDialog title="Excluir template?" onCancel={() => { if (!busy) setRemoving(null) }} actions={[{ label: busy ? 'Excluindo…' : 'Excluir template', danger: true, disabled: busy, onClick: () => { void action(async () => { await prompts.delete(removing.id); setRemoving(null); if (selected?.id === removing.id) select(null); await load(); window.dispatchEvent(new Event('nebula:templates-changed')) }) } }]}>
      <p>Excluir “{removing.name}” da seleção? Os documentos e vínculos existentes serão preservados. Novas gerações de sessões associadas exigirão outro template escolhido explicitamente.</p>
    </ConfirmDialog>}
  </div>
}
