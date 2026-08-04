"""
infra/bullmq_consumer.py — Consumer BullMQ para jobs de transcrição assíncrona.

Usa o pacote `bullmq` (porte Python oficial, mesmos scripts Lua do BullMQ
Node) — locks, stalled jobs, retries e backoff são tratados pela lib.

Contrato esperado em job.data (JSON):
    {
        "sessionId":  str,
        "storageKey": str,   # chave do objeto no MinIO/S3
        "filename":   str,
        "mode":       str,   # "MEETING" | "CLASS" (default "MEETING")
        "language":   str    # default "pt"
    }

Semântica de conclusão:
  - O job é marcado `completed` quando o processor retorna sem exceção, ou
    seja, quando o BatchHandler ACEITA o job na sua fila interna — equivalente
    ao BatchAck retornado pelo RPC SubmitBatch. O resultado real da
    transcrição é persistido no Postgres pelo BatchResultEmitter,
    independentemente.
  - Levantar exceção no processor faz a lib registrar `failedReason` e
    re-agendar o job conforme `opts.attempts` / `opts.backoff` definidos
    pelo producer — sem lógica extra aqui.
"""

from __future__ import annotations

import logging
from typing import Optional

from bullmq import Worker

from core.logging import session_logger
from observability.metrics import ERRORS_TOTAL

log = logging.getLogger("infra.bullmq_consumer")


class BullMQConsumer:
    """
    Wrapper fino sobre bullmq.Worker — encaminha jobs para o BatchHandler.

    Uso:
        consumer = BullMQConsumer(redis_url, queue_name, batch_handler)
        await consumer.start(concurrency=1)
        ...
        await consumer.stop()
    """

    def __init__(self, redis_url: str, queue_name: str, batch_handler: object) -> None:
        self._redis_url = redis_url
        self._queue_name = queue_name
        self._handler = batch_handler
        self._worker: Optional[Worker] = None

    async def start(self, concurrency: int = 1) -> None:
        """Cria o Worker e começa a processar jobs em background."""
        self._worker = Worker(
            self._queue_name,
            self._process,
            {
                "connection": self._redis_url,
                "concurrency": max(1, concurrency),
            },
        )
        log.info(
            "BullMQ worker iniciado queue=%s concurrency=%d",
            self._queue_name, concurrency,
        )

    async def stop(self) -> None:
        if self._worker:
            await self._worker.close()
            log.info("BullMQ worker encerrado queue=%s", self._queue_name)

    # ── processor ─────────────────────────────────────────────────────────────

    async def _process(self, job, token: str):
        data = job.data or {}

        session_id  = data.get("sessionId") or job.id
        storage_key = data.get("storageKey")
        filename    = data.get("filename", "")
        mode        = data.get("mode") or "MEETING"
        language    = data.get("language") or "pt"

        slog = session_logger("infra.bullmq_consumer", session_id)

        if not storage_key:
            slog.error("job_id=%s sem storageKey", job.id)
            ERRORS_TOTAL.labels(layer="bullmq_consumer", error_type="missing_storage_key").inc()
            raise ValueError("job sem storageKey")

        slog.info(
            "job recebido da fila %s job_id=%s key=%s filename=%s mode=%s",
            self._queue_name, job.id, storage_key, filename, mode,
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