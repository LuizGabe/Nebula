CREATE TABLE IF NOT EXISTS "prompts" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "instructions" TEXT,
  "formality" TEXT NOT NULL DEFAULT 'neutral',
  "detailLevel" TEXT NOT NULL DEFAULT 'balanced',
  "useTitle" BOOLEAN NOT NULL DEFAULT true,
  "useHeadings" BOOLEAN NOT NULL DEFAULT true,
  "useSubheadings" BOOLEAN NOT NULL DEFAULT true,
  "preferLists" BOOLEAN NOT NULL DEFAULT true,
  "preferTables" BOOLEAN NOT NULL DEFAULT false,
  "includeAudioCitations" BOOLEAN NOT NULL DEFAULT true,
  "transcriptionMode" TEXT NOT NULL DEFAULT 'MEETING',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isPublic" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ownerId" TEXT
);

ALTER TABLE "prompts"
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "instructions" TEXT,
  ADD COLUMN IF NOT EXISTS "formality" TEXT NOT NULL DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS "detailLevel" TEXT NOT NULL DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS "useTitle" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "useHeadings" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "useSubheadings" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "preferLists" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "preferTables" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "includeAudioCitations" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "transcriptionMode" TEXT NOT NULL DEFAULT 'MEETING',
  ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "ownerId" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Best-effort migration from the short-lived placeholder template model.
-- We intentionally remove old placeholders and transcript/context blocks because
-- the Nebula backend now injects transcript and session context automatically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prompts' AND column_name = 'user_template'
  ) THEN
    UPDATE "prompts"
    SET "instructions" = btrim(regexp_replace(
      regexp_replace(
        regexp_replace("user_template", '<dados_usuario_input[\s\S]*?</dados_usuario_input>', '', 'gi'),
        '\{\{\s*(transcricao|contexto_sessao|sessionTitle|promptName|createdAt)\s*\}\}',
        '',
        'gi'
      ),
      '</?[^>]+>',
      '',
      'g'
    ))
    WHERE "instructions" IS NULL OR btrim("instructions") = '';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prompts' AND column_name = 'content'
  ) THEN
    UPDATE "prompts"
    SET "instructions" = "content"
    WHERE ("instructions" IS NULL OR btrim("instructions") = '') AND "content" IS NOT NULL;
  END IF;
END $$;

UPDATE "prompts"
SET "instructions" = 'Gere um documento claro, organizado e util em portugues brasileiro com base na transcricao da sessao.'
WHERE "instructions" IS NULL OR btrim("instructions") = '';

ALTER TABLE "prompts"
  ALTER COLUMN "instructions" SET NOT NULL;

ALTER TABLE "prompts"
  DROP COLUMN IF EXISTS "system_prompt",
  DROP COLUMN IF EXISTS "user_template",
  DROP COLUMN IF EXISTS "available_variables",
  DROP COLUMN IF EXISTS "content",
  DROP COLUMN IF EXISTS "template";

CREATE TABLE IF NOT EXISTS "folders" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ownerId" TEXT NOT NULL,
  "parentId" TEXT
);

ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT 'neutral';

ALTER TABLE "recording_sessions"
  ADD COLUMN IF NOT EXISTS "promptId" TEXT,
  ADD COLUMN IF NOT EXISTS "folderId" TEXT,
  ADD COLUMN IF NOT EXISTS "sessionContext" TEXT,
  ADD COLUMN IF NOT EXISTS "formalityOverride" TEXT,
  ADD COLUMN IF NOT EXISTS "detailLevelOverride" TEXT,
  ADD COLUMN IF NOT EXISTS "useTitleOverride" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "useHeadingsOverride" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "useSubheadingsOverride" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "preferListsOverride" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "preferTablesOverride" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "includeAudioCitationsOverride" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "instructionsOverride" TEXT,
  ADD COLUMN IF NOT EXISTS "transcriptionModeOverride" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'recording_sessions' AND column_name = 'userInstructions'
  ) THEN
    UPDATE "recording_sessions"
    SET "instructionsOverride" = "userInstructions"
    WHERE ("instructionsOverride" IS NULL OR btrim("instructionsOverride") = '')
      AND "userInstructions" IS NOT NULL
      AND btrim("userInstructions") <> '';
  END IF;
END $$;

ALTER TABLE "recording_sessions"
  DROP COLUMN IF EXISTS "writingStyle",
  DROP COLUMN IF EXISTS "userInstructions";

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "promptId" TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecordingSessionStatus') THEN
    ALTER TYPE "RecordingSessionStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
    ALTER TYPE "RecordingSessionStatus" ADD VALUE IF NOT EXISTS 'ERROR';
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
