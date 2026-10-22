import { useEffect, useState } from 'react'
import { insights, transcripts, type Insights } from '../api/client'
import { Button } from './ui/Button'

export function TranscriptProductivity({ sessionId, reloadToken = 0, onSeekTo }: { sessionId: string; reloadToken?: number; onSeekTo: (seconds: number) => void }) {
  const [data, setData] = useState<Insights | null>(null)
  const [format, setFormat] = useState('srt')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.sessionId === sessionId) { setData(null); setVersion(n => n + 1) }
    }
    window.addEventListener('nebula:transcript-edited', changed)
    return () => window.removeEventListener('nebula:transcript-edited', changed)
  }, [sessionId])
  useEffect(() => {
    let cancelled = false; let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const result = await insights.get(sessionId)
        if (cancelled) return
        setData(result.insights)
        const pending = ['active','waiting','delayed','prioritized'].includes(result.status)
        setWorking(pending)
        if (result.status === 'failed') setError('Não foi possível gerar os insights. Tente novamente.')
        if (pending) timer = setTimeout(() => void load(), 3000)
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar insights') }
    }
    void load()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [sessionId, reloadToken, version])
  const generate = async () => {
    setError(''); setWorking(true)
    try { await insights.generate(sessionId); setVersion(n => n + 1) }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao iniciar geração'); setWorking(false) }
  }
  const download = async () => {
    setError(''); setExporting(true)
    try {
      const blob = await transcripts.export(sessionId, format)
      const url = URL.createObjectURL(blob); const a = document.createElement('a')
      a.href = url; a.download = 'transcricao.' + format; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha na exportação') }
    finally { setExporting(false) }
  }
  const source = async (id: string) => {
    try { const result = await transcripts.list(sessionId); const block = result.transcripts.find(b => b.id === id); if (block) onSeekTo(block.timestampStart / 1000) }
    catch { setError('Não foi possível localizar a fonte da tarefa.') }
  }
  const sentiment = { positive: 'Positivo', negative: 'Negativo', neutral: 'Neutro', mixed: 'Misto', unknown: 'Indeterminado' }
  return <section className="rounded-2xl border border-ink-100 bg-white p-6 shadow-soft" aria-label="Insights e exportação">
    <div className="flex flex-wrap items-center gap-3"><h3 className="mr-auto font-medium">Insights</h3>
      <Button disabled={working} onClick={() => void generate()}>{working ? 'Gerando insights…' : data ? 'Atualizar insights' : 'Gerar insights'}</Button>
      <select aria-label="Formato de exportação" value={format} onChange={e => setFormat(e.target.value)} className="rounded-lg border border-ink-200 px-2 py-2 text-sm">{['srt','vtt','pdf','docx','json','md','txt'].map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select>
      <Button variant="secondary" disabled={exporting} onClick={() => void download()}>{exporting ? 'Exportando…' : 'Exportar'}</Button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    {working && !data && <div role="status" aria-label="Gerando insights" className="mt-4 h-32 animate-pulse rounded-xl bg-ink-50" />}
    {data && <div className="mt-4 space-y-4 text-sm text-ink-700">
      <ul className="list-disc space-y-2 pl-5">{data.summary.map((text,i) => <li key={i}>{text}</li>)}</ul>
      <h4 className="font-medium">Tarefas</h4>
      {!data.actionItems.length && <p className="text-ink-400">Nenhuma tarefa explícita encontrada.</p>}
      {data.actionItems.map((item,i) => <div key={i} className="rounded-xl border border-ink-100 p-3"><p>{item.text}</p><p className="mt-1 text-xs text-ink-500">Responsável: {item.owner || 'Não informado'} · Prazo: {item.dueDate || 'Não informado'}</p><Button size="sm" variant="ghost" onClick={() => void source(item.transcriptReferenceId)}>Ouvir fonte</Button></div>)}
      <div className="flex flex-wrap gap-2">{data.tags.map(tag => <span key={tag} className="rounded-full bg-jade-50 px-3 py-1 text-jade-700">{tag}</span>)}</div>
      <p className="text-xs text-ink-500">Tom do texto: {sentiment[data.sentiment]}</p>
    </div>}
  </section>
}
