from __future__ import annotations

import json
import logging
import time

import redis.asyncio as aioredis

from events.enums import EventType

log = logging.getLogger("infra.bullmq_client")
_BULL_PREFIX = "bull"


class BullMQClient:
    def __init__(self, redis_url: str, queue_name: str, event_service: object) -> None:
        self._redis_url = redis_url
        self._queue_name = queue_name
        self._event_service = event_service
        self._redis: aioredis.Redis | None = None

    async def connect(self) -> None:
        self._redis = aioredis.from_url(self._redis_url, encoding="utf-8", decode_responses=True)

    async def disconnect(self) -> None:
        if self._redis:
            await self._redis.aclose()

    async def enqueue_post_processing(
        self,
        session_id: str,
        triggered_by: str = "batch_transcription_done",
    ) -> str:
        if not self._redis:
            raise RuntimeError("BullMQClient nao conectado")

        job_id = f"{session_id}-{int(time.time() * 1000)}"
        job_key = f"{_BULL_PREFIX}:{self._queue_name}:{job_id}"
        wait_key = f"{_BULL_PREFIX}:{self._queue_name}:wait"

        job_data = {
            "id": job_id,
            "name": "post-process",
            "data": json.dumps({"sessionId": session_id, "triggeredBy": triggered_by}),
            "opts": json.dumps({"attempts": 3, "backoff": {"type": "exponential", "delay": 5000}}),
            "timestamp": int(time.time() * 1000),
            "processedOn": "",
            "finishedOn": "",
            "returnvalue": "",
            "failedReason": "",
            "attemptsMade": "0",
            "stacktrace": "[]",
        }

        pipe = self._redis.pipeline()
        pipe.hset(job_key, mapping=job_data)
        pipe.rpush(wait_key, job_id)
        await pipe.execute()
        await self._event_service.emit(
            session_id,
            EventType.DOCUMENT_QUEUED,
            {"job_id": job_id, "triggered_by": triggered_by},
        )
        log.info("BullMQ post-process enfileirado job_id=%s session=%s", job_id, session_id)
        return job_id
