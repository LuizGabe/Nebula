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
