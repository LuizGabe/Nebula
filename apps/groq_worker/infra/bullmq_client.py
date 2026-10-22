from __future__ import annotations

import logging
import uuid

from bullmq import Queue

from events.enums import EventType

log = logging.getLogger("infra.bullmq_client")


class BullMQClient:
    def __init__(self, redis_url: str, queue_name: str, event_service: object) -> None:
        self._redis_url = redis_url
        self._queue_name = queue_name
        self._event_service = event_service
        self._queue: Queue | None = None

    async def connect(self) -> None:
        self._queue = Queue(self._queue_name, {"connection": self._redis_url})

    async def disconnect(self) -> None:
        if self._queue:
            await self._queue.close()

    async def enqueue_post_processing(
        self,
        session_id: str,
        triggered_by: str = "batch_transcription_done",
    ) -> str:
        if not self._queue:
            raise RuntimeError("BullMQClient nao conectado")

        job_id = f"session-{session_id}" if triggered_by == "batch_transcription_done" else f"{session_id}-{uuid.uuid4()}"
        await self._queue.add("post-process", {"sessionId": session_id, "triggeredBy": triggered_by}, {
            "jobId": job_id, "attempts": 3, "backoff": {"type": "exponential", "delay": 5000},
            "removeOnComplete": {"count": 100}, "removeOnFail": {"count": 50},
        })
        await self._event_service.emit(
            session_id,
            EventType.DOCUMENT_QUEUED,
            {"job_id": job_id, "triggered_by": triggered_by},
        )
        log.info("BullMQ post-process enfileirado job_id=%s session=%s", job_id, session_id)
        return job_id
