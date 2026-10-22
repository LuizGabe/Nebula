const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Fastify = require('fastify')

function transpile(relative, overrides = {}) {
  const exports = {}
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(output, { exports, URL, console, process, require: id => id in overrides ? overrides[id] : require(id) })
  return exports
}

async function main() {
  const urls = transpile('lib/youtubeUrl.ts')
  const created = [], jobs = [], events = [], updates = []
  let username = 'common'
  let queueFailure = false
  const prisma = {
    prompt: { findFirst: async ({ where }) => where.id === 'public-prompt' ? { id: 'public-prompt', transcriptionMode: 'CLASS' } : null },
    folder: { findFirst: async ({ where }) => where.id === 'owned-folder' ? { id: 'owned-folder' } : null },
    recordingSession: {
      create: async ({ data }) => { created.push(data); return { ...data, id: `s${created.length}`, owner: { id: 'owner', username } } },
      update: async ({ data }) => updates.push(data),
      findFirst: async () => null,
    },
  }
  const route = transpile('routes/sessions.ts', {
    '@/lib/prisma.js': { prisma },
    '@/hooks/requireAuth': { requireAuth: async (request, reply) => {
      if (!request.headers['x-test-auth']) return reply.status(401).send({ error: 'Unauthorized' })
      request.session = { get: () => 'owner' }
    } },
    ioredis: class {},
    '@/lib/llm': {}, '@/config': { config: { REDIS_URL: 'redis://test' } },
    '@/jobs/queues': { postProcessQueue: {}, transcriptionJobsQueue: { add: async (...args) => {
      if (queueFailure) throw new Error('Redis unavailable')
      jobs.push(args)
      return { id: 'job' }
    } } },
    '@/events/publisher': { createEventPublisher: () => ({ emit: async (...args) => events.push(args) }) },
    '@/lib/youtubeUrl': urls, '@/lib/storage': {}, '@/lib/audioTimestamps': {},
    '@/lib/prompts': { FORMALITY_VALUES: ['neutral'], DETAIL_LEVEL_VALUES: ['balanced'], TRANSCRIPTION_MODE_VALUES: ['MEETING', 'CLASS'] },
  }).default
  const app = Fastify()
  await app.register(route)
  const create = (payload) => app.inject({ method: 'POST', url: '/sessions', headers: { 'x-test-auth': 'yes' }, payload: { promptId: 'public-prompt', ...payload } })
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/sessions', payload: {} })).statusCode, 401)
    for (const youtubeUrl of ['https://youtu.be/jNQXAC9IVRw?t=5', 'https://youtube.com/watch?v=jNQXAC9IVRw', 'https://www.youtube.com/shorts/jNQXAC9IVRw']) {
      const response = await create({ youtubeUrl, maxDurationMinutes: 9999 })
      assert.equal(response.statusCode, 201)
      assert.equal(response.json().session.status, 'IN_PROGRESS')
      assert.equal(jobs.at(-1)[0], 'ingest-youtube')
      assert.equal(jobs.at(-1)[1].youtubeUrl, 'https://www.youtube.com/watch?v=jNQXAC9IVRw')
      assert.equal(jobs.at(-1)[1].ownerId, 'owner')
      assert.equal(jobs.at(-1)[1].maxDurationMinutes, 30)
      assert.equal(jobs.at(-1)[1].mode, 'CLASS')
      assert.equal(jobs.at(-1)[2].attempts, 1)
    }
    username = 'luizgabe'
    await create({ youtubeUrl: 'https://youtu.be/jNQXAC9IVRw' })
    assert.equal(jobs.at(-1)[1].maxDurationMinutes, 300)
    const before = created.length
    for (const youtubeUrl of ['http://localhost/file', 'https://youtube.com.evil.test/watch?v=jNQXAC9IVRw', 'https://youtu.be/short', 'https://youtube.com/playlist?list=123', 'file:///etc/passwd']) {
      assert.equal((await create({ youtubeUrl })).statusCode, 400)
    }
    assert.equal(created.length, before)
    assert.equal((await create({ promptId: 'private-prompt' })).statusCode, 400)
    assert.equal((await create({ folderId: 'someone-elses-folder' })).statusCode, 404)
    const queued = jobs.length
    assert.equal((await create({})).json().session.status, 'ACTIVE')
    assert.equal(jobs.length, queued)
    queueFailure = true
    assert.equal((await create({ youtubeUrl: 'https://youtu.be/jNQXAC9IVRw' })).statusCode, 503)
    assert.equal(updates.at(-1).status, 'ERROR')
    assert.equal(events.at(-1)[1], 'UPLOAD_FAILED')
    assert.equal((await app.inject({ method: 'GET', url: '/sessions/other/status/stream', headers: { 'x-test-auth': 'yes' } })).statusCode, 404)
    console.log('YouTube session API regression tests passed')
  } finally { await app.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
