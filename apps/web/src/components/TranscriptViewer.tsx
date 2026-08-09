import { useEffect, useRef, useState } from 'react'
import { AlignLeft, Check, Copy, Radio } from 'lucide-react'
import { transcripts, type TranscriptBlock } from '../api/client'
import { Spinner } from './ui/misc'
import { type LiveTranscription } from '@/hooks/useProcessingStatus'

function formatTimestamp(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

interface TranscriptViewerProps {
  sessionId: string
  liveText?: LiveTranscription[] | null
  transcriptionProgress?: [total: number, current: number] | null
  reloadToken?: number
}

export function TranscriptViewer({ sessionId, liveText, transcriptionProgress, reloadToken = 0 }: TranscriptViewerProps) {
  const [blocks, setBlocks] = useState<TranscriptBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [frozenLive, setFrozenLive] = useState<LiveTranscription[] | null>(null)
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    transcripts.list(sessionId).then((result) => {
      setBlocks(result.transcripts)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [sessionId, reloadToken])

  useEffect(() => {
    if (liveText != null && liveText.length > 0) {
      // Always keep the latest snapshot.
      setFrozenLive(liveText)
    }
    // On null: do nothing — frozenLive stays until blocks replace it below.
  }, [liveText])

  // Clear frozen only after blocks have loaded and liveText is gone.
  useEffect(() => {
    if (!loading && blocks.length > 0 && (liveText == null || liveText.length === 0)) {
      setFrozenLive(null)
    }
  }, [loading, blocks, liveText])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [blocks, liveText])

  const hasLive = liveText != null && liveText.length > 0
  const isLive = hasLive || (transcriptionProgress != null && transcriptionProgress[0] > 0)
  const displayLive = hasLive ? liveText : frozenLive
  const transcriptText = displayLive
    ? displayLive.map((item) => item.text).join('\n')
    : blocks.map((block) => block.text).join('\n')

  const copyTranscript = async () => {
    if (!transcriptText.trim()) return
    await navigator.clipboard.writeText(transcriptText)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-soft">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-ink-100">
        {isLive ? (
          <Radio className="w-4 h-4 text-red-400 animate-pulse" />
        ) : (
          <AlignLeft className="w-4 h-4 text-ink-500" />
        )}
        <h3 className="font-medium text-ink-800 text-sm">Transcrição
          {transcriptionProgress && (
            <span className="ml-2 text-xs text-ink-500">
              ({transcriptionProgress[1]}/{transcriptionProgress[0]})
            </span>
          )}
        </h3>
        {isLive && (
          <span className="ml-auto text-xs font-medium text-red-400 tracking-wide uppercase">
            Ao vivo
          </span>
        )}
        <button
          onClick={copyTranscript}
          disabled={!transcriptText.trim()}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-ink-500 hover:text-ink-900 hover:bg-ink-50 disabled:opacity-40 disabled:hover:bg-transparent"
          title="Copiar transcricao"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-jade-500" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>

      <div className="px-6 py-4 max-h-72 overflow-y-auto">
        {loading && !displayLive ? (
          <div className="flex justify-center py-8">
            <Spinner className="w-6 h-6" />
          </div>
        ) : blocks.length === 0 && !displayLive ? (
          <p className="text-sm text-ink-400 py-4 text-center">Nenhuma transcrição disponível ainda.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {displayLive
              ? displayLive.map((item, index) => (
                  <div key={`live-${index}`} className="flex gap-3">
                    <span className={`font-mono text-xs pt-0.5 shrink-0 w-13 text-right ${hasLive ? 'text-red-400' : 'text-ink-300'}`}>
                      {formatTimestamp(item.timestamp_start_ms)}
                    </span>
                    <p className={`text-sm leading-relaxed text-justify ${hasLive ? 'text-ink-700 italic' : 'text-ink-700'}`}>
                      {item.text}
                    </p>
                  </div>
                ))
              : blocks.map((block) => (
                  <div key={block.chunkIndex} className="flex gap-3 group">
                    <span className="font-mono text-xs text-ink-300 pt-0.5 shrink-0 w-13 text-right">
                      {formatTimestamp(block.timestampStart)}
                    </span>
                    <p className="text-sm text-ink-700 leading-relaxed text-justify">{block.text}</p>
                  </div>
                ))
            }
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
