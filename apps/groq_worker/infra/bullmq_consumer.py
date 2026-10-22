from __future__ import annotations

import logging
from typing import Optional

from bullmq import Worker

log = logging.getLogger("infra.bullmq_consumer")


class BullMQConsumer:
    def __init__(self, redis_url: str, queue_name: str, batch_handler: object, youtube_handler=None) -> None:
        self._redis_url = redis_url
        self._queue_name = queue_name
        self._handler = batch_handler
        self._youtube_handler = youtube_handler
        self._worker: Optional[Worker] = None

    async def start(self, concurrency: int = 1) -> None:
        self._worker = Worker(
            self._queue_name,
            self._process,
            {"connection": self._redis_url, "concurrency": max(1, concurrency)},
        )
        log.info("BullMQ worker iniciado queue=%s concurrency=%d", self._queue_name, concurrency)

    async def stop(self) -> None:
        if self._worker:
            await self._worker.close()

    async def _process(self, job, token: str):
        data = job.data or {}
        if job.name == "ingest-youtube":
            if not self._youtube_handler:
                raise RuntimeError("YouTube handler nao configurado")
            return await self._youtube_handler.process(job.id, data)
        session_id = data.get("sessionId") or job.id
        storage_key = data.get("storageKey")
        filename = data.get("filename", "")
        mode = data.get("mode") or "MEETING"
        language = data.get("language") or "pt"

        if not storage_key:
            raise ValueError("job sem storageKey")

        log.info(
            "job recebido queue=%s job_id=%s session=%s filename=%s storage_key=%s",
            self._queue_name,
            job.id,
            session_id,
            filename,
            storage_key,
        )

        await self._handler.enqueue(
            job_id=job.id,
            session_id=session_id,
            storage_key=storage_key,
            filename=filename,
            mode=mode,
            language=language,
        )
        return {"accepted": True}
