import { prisma } from '@/lib/prisma';

export async function ensureSessionStatusSchema() {
  await prisma.$executeRawUnsafe(`ALTER TYPE "RecordingSessionStatus" ADD VALUE IF NOT EXISTS 'ERROR'`);
}
