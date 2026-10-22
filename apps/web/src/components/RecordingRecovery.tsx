import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { audioExtension, discardRecording, recordingStore, reconstructRecording, type RecordingManifest } from '../services/recordingStore'
import { isRecordingActive } from '../services/AudioRecorderService'
import { uploadRecording } from '../services/recordingUpload'
import { Button } from './ui/Button'

export function RecordingRecovery() {
  const ownerId = useAuthStore(s => s.user?.id)
  const [items, setItems] = useState<RecordingManifest[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!ownerId) return
    void recordingStore.recordings.where('ownerId').equals(ownerId).toArray().then(async rows => {
      const pending = await recordingStore.chunks.where('status').equals('pending').primaryKeys()
      const ids = new Set(pending.map(key => key[0]))
      setItems(rows.filter(row => !row.uploaded && ids.has(row.sessionId) && !isRecordingActive(row.sessionId)))
    }).catch(() => setError('Não foi possível verificar as gravações locais.'))
  }, [ownerId])
  useEffect(() => { if (items.length && !dialog.current?.open) dialog.current?.showModal() }, [items])
  const act = async (item: RecordingManifest, action: 'upload' | 'download' | 'discard') => {
    if (!ownerId) return
    setBusy(true); setError('')
    try {
      await navigator.locks.request('nebula-recording:' + item.sessionId, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Esta gravação está em uso em outra aba.')
        if (action === 'upload') await uploadRecording(item.sessionId, ownerId)
        if (action === 'discard') {
          if (!confirm('Descartar permanentemente esta gravação local?')) return
          await discardRecording(item.sessionId)
        }
        if (action === 'download') {
          const blob = await reconstructRecording(item.sessionId)
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a'); a.href = url; a.download = item.sessionId + '.' + audioExtension(blob.type); a.click()
          setTimeout(() => URL.revokeObjectURL(url), 10000)
          return
        }
        setItems(rows => rows.filter(row => row.sessionId !== item.sessionId))
        window.dispatchEvent(new Event('nebula:sessions-changed'))
      })
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha na recuperação') }
    finally { setBusy(false) }
  }
  if (!items.length) return error ? <p role="alert" className="p-3 text-rose-700">{error}</p> : null
  return <><div className="fixed right-4 top-4 z-40"><Button variant="secondary" onClick={() => dialog.current?.showModal()}>Revisar {items.length} gravação(ões) local(is)</Button></div><dialog ref={dialog} aria-labelledby="recovery-title" onCancel={e => { if (busy) e.preventDefault() }} className="w-full max-w-xl rounded-2xl p-6 shadow-float backdrop:bg-ink-900/40">
    <h2 id="recovery-title" className="text-lg font-semibold">Gravações recuperadas</h2>
    <p className="my-3 text-sm text-ink-500">O áudio salvo neste dispositivo está disponível para envio ou download. O último fragmento pode não ter sido finalizado pelo navegador.</p>
    {items.map(item => <div key={item.sessionId} className="my-3 rounded-xl border border-ink-100 p-3">
      <Link to={'/sessions/' + item.sessionId} onClick={() => dialog.current?.close()} className="text-sm underline">Sessão de {new Date(item.createdAt).toLocaleString()}</Link>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void act(item, 'upload')}>Finalizar envio</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void act(item, 'download')}>Baixar áudio</Button>
        <Button variant="danger" disabled={busy} onClick={() => void act(item, 'discard')}>Descartar</Button>
      </div>
    </div>)}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <Button variant="ghost" disabled={busy} onClick={() => dialog.current?.close()}>Revisar depois</Button>
  </dialog></>
}
