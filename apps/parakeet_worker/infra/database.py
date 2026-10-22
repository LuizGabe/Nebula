"""
infra/database.py — Pool asyncpg para PostgreSQL.

Usado exclusivamente pelo BatchResultEmitter (path de batch).
Stream não acessa banco no hot path.

Schema relevante (Prisma → PostgreSQL):
  - transcripts:    id (cuid), chunkIndex, text, timestampStart (float/s),
                    timestampEnd (float/s), segments (text), sessionId
                    UNIQUE (sessionId, chunkIndex)
  - session_events: id (cuid), type (SessionEventType enum), payload (json),
                    sessionId — append-only, sem UPDATE (trilha de auditoria)
"""

from __future__ import annotations

import json
import logging
import uuid

log = logging.getLogger("infra.database")

# Mapeamento de status genéricos do worker → SessionEventType do schema
_STATUS_TO_EVENT: dict[str, str] = {
    "ENDED":  "UPLOAD_TRANSCRIBED",
    "FAILED": "UPLOAD_FAILED",
}


class Database:
    """Wrapper fino sobre asyncpg com pool de conexões."""

    def __init__(self, database_url: str) -> None:
        self._url  = database_url
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
            log.info("pool PostgreSQL fechado")

    # ── operações ─────────────────────────────────────────────────────────────

    async def save_transcript(
        self,
        session_id:         str,
        chunk_index:        int,
        full_text:          str,
        timestamp_start_ms: int,
        timestamp_end_ms: int,
        words: list[dict] | None = None,
        speaker_id: str | None = None,
    ) -> None:
        """
        Persiste um segmento de transcrição.

        chunk_index é o índice do segmento dentro da sessão — cada segmento
        do faster-whisper vira uma linha separada na tabela transcripts, o que
        permite ao frontend exibir timestamps individuais por trecho.

        timestamps: inteiros em milissegundos, sem conversão para segundos; compatível com
        o tipo Float do schema Prisma (timestampStart, timestampEnd).
        """
        generated_id    = str(uuid.uuid4())

        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO public.transcripts
                    (id, "chunkIndex", text, "timestampStart", "timestampEnd", "sessionId", words, "speakerId")
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
                ON CONFLICT ("sessionId", "chunkIndex") DO UPDATE
                    SET text             = EXCLUDED.text,
                        "timestampStart" = EXCLUDED."timestampStart",
                        "timestampEnd" = EXCLUDED."timestampEnd",
                        words = EXCLUDED.words, "speakerId" = EXCLUDED."speakerId"
                    WHERE NOT transcripts.edited
                """,
                generated_id,
                chunk_index,
                full_text,
                int(round(timestamp_start_ms)),
                int(round(timestamp_end_ms)),
                session_id,
                json.dumps(words) if words is not None else None,
                speaker_id,)

    async def save_event(self, session_id: str, event_type: str, payload: dict):
        """Insere um evento na tabela session_events (append-only)."""
        import uuid
        generated_id = str(uuid.uuid4())
        payload_json = json.dumps(payload)
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO public.session_events (id, type, payload, "sessionId")
                VALUES ($1, $2, $3, $4)
                """,
                generated_id, event_type, payload_json, session_id
            )

    async def healthcheck(self) -> bool:
        try:
            async with self._pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            return True
        except Exception as exc:
            log.warning("database healthcheck falhou: %s", exc)
            return False

    async def save_waveform(self, storage_key: str, peaks: list[list[float]], duration_ms: int) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute('''UPDATE audio_chunks SET peaks = $2::jsonb, "durationMs" = $3
                                  WHERE "storageKey" = $1''', storage_key, json.dumps(peaks), duration_ms)
