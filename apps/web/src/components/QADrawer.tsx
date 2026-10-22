import { useState, useRef, useEffect } from 'react'
import { X, Send, MessageSquare, Loader2 } from 'lucide-react'
import { openQuestionSSE } from '../api/client'
import clsx from 'clsx'
import { useDialogFocus } from '../hooks/useDialogFocus'

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  loading?: boolean
}

interface Props {
  sessionId: string
  onClose: () => void
}

export function QADrawer({ sessionId, onClose }: Props) {
  const dialogRef = useDialogFocus(onClose)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => () => abortRef.current?.(), [])

  const send = () => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setBusy(true)

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', text: q }
    const assistantId = crypto.randomUUID()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', text: '', loading: true }

    setMessages((prev) => [...prev, userMsg, assistantMsg])

    abortRef.current = openQuestionSSE(
      sessionId,
      q,
      (chunk) => {
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, text: m.text + chunk, loading: false } : m)
        )
      },
      () => {
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, loading: false } : m)
        )
        setBusy(false)
      },
      () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, text: 'Erro ao obter resposta.', loading: false }
              : m
          )
        )
        setBusy(false)
      }
    )
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-overlay/25 backdrop-blur-md z-overlay"
        onClick={onClose}
      />

      {/* Drawer */}
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Perguntas sobre a sessão" className="fixed right-0 top-0 nebula-drawer h-full w-full max-w-[440px] bg-surface backdrop-blur-xl border-l border-line shadow-float z-overlay flex flex-col slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-subtle" />
            <span className="font-medium text-primary text-sm">Perguntas sobre a sessão</span>
          </div>
          <button
            aria-label="Fechar perguntas"
            onClick={onClose}
            className="text-subtle hover:text-secondary hover:bg-muted rounded-lg p-1.5 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-subtle" />
              </div>
              <div>
                <p className="text-sm font-medium text-secondary">Faça uma pergunta</p>
                <p className="text-xs text-subtle mt-1 max-w-[220px]">
                  Pergunte qualquer coisa sobre o conteúdo desta sessão
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-[260px] mt-2">
                {[
                  'Quais foram os pontos principais?',
                  'Quais decisões foram tomadas?',
                  'Faça um resumo em 3 tópicos',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => { setInput(suggestion) }}
                    className="text-xs text-left px-3 py-2 rounded-lg border border-line text-subtle hover:border-line hover:text-secondary hover:bg-muted transition-all"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={clsx('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={clsx(
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-action text-on-action rounded-br-sm'
                    : 'bg-muted text-primary rounded-bl-sm'
                )}
              >
                {msg.loading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-subtle" />
                ) : (
                  msg.text || <span className="text-subtle italic">...</span>
                )}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-5 py-4 border-t border-line shrink-0">
          <div className="flex items-end gap-2 bg-muted rounded-xl border border-line focus-within:border-line focus-within:bg-surface transition-all px-3 py-2.5">
            <textarea
              aria-label="Sua pergunta sobre a sessão"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="Faça uma pergunta... (Enter para enviar)"
              rows={2}
              className="flex-1 bg-transparent text-sm text-primary placeholder:text-subtle outline-none resize-none leading-relaxed"
            />
            <button
              aria-label="Enviar pergunta"
              onClick={send}
              disabled={!input.trim() || busy}
              className="p-1.5 rounded-lg bg-action text-on-action disabled:opacity-30 hover:bg-action-hover transition-all shrink-0 mb-0.5"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs text-subtle mt-1.5 text-center">Shift+Enter para nova linha</p>
        </div>
      </div>
    </>
  )
}
