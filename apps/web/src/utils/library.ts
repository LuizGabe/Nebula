import type { Folder, FolderColor, Session } from '../api/client'

export const notebookColors: { id: FolderColor; name: string }[] = [
  { id: 'neutral', name: 'Padrão' }, { id: 'violet', name: 'Violeta' },
  { id: 'sage', name: 'Sálvia' }, { id: 'sand', name: 'Areia' }, { id: 'blue', name: 'Azul' },
]
export function notebookColor(color?: string) {
  return notebookColors.some(item => item.id === color) && color !== 'neutral'
    ? `rgb(var(--notebook-${color}))` : 'rgb(var(--secondary))'
}
export function folderBranch(id: string, folders: Folder[]) {
  const ids = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id); changed = true
      }
    }
  }
  return ids
}
export function folderPath(id: string | null, folders: Folder[]) {
  const path: Folder[] = []
  const visited = new Set<string>()
  while (id && !visited.has(id)) {
    visited.add(id)
    const folder = folders.find(item => item.id === id)
    if (!folder) break
    path.unshift(folder)
    id = folder.parentId
  }
  return path
}
export const normalizeSearch = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim()
export function librarySessions(sessions: Session[], folders: Folder[], scope: string | null, query = '') {
  const ids = scope && scope !== 'root' ? folderBranch(scope, folders) : null
  const search = normalizeSearch(query)
  return sessions.filter(session => (!scope || (scope === 'root' ? session.folderId === null : !!session.folderId && ids!.has(session.folderId)))
    && (!search || normalizeSearch([session.title, session.prompt?.name].filter(Boolean).join(' ')).includes(search)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}
export function sessionPending(session: Session) {
  return session.status === 'IN_PROGRESS' || !!session.processing?.pendingAudio
    || ['DOCUMENT_QUEUED', 'DOCUMENT_GENERATING'].includes(session.processing?.documentEvent ?? '')
}
export function sessionLabels(session: Session) {
  const data = session.processing
  const capture = session.status === 'ACTIVE' ? 'Sessão aberta' : session.status === 'IN_PROGRESS' ? 'Processando sessão' : session.status === 'ERROR' ? 'Erro na sessão' : 'Sessão encerrada'
  const transcript = data?.pendingAudio ? 'Transcrição pendente' : data?.failedAudio ? 'Falha na transcrição' : data?.hasTranscript ? 'Transcrição disponível' : 'Sem transcrição confirmada'
  const event = data?.documentEvent
  const document = event === 'DOCUMENT_FAILED' ? (data?.hasDocument ? 'Nova geração falhou · documento anterior disponível' : 'Falha no documento')
    : event === 'DOCUMENT_GENERATING' ? 'Gerando documento' : event === 'DOCUMENT_QUEUED' ? 'Documento na fila'
      : event === 'DOCUMENT_SKIPPED' ? (data?.hasDocument ? 'Geração ignorada · documento anterior disponível' : 'Documento não gerado')
        : data?.hasDocument ? 'Documento disponível' : 'Sem documento confirmado'
  return { capture, transcript, document }
}

export type NotebookRequest = { folder?: Folder; parentId?: string | null }
export function openNotebook(detail: NotebookRequest) {
  window.dispatchEvent(new CustomEvent('nebula:edit-notebook', { detail }))
}
