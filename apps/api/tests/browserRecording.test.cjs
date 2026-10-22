const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Fastify = require('fastify')

async function main() {
  const jobs = []
  const events = []
  const media = []
  const updates = []
  let hasTranscript = false
  const documentJobs = []
  const prisma = {
    transcript: { findFirst: async () => hasTranscript ? { id: 'transcript' } : null },
    recordingSession: {
      findFirst: async ({ where }) => (where.ownerId === 'owner' || where.ownerId === undefined) && where.isDeleted === false ? { id: 'session' } : null,
      findUnique: async () => ({ transcriptionModeOverride: null }),
      update: async ({ data }) => updates.push(data),
    },
    audioMedia: {
      upsert: async ({ create }) => media.push(create),
      findFirst: async ({ where }) => media.find(row => row.sessionId === where.sessionId && row.storageKey === where.storageKey),
      findUnique: async () => null,
      updateMany: async ({ data }) => updates.push(data),
    },
    $transaction: async (operations) => Promise.all(operations),
  }
  function load(file) {
    const source = fs.readFileSync(path.join(__dirname, '../src/routes', file), 'utf8')
    const output = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText
    const exports = {}
    vm.runInNewContext(output, {
      exports, process: { env: {} },
      require: (id) => {
        if (id === '@/lib/youtubeUrl') return { normalizeYouTubeUrl: () => null }
        if (id === '@/lib/transcriptWords') return { parseWords: value => Array.isArray(value) ? value : [] }
        if (id.includes('prisma')) return { prisma }
        if (id.includes('requireAuth')) return { requireAuth: async (request) => { request.session = { get: () => 'owner' } } }
        if (id.includes('storage')) return { s3Public: {}, BUCKET: 'test' }
        if (id.includes('publisher')) return { createEventPublisher: () => ({ emit: async (...args) => events.push(args) }) }
        if (id.includes('queues')) return {
          transcriptionJobsQueue: { getJob: async id => jobs.find(job => job[2]?.jobId === id), add: async (...args) => { jobs.push(args); return { id: 'job' } } },
          postProcessQueue: { add: async (...args) => documentJobs.push(args) },
        }
        if (id === 'ioredis') return class {}
        if (id === '@/config') return { config: { REDIS_URL: 'redis://test' } }
        if (id === '@/lib/llm' || id === '@/lib/audioTimestamps') return {}
        if (id === '@/lib/prompts') return {
          DETAIL_LEVEL_VALUES: ['concise', 'balanced', 'detailed'],
          FORMALITY_VALUES: ['informal', 'neutral', 'formal'],
          TRANSCRIPTION_MODE_VALUES: ['MEETING', 'CLASS'],
        }
        if (id === '@aws-sdk/client-s3') return { PutObjectCommand: class {} }
        if (id === '@aws-sdk/s3-request-presigner') return { getSignedUrl: async () => 'https://example.test/upload' }
        return require(id)
      },
    })
    return exports.default
  }
  const app = Fastify()
  await app.register(load('uploads.ts'))
  await app.register(load('internalWebhook.ts'))
  await app.register(load('sessions.ts'))
  await app.register(load('transcripts.ts'))
  const upload = (transcribe) => app.inject({ method: 'POST', url: '/uploads/audio/presigned-url', payload: {
    sessionId: 'session', filename: 'recording.webm', contentType: 'audio/webm', sizeBytes: 5000,
    ...(transcribe === undefined ? {} : { transcribe }),
  } })
  const webhook = (key) => app.inject({ method: 'POST', url: '/internal/minio-webhook', payload: {
    EventName: 's3:ObjectCreated:Put', Records: [{ s3: { bucket: { name: 'test' }, object: { key } } }],
  } })
  try {
    const recording = await upload(false)
    assert.equal(recording.statusCode, 200)
    assert.match(recording.json().key, /^sessions\/session\/recordings\//)
    assert.equal(events.length, 0)
    assert.equal(updates.length, 0)
    assert.equal((await webhook(recording.json().key)).statusCode, 200)
    assert.equal(jobs.length, 0, 'browser recording must never reach Groq')
    assert.equal(updates[0].status, 'UPLOADED')

    const file = await upload()
    assert.equal(file.statusCode, 200)
    assert.match(file.json().key, /^sessions\/session\/uploads\//)
    assert.equal((await webhook(file.json().key)).statusCode, 200)
    assert.equal(jobs.length, 1, 'ordinary file upload still transcribes')
    assert.equal((await webhook(file.json().key)).statusCode, 200)
    assert.equal(jobs.length, 1, 'redelivered webhook must not enqueue a duplicate')
    assert.equal(jobs[0][0], 'transcribe-upload')
    assert.equal(media.length, 2, 'both audio files remain available for playback')
    assert.equal((await upload('false')).statusCode, 400)

    const updateCount = updates.length
    const empty = await app.inject({ method: 'PATCH', url: '/sessions/session/end' })
    assert.equal(empty.statusCode, 409)
    assert.equal(documentJobs.length, 0, 'empty session must not generate a document')
    assert.equal(updates.length, updateCount, 'empty session must not be marked ended')
    hasTranscript = true
    assert.equal((await app.inject({ method: 'PATCH', url: '/sessions/session/end' })).statusCode, 200)
    assert.equal(documentJobs.length, 1)

    const diagnostic = await app.inject({ method: 'POST', url: '/sessions/session/transcripts/browser-status', payload: { stage: 'error', errorCode: 'network' } })
    assert.equal(diagnostic.statusCode, 204)
    assert.equal(events.at(-1)[1], 'CHUNK_FAILED')
    assert.equal(events.at(-1)[2].errorCode, 'network')
  } finally {
    await app.close()
  }
  console.log('Browser recording API regression tests passed')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
