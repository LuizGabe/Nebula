import { useEffect, useState } from 'react'
import { recordingStore } from '../services/recordingStore'
import type { SessionAudioMedia } from '../api/client'
import { useAuthStore } from '../store/auth'

export function RecordingMilestones({ sessionId, media, complete }: { sessionId: string; media: SessionAudioMedia[]; complete: boolean }) {
  const [saved, setSaved] = useState(false)
  const ownerId = useAuthStore(s => s.user?.id)
  useEffect(() => {
    let cancelled = false
    void recordingStore.recordings.get(sessionId).then(async manifest => {
      const count = manifest?.ownerId === ownerId ? await recordingStore.chunks.where('sessionId').equals(sessionId).count() : 0
      if (!cancelled) setSaved(count > 0)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [sessionId, ownerId, media])
  const cloud = media.some(m => m.status !== 'PENDING_UPLOAD' && m.status !== 'FAILED')
  return <div className="flex flex-wrap gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3 text-xs" role="status" aria-label="Segurança e processamento da gravação">
    {[[saved, 'Salvo no Dispositivo'], [cloud, 'Enviado para Nuvem'], [complete, 'Transcrição Concluída']].map(([done,label]) => <span key={String(label)} className={done ? 'text-jade-700' : 'text-ink-400'}>{done ? '✓ ' : '○ '}{label}</span>)}
  </div>
}
