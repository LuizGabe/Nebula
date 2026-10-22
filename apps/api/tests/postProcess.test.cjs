const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

async function main() {
  let generationError = null
  let generated = 0
  const events = [], saved = []
  const session = { id: 's1', ownerId: 'user', status: 'ENDED', isDeleted: false, owner: { config: {} }, prompt: { ownerId: 'user', id: 'p1', name: 'Resumo', instructions: 'Resuma os fatos.' } }
  const prisma = {
    recordingSession: { findUnique: async () => session },
    transcript: { findMany: async () => [{ text: 'Fato transcrito.', timestampStart: 0 }] },
    document: {
      findFirst: async () => ({ version: 2 }),
      create: async ({ data }) => { saved.push(data); return data },
    },
  }
  const overrides = {
    '../queues': { postProcessQueue: { add: async () => ({ id: 'insights-s1' }) } },
    '@/lib/insights': { generateInsights: async () => ({}) },
    '@/lib/prisma': { prisma },
    '@/lib/llm': { DEFAULT_MODEL: 'groq/openai/gpt-oss-20b', createAdapter: () => ({}) },
    '@/lib/prompts': { ...require('./templatePolicyHarness.cjs').loadPolicy(prisma), ensureDocumentTemplateSchema: async () => {} },
    '@/lib/documentGeneration': { generateDocument: async () => {
      generated++
      if (generationError) throw generationError
      return '# Documento novo'
    } },
    '@/lib/audioTimestamps': { formatAudioTag: () => '[audio:00:00]' },
    '@/events/publisher': { createEventPublisher: () => ({ emit: async (...args) => events.push(args) }) },
    '@/events/payloads': {
      documentGenerating: (triggeredBy, version) => ({ triggeredBy, version }),
      documentSkipped: reason => ({ reason }), documentFailed: (reason, version) => ({ reason, version }),
      documentReady: version => ({ version }),
    },
  }
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/jobs/processors/postProcess.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, console: { log() {}, warn() {} }, Error, require: id => id in overrides ? overrides[id] : require(id) })
  const job = triggeredBy => ({ data: { sessionId: 's1', triggeredBy }, log: async () => {}, updateProgress: async () => {} })
  const handler = exports.postProcessHandler
  const result = await handler(job('user_reprocess'))
  assert.equal(result.version, 3)
  assert.equal(saved[0].version, 3)
  assert.equal(events.at(-1)[1], 'DOCUMENT_READY')
  assert.equal((await handler(job('batch_transcription_done'))).reason, 'already_exists')
  assert.equal(generated, 1, 'Automatic retries must preserve existing documents')
  events.length = 0
  generationError = new Error('413 Request too large')
  await assert.rejects(handler(job('user_reprocess')), /413/)
  assert.equal(events.at(-1)[1], 'DOCUMENT_FAILED')
  assert.ok(!events.some(event => event[1] === 'DOCUMENT_SKIPPED'), 'A provider failure must never become a completed/skipped job')
  assert.equal(saved.length, 1, 'Failed generation must preserve the prior version')
  const beforeUnavailable = generated
  generationError = null
  session.prompt.deletedAt = new Date()
  await assert.rejects(handler(job('user_reprocess')), /Template indisponível/)
  session.prompt.deletedAt = null
  session.prompt.ownerId = 'another-user'
  await assert.rejects(handler(job('user_reprocess')), /Template indisponível/)
  assert.equal(generated, beforeUnavailable, 'Deleted/private references never fall back to a different template')
  assert.equal(saved.length, 1)
  console.log('Post-processing version and failure regression tests passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
