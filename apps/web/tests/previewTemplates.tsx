// Local visual QA only. This HTML is not an entry point of the production build.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '../src/index.css'
import { NewSessionModal } from '../src/components/NewSessionModal'
import { TemplateManager } from '../src/components/TemplateManager'
import { useDraftGuard } from '../src/hooks/useDraftGuard'
import { defaultOptions } from '../src/utils/templates'
import { prompts, sessions, folders, ApiError, type Prompt } from '../src/api/client'
const query = new URLSearchParams(window.location.search)
document.documentElement.dataset.theme = query.get('theme') === 'light' ? 'light' : 'dark'
const readonly = { canUse: true, canDuplicate: true, canSetDefault: true, canEdit: false, canDelete: false }
let templates = [
  { ...defaultOptions, id: 'qa-platform', name: 'QA · Ata de reunião', description: 'Decisões, ações e próximos passos da reunião.', instructions: 'Resuma decisões e ações presentes no áudio.', origin: 'platform', isDefault: true, isPublic: true, capabilities: readonly },
  { ...defaultOptions, id: 'qa-own', name: 'QA · Meu template', description: 'Organização própria para a revisão semanal.', instructions: 'Organize os fatos do áudio em temas e próximos passos.', origin: 'own', isPublic: false, capabilities: { ...readonly, canEdit: true, canDelete: true } },
  { ...defaultOptions, id: 'qa-shared', name: 'QA · Material de estudo', description: 'Conceitos e perguntas para revisar uma aula.', instructions: 'Organize conceitos presentes na aula.', origin: 'shared', isPublic: true, capabilities: readonly },
] as Prompt[]
prompts.list = async () => { if (query.has('error')) throw Error('Consulta simulada indisponível'); return { prompts: templates, defaultPromptId: 'qa-platform' } }
folders.list = async () => { if (query.has('error')) throw Error('Consulta simulada indisponível'); return { folders: [{ id: 'qa-folder', name: 'QA · Trabalho', parentId: null, color: 'sage', createdAt: '', updatedAt: '' }] } }
sessions.creationOptions = async () => ({ youtubeMaxDurationMinutes: 30 })
sessions.create = async data => { throw data.youtubeUrl ? new ApiError('QA: importação falhou após criar a sessão.', 503, 'qa-existing-session') : new Error('QA: falha de criação simulada. Nenhuma sessão foi criada.') }
prompts.create = prompts.update = async () => { throw Error('QA: falha de salvamento simulada. O rascunho foi preservado.') }
prompts.setDefault = async id => { templates = templates.map(item => ({ ...item, isDefault: item.id === id })); return { defaultPromptId: id } }
prompts.delete = async () => { throw Error('QA: exclusão simulada indisponível.') }
prompts.duplicate = async id => { const prompt = { ...templates.find(item => item.id === id)!, id: 'qa-copy', name: 'QA · Cópia', origin: 'own' as const, isPublic: false, capabilities: { ...readonly, canEdit: true, canDelete: true } }; templates = [...templates.filter(item => item.id !== 'qa-copy'), prompt]; return { prompt } }
function Preview() {
  const [open, setOpen] = useState(query.get('mode') !== 'management')
  const [dirty, setDirty] = useState(false)
  const guard = useDraftGuard(dirty)
  return <div className="min-h-screen bg-canvas p-4 text-primary sm:p-8"><header className="mb-6 border-b border-line pb-4"><h1 className="font-semibold">QA visual local · dados simulados</h1><p className="mt-1 text-sm text-secondary">Nenhuma alteração em contas, sessões, áudio ou templates reais. Falhas são intencionais para validar a interface.</p></header>
    {query.get('mode') === 'management' ? <div className="mx-auto max-w-5xl rounded-xl border border-line bg-surface"><TemplateManager onDirtyChange={setDirty} guard={guard.request} />{guard.dialog}</div> : <>{!open && <button onClick={() => setOpen(true)}>Reabrir criação de QA</button>}{open && <NewSessionModal initialFolderId="qa-folder" onClose={() => setOpen(false)} onCreate={() => {}} onOpenSession={() => setOpen(false)} />}</>}
  </div>
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><Preview /></BrowserRouter>)
