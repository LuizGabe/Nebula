CREATE TABLE IF NOT EXISTS "prompts" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "content" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "recording_sessions"
  ADD COLUMN IF NOT EXISTS "promptId" TEXT;

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "promptId" TEXT;

CREATE TABLE IF NOT EXISTS "folders" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ownerId" TEXT NOT NULL,
  "parentId" TEXT
);

ALTER TABLE "recording_sessions"
  ADD COLUMN IF NOT EXISTS "folderId" TEXT;

ALTER TABLE "prompts"
  ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "ownerId" TEXT;

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
