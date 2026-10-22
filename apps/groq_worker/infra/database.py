from __future__ import annotations

import json
import logging
import uuid

log = logging.getLogger("infra.database")


class Database:
    def __init__(self, database_url: str) -> None:
        self._url = database_url
        self._pool = None

    async def connect(self) -> None:
        import asyncpg

        self._pool = await asyncpg.create_pool(
            self._url,
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
        log.info("pool PostgreSQL conectado")

    async def disconnect(self) -> None:
        if self._pool:
            await self._pool.close()

    async def save_transcript(
        self,
        session_id: str,
        chunk_index: int,
        full_text: str,
        timestamp_start_ms: int,
        timestamp_end_ms: int,
    ) -> None:
        generated_id = str(uuid.uuid4())
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO public.transcripts
                    (id, "chunkIndex", text, "timestampStart", "timestampEnd", "sessionId")
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT ("sessionId", "chunkIndex") DO UPDATE
                    SET text = EXCLUDED.text,
                        "timestampStart" = EXCLUDED."timestampStart",
                        "timestampEnd" = EXCLUDED."timestampEnd"
                """,
                generated_id,
                chunk_index,
                full_text,
                timestamp_start_ms,
                timestamp_end_ms,
                session_id,
            )

    async def save_event(self, session_id: str, event_type: str, payload: dict) -> None:
        generated_id = str(uuid.uuid4())
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO public.session_events (id, type, payload, "sessionId")
                VALUES ($1, $2, $3, $4)
                """,
                generated_id,
                event_type,
                json.dumps(payload),
                session_id,
            )

    async def youtube_session(self, session_id: str, owner_id: str):
        async with self._pool.acquire() as conn:
            return await conn.fetchrow(
                '''SELECT s.id, s.status, u.username,
                          (EXISTS(SELECT 1 FROM documents d WHERE d."sessionId" = s.id)
                           OR EXISTS(SELECT 1 FROM session_events e WHERE e."sessionId" = s.id
                                     AND e.type = 'UPLOAD_TRANSCRIBED')) AS completed
                   FROM recording_sessions s JOIN users u ON u.id = s."ownerId"
                   WHERE s.id = $1 AND s."ownerId" = $2 AND NOT s."isDeleted"''',
                session_id, owner_id,
            )

    async def register_youtube_audio(self, session_id: str, storage_key: str, duration_ms: int) -> None:
        async with self._pool.acquire() as conn:
            # Deterministic media id and key make a redelivered job reuse the same object.
            await conn.execute(
                '''INSERT INTO audio_chunks
                     (id, "sessionId", "storageKey", source, status, "timestampStart", "timestampEnd")
                   SELECT $1, id, $3, 'UPLOAD', 'PROCESSING', 0, $4
                   FROM recording_sessions WHERE id = $2 AND NOT "isDeleted"
                   ON CONFLICT (id) DO UPDATE SET status = 'PROCESSING', "timestampEnd" = EXCLUDED."timestampEnd"''',
                f"youtube-{session_id}", session_id, storage_key, duration_ms,
            )

    async def set_youtube_title_if_empty(self, session_id: str, owner_id: str, title: str) -> None:
        title = title.strip()[:120]
        if not title:
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                '''UPDATE recording_sessions SET title = $3, "updatedAt" = CURRENT_TIMESTAMP
                   WHERE id = $1 AND "ownerId" = $2 AND NOT "isDeleted"
                     AND btrim(COALESCE(title, '')) = '' ''', session_id, owner_id, title,
            )

    async def youtube_audio_exists(self, session_id: str):
        async with self._pool.acquire() as conn:
            return await conn.fetchrow(
                '''SELECT "storageKey", "timestampEnd" FROM audio_chunks
                   WHERE id = $1 AND status IN ('PROCESSING', 'TRANSCRIBED')''',
                f"youtube-{session_id}",
            )

    async def fail_youtube_session(self, session_id: str) -> None:
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    '''UPDATE recording_sessions SET status = 'ERROR', "updatedAt" = CURRENT_TIMESTAMP
                       WHERE id = $1 AND NOT "isDeleted"''', session_id,
                )
                await conn.execute(
                    "UPDATE audio_chunks SET status = 'FAILED' WHERE id = $1", f"youtube-{session_id}",
                )
