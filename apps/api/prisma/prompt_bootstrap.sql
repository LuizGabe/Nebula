CREATE TABLE IF NOT EXISTS "prompts" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "system_prompt" TEXT,
  "user_template" TEXT,
  "available_variables" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "includeAudioCitations" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isPublic" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ownerId" TEXT
);

ALTER TABLE "prompts"
  ADD COLUMN IF NOT EXISTS "system_prompt" TEXT,
  ADD COLUMN IF NOT EXISTS "user_template" TEXT,
  ADD COLUMN IF NOT EXISTS "available_variables" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "includeAudioCitations" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "ownerId" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prompts' AND column_name = 'content'
  ) THEN
    UPDATE "prompts" SET "system_prompt" = "content" WHERE "system_prompt" IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prompts' AND column_name = 'template'
  ) THEN
    UPDATE "prompts" SET "user_template" = "template" WHERE "user_template" IS NULL;
  END IF;
END $$;


DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prompts' AND column_name = 'content'
  ) THEN
    ALTER TABLE "prompts" ALTER COLUMN "content" DROP NOT NULL;
  END IF;
END $$;

UPDATE "prompts"
SET "available_variables" = '["transcricao", "contexto_sessao", "sessionTitle", "promptName", "createdAt"]'::jsonb
WHERE "available_variables" = '[]'::jsonb;

CREATE TABLE IF NOT EXISTS "folders" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ownerId" TEXT NOT NULL,
  "parentId" TEXT
);

ALTER TABLE "recording_sessions"
  ADD COLUMN IF NOT EXISTS "promptId" TEXT,
  ADD COLUMN IF NOT EXISTS "folderId" TEXT,
  ADD COLUMN IF NOT EXISTS "sessionContext" TEXT,
  ADD COLUMN IF NOT EXISTS "writingStyle" TEXT,
  ADD COLUMN IF NOT EXISTS "userInstructions" TEXT;

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "promptId" TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecordingSessionStatus') THEN
    ALTER TYPE "RecordingSessionStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SessionEventType') THEN
    ALTER TYPE "SessionEventType" ADD VALUE IF NOT EXISTS 'CHUNK_TRANSCRIPTION_PROGRESS';
    ALTER TYPE "SessionEventType" ADD VALUE IF NOT EXISTS 'UPLOAD_TRANSCRIPTION_PROGRESS';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'documents'
      AND column_name = 'type'
      AND udt_name <> 'text'
  ) THEN
    ALTER TABLE "documents"
      ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'recording_sessions'
      AND column_name = 'mode'
  ) THEN
    ALTER TABLE "recording_sessions"
      ALTER COLUMN "mode" DROP NOT NULL,
      ALTER COLUMN "mode" SET DEFAULT 'MEETING';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recording_sessions_promptId_fkey'
  ) THEN
    ALTER TABLE "recording_sessions"
      ADD CONSTRAINT "recording_sessions_promptId_fkey"
      FOREIGN KEY ("promptId") REFERENCES "prompts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_promptId_fkey'
  ) THEN
    ALTER TABLE "documents"
      ADD CONSTRAINT "documents_promptId_fkey"
      FOREIGN KEY ("promptId") REFERENCES "prompts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prompts_ownerId_fkey'
  ) THEN
    ALTER TABLE "prompts"
      ADD CONSTRAINT "prompts_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'folders_ownerId_fkey'
  ) THEN
    ALTER TABLE "folders"
      ADD CONSTRAINT "folders_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'folders_parentId_fkey'
  ) THEN
    ALTER TABLE "folders"
      ADD CONSTRAINT "folders_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "folders"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recording_sessions_folderId_fkey'
  ) THEN
    ALTER TABLE "recording_sessions"
      ADD CONSTRAINT "recording_sessions_folderId_fkey"
      FOREIGN KEY ("folderId") REFERENCES "folders"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "recording_sessions_promptId_idx" ON "recording_sessions"("promptId");
CREATE INDEX IF NOT EXISTS "recording_sessions_folderId_idx" ON "recording_sessions"("folderId");
CREATE INDEX IF NOT EXISTS "documents_promptId_idx" ON "documents"("promptId");
CREATE INDEX IF NOT EXISTS "prompts_ownerId_idx" ON "prompts"("ownerId");
CREATE INDEX IF NOT EXISTS "folders_ownerId_idx" ON "folders"("ownerId");
CREATE INDEX IF NOT EXISTS "folders_parentId_idx" ON "folders"("parentId");
