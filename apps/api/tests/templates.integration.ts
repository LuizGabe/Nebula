import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import Fastify from 'fastify'
import dotenv from 'dotenv'
dotenv.config({ path: '../../.env', quiet: true })
const url = new URL(process.env.DATABASE_URL!)
assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(url.hostname), 'Integration is restricted to local PostgreSQL')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href }) })
const require = createRequire(import.meta.url)
const { loadPolicy, loadSource } = require('./templatePolicyHarness.cjs')
const policy = loadPolicy(prisma)
const owners: string[] = [], legacyIds: string[] = []
const suffix = randomUUID()
const app = Fastify()
const route = loadSource('routes/prompts.ts', {
  '@/lib/prisma': { prisma }, '@/lib/prompts': policy,
  '@/hooks/requireAuth': { requireAuth: async (request: any, reply: any) => {
    const id = request.headers['x-test-owner']
    if (!id) return reply.status(401).send({ error: 'Unauthorized' })
    request.session = { get: () => id }
  } },
}).default
try {
  // Bootstrap must preserve every preexisting ID, content, link and global flag.
  await policy.ensureTemplatePolicySchema(prisma)
  const before = await prisma.prompt.findMany({ orderBy: { id: 'asc' } })
  await policy.ensureDefaultDocumentTemplates(prisma)
  await policy.ensureDefaultDocumentTemplates(prisma)
  for (const record of before) assert.deepEqual(await prisma.prompt.findUnique({ where: { id: record.id } }), record)
  const natives = await prisma.prompt.findMany({ where: { platformKey: { not: null } } })
  assert.equal(new Set(natives.map(item => item.platformKey)).size, 7)
  for (let i = 0; i < 2; i++) owners.push((await prisma.user.create({ data: { username: `qa-template-${suffix}-${i}`, hashedPassword: 'qa-no-login' } })).id)
  for (const isPublic of [true, false]) legacyIds.push((await prisma.prompt.create({ data: { name: `QA legacy ${isPublic} ${suffix}`, instructions: 'Preserve legacy content exactly', isDefault: isPublic, isPublic } })).id)
  await app.register(route)
  const call = (owner: string | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, payload?: unknown) => app.inject({ method, url: path, headers: owner ? { 'x-test-owner': owner } : {}, payload: payload as any })
  const list = async (owner: string) => (await call(owner, 'GET', '/prompts')).json()
  assert.equal((await call(null, 'GET', '/prompts')).statusCode, 401)
  assert.equal((await list(owners[0])).defaultPromptId, natives.find(item => item.platformKey === 'briefing-v1')!.id, 'A global legacy default must not become a personal preference')
  const ownA = (await call(owners[0], 'POST', '/prompts', { name: `QA A ${suffix}`, instructions: 'Instructions A', isPublic: true })).json().prompt
  const ownB = (await call(owners[1], 'POST', '/prompts', { name: `QA B ${suffix}`, instructions: 'Instructions B' })).json().prompt
  assert.equal(ownA.origin, 'own'); assert.equal(ownA.capabilities.canEdit, true)
  for (const [owner, id] of [[owners[0], ownA.id], [owners[1], ownB.id]]) assert.equal((await call(owner, 'PUT', '/prompts/default', { promptId: id })).statusCode, 200)
  const snapshot = await prisma.prompt.findMany({ orderBy: { id: 'asc' } })
  for (let repeat = 0; repeat < 3; repeat++) {
    assert.equal((await list(owners[0])).defaultPromptId, ownA.id)
    assert.equal((await list(owners[1])).defaultPromptId, ownB.id)
  }
  assert.deepEqual(await prisma.prompt.findMany({ orderBy: { id: 'asc' } }), snapshot, 'GET must not rewrite templates or global defaults')
  assert.equal((await prisma.user.findUnique({ where: { id: owners[0] } }))!.defaultPromptId, ownA.id)
  assert.equal((await prisma.user.findUnique({ where: { id: owners[1] } }))!.defaultPromptId, ownB.id)
  const foreign = (await list(owners[1])).prompts.find((item: any) => item.id === ownA.id)
  assert.equal(foreign.origin, 'shared'); assert.equal(foreign.capabilities.canEdit, false); assert.equal(foreign.capabilities.canDuplicate, true)
  const legacy = (await list(owners[0])).prompts.find((item: any) => item.id === legacyIds[0])
  assert.equal(legacy.origin, 'legacy'); assert.equal(legacy.capabilities.canEdit, false)
  assert.ok(!(await list(owners[0])).prompts.some((item: any) => item.id === legacyIds[1]))
  for (const id of [natives[0].id, ownA.id, ...legacyIds]) {
    assert.equal((await call(owners[1], 'PUT', `/prompts/${id}`, { instructions: 'unauthorized' })).statusCode, 404)
    assert.equal((await call(owners[1], 'DELETE', `/prompts/${id}`)).statusCode, 404)
  }
  assert.equal((await call(owners[0], 'PUT', '/prompts/default', { promptId: ownB.id })).statusCode, 404)
  assert.equal((await call(owners[0], 'POST', '/prompts', { name: 'x'.repeat(81), instructions: 'x' })).statusCode, 400)
  const copy = (await call(owners[1], 'POST', `/prompts/${ownA.id}/duplicate`)).json().prompt
  assert.equal(copy.instructions, 'Instructions A'); assert.equal(copy.ownerId, owners[1]); assert.equal(copy.isPublic, false); assert.equal(copy.platformKey, null)
  assert.equal((await call(owners[1], 'POST', `/prompts/${natives[0].id}/duplicate`)).statusCode, 201)
  assert.equal((await call(owners[1], 'POST', `/prompts/${legacyIds[0]}/duplicate`)).statusCode, 201)
  const session = await prisma.recordingSession.create({ data: { ownerId: owners[1], promptId: ownA.id, status: 'ENDED' } })
  const document = await prisma.document.create({ data: { sessionId: session.id, promptId: ownA.id, content: 'QA retained document', modelUsed: 'qa' } })
  await call(owners[1], 'PUT', '/prompts/default', { promptId: ownA.id })
  assert.equal((await call(owners[0], 'PUT', `/prompts/${ownA.id}`, { isPublic: false })).statusCode, 200)
  let retained = await prisma.recordingSession.findUnique({ where: { id: session.id }, include: { prompt: true } })
  assert.equal(retained!.promptId, ownA.id); assert.equal(policy.canUseTemplate(retained!.prompt, owners[1]), false)
  const hidden = policy.templateResponse(retained!.prompt, owners[1])
  assert.equal(hidden.instructions, ''); assert.equal(hidden.capabilities.canUse, false)
  assert.notEqual((await list(owners[1])).defaultPromptId, ownA.id)
  assert.equal((await prisma.user.findUnique({ where: { id: owners[1] } }))!.defaultPromptId, ownA.id, 'Fallback does not rewrite personal preferences')
  assert.equal((await call(owners[0], 'DELETE', `/prompts/${ownA.id}`)).statusCode, 204)
  retained = await prisma.recordingSession.findUnique({ where: { id: session.id }, include: { prompt: true } })
  assert.equal(retained!.promptId, ownA.id); assert.ok(retained!.prompt!.deletedAt)
  assert.equal(policy.canUseTemplate(retained!.prompt, owners[0]), false)
  assert.equal((await prisma.document.findUnique({ where: { id: document.id } }))!.content, 'QA retained document')
  assert.equal((await call(owners[0], 'POST', `/prompts/${ownA.id}/duplicate`)).statusCode, 404)
  assert.equal((await list(owners[0])).defaultPromptId, natives.find(item => item.platformKey === 'briefing-v1')!.id)
  console.log('Template PostgreSQL: personal defaults, read-only listing, idempotent provisioning, stable origin, ownership, legacy policy, duplication, retained references and deterministic fallback passed')
} finally {
  await app.close()
  try {
    if (owners.length) {
      await prisma.document.deleteMany({ where: { session: { ownerId: { in: owners } } } })
      await prisma.recordingSession.deleteMany({ where: { ownerId: { in: owners } } })
      await prisma.user.updateMany({ where: { id: { in: owners } }, data: { defaultPromptId: null } })
      await prisma.prompt.deleteMany({ where: { OR: [{ ownerId: { in: owners } }, { id: { in: legacyIds } }] } })
      await prisma.user.deleteMany({ where: { id: { in: owners } } })
    }
  } finally { await prisma.$disconnect() }
}
