"""
infra/bullmq_client.py — Cliente BullMQ para enfileiramento de pós-processamento.

Usado pelo BatchResultEmitter após finalizar a transcrição de um upload.
Stream não usa BullMQ.
"""

from __future__ import annotations

import json
import logging
import time

import redis.asyncio as aioredis
from events.service import EventService, EventType

log = logging.getLogger("infra.bullmq")

# Prefixo padrão do BullMQ
_BULL_PREFIX = "bull"


class BullMQClient:

    def __init__(self, redis_url: str, queue_name: str, event_service: EventService) -> None:
        self._redis_url  = redis_url
        self._queue_name = queue_name
        self._redis: aioredis.Redis | None = None
        self._event_service: EventService = event_service
    async def connect(self) -> None:
        self._redis = aioredis.from_url(
            self._redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
        log.info("BullMQ client conectado queue=%s", self._queue_name)

    async def disconnect(self) -> None:
        if self._redis:
            await self._redis.aclose()
            log.info("BullMQ client desconectado")

    async def enqueue_post_processing(
        self,
        session_id:   str,
        triggered_by: str = "batch_transcription_done",
    ) -> str:
        """
        Enfileira um job BullMQ no formato nativo (compatível com workers Node.js).
        Retorna o job_id gerado.
        """
        job_id    = f"{session_id}-{int(time.time() * 1000)}"
        job_key   = f"{_BULL_PREFIX}:{self._queue_name}:{job_id}"
        wait_key  = f"{_BULL_PREFIX}:{self._queue_name}:wait"

        job_data = {
            "id":        job_id,
            "name":      "post-process",
            "data":      json.dumps({"sessionId": session_id, "triggeredBy": triggered_by}),
            "opts":      json.dumps({"attempts": 3, "backoff": {"type": "exponential", "delay": 5000}}),
            "timestamp": int(time.time() * 1000),
            "processedOn": "",
            "finishedOn":  "",
            "returnvalue": "",
            "failedReason": "",
            "attemptsMade": "0",
            "stacktrace":   "[]",
        }

        pipe = self._redis.pipeline()
        pipe.hset(job_key, mapping=job_data)
        pipe.rpush(wait_key, job_id)
        await pipe.execute()
        
        await self._event_service.emit(
            session_id, EventType.DOCUMENT_QUEUED,
            {"job_id": job_id, "triggered_by": triggered_by}
        )

        log.info("BullMQ job enfileirado job_id=%s session=%s", job_id, session_id)
        return job_id

    async def healthcheck(self) -> bool:
        try:
            await self._redis.ping()
            return True
        except Exception as exc:
            log.warning("BullMQ healthcheck falhou: %s", exc)
            return False
