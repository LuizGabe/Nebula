import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, transcripts, type TranscriptBlock } from '../api/client'
import { usePlaybackStore } from '../store/playback'
import type { LiveTranscription } from '../hooks/useProcessingStatus'
import { Button } from './ui/Button'

interface Props {
  sessionId: string; liveText?: LiveTranscription[] | null
  transcriptionProgress?: [number, number] | null; reloadToken?: number
  onSeekTo?: (seconds: number) => void
  transcriptionComplete?: boolean
}
const time = (ms: number) => new Date(Math.max(0, ms)).toISOString().slice(11, 19)
const palettes = ['bg-jade-50 text-jade-700', 'bg-amber-50 text-amber-700', 'bg-rose-50 text-rose-700', 'bg-ink-100 text-ink-700']
const speakerLabel = (id: string) => `Palestrante ${Number(id.replace('SPEAKER_', '')) + 1}`

export function SyncedTranscript({ sessionId, liveText, transcriptionProgress, reloadToken = 0, onSeekTo, transcriptionComplete = false }: Props) {
  const [blocks, setBlocks] = useState<TranscriptBlock[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [scope, setScope] = useState('all')
  const [matchIndex, setMatchIndex] = useState(0)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const automaticScroll = useRef<number | null>(null)
  const activeBlock = usePlaybackStore(s => blocks.find(b => s.currentTimeMs >= b.timestampStart && s.currentTimeMs < b.timestampEnd)?.id)
  useEffect(() => {
    const words = Array.from(scroll.current?.querySelectorAll<HTMLElement>('[data-word-start]') ?? [])
      .map(element => ({ element, start: Number(element.dataset.wordStart), end: Number(element.dataset.wordEnd) }))
      .sort((a, b) => a.start - b.start)
    let previous: HTMLElement | null = null
    const update = () => {
      const ms = usePlaybackStore.getState().currentTimeMs
      let lo = 0; let hi = words.length - 1; let index = -1
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (words[mid].start <= ms) { index = mid; lo = mid + 1 } else hi = mid - 1 }
      const next = index >= 0 && ms < words[index].end ? words[index].element : null
      if (next === previous) return
      previous?.removeAttribute('data-current')
      next?.setAttribute('data-current', 'true')
      previous = next
    }
    update()
    const unsubscribe = usePlaybackStore.subscribe(update)
    return () => { unsubscribe(); previous?.removeAttribute('data-current') }
  }, [blocks, editId])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    void transcripts.list(sessionId).then(result => {
      if (!cancelled) { setBlocks(result.transcripts); setNames(result.speakerNames); setLoading(false) }
    }).catch(e => {
      if (cancelled) return
      setLoading(false)
      setError(e instanceof ApiError && e.status === 401 ? 'Sua sessão expirou. Entre novamente.' : e instanceof ApiError && e.status === 404 ? 'Sessão indisponível ou removida.' : 'Não foi possível carregar a transcrição. Verifique a conexão e tente novamente.')
    })
    return () => { cancelled = true }
  }, [sessionId, reloadToken, refresh])
  useEffect(() => { setBlocks([]); setEditId(null); nearBottom.current = true }, [sessionId])
  useEffect(() => {
    if (!nearBottom.current || !scroll.current) return
    if (liveText?.length) scroll.current.scrollTop = scroll.current.scrollHeight
    else if (activeBlock) {
      const row = scroll.current.querySelector<HTMLElement>('[data-active="true"]')
      if (row) scroll.current.scrollTop = Math.max(0, row.offsetTop - scroll.current.offsetTop - scroll.current.clientHeight / 2)
    }
    automaticScroll.current = scroll.current.scrollTop
  }, [activeBlock, liveText])
  const matches = useMemo(() => {
    if (!query) return []
    return blocks.flatMap(block => {
      if (scope !== 'all' && scope !== block.id) return []
      const found: { block: TranscriptBlock; start: number }[] = []
      let start = 0
      while ((start = block.text.indexOf(query, start)) !== -1) { found.push({ block, start }); start += query.length }
      return found
    })
  }, [blocks, query, scope])
  useEffect(() => { setMatchIndex(0); setPreview(false) }, [query, replacement, scope])
  const changed = useMemo(() => blocks.filter(b => (scope === 'all' || scope === b.id) && query && b.text.includes(query))
    .map(b => ({ id: b.id, revision: b.revision ?? 0, text: b.text.split(query).join(replacement) })), [blocks, scope, query, replacement])
  const save = async (edits: { id: string; revision: number; text: string }[]) => {
    setBusy(true); setError('')
    try { await transcripts.edit(sessionId, edits); setEditId(null); setPreview(false); setRefresh(n => n + 1); window.dispatchEvent(new CustomEvent('nebula:transcript-edited', { detail: { sessionId } })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao salvar') }
    finally { setBusy(false) }
  }
  const navigateMatch = (direction: number) => {
    if (!matches.length) return
    const next = (matchIndex + direction + matches.length) % matches.length
    setMatchIndex(next); nearBottom.current = false
    const target = scroll.current?.querySelector<HTMLElement>(`[data-block-id="${matches[next].block.id}"]`)
    if (target && scroll.current) scroll.current.scrollTop = target.offsetTop - scroll.current.offsetTop
    onSeekTo?.(matches[next].block.timestampStart / 1000)
  }
  const highlight = (text: string) => !query ? text : text.split(query).flatMap((part, i) => i ? [<mark key={i} className="rounded bg-amber-100">{query}</mark>, part] : [part])
  const copy = async () => {
    try { await navigator.clipboard.writeText(blocks.map(b => b.text).join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { setError('Não foi possível copiar. Verifique a permissão da área de transferência.') }
  }
  return <section className="rounded-2xl border border-ink-100 bg-white shadow-soft" aria-label="Transcrição sincronizada">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-6 py-4">
      <h3 className="text-sm font-medium text-ink-800">Transcrição {transcriptionProgress ? `(${transcriptionProgress[1]}/${transcriptionProgress[0]})` : ''}</h3>
      <span className="text-xs text-jade-700" role="status">{!loading && !error && blocks.length > 0 && transcriptionComplete ? '✓ Transcrição Concluída' : liveText?.length ? 'Ao vivo' : ''}</span>
      <Button size="sm" variant="ghost" disabled={!blocks.length} onClick={() => void copy()}>{copied ? 'Copiado' : 'Copiar'}</Button>
    </div>
    <div className="flex flex-wrap gap-2 border-b border-ink-100 px-6 py-3">
      <input aria-label="Buscar na transcrição (diferencia maiúsculas)" placeholder="Buscar texto…" value={query} onChange={e => setQuery(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm" />
      <input aria-label="Substituir por" placeholder="Substituir por…" value={replacement} onChange={e => setReplacement(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm" />
      <select aria-label="Escopo da busca" value={scope} onChange={e => setScope(e.target.value)} className="max-w-48 rounded-lg border border-ink-200 text-sm">
        <option value="all">Toda a transcrição</option>{blocks.map(b => <option key={b.id} value={b.id}>Trecho {time(b.timestampStart)}</option>)}
      </select>
      <Button size="sm" disabled={!matches.length} onClick={() => navigateMatch(-1)} aria-label="Ocorrência anterior">↑</Button>
      <Button size="sm" disabled={!matches.length} onClick={() => navigateMatch(1)} aria-label="Próxima ocorrência">↓</Button>
      <span className="self-center text-xs text-ink-500" role="status">{matches.length ? matchIndex + 1 : 0}/{matches.length}</span>
      <Button size="sm" disabled={!changed.length || changed.some(e => !e.text.trim()) || busy} onClick={() => setPreview(true)}>Prévia</Button>
    </div>
    {preview && <div className="max-h-64 overflow-auto border-b border-amber-100 bg-amber-50 px-6 py-4">
      <p className="mb-2 text-sm">{changed.length} trecho(s) serão alterados. Os tempos originais serão preservados.</p>
      {changed.map(c => <div key={c.id} className="mb-2 text-sm"><del className="text-rose-700">{blocks.find(b => b.id === c.id)?.text}</del><p className="text-jade-700">{c.text}</p></div>)}
      <Button disabled={busy} onClick={() => void save(changed)}>Confirmar substituição</Button> <Button variant="ghost" onClick={() => setPreview(false)}>Cancelar</Button>
    </div>}
    {error && <div role="alert" className="px-6 py-4 text-sm text-rose-700">{error} <Button size="sm" onClick={() => setRefresh(n => n + 1)}>Recarregar</Button></div>}
    <div ref={scroll} onScroll={e => { const el = e.currentTarget; if (automaticScroll.current != null && Math.abs(el.scrollTop - automaticScroll.current) < 2) return; automaticScroll.current = null; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }} className="relative max-h-96 overflow-y-auto px-6 py-4">
      {loading && <div role="status" aria-label="Carregando transcrição" className="space-y-4 py-4">{[100, 85, 95, 70].map(w => <div key={w} className="h-5 animate-pulse rounded bg-ink-100" style={{ width: `${w}%` }} />)}</div>}
      {!loading && !error && !blocks.length && !liveText?.length && <p className="py-8 text-center text-sm text-ink-400">Nenhuma transcrição disponível ainda.</p>}
      <div className="space-y-5">{blocks.map(block => {
        const label = block.speakerId ? names[block.speakerId] || speakerLabel(block.speakerId) : null
        const words = !block.edited && Array.isArray(block.words) ? block.words : []
        return <article key={block.id} data-block-id={block.id} data-active={activeBlock === block.id} className={activeBlock === block.id ? 'rounded-xl bg-jade-50/40 p-2' : 'p-2'}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onSeekTo?.(block.timestampStart / 1000)} className="font-mono text-xs text-ink-500" aria-label={'Reproduzir trecho em ' + time(block.timestampStart)}>{time(block.timestampStart)}</button>
            {label && <button type="button" className={'inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs ' + palettes[Number(block.speakerId!.slice(8)) % palettes.length]} title="Renomear palestrante" onClick={() => { setRenameId(block.speakerId!); setNameDraft(label) }}><span className="flex h-5 w-5 items-center justify-center rounded-full border border-current" aria-hidden="true">{label.slice(0, 1)}</span>{label}</button>}
            {block.edited && <span className="text-xs text-amber-700">Editado · tempos originais</span>}
            <Button size="sm" variant="ghost" onClick={() => { setEditId(block.id); setDraft(block.text) }}>Editar</Button>
          </div>
          {editId === block.id ? <div><textarea aria-label="Texto do segmento" rows={3} value={draft} onChange={e => setDraft(e.target.value)} className="w-full rounded-lg border border-ink-200 p-3 text-sm" /><Button disabled={busy || !draft.trim()} onClick={() => void save([{ id: block.id, text: draft, revision: block.revision ?? 0 }])}>Salvar</Button> <Button variant="ghost" onClick={() => setEditId(null)}>Cancelar</Button></div> :
            <p className="whitespace-pre-wrap text-sm leading-7 text-ink-700">{words.length ? words.map((word, index) => <span key={index}><button type="button" data-word-start={word.start_ms} data-word-end={word.end_ms} onClick={() => onSeekTo?.(word.start_ms / 1000)} className="rounded px-0.5 text-left transition-colors hover:bg-jade-100 data-[current=true]:bg-jade-200 data-[current=true]:text-ink-900" aria-label={`Reproduzir ${word.text} em ${time(word.start_ms)}`}>{highlight(word.text)}</button>{' '}</span>) : <button type="button" className="text-left" onClick={() => onSeekTo?.(block.timestampStart / 1000)}>{highlight(block.text)}</button>}</p>}
        </article>
      })}</div>
      {!!liveText?.length && <div aria-live="polite" className="space-y-3 border-t border-ink-100 pt-3">{liveText.map((item, index) => <p key={index} className="text-sm italic text-ink-500"><button onClick={() => onSeekTo?.(item.timestamp_start_ms / 1000)}>{time(item.timestamp_start_ms)} {item.text}</button></p>)}</div>}
    </div>
    <div className="px-6 pb-3"><Button size="sm" variant="ghost" onClick={() => { nearBottom.current = true; if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }}>Acompanhar transcrição</Button></div>
    {renameId && <form className="flex gap-2 border-t border-ink-100 p-4" onSubmit={event => { event.preventDefault(); setBusy(true); void transcripts.renameSpeaker(sessionId, renameId, nameDraft).then(() => { setNames(n => ({ ...n, [renameId]: nameDraft })); setRenameId(null) }).catch(e => setError(e.message)).finally(() => setBusy(false)) }}>
      <input autoFocus aria-label="Nome do palestrante" maxLength={100} value={nameDraft} onChange={e => setNameDraft(e.target.value)} className="min-w-0 flex-1 rounded-lg border p-2" /><Button type="submit" disabled={busy || !nameDraft.trim()}>Renomear em todos os trechos</Button><Button type="button" variant="ghost" onClick={() => setRenameId(null)}>Cancelar</Button>
    </form>}
  </section>
}
