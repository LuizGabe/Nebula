import { prisma } from '@/lib/prisma';

// Additive bootstrap: legacy Float columns remain, new writes use integer ms.
export async function ensureTranscriptSchema() {
  await prisma.$executeRawUnsafe(`ALTER TABLE transcripts
    ADD COLUMN IF NOT EXISTS words JSONB,
    ADD COLUMN IF NOT EXISTS "speakerId" TEXT,
    ADD COLUMN IF NOT EXISTS edited BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "originalText" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE recording_sessions
    ADD COLUMN IF NOT EXISTS "speakerNames" JSONB,
    ADD COLUMN IF NOT EXISTS insights JSONB`);
  await prisma.$executeRawUnsafe(`ALTER TABLE audio_chunks
    ADD COLUMN IF NOT EXISTS peaks JSONB,
    ADD COLUMN IF NOT EXISTS "durationMs" INTEGER`);
}
