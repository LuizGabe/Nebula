import { useRef, useState } from 'react'
import { Mic, Square, Pause, Play, Upload, X } from 'lucide-react'
import clsx from 'clsx'
import { useRecorder, type RecorderState } from '../hooks/useRecorder'
import { uploads } from '../api/client'
import { Button } from './ui/Button'

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

interface Props {
  sessionId: string
  onEnd: () => void
  onUploadStarted?: () => void
  disabled?: boolean
}

export function RecordingPanel({ sessionId, onEnd, onUploadStarted, disabled }: Props) {
  const { state, elapsed, start, pause, resume, stop } = useRecorder({ sessionId })
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const isRecording = state === 'recording'
  const isPaused = state === 'paused'
  const isStopped = state === 'stopped'
  const isIdle = state === 'idle'

  const handleEnd = () => {
    stop()
    onEnd()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setUploadFile(file)
    e.target.value = ''
  }

  const handleUpload = async () => {
    if (!uploadFile) return
    setUploadState('uploading')
    setUploadError('')
    try {
      const { url, key } = await uploads.presignedUrl(
        sessionId,
        uploadFile.name,
        uploadFile.type,
        uploadFile.size
      )
      await uploads.uploadToMinio(url, uploadFile)
      setUploadState('done')
      setUploadFile(null)
      onUploadStarted?.()
    } catch (e: any) {
      setUploadState('error')
      setUploadError(e.message ?? 'Erro no upload')
    }
  }

  const ACCEPTED = '.mp3,.wav,.webm,.ogg,.m4a,audio/*'

  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-soft p-6">
      <div className="flex gap-6">
        {/* ── Live recording side ── */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex items-center gap-2 mb-1">
            <Mic className="w-4 h-4 text-ink-500" />
            <span className="text-sm font-medium text-ink-700">Gravar ao vivo</span>
          </div>

          {/* Timer */}
          <div className="flex items-center gap-3">
            {(isRecording || isPaused || isStopped) && (
              <div className="flex items-center gap-2">
                {isRecording && (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                  </span>
                )}
                <span className="font-mono text-2xl font-medium text-ink-900 tabular-nums">
                  {formatTime(elapsed)}
                </span>
              </div>
            )}
            {isIdle && (
              <span className="font-mono text-2xl font-medium text-ink-300 tabular-nums">00:00</span>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {isIdle && (
              <Button variant="primary" onClick={start} disabled={disabled}>
                <Mic className="w-4 h-4" />
                Gravar
              </Button>
            )}

            {isRecording && (
              <>
                <Button variant="secondary" onClick={pause}>
                  <Pause className="w-4 h-4" />
                  Pausar
                </Button>
                <Button variant="danger" onClick={handleEnd}>
                  <Square className="w-4 h-4" />
                  Encerrar
                </Button>
              </>
            )}

            {isPaused && (
              <>
                <Button variant="secondary" onClick={resume}>
                  <Play className="w-4 h-4" />
                  Retomar
                </Button>
                <Button variant="danger" onClick={handleEnd}>
                  <Square className="w-4 h-4" />
                  Encerrar
                </Button>
              </>
            )}

            {isStopped && (
              <span className="text-sm text-ink-400">Gravação encerrada</span>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="w-px bg-ink-100 self-stretch" />

        {/* ── Upload side ── */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex items-center gap-2 mb-1">
            <Upload className="w-4 h-4 text-ink-500" />
            <span className="text-sm font-medium text-ink-700">Enviar arquivo</span>
          </div>

          {!uploadFile ? (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={disabled || isStopped || isRecording || isPaused}
              className={clsx(
                'flex flex-col items-center justify-center gap-2 h-24 rounded-xl border-2 border-dashed text-sm transition-all',
                disabled || isStopped || isRecording || isPaused
                  ? 'border-ink-100 text-ink-300 cursor-not-allowed'
                  : 'border-ink-200 text-ink-500 hover:border-jade-400 hover:text-jade-500 hover:bg-jade-50 cursor-pointer'
              )}
            >
              <Upload className="w-5 h-5" />
              <span>mp3, wav, webm, ogg, m4a</span>
            </button>
          ) : (
            <div className="rounded-xl border border-ink-200 p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-800 truncate">{uploadFile.name}</p>
                <p className="text-xs text-ink-400">{(uploadFile.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              <button onClick={() => setUploadFile(null)} className="text-ink-400 hover:text-ink-700">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <input ref={fileRef} type="file" accept={ACCEPTED} className="hidden" onChange={handleFileSelect} />

          {uploadError && <p className="text-xs text-rose-500">{uploadError}</p>}

          {uploadState === 'done' ? (
            <span className="text-sm text-jade-500 font-medium">Upload concluído!</span>
          ) : (
            <Button
              variant="primary"
              onClick={handleUpload}
              loading={uploadState === 'uploading'}
              disabled={!uploadFile || disabled}
            >
              <Upload className="w-4 h-4" />
              Enviar e processar
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
