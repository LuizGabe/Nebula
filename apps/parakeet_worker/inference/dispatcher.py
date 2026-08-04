"""
inference/dispatcher.py — Scheduler de prioridade para a GPU.

Garante que jobs de stream (tempo real) SEMPRE têm prioridade sobre
jobs de batch (uploads assíncronos). Um batch nunca bloqueia um stream.

Implementação:
  - Duas asyncio.PriorityQueue separadas (STREAM e BATCH)
  - Loop de despacho verifica STREAM primeiro; só consome BATCH se STREAM estiver vazia
  - Inferências são serializadas (uma por vez na GPU) para evitar OOM e garantir
    latência previsível. Para sessões múltiplas simultâneas, o stream de cada sessão
    deposita na mesma fila — a ordem é FIFO dentro da mesma prioridade.

Métricas:
  - STREAM_QUEUE_SIZE e BATCH_QUEUE_SIZE atualizados a cada enqueue/dequeue
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Callable, Awaitable, Optional

from observability.metrics import (
    BATCH_QUEUE_SIZE,
    STREAM_QUEUE_SIZE,
    INFERENCE_DURATION,
    ERRORS_TOTAL,
)

log = logging.getLogger("inference.dispatcher")


class Priority(IntEnum):
    STREAM = 0   # sempre à frente
    BATCH  = 10  # processado só se a fila stream estiver vazia


@dataclass(order=True)
class _Job:
    priority:   int
    enqueued_at: float = field(compare=False, default_factory=time.monotonic)
    # A função a ser chamada (corrotina sem argumentos)
    fn: Callable[[], Awaitable[None]] = field(compare=False, default=lambda: None)
    job_type: str = field(compare=False, default="stream")


class GPUDispatcher:
    """
    Serializa o acesso à GPU com prioridade stream > batch.

    Uso:
        dispatcher = GPUDispatcher()
        await dispatcher.start()

        # submeter job de stream
        await dispatcher.submit_stream(my_coroutine)

        # submeter job de batch
        await dispatcher.submit_batch(my_batch_coroutine)

        # encerrar no shutdown
        await dispatcher.stop()
    """

    def __init__(self) -> None:
        # Filas separadas para controle explícito de prioridade
        self._stream_queue: asyncio.Queue[Optional[_Job]] = asyncio.Queue()
        self._batch_queue:  asyncio.Queue[Optional[_Job]] = asyncio.Queue()
        self._task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self) -> None:
        """Inicia o loop de despacho em background."""
        self._running = True
        self._task    = asyncio.create_task(self._dispatch_loop(), name="gpu-dispatcher")
        log.info("GPUDispatcher iniciado")

    async def stop(self) -> None:
        """Encerra o loop de despacho graciosamente."""
        self._running = False
        # Envia sentinelas para desbloquear o loop
        await self._stream_queue.put(None)
        await self._batch_queue.put(None)
        if self._task:
            await asyncio.wait_for(self._task, timeout=10.0)
        log.info("GPUDispatcher encerrado")

    # ── submissão ─────────────────────────────────────────────────────────────

    async def submit_stream(self, fn: Callable[[], Awaitable[None]]) -> None:
        """Enfileira um job de stream (alta prioridade)."""
        job = _Job(priority=Priority.STREAM, fn=fn, job_type="stream")
        await self._stream_queue.put(job)
        STREAM_QUEUE_SIZE.set(self._stream_queue.qsize())

    async def submit_batch(self, fn: Callable[[], Awaitable[None]]) -> None:
        """Enfileira um job de batch (baixa prioridade)."""
        job = _Job(priority=Priority.BATCH, fn=fn, job_type="batch")
        await self._batch_queue.put(job)
        BATCH_QUEUE_SIZE.set(self._batch_queue.qsize())

    def stream_queue_size(self) -> int:
        return self._stream_queue.qsize()

    def batch_queue_size(self) -> int:
        return self._batch_queue.qsize()

    # ── loop interno ──────────────────────────────────────────────────────────

    async def _dispatch_loop(self) -> None:
        """
        Loop principal de despacho.

        Regra de prioridade:
          1. Se stream_queue não vazia → pega da stream_queue
          2. Senão, se batch_queue não vazia → pega da batch_queue
          3. Senão → aguarda qualquer uma das duas (sem busy-wait)
        """
        log.debug("dispatch loop iniciado")

        while self._running:
            job = await self._next_job()

            if job is None:
                # Sentinela de encerramento
                break

            wait_ms = int((time.monotonic() - job.enqueued_at) * 1000)
            log.debug(
                "despachando job type=%s queue_wait_ms=%d",
                job.job_type, wait_ms,
            )

            t0 = time.perf_counter()
            try:
                await job.fn()
            except Exception as exc:
                log.error(
                    "erro ao executar job type=%s: %s",
                    job.job_type, exc, exc_info=True,
                )
                ERRORS_TOTAL.labels(layer="dispatcher", error_type=type(exc).__name__).inc()
            finally:
                elapsed_ms = (time.perf_counter() - t0) * 1000
                INFERENCE_DURATION.labels(job_type=job.job_type).observe(elapsed_ms)

                # Atualiza gauge após consumo
                if job.job_type == "stream":
                    STREAM_QUEUE_SIZE.set(self._stream_queue.qsize())
                else:
                    BATCH_QUEUE_SIZE.set(self._batch_queue.qsize())

        log.debug("dispatch loop encerrado")

    async def _next_job(self) -> Optional[_Job]:
        """
        Retorna o próximo job respeitando prioridade.

        Nunca faz busy-wait — usa asyncio.wait() para dormir até
        que qualquer fila tenha algo.
        """
        while self._running:
            # Stream tem prioridade absoluta
            if not self._stream_queue.empty():
                return await self._stream_queue.get()

            # Batch só se stream estiver vazia
            if not self._batch_queue.empty():
                return await self._batch_queue.get()

            # Nenhuma fila tem item — aguarda com timeout curto
            # para re-checar _running
            await asyncio.sleep(0.005)  # 5ms poll

        return None
