import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import dotenv from 'dotenv'

dotenv.config({ path: '../../.env', quiet: true })
const url = new URL(process.env.DATABASE_URL!)
assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(url.hostname), 'Integration test is restricted to a local database')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href }) })
const owners: string[] = []
const require = createRequire(import.meta.url)
try {
  await prisma.$executeRawUnsafe(`ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT 'neutral'`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT 'neutral'`)
  for (let index = 0; index < 2; index++) {
    const user = await prisma.user.create({ data: { username: `qa-library-${randomUUID()}`, hashedPassword: 'integration-test-no-login' } })
    owners.push(user.id)
  }
  const legacy = await prisma.$queryRawUnsafe<{ id: string; color: string }[]>(`INSERT INTO "folders" (id, name, "ownerId") VALUES ($1, 'QA legacy', $2) RETURNING id, color`, randomUUID(), owners[0])
  assert.equal(legacy[0].color, 'neutral')
  await prisma.folder.delete({ where: { id: legacy[0].id } })
  await require('./folderRoutesHarness.cjs').checkFolders(prisma, owners)
  console.log('PostgreSQL integration: additive migration is repeatable and old inserts receive the neutral default')
} finally {
  try {
    if (owners.length) {
      await prisma.recordingSession.deleteMany({ where: { ownerId: { in: owners } } })
      await prisma.folder.deleteMany({ where: { ownerId: { in: owners } } })
      await prisma.user.deleteMany({ where: { id: { in: owners } } })
    }
  } finally { await prisma.$disconnect() }
}
