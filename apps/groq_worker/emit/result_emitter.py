from __future__ import annotations

import json
import logging

log = logging.getLogger("emit.result_emitter")


class BatchResultEmitter:
    def __init__(self, database: object, bullmq: object, redis_client: object) -> None:
        self._db = database
        self._bullmq = bullmq
        self._redis = redis_client

    async def emit_segment(
        self,
        session_id: str,
        chunk_index: int,
        text: str,
        timestamp_start: int,
        timestamp_end: int,
    ) -> None:
        if not text.strip():
            return

        await self._db.save_transcript(
            session_id=session_id,
            chunk_index=chunk_index,
            full_text=text,
            timestamp_start_ms=timestamp_start,
            timestamp_end_ms=timestamp_end,
        )
        await self._redis.publish(
            channel=f"session:transcription:{session_id}",
            message=json.dumps(
                {
                    "text": text,
                    "segment": {"start_ms": timestamp_start, "end_ms": timestamp_end},
                    "is_final": False,
                    "chunk_index": chunk_index,
                }
            ),
        )

    async def finalize(self, session_id: str, total_chunks: int, saved_chunks: int, total_sec: float) -> None:
        await self._bullmq.enqueue_post_processing(
            session_id=session_id,
            triggered_by="batch_transcription_done",
        )
        await self._redis.publish(
            channel=f"session:transcription:{session_id}",
            message=json.dumps({"status": "completed", "saved_chunks": saved_chunks}),
        )
        log.info(
            "batch finalizado session=%s chunks=%d/%d duration=%.1fs",
            session_id,
            saved_chunks,
            total_chunks,
            total_sec,
        )
