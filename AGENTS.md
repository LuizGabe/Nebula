## Stack

- Use `pnpm@9` workspaces; keep Node code in TypeScript ESM.
- API: Fastify, Prisma 7 with `@prisma/adapter-pg`, Zod, BullMQ, Redis, MinIO/S3, secure sessions.
- Web: React 18, Vite, Tailwind, Zustand, `lucide-react`; keep API calls in `apps/web/src/api/client.ts`.
- Workers: Python async services for Groq batch and Parakeet/faster-whisper gRPC; keep infra/event/batch/inference concerns separated.

## Commands

- Install: `pnpm install`.
- Dev stack: `docker compose -f docker-compose.dev.yml up -d --build`.
- Production-like local stack: `docker compose up -d --build`; add `--profile parakeet` for Parakeet.
- Node dev: `pnpm dev`, or `pnpm --filter api dev` / `pnpm --filter nebula-frontend dev`.
- Build/typecheck: `pnpm build`; scoped: `pnpm --filter api build`, `pnpm --filter nebula-frontend build`.
- API seed: `pnpm --filter api db:seed`.
- Prisma: from `apps/api`, run `pnpm exec prisma generate` and `pnpm exec prisma validate`.
- API smoke test: `pnpm --filter api exec tsx tests/documentGeneration.test.ts`.
- Groq worker tests: from `apps/groq_worker`, run `python -m pytest`.
- No ESLint/Prettier/Ruff/Mypy scripts are configured; do not invent them in completion notes.

## Architecture

- Preserve flow: Web `client.ts` -> Fastify routes -> `lib/*`/`jobs/*`/`events/*` -> Prisma/Redis/MinIO/workers.
- Keep HTTP/session ownership checks in routes. Use `requireAuth`; query user-owned records with `ownerId` and respect `isDeleted`.
- Validate external request bodies/params with local Zod schemas in each route file.
- Put LLM prompt assembly and document-template logic in `apps/api/src/lib/prompts.ts`; do not duplicate prompt text in routes.
- Emit pipeline status through `createEventPublisher()`: persist `SessionEvent` and publish Redis `session:status:<id>`.
- Queue document generation on BullMQ `post-processing`; queue upload transcription on `transcription-jobs`.
- Keep gRPC contract synchronized between `apps/api/src/proto/transcriber.proto` and `apps/parakeet_worker/proto/transcriber.proto`; regenerate Python stubs with `apps/parakeet_worker/scripts/compile_proto.sh`.

## Database

- Treat `apps/api/prisma/schema.prisma` as the Prisma model source; generated client output is `apps/api/src/generated/prisma`.
- This repo has no Prisma migrations directory. Existing schema evolution is conservative SQL in `apps/api/prisma/prompt_bootstrap.sql` plus startup helpers in `lib/prompts.ts`.
- Do not drop or rename persisted columns casually; preserve old session/document/prompt data and use `ADD COLUMN IF NOT EXISTS`-style migrations when matching current patterns.
- Prompts are DB records, not shared files. Preserve public/private visibility and owner checks.

## API Conventions

- Import API internals through `@/*`; keep ESM `.js` suffix where existing imports use it.
- Return compact JSON errors shaped as `{ error: ... }`; use 400 for validation, 401 for auth, 404 for missing owned records, 409 for conflicts.
- Use `request.session.get("userId")` after `requireAuth`; sessions are cookie-based via `@fastify/secure-session`.
- For SSE, set credentials on the web side and preserve current `data: JSON.stringify(...)` event shape.
- Use `formatAudioTag()` for transcript timestamps passed into LLM prompts.

## Web Conventions

- Add backend endpoints/types to `apps/web/src/api/client.ts` before using them in pages/components.
- Use existing UI primitives in `components/ui` and Tailwind tokens from `tailwind.config.js` (`ink`, `jade`, `amber`, `rose`).
- Use `lucide-react` icons and existing `Button`, `Badge`, `Spinner` patterns.
- Keep auth state in `useAuthStore`; unauthenticated API responses redirect through `client.ts`.

## Workers

- Keep worker code async and dependency-injected through existing `core`, `infra`, `events`, `batch`, `inference`, `observability` modules.
- Groq worker handles batch transcription and audio preprocessing; Parakeet worker handles streaming gRPC and GPU inference.
- Preserve event names shared with Prisma enum `SessionEventType` and frontend status consumers.

## Verification

Before finishing relevant changes:
- Node/API/Web: `pnpm build` or the narrow `pnpm --filter ... build`.
- Prompt/document logic: `pnpm --filter api exec tsx tests/documentGeneration.test.ts`.
- Groq worker logic: `python -m pytest` from `apps/groq_worker`.
- Prisma changes: `pnpm exec prisma validate` and `pnpm exec prisma generate` from `apps/api`.
