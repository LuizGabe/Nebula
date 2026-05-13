import { useEffect, useState } from 'react'
import { AlignLeft } from 'lucide-react'
import { transcripts, type TranscriptBlock } from '../api/client'
import { Spinner } from './ui/misc'

function formatTimestamp(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function TranscriptViewer({ sessionId }: { sessionId: string }) {
  const [blocks, setBlocks] = useState<TranscriptBlock[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    transcripts.list(sessionId).then((result) => {
      setBlocks(result.transcripts)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [sessionId])

  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-soft">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-ink-100">
        <AlignLeft className="w-4 h-4 text-ink-500" />
        <h3 className="font-medium text-ink-800 text-sm">Transcrição</h3>
      </div>

      <div className="px-6 py-4 max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner className="w-6 h-6" />
          </div>
        ) : blocks.length === 0 ? (
          <p className="text-sm text-ink-400 py-4 text-center">Nenhuma transcrição disponível ainda.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {blocks.map((block) => (
              <div key={block.chunkIndex} className="flex gap-3 group">
                <span className="font-mono text-xs text-ink-300 pt-0.5 shrink-0 w-13 text-right">
                  {formatTimestamp(block.timestampStart)}
                </span>
                <p className="text-sm text-ink-700 leading-relaxed text-justify">{block.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
