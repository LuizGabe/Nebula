const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Fastify = require('fastify')

async function main() {
  const rows = new Map(['a', 'b'].map(id => [id, {
    id, sessionId: 'session', text: `Texto ${id}`, chunkIndex: id === 'a' ? 0 : 1,
    timestampStart: 1000, timestampEnd: 2000, revision: 0, edited: false, originalText: null,
    words: [{ text: 'Texto', start_ms: 1000, end_ms: 1500 }],
  }]))
  let deleted = false
  let insights = { summary: ['Desatualizado'] }
  const prisma = {
    recordingSession: {
      findFirst: async ({ where }) => where.id === 'session' && where.ownerId === 'owner' && where.isDeleted === false && !deleted
        ? { id: 'session', status: 'ENDED', speakerNames: {} } : null,
      update: async ({ data }) => { insights = data.insights },
    },
    transcript: {
      findMany: async () => [...rows.values()],
      findFirst: async ({ where }) => {
        const row = rows.get(where.id)
        return row && row.sessionId === where.sessionId && row.revision === where.revision ? { ...row } : null
      },
      updateMany: async ({ where, data }) => {
        const row = rows.get(where.id)
        if (!row || row.revision !== where.revision) return { count: 0 }
        rows.set(row.id, { ...row, ...data, revision: row.revision + 1 })
        return { count: 1 }
      },
    },
    $transaction: async callback => {
      const snapshot = structuredClone([...rows])
      try { return await callback(prisma) }
      catch (e) { rows.clear(); snapshot.forEach(([key, value]) => rows.set(key, value)); throw e }
    },
  }
  const exported = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/routes/transcripts.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports: exported, Error,
    require: id => {
      if (id === '@/generated/prisma/client') return { Prisma: { DbNull: null } }
      if (id.includes('prisma')) return { prisma }
      if (id.includes('requireAuth')) return { requireAuth: async (request, reply) => {
        const user = request.headers['x-user']
        if (!user) return reply.status(401).send({ error: 'Unauthorized' })
        request.session = { get: () => user }
      } }
      if (id.includes('publisher')) return { createEventPublisher: () => ({ emit: async () => {} }) }
      if (id === '@/lib/transcriptWords') return { parseWords: value => value ?? [] }
      return require(id)
    },
  })
  const app = Fastify()
  await app.register(exported.default)
  const request = (method, payload, user = 'owner') => app.inject({ method, url: '/sessions/session/transcripts', headers: user ? { 'x-user': user } : {}, ...(payload ? { payload } : {}) })
  try {
    assert.equal((await request('GET', null, null)).statusCode, 401)
    assert.equal((await request('GET', null, 'intruder')).statusCode, 404)
    const original = structuredClone(rows.get('a'))
    assert.equal((await request('PATCH', { edits: [{ id: 'a', revision: 0, text: 'Corrigido' }] })).statusCode, 200)
    const edited = rows.get('a')
    assert.equal(edited.id, original.id)
    assert.equal(edited.timestampStart, original.timestampStart)
    assert.deepEqual(edited.words, original.words)
    assert.equal(edited.originalText, original.text)
    assert.equal(edited.edited, true)
    assert.equal(edited.revision, 1)
    assert.equal(insights, null)
    assert.equal((await request('PATCH', { edits: [{ id: 'a', revision: 0, text: 'Stale' }] })).statusCode, 409)
    assert.equal(rows.get('a').text, 'Corrigido')
    assert.equal((await request('PATCH', { edits: [{ id: 'a', revision: 1, text: 'Não salvar' }, { id: 'b', revision: 999, text: 'Conflito' }] })).statusCode, 409)
    assert.equal(rows.get('a').text, 'Corrigido', 'A conflicting batch must roll back all edits')
    assert.equal((await request('PATCH', { edits: [{ id: 'a', revision: 1, text: '' }] })).statusCode, 400)
    deleted = true
    assert.equal((await request('GET')).statusCode, 404)
    assert.equal((await request('PATCH', { edits: [{ id: 'a', revision: 1, text: 'Oculto' }] })).statusCode, 404)
  } finally { await app.close() }
  console.log('Transcript ownership, revision, timing and atomic edit tests passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
