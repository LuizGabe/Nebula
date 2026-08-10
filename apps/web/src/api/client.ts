import { config } from '@/config'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${config.VITE_API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })

  if (res.status === 401) {
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.message ?? `HTTP ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const auth = {
  login: (username: string, password: string) =>
    request<{ user: { id: string, username: string, config: Record<string, string> } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  register: (username: string, password: string) =>
    request<{ user: { id: string, username: string, createdAt: string, config: Record<string, string> } }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  me: () => request<{ userId: string; username: string; config: Record<string, string> }>('/auth/me'),

  logout: () => request('/auth/logout', { method: 'POST' }),
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export type SessionStatus = 'ACTIVE' | 'IN_PROGRESS' | 'ENDED'

export interface Folder {
  id: string
  name: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  _count?: { sessions: number; children: number }
}

export interface Prompt {
  id: string
  name: string
  content: string
  isDefault: boolean
  isPublic: boolean
  createdAt: string
  ownerId?: string | null
  owner?: { id: string; username: string } | null
}

export interface Session {
  id: string
  promptId: string | null
  prompt: Prompt | null
  folderId: string | null
  folder: Folder | null
  status: SessionStatus
  title: string | null
  createdAt: string
  updatedAt: string
  endedAt: string | null
}

export type ServiceHealthStatus = 'healthy' | 'degraded' | 'down' | 'inactive'
export type CircuitBreakerState = 'closed' | 'open' | 'half_open'

export interface QueueHealth {
  waiting: number
  active: number
  completed: number
  failed: number
}

export interface ServiceHealth {
  id: string
  label: string
  status: ServiceHealthStatus
  latencyMs: number
  checkedAt: string
  message: string
  breaker: {
    state: CircuitBreakerState
    failures: number
    openedAt: string | null
    nextRetryAt: string | null
  }
  details?: {
    queues?: Record<string, QueueHealth>
    models?: Array<{ id: string; provider: string; available: boolean }>
    [key: string]: unknown
  }
}

export interface SystemStatus {
  status: 'healthy' | 'degraded' | 'down'
  checkedAt: string
  uptimeSec: number
  services: ServiceHealth[]
  connections: Array<{ from: string; to: string; label: string }>
}

export const sessions = {
  list: () => request<{ sessions: Session[] }>('/sessions'),

  get: (id: string) => request<{ session: Session }>(`/sessions/${id}`),

  create: (promptId: string, title?: string, folderId?: string | null) =>
    request<{ session: Session }>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ promptId, title, folderId }),
    }),

  end: (id: string) =>
    request<Session>(`/sessions/${id}/end`, { method: 'PATCH', body: JSON.stringify({}) }),

  status: (sessionId: string) => {
    return new EventSource(
      `${config.VITE_API_BASE_URL}/sessions/${sessionId}/status/stream`,
      { withCredentials: true }
    )
  },

  transcription: (sessionId: string) => {
    return new EventSource(
      `${config.VITE_API_BASE_URL}/sessions/${sessionId}/transcription/stream`,
      { withCredentials: true }
    )
  },

  rename: (id: string, title: string) =>
    request<{ session: Session }>(`/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  update: (id: string, data: { title?: string; promptId?: string | null; folderId?: string | null }) =>
    request<{ session: Session }>(`/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/sessions/${id}`, { method: 'DELETE', body: JSON.stringify({}) }),
}

export const system = {
  status: () => request<SystemStatus>('/system/status'),
}

export const folders = {
  list: () => request<{ folders: Folder[] }>('/folders'),

  create: (data: { name: string; parentId?: string | null }) =>
    request<{ folder: Folder }>('/folders', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: { name?: string; parentId?: string | null }) =>
    request<{ folder: Folder }>(`/folders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string, data?: { sessionAction?: 'moveToRoot' | 'delete' }) =>
    request<void>(`/folders/${id}`, { method: 'DELETE', body: JSON.stringify(data ?? {}) }),
}

// â”€â”€ Prompts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const prompts = {
  list: () => request<{ prompts: Prompt[] }>('/prompts'),

  create: (data: { name: string; content: string; isDefault?: boolean; isPublic?: boolean }) =>
    request<{ prompt: Prompt }>('/prompts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: { name?: string; content?: string; isDefault?: boolean; isPublic?: boolean }) =>
    request<{ prompt: Prompt }>(`/prompts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/prompts/${id}`, { method: 'DELETE', body: JSON.stringify({}) }),
}

// ── Chunks ────────────────────────────────────────────────────────────────────

export const chunks = {
  presignedUrl: (
    sessionId: string,
    chunkIndex: number,
    timestampStart: number,
    timestampEnd: number
  ) =>
    request<{ url: string; key: string }>('/chunks/presigned-url', {
      method: 'POST',
      body: JSON.stringify({ sessionId, chunkIndex, contentType: 'audio/webm', timestampStart, timestampEnd }),
    }),
  
    uploadToMinio: (presignedUrl: string, chunk: Blob) =>
    fetch(presignedUrl, {
      method: 'PUT',
      body: chunk,
      headers: { 'Content-Type': 'audio/webm' },
    }),
}

// ── Uploads ───────────────────────────────────────────────────────────────────

export const uploads = {
  presignedUrl: (sessionId: string, filename: string, contentType: string, sizeBytes: number) =>
    request<{ url: string; key: string }>('/uploads/audio/presigned-url', {
      method: 'POST',
      body: JSON.stringify({ sessionId, filename, contentType, sizeBytes }),
    }),

  uploadToMinio: (presignedUrl: string, file: File) =>
    fetch(presignedUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    }),
}

// ── Documents ─────────────────────────────────────────────────────────────────

export interface DocumentVersion {
  id: string
  version: number
  type: string
  modelUsed: string
  createdAt: string
}

export interface DocumentContent {
  id: string
  type: string
  content: string
  version: number
  modelUsed: string
  createdAt: string
}

export const documents = {

  listVersions: (sessionId: string) =>
    request<{ documents: DocumentVersion[] }>(`/sessions/${sessionId}/document`),

  getContent: (sessionId: string, version?: number) =>
    request<{ document: DocumentContent }>(
      `/sessions/${sessionId}/document/content${version ? `?version=${version}` : ''}`
    ),

  update: (sessionId: string, content: string) =>
    request<DocumentContent>(`/sessions/${sessionId}/document`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),

  reprocess: (sessionId: string) =>
    request(`/sessions/${sessionId}/document/reprocess`, { method: 'POST', body: JSON.stringify({}) })
}

// ── Transcripts ───────────────────────────────────────────────────────────────

export interface TranscriptBlock {
  id: string
  chunkIndex: number
  text: string
  timestampStart: number
  timestampEnd: number
}

export const transcripts = {
  list: (sessionId: string) =>
    request<{ transcripts: TranscriptBlock[] }>(`/sessions/${sessionId}/transcripts`),
}

// ── LLM ──────────────────────────────────────────────────────────────────────
export interface LLMModel {
  id: string
  label: string
  provider: string
}


export const llm = {
  models: () => request<{ models: LLMModel[] }>('/llm/models'),
}

// ── Users ─────────────────────────────────────────────────────────────────────

export const users = {
  updateConfig: (defaultModel: string) =>
    request('/users/config', {
      method: 'PATCH',
      body: JSON.stringify({ defaultModel }),
    }),
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

export function openQuestionSSE(
  sessionId: string,
  question: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (e: Error) => void
): () => void {
  const ctrl = new AbortController()

  fetch(`${config.VITE_API_BASE_URL}/sessions/${sessionId}/question`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
    signal: ctrl.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) throw new Error('SSE error')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) { onDone(); break }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') { onDone(); return }
            try {
              const parsed = JSON.parse(data)
              if (parsed.text) onChunk(parsed.text)
            } catch { }
          }
        }
      }
    })
    .catch((e) => { if (e.name !== 'AbortError') onError(e) })

  return () => ctrl.abort()
}
