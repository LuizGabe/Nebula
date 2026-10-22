const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, overrides = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, URL, require: id => id in overrides ? overrides[id] : require(id) })
  return exports
}

const { youtubeUrlSchema, normalizeYouTubeUrl } = load('utils/youtubeUrl.ts')
for (const url of ['https://youtu.be/jNQXAC9IVRw?t=4', 'https://www.youtube.com/watch?v=jNQXAC9IVRw', 'https://youtube.com/shorts/jNQXAC9IVRw']) {
  assert.ok(youtubeUrlSchema.safeParse(url).success)
  assert.equal(normalizeYouTubeUrl(url), 'https://www.youtube.com/watch?v=jNQXAC9IVRw')
}
for (const url of ['', 'https://youtube.com.evil.test/watch?v=jNQXAC9IVRw', 'https://youtube.com/playlist?list=1', 'file:///etc/passwd', 'https://youtu.be/x']) {
  assert.equal(youtubeUrlSchema.safeParse(url).success, false)
}

const states = []
const cleanups = []
const sources = []
class Source {
  callbacks = {}
  readyState = 1
  addEventListener(name, callback) { this.callbacks[name] = callback }
  close() { this.closed = true }
  constructor() { sources.push(this) }
}
const { useSessionEvents } = load('hooks/useProcessingStatus.ts', {
  react: {
    useState: initial => {
      const index = states.push(initial) - 1
      return [initial, value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useRef: value => ({ current: value }),
    useEffect: callback => cleanups.push(callback()),
  },
  '@/api/client': { sessions: { status: () => new Source(), transcription: () => new Source() } },
})
useSessionEvents('session', true)
const emit = (type, data) => sources[0].callbacks.progress({ data: JSON.stringify({ type, data }) })
emit('UPLOAD_RECEIVED', { source: 'youtube', stage: 'queued', message: 'Aguardando' })
assert.equal(states[0], 'waiting:ingestion')
emit('UPLOAD_RECEIVED', { source: 'youtube', stage: 'metadata', message: 'Verificando video' })
assert.equal(states[0], 'processing:ingestion')
assert.equal(states[6], 'Verificando video')
emit('UPLOAD_RECEIVED', { source: 'youtube', stage: 'stored' })
assert.equal(states[0], 'waiting:transcript')
assert.equal(states[5], 1)
emit('UPLOAD_TRANSCRIPTION_STARTED', { total_chunks: 2 })
assert.equal(states[0], 'processing:transcript')
emit('UPLOAD_FAILED', { source: 'youtube', error: 'O vídeo excede o limite de duração permitido de 30 minutos' })
assert.equal(states[0], 'error:ingestion')
assert.match(states[7], /30 minutos/)
emit('UPLOAD_FAILED', { source: 'youtube', stage: 'transcript', error: 'Falha ao transcrever' })
assert.equal(states[0], 'error:transcript')
emit('DOCUMENT_READY', {})
assert.equal(states[0], 'done')
assert.equal(states[7], '')
cleanups.forEach(cleanup => cleanup?.())
assert.ok(sources.every(source => source.closed))
console.log('YouTube URL and SSE frontend regression tests passed')
