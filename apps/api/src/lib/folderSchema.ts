import { prisma } from '@/lib/prisma';

// Additive and safe to repeat; existing notebooks receive the neutral default.
export async function ensureFolderColorSchema() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT 'neutral'`);
}
