const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Fastify = require('fastify')

async function main() {
  const jobs = new Map()
  const events = []
  let status = 'ENDED'
  let transcripts = 4
  const prompt = { isPublic: true, deletedAt: null }
  const prisma = {
    recordingSession: { findFirst: async ({ where }) => where.id === 'own' && where.ownerId === 'user' && where.isDeleted === false ? { id: 'own', status, prompt } : null },
    transcript: { count: async () => transcripts },
  }
  const queue = {
    getJob: async id => jobs.get(id),
    add: async (name, data, opts) => {
      const job = { id: opts.jobId, timestamp: Date.now(), data, state: 'waiting', progress: 0,
        getState: async () => job.state, remove: async () => jobs.delete(job.id) }
      jobs.set(job.id, job)
      return job
    },
  }
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/routes/documents.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: id => {
    if (id === '@/lib/prompts') return require('./templatePolicyHarness.cjs').loadPolicy(prisma)
    if (id.includes('prisma')) return { prisma }
    if (id.includes('requireAuth')) return { requireAuth: async request => { request.session = { get: () => 'user' } } }
    if (id.includes('queues')) return { postProcessQueue: queue }
    if (id.includes('publisher')) return { createEventPublisher: () => ({ emit: async (...args) => events.push(args) }) }
    return require(id)
  } })
  const app = Fastify()
  await app.register(exports.default)
  const reprocess = () => app.inject({ method: 'POST', url: '/sessions/own/document/reprocess', payload: {} })
  try {
    assert.equal((await reprocess()).statusCode, 202)
    assert.equal(events.at(-1)[1], 'DOCUMENT_QUEUED')
    assert.equal((await reprocess()).statusCode, 409, 'Duplicate clicks must not queue a second generation')
    let response = await app.inject({ method: 'GET', url: '/sessions/own/document/job-status?jobId=reprocess-own' })
    assert.equal(response.json().status, 'waiting')
    jobs.get('reprocess-own').state = 'failed'
    jobs.get('reprocess-own').failedReason = 'Provider failed'
    response = await app.inject({ method: 'GET', url: '/sessions/own/document/job-status?jobId=reprocess-own' })
    assert.equal(response.json().error, 'Provider failed')
    assert.equal((await reprocess()).statusCode, 202, 'A failed generation must be retryable')
    jobs.set('foreign', { data: { sessionId: 'someone-else' } })
    assert.equal((await app.inject({ method: 'GET', url: '/sessions/own/document/job-status?jobId=foreign' })).json().status, 'not_found')
    assert.equal((await app.inject({ method: 'POST', url: '/sessions/other/document/reprocess', payload: {} })).statusCode, 404)
    jobs.clear()
    status = 'ACTIVE'
    assert.equal((await reprocess()).statusCode, 409)
    status = 'ERROR'
    transcripts = 0
    assert.equal((await reprocess()).statusCode, 409)
    transcripts = 4
    assert.equal((await reprocess()).statusCode, 202)
    jobs.clear()
    prompt.deletedAt = new Date()
    assert.equal((await reprocess()).statusCode, 409)
    assert.equal(jobs.size, 0, 'Unavailable template must not enqueue generation')
    console.log('Document reprocess API tests passed')
  } finally { await app.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
