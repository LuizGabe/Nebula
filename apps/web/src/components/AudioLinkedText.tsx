import { Volume2 } from 'lucide-react'
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function parseAudioTimestamp(value: string) {
  const parts = value.split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2]
}

interface MarkdownNode {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
  data?: { hProperties: Record<string, string> }
}

// Documents also wrap audio references in inline code. Only an exact reference
// is interactive there; ordinary code examples and existing links stay intact.
function remarkAudioTags() {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (!node.children || ['link', 'linkReference', 'code', 'inlineCode', 'html', 'image', 'imageReference'].includes(node.type)) return
      node.children = node.children.flatMap((child) => {
        const isAudioCode = child.type === 'inlineCode' && /^\[audio:\d{1,2}:[0-5]\d(?::[0-5]\d)?\]$/.test(child.value ?? '')
        if (child.type !== 'text' && !isAudioCode) {
          visit(child)
          return [child]
        }
        const value = child.value ?? ''
        const result: MarkdownNode[] = []
        let offset = 0
        for (const match of value.matchAll(/\[audio:(\d{1,2}:[0-5]\d(?::[0-5]\d)?)\]/g)) {
          const index = match.index!
          if (index > offset) result.push({ type: 'text', value: value.slice(offset, index) })
          result.push({
            type: 'link', url: '#audio',
            data: { hProperties: { 'data-audio-label': match[1] } },
            children: [{ type: 'text', value: match[1] }],
          })
          offset = index + match[0].length
        }
        if (offset < value.length) result.push({ type: 'text', value: value.slice(offset) })
        return result.length ? result : [child]
      })
    }
    visit(tree)
  }
}

interface AudioLinkedTextProps {
  content: string
  onSeekTo?: (seconds: number) => void
}

export function AudioLinkedText({ content, onSeekTo }: AudioLinkedTextProps) {
  return (
    <div className="nebula-markdown min-w-0 text-sm leading-7 text-ink-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkAudioTags]}
        components={{
          table: ({ node: _node, ...props }) => (
            <div className="markdown-table-scroll" role="region" aria-label="Tabela do documento" tabIndex={0}>
              <table {...props} />
            </div>
          ),
          a: ({ node, children, ...props }) => {
            const label = node?.properties['data-audio-label']
            if (typeof label === 'string') {
              return (
                <button type="button" onClick={() => onSeekTo?.(parseAudioTimestamp(label))}
                  className="mx-1 inline-flex items-center gap-1 rounded-md border border-jade-200 bg-jade-50 px-1.5 py-0.5 align-baseline text-xs font-medium text-jade-700 hover:border-jade-400 hover:bg-jade-100"
                  title={`Tocar em ${label}`}>
                  <Volume2 className="h-3 w-3" />{label}
                </button>
              )
            }
            return <a {...props}>{children}</a>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
