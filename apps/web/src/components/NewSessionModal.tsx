import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react'
import clsx from 'clsx'
import { folders as foldersApi, prompts as promptsApi, sessions as sessionsApi, type Folder as FolderItem, type Prompt, type Session } from '../api/client'
import { Button } from './ui/Button'

type FolderNode = FolderItem & { children: FolderNode[] }

function buildFolderTree(folderList: FolderItem[]) {
  const nodes = new Map<string, FolderNode>()
  const roots: FolderNode[] = []

  folderList.forEach((folder) => nodes.set(folder.id, { ...folder, children: [] }))
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  const sort = (items: FolderNode[]) => {
    items.sort((a, b) => a.name.localeCompare(b.name))
    items.forEach((item) => sort(item.children))
  }
  sort(roots)

  return roots
}

function FolderTreeItem({
  node,
  selectedFolderId,
  depth,
  onSelect,
}: {
  node: FolderNode
  selectedFolderId: string | null
  depth: number
  onSelect: (folderId: string) => void
}) {
  const [open, setOpen] = useState(true)
  const selected = selectedFolderId === node.id
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div className="flex items-center gap-1" style={{ paddingLeft: depth * 14 }}>
        <button
          type="button"
          disabled={!hasChildren}
          onClick={() => setOpen((value) => !value)}
          className="h-8 w-6 shrink-0 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-800 hover:bg-ink-50 disabled:hover:bg-transparent"
          title={open ? 'Recolher' : 'Expandir'}
        >
          {hasChildren ? (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : null}
        </button>
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className={clsx(
            'min-w-0 flex-1 h-8 px-2 rounded-lg flex items-center gap-2 text-left text-sm transition-all',
            selected ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900 hover:bg-ink-50'
          )}
        >
          {selected ? <FolderOpen className="w-4 h-4 shrink-0" /> : <Folder className="w-4 h-4 shrink-0" />}
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {open && node.children.map((child) => (
        <FolderTreeItem
          key={child.id}
          node={child}
          selectedFolderId={selectedFolderId}
          depth={depth + 1}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export function NewSessionModal({
  initialFolderId,
  onClose,
  onCreate,
}: {
  initialFolderId?: string | null
  onClose: () => void
  onCreate: (session: Session) => void
}) {
  const [promptList, setPromptList] = useState<Prompt[]>([])
  const [folderList, setFolderList] = useState<FolderItem[]>([])
  const [promptId, setPromptId] = useState('')
  const [folderId, setFolderId] = useState<string | null>(initialFolderId ?? null)
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setFolderId(initialFolderId ?? null)
  }, [initialFolderId])

  useEffect(() => {
    promptsApi.list()
      .then(({ prompts }) => {
        setPromptList(prompts)
        setPromptId(prompts.find((prompt) => prompt.isDefault)?.id ?? prompts[0]?.id ?? '')
      })
      .catch(() => setPromptList([]))

    foldersApi.list()
      .then(({ folders }) => setFolderList(folders ?? []))
      .catch(() => setFolderList([]))
  }, [])

  const folderTree = useMemo(() => buildFolderTree(folderList), [folderList])

  const handleCreate = async () => {
    if (!promptId) return
    setLoading(true)
    try {
      const { session } = await sessionsApi.create(promptId, title.trim() || undefined, folderId)
      onCreate(session)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 px-4"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-float border border-ink-100 p-6 w-full max-w-2xl fade-in">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="font-display font-semibold text-xl text-ink-900">Nova sessao</h2>
            <p className="text-sm text-ink-400 mt-1">Escolha o prompt e o caderno antes de gravar ou enviar audio.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-5">
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm font-medium text-ink-700 mb-2">Prompt</p>
              <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto pr-1">
                {promptList.map((prompt) => (
                  <button
                    key={prompt.id}
                    type="button"
                    onClick={() => setPromptId(prompt.id)}
                    className={clsx(
                      'flex items-center justify-between gap-3 py-2.5 px-4 rounded-xl border text-sm font-medium transition-all',
                      promptId === prompt.id
                        ? 'border-ink-900 bg-ink-900 text-white'
                        : 'border-ink-200 text-ink-600 hover:border-ink-400 hover:bg-ink-50'
                    )}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 shrink-0" />
                      <span className="truncate">{prompt.name}</span>
                    </span>
                    {prompt.isDefault && <span className="text-xs opacity-70">padrao</span>}
                  </button>
                ))}
                {promptList.length === 0 && (
                  <p className="text-sm text-ink-400">Nenhum prompt cadastrado.</p>
                )}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-ink-700 mb-2">
                Titulo <span className="text-ink-400 font-normal">(opcional)</span>
              </p>
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="ex: Aula de arquitetura"
                onKeyDown={(event) => event.key === 'Enter' && handleCreate()}
                className="w-full px-3.5 py-2.5 rounded-xl border border-ink-200 text-sm bg-white text-ink-900 outline-none focus:border-ink-400 focus:ring-2 focus:ring-ink-100 placeholder:text-ink-400 transition-all"
              />
            </div>
          </div>

          <div className="border border-ink-100 rounded-2xl p-3 bg-ink-50/60 min-h-[260px]">
            <p className="text-sm font-medium text-ink-700 px-1 mb-2">Caderno</p>
            <button
              type="button"
              onClick={() => setFolderId(null)}
              className={clsx(
                'w-full h-8 px-2 rounded-lg flex items-center gap-2 text-left text-sm transition-all mb-1',
                folderId === null ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900 hover:bg-white'
              )}
            >
              <Folder className="w-4 h-4 shrink-0" />
              <span className="truncate">Sem caderno</span>
            </button>

            <div className="max-h-64 overflow-y-auto pr-1">
              {folderTree.map((node) => (
                <FolderTreeItem
                  key={node.id}
                  node={node}
                  selectedFolderId={folderId}
                  depth={0}
                  onSelect={setFolderId}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" className="flex-1" loading={loading} disabled={!promptId} onClick={handleCreate}>
            Criar sessao
          </Button>
        </div>
      </div>
    </div>
  )
}
