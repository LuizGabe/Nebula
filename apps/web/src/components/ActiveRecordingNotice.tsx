import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { activeRecordings, subscribeRecorders } from '../services/AudioRecorderService'
import { useAuthStore } from '../store/auth'

export function ActiveRecordingNotice() {
  const [items, setItems] = useState(activeRecordings)
  const ownerId = useAuthStore(s => s.user?.id)
  useEffect(() => subscribeRecorders(() => setItems(activeRecordings())), [])
  const visible = items.filter(item => item.ownerId === ownerId)
  if (!visible.length) return null
  return <div className="sticky top-0 z-notice border-b border-rose-100 bg-rose-50 px-6 py-2 text-sm text-rose-700" role="status">
    {visible.map(item => <Link key={item.sessionId} to={'/sessions/' + item.sessionId} className="mr-4 inline-flex items-center gap-2 rounded-lg px-2 py-1 underline">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-rose-500" />
      {item.state === 'recording' ? 'Microfone ativo' : item.state === 'paused' ? 'Gravação pausada' : item.state === 'interrupted' ? 'Microfone interrompido' : 'Gravação em andamento'} · {Math.floor(item.elapsed / 60)}:{String(item.elapsed % 60).padStart(2, '0')} · Abrir gravação
    </Link>)}
  </div>
}
