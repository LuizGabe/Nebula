-- Additive template policy migration. Does not claim legacy origin or infer preferences.
ALTER TABLE "prompts" ADD COLUMN IF NOT EXISTS "platformKey" TEXT, ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "prompts_platformKey_key" ON "prompts"("platformKey");
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "defaultPromptId" TEXT;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_defaultPromptId_fkey') THEN
  ALTER TABLE "users" ADD CONSTRAINT "users_defaultPromptId_fkey" FOREIGN KEY ("defaultPromptId") REFERENCES "prompts"(id) ON DELETE SET NULL;
END IF; END $$;
