// Idempotent additive provisioning. Never rewrites templates or session links.
import { prisma } from '../src/lib/prisma'
import { ensureDefaultDocumentTemplates } from '../src/lib/prompts'
try {
  await ensureDefaultDocumentTemplates()
  console.log('Platform templates provisioned; existing content and preferences preserved')
} finally { await prisma.$disconnect() }
