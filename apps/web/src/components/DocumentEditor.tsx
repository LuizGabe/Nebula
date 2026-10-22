import { useEffect, useState, useCallback, useRef } from 'react'
import {
  FileText, RefreshCw, Download, Copy, ChevronDown, Check, Loader2, Pencil, Eye
} from 'lucide-react'
import { documents, type DocumentVersion, type DocumentContent } from '../api/client'
import { Button } from './ui/Button'
import { DocumentSkeleton } from './ui/Skeleton'
import { AudioLinkedText } from './AudioLinkedText'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { getMarkdown } from '@milkdown/kit/utils'
import { Crepe } from '@milkdown/crepe'

import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

// ─── Editor interno — usa Crepe para suporte completo (tabelas, etc.) ─────────
interface EditorInnerProps {
  content: string
  onReady: (getter: () => string) => void
}

function EditorInner({ content, onReady }: EditorInnerProps) {
  const { get } = useEditor((root) =>
    new Crepe({
      root,
      defaultValue: content,
    })
  )

  useEffect(() => {
    onReady(() => get()?.action(getMarkdown()) ?? '')
  }, [get, onReady])

  return <Milkdown />
}

// ─── Componente principal ─────────────────────────────────────────────────────
interface Props {
  sessionId: string
  reloadToken?: number
  onReprocessed?: () => void
  onSeekTo?: (seconds: number) => void
}

export function DocumentEditor({ sessionId, reloadToken = 0, onReprocessed, onSeekTo }: Props) {
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [current, setCurrent] = useState<DocumentContent | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [actionError, setActionError] = useState('')
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestRef = useRef(0)
  const reprocessingRef = useRef(false)

  useEffect(() => {
    setReprocessing(false)
    setActionError('')
    return () => {
      requestRef.current++
      reprocessingRef.current = false
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [sessionId])

  // Referência para o getter de markdown exposto pelo EditorInner
  const getMarkdownRef = useRef<() => string>(() => '')

  const handleEditorReady = useCallback((getter: () => string) => {
    getMarkdownRef.current = getter
  }, [])

  const loadVersions = useCallback(async () => {
    try {
      const result = await documents.listVersions(sessionId)
      setVersions(result.documents)
      return result.documents
    } catch { return [] }
  }, [sessionId])

  const loadContent = useCallback(async (version?: number) => {
    setLoading(true)
    try {
      const result = await documents.getContent(sessionId, version)
      setCurrent(result.document)
      setSelectedVersion(result.document.version)
      setIsEditing(false)
      // replaceAll precisa do editor já montado — o conteúdo inicial
      // é passado via prop `content` para o EditorInner
      // Para troca de versão depois da montagem, precisamos forçar re-render
      // passando o novo conteúdo como key (ver JSX abaixo)
    } catch {
      // sem documento ainda
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    loadVersions().then((v) => {
      if (v.length > 0) loadContent()
      else setLoading(false)
    })
  }, [loadVersions, reloadToken])

  const save = async () => {
    setSaving(true)
    try {
      const md = getMarkdownRef.current()
      if (!md) return
      const updated = await documents.update(sessionId, md)
      setCurrent(updated.document)
      setSaved(true)
      setIsEditing(false)
      setTimeout(() => setSaved(false), 2000)
      loadVersions()
    } finally {
      setSaving(false)
    }
  }

  const reprocess = async () => {
    if (reprocessingRef.current) return
    reprocessingRef.current = true
    const requestId = ++requestRef.current
    setActionError('')
    setReprocessing(true)
    const finish = (error = '') => {
      if (requestId !== requestRef.current) return
      reprocessingRef.current = false
      setReprocessing(false)
      setActionError(error)
    }
    try {
      const { jobId } = await documents.reprocess(sessionId)
      if (requestId !== requestRef.current) return
      onReprocessed?.()
      let failures = 0
      const poll = async () => {
        try {
          const job = await documents.jobStatus(sessionId, jobId)
          if (requestId !== requestRef.current) return
          failures = 0
          if (job.status === 'failed') {
            finish(job.error || 'Nao foi possivel gerar o documento. Tente novamente.')
            return
          }
          if (job.status === 'not_found') {
            finish('Nao foi possivel localizar o processamento. Atualize a sessao para conferir o documento.')
            return
          }
          if (job.status === 'completed') {
            if (job.result?.skipped) {
              finish('O documento nao foi gerado. Verifique se a sessao possui uma transcricao valida.')
              return
            }
            await loadVersions()
            if (requestId !== requestRef.current) return
            await loadContent(job.result?.version)
            finish()
            return
          }
        } catch (error) {
          if (requestId !== requestRef.current) return
          if (++failures >= 3) {
            finish(error instanceof Error ? error.message : 'Nao foi possivel acompanhar o processamento.')
            return
          }
        }
        pollRef.current = setTimeout(() => void poll(), 3000)
      }
      await poll()
    } catch (error) {
      finish(error instanceof Error ? error.message : 'Nao foi possivel iniciar a geracao do documento.')
    }
  }

  const downloadMd = () => {
    const md = isEditing ? getMarkdownRef.current() : current?.content
    if (!md) return
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `documento-v${current?.version ?? 1}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyMd = () => {
    const md = isEditing ? getMarkdownRef.current() : current?.content
    if (!md) return
    navigator.clipboard.writeText(md)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading && versions.length === 0) {
    return (
      <DocumentSkeleton />

    )
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-soft">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-ink-100">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-ink-500" />
          <h3 className="font-medium text-ink-800 text-sm">Documento</h3>
          {current && (
            <span className="text-xs text-ink-400">v{current.version}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Version selector */}
          {versions.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setShowVersions(!showVersions)}
                className="flex items-center gap-1.5 text-xs text-ink-600 hover:text-ink-900 border border-ink-200 rounded-lg px-2.5 py-1.5 hover:border-ink-300 transition-all"
              >
                v{current?.version ?? 1} de {versions.length} versões
                <ChevronDown className="w-3 h-3" />
              </button>
              {showVersions && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-ink-100 rounded-xl shadow-float z-20 min-w-36 py-1">
                  {[...versions].reverse().map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        loadContent(v.version)
                        setShowVersions(false)
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-ink-50 flex items-center justify-between gap-4 ${
                        selectedVersion === v.version ? 'text-ink-900 font-medium' : 'text-ink-600'
                      }`}
                    >
                      <span>v{v.version}</span>
                      {selectedVersion === v.version && <Check className="w-3 h-3 text-jade-500" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <Button size="sm" variant="ghost" onClick={copyMd} title="Copiar Markdown">
            {copied ? <Check className="w-3.5 h-3.5 text-jade-500" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>

          <Button size="sm" variant="ghost" onClick={downloadMd} title="Baixar .md">
            <Download className="w-3.5 h-3.5" />
          </Button>

          <Button size="sm" variant="ghost" onClick={reprocess} disabled={reprocessing} title="Reprocessar">
            <RefreshCw className={`w-3.5 h-3.5 ${reprocessing ? 'animate-spin' : ''}`} />
          </Button>

          {versions.length > 0 && (
            isEditing ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} disabled={saving}>
                  <Eye className="w-3.5 h-3.5" />
                  Visualizar
                </Button>
                <Button
                  size="sm"
                  variant={saved ? 'ghost' : 'primary'}
                  onClick={save}
                  loading={saving}
                  disabled={saving}
                >
                  {saved ? (
                    <><Check className="w-3.5 h-3.5 text-jade-500" /> Salvo</>
                  ) : 'Salvar'}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setIsEditing(true)}>
                <Pencil className="w-3.5 h-3.5" />
                Editar
              </Button>
            )
          )}
        </div>
      </div>

      {actionError && <p role="alert" className="px-6 pt-3 text-sm text-rose-500">{actionError}</p>}
      {reprocessing && <p role="status" className="px-6 pt-3 text-xs text-ink-500">Gerando nova versao. Transcricoes longas podem levar alguns minutos.</p>}

      {/* Model badge */}
      {current?.modelUsed && (
        <div className="px-6 pt-3 pb-0">
          <span className="text-xs text-ink-400">
            Gerado por <span className="font-mono text-ink-600">{current.modelUsed}</span>
          </span>
        </div>
      )}

      {/* Editor */}
      <div className="px-6 py-4">
        {versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-ink-50 flex items-center justify-center">
              <FileText className="w-5 h-5 text-ink-300" />
            </div>
            <p className="text-sm text-ink-400">O documento será gerado automaticamente após o processamento.</p>
            <Button size="sm" variant="secondary" onClick={reprocess} disabled={reprocessing}>
              {reprocessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Gerar agora
            </Button>
          </div>
        ) : (
          isEditing ? (
            <MilkdownProvider key={`${current?.id ?? current?.version ?? 'editor'}-${isEditing ? 'edit' : 'view'}`}>
              <EditorInner
                content={current?.content ?? ''}
                onReady={handleEditorReady}
              />
            </MilkdownProvider>
          ) : (
            <div className="min-h-96 rounded-xl border border-ink-100 bg-white px-2 py-1">
              <AudioLinkedText content={current?.content ?? ''} onSeekTo={onSeekTo} />
            </div>
          )
        )}
      </div>
    </div>
  )
}
