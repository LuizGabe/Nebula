import { Volume2 } from 'lucide-react'
import type React from 'react'

const AUDIO_TAG_RE = /\[audio:(\d{1,2}:\d{2}(?::\d{2})?)\]/g

export function parseAudioTimestamp(value: string) {
  const parts = value.split(':').map((part) => Number(part))
  if (parts.some((part) => Number.isNaN(part))) return 0
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

interface AudioLinkedTextProps {
  content: string
  onSeekTo?: (seconds: number) => void
}

export function AudioLinkedText({ content, onSeekTo }: AudioLinkedTextProps) {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = AUDIO_TAG_RE.exec(content)) != null) {
    if (match.index > lastIndex) {
      nodes.push(renderText(content.slice(lastIndex, match.index), `text-${lastIndex}`))
    }

    const label = match[1]
    const seconds = parseAudioTimestamp(label)
    nodes.push(
      <button
        key={`audio-${match.index}`}
        type="button"
        onClick={() => onSeekTo?.(seconds)}
        className="mx-1 inline-flex items-center gap-1 rounded-md border border-jade-200 bg-jade-50 px-1.5 py-0.5 align-baseline text-xs font-medium text-jade-700 hover:border-jade-400 hover:bg-jade-100"
        title={`Tocar em ${label}`}
      >
        <Volume2 className="h-3 w-3" />
        {label}
      </button>,
    )

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    nodes.push(renderText(content.slice(lastIndex), `text-${lastIndex}`))
  }

  return <div className="whitespace-pre-wrap text-sm leading-7 text-ink-700">{nodes}</div>
}

function renderText(text: string, key: string) {
  return <span key={key}>{text}</span>
}
