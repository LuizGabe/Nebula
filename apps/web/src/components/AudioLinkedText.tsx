import { Volume2 } from 'lucide-react'
import React from 'react'
import ReactMarkdown from 'react-markdown'

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
  const renderChildren = (children: React.ReactNode) => transformAudioTags(children, onSeekTo)

  return (
    <div className="text-sm leading-7 text-ink-700">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-3">{renderChildren(children)}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li>{renderChildren(children)}</li>,
          h1: ({ children }) => <h1 className="mb-4 mt-2 font-display text-2xl font-semibold text-ink-900">{renderChildren(children)}</h1>,
          h2: ({ children }) => <h2 className="mb-3 mt-5 font-display text-xl font-semibold text-ink-900">{renderChildren(children)}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-4 text-lg font-semibold text-ink-800">{renderChildren(children)}</h3>,
          h4: ({ children }) => <h4 className="mb-2 mt-3 font-semibold text-ink-800">{renderChildren(children)}</h4>,
          strong: ({ children }) => <strong className="font-semibold text-ink-900">{renderChildren(children)}</strong>,
          em: ({ children }) => <em className="italic">{renderChildren(children)}</em>,
          code: ({ children }) => <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs text-rose-500">{children}</code>,
          blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-jade-400 pl-4 text-ink-600 italic">{renderChildren(children)}</blockquote>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function transformAudioTags(children: React.ReactNode, onSeekTo?: (seconds: number) => void): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') return renderInlineAudioTags(child, onSeekTo)
    if (React.isValidElement(child)) {
      return React.cloneElement(child, {
        ...child.props,
        children: transformAudioTags(child.props.children, onSeekTo),
      })
    }
    return child
  })
}

function renderInlineAudioTags(content: string, onSeekTo?: (seconds: number) => void) {
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

  return nodes
}

function renderText(text: string, key: string) {
  return <span key={key}>{text}</span>
}
