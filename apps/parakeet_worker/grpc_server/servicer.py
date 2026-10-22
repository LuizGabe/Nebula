"""
grpc_server/servicer.py — Handlers gRPC com janela deslizante (faster-whisper).

Mudanças em relação à versão NeMo:

STREAM:
  - VAD externo (session/vad.py) removido — o faster-whisper tem Silero
    embutido via vad_filter=True.
  - Lógica de janela deslizante implementada aqui no _receive_loop:
      * Inferência periódica a cada INFER_INTERVAL_SEC sobre o buffer acumulado
      * Flush (limpeza total do buffer) quando buffer >= FLUSH_THRESHOLD_SEC
        ou quando end_of_stream chega
  - O buffer NÃO é consumido a cada inferência (janela deslizante) —
    apenas no flush. Isso garante contexto entre janelas consecutivas.
  - Texto consolidado (frase_consolidada) é acumulado por sessão em memória.

BATCH:
  - BatchHandler agora recebe bytes PCM 16kHz (saída do ffmpeg in-memory)
    e chama engine.transcribe_batch() diretamente — sem AudioSplitter.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid

import grpc

from core.config import Config
from core.logging import session_logger
from emit.result_emitter import StreamResultEmitter
from inference.dispatcher import GPUDispatcher
from inference.engine import WhisperInferenceEngine
from observability.metrics import ERRORS_TOTAL, STREAM_LATENCY, get_free_vram_mb
from observability.tracing import session_span
from proto import transcriber_pb2 as pb2
from proto import transcriber_pb2_grpc as pb2_grpc
from session.manager import SessionManager, SessionStatus
from events.service import EventService, EventType
from infra.redis_connection import RedisConnection
from infra.database import Database

log = logging.getLogger("grpc_server.servicer")

# ── constantes de janela deslizante ──────────────────────────────────────────

SAMPLE_RATE = 16_000

# Dispara inferência a cada N segundos sobre o buffer acumulado
INFER_INTERVAL_SEC: float = 2.0

# Flush do buffer (consolida frase) quando acumula >= N segundos
FLUSH_THRESHOLD_SEC: float = 8.0

# Mínimo de áudio para valer a pena inferir (evita chamadas com silêncio puro)
MIN_INFER_SEC: float = 0.5


class TranscriberServicer(pb2_grpc.TranscriberServicer):

    def __init__(
        self,
        config:          Config,
        session_manager: SessionManager,
        engine:          WhisperInferenceEngine,
        dispatcher:      GPUDispatcher,
        redis_conn: RedisConnection,
        event_service:   EventService,
        database: Database
    ) -> None:
        self._config = config
        self._sessions = session_manager
        self._engine = engine
        self._dispatch = dispatcher
        self._emitter = StreamResultEmitter(redis_client=redis_conn, database=database)
        self._event_service = event_service

    # ── TranscribeStream ──────────────────────────────────────────────────────

    async def TranscribeStream(
        self,
        request_iterator,
        context: grpc.aio.ServicerContext,
    ) -> None:
        session_id = f"stream-{uuid.uuid4().hex[:12]}"
        slog = session_logger("grpc_server.servicer", session_id)

        try:
            first_chunk: pb2.AudioChunk = await asyncio.wait_for(
                request_iterator.__anext__(), timeout=10.0
            )
        except (StopAsyncIteration, asyncio.TimeoutError):
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "nenhum chunk recebido")
            return

        if first_chunk.session_id:
            session_id = first_chunk.session_id

        meta = first_chunk.meta
        mode = meta.mode or "MEETING"
        language = meta.language_hint or "pt"

        slog.info("stream iniciado mode=%s language=%s", mode, language)

        await self._event_service.emit(
            session_id, EventType.CHUNK_RECEIVED,
            {"mode": mode, "language": language,
                "chunk_size": len(first_chunk.pcm_data)}
        )

        try:
            session = await self._sessions.create(
                session_id=session_id,
                grpc_context=context,
                mode=mode,
                language_hint=language,
            )
        except RuntimeError as exc:
            slog.warning("sessão rejeitada: %s", exc)
            await context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, str(exc))

            await self._event_service.emit(
                session.id, EventType.CHUNK_FAILED,
                {"error": str(exc), "job_type": "stream"}
            )

            return

        with session_span(session_id, "stream"):
            if first_chunk.pcm_data:
                session.buffer.append(
                    first_chunk.pcm_data, first_chunk.timestamp_ms)
                session.touch()

            try:
                await asyncio.gather(
                    self._receive_loop(
                        session, request_iterator, context, language),
                    self._send_loop(session, context),
                )
            except Exception as exc:
                slog.error("erro no stream: %s", exc, exc_info=True)

                await self._event_service.emit(
                    session.id, EventType.CHUNK_FAILED,
                    {"error": str(exc), "job_type": "stream"}
                )

                ERRORS_TOTAL.labels(
                    layer="servicer", error_type=type(exc).__name__).inc()
            finally:
                await self._sessions.close(session_id, SessionStatus.CLOSED)
                slog.info("stream encerrado")

    async def _receive_loop(
        self,
        session,
        request_iterator,
        context: grpc.aio.ServicerContext,
        language: str,
    ) -> None:
        """
        Consome chunks do cliente com lógica de janela deslizante.

        Não há VAD externo — o faster-whisper aplica Silero internamente.
        A decisão de inferir ou fazer flush é baseada em tempo/tamanho.

        Janela deslizante:
          - A cada INFER_INTERVAL_SEC, infere sobre o buffer COMPLETO atual
            (sem consumir) → resultado parcial enviado ao cliente
          - Quando buffer >= FLUSH_THRESHOLD_SEC → infere + consome (flush)
            → resultado consolidado (frase_consolidada) enviado ao cliente
        """
        slog = session.log
        last_infer_at = time.monotonic()

        async for chunk in request_iterator:
            if context.done():
                break

            session.touch()

            if chunk.end_of_stream:
                slog.info("end_of_stream recebido")
                session.status = SessionStatus.DRAINING
                await self._flush(session, language, is_final=True)
                break

            if not chunk.pcm_data:
                continue

            t_recv = time.monotonic()
            session.buffer.append(chunk.pcm_data, chunk.timestamp_ms)

            buf_sec = session.buffer.duration_sec()
            elapsed = t_recv - last_infer_at

            # Flush: buffer muito grande → consolida frase e limpa
            if buf_sec >= FLUSH_THRESHOLD_SEC:
                slog.debug("flush por tamanho buf_sec=%.1f", buf_sec)
                await self._flush(session, language, is_final=False)
                last_infer_at = time.monotonic()

            # Inferência periódica: janela deslizante sem limpar buffer
            elif elapsed >= INFER_INTERVAL_SEC and buf_sec >= MIN_INFER_SEC:
                slog.debug(
                    "infer periódico buf_sec=%.1f elapsed=%.1f", buf_sec, elapsed)
                await self._infer_window(session, language, t_recv)
                last_infer_at = time.monotonic()

    async def _send_loop(self, session, context: grpc.aio.ServicerContext) -> None:
        while not context.done():
            try:
                msg = await asyncio.wait_for(session.result_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            if msg is None:
                break
            await context.write(msg)

    # ── janela deslizante (parcial — não consome buffer) ──────────────────────

    async def _infer_window(self, session, language: str, t_recv: float) -> None:
        """
        Infere sobre o buffer atual SEM consumi-lo.
        Envia resultado como PARTIAL — o cliente usa para atualizar a UI.
        """
        snapshot = session.buffer.take_snapshot()
        if snapshot is None or snapshot.duration_ms < int(MIN_INFER_SEC * 1000):
            return

        async def _run() -> None:
            await self._event_service.emit(
                session.id, EventType.CHUNK_TRANSCRIPTION_STARTED,
                {"duration_ms": snapshot.duration_ms}
            )

            result = await self._engine.transcribe_stream(
                pcm=snapshot.pcm,
                session_id=session.id,
                audio_offset_ms=snapshot.start_ms,
                language=language,
                job_type="stream",
            )
            if result:
                latency_ms = (time.monotonic() - t_recv) * 1000
                STREAM_LATENCY.observe(latency_ms)

                await self._event_service.emit(
                    session.id, EventType.CHUNK_TRANSCRIBED,
                    {"segments": len(result.segments),
                     "text_preview": result.text[:100]}
                )

                await self._emitter.emit(session, result, is_final=False)

        await self._event_service.emit(
            session.id, EventType.CHUNK_QUEUED,
            {"duration_ms": snapshot.duration_ms, "offset_ms": snapshot.start_ms}
        )

        await self._dispatch.submit_stream(_run)

    # ── flush (consolida frase e limpa buffer) ────────────────────────────────
    async def _flush(self, session, language: str, is_final: bool) -> None:
        """
        Infere sobre o buffer completo, limpa o buffer e envia resultado.
        is_final=True → encerra o send_loop via sentinela None.
        """
        snapshot = session.buffer.drain()

        if snapshot is None:
            if is_final:
                await session.result_queue.put(None)
            return

        async def _run() -> None:
            result = await self._engine.transcribe_stream(
                pcm=snapshot.pcm,
                session_id=session.id,
                audio_offset_ms=snapshot.start_ms,
                language=language,
                job_type="stream",
            )
            if result:
                # Acumula no contexto da sessão (para referência futura)
                session.transcript_ctx.append(result.text)
                
                # Emite via gRPC e Redis
                await self._emitter.emit(session, result, is_final=is_final)
                
                # --- PERSISTÊNCIA NO BANCO ---
                # Incrementa contador de chunks
                session.chunk_counter += 1
                chunk_idx = session.chunk_counter

                # Timestamps do primeiro e último segmento
                start_ms = result.segments[0]["start_ms"] if result.segments else 0
                end_ms = result.segments[-1]["end_ms"] if result.segments else 0

                await self._emitter.persist_flush(
                    session_id=session.id,
                    chunk_index=chunk_idx,
                    text=result.text,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    words=[w for seg in result.segments for w in seg.get("words", [])],
                )
                
            if is_final:
                await session.result_queue.put(None)

        await self._dispatch.submit_stream(_run)

    # ── SubmitBatch ───────────────────────────────────────────────────────────

    async def SubmitBatch(
        self,
        request: pb2.BatchRequest,
        context: grpc.aio.ServicerContext,
    ) -> pb2.BatchAck:

        # Validar campos obrigatórios da request
        required_fields = {
            "session_id": (str, lambda x: len(x) > 0),
            "filename": (str, lambda x: len(x) > 0),
            "storage_key": (str, lambda x: len(x) > 0),
            "mode": (str, lambda x: x in ["CLASS", "MEETING", "LECTURE"]),
        }

        for field, (expected_type, validator) in required_fields.items():
            value = getattr(request, field, None)
            if value is None or not isinstance(value, expected_type) or not validator(value):
                await context.abort(
                    grpc.StatusCode.INVALID_ARGUMENT,
                    f"campo inválido ou ausente: {field}"
                )
                return pb2.BatchAck()

        session_id = request.session_id
        job_id = f"job-{uuid.uuid4().hex}"

        log.info(
            "batch recebido session=%s key=%s filename=%s",
            session_id, request.storage_key, request.filename,
        )

        from batch.handler import BatchHandler
        handler = BatchHandler.get_instance()
        if handler:
            await handler.enqueue(
                job_id=job_id,
                session_id=session_id,
                storage_key=request.storage_key,
                filename=request.filename,
                mode=request.mode or "MEETING",
            )

        return pb2.BatchAck(
            job_id=job_id,
            session_id=session_id,
            queue_position=self._dispatch.batch_queue_size(),
        )

    # ── GetWorkerStatus ───────────────────────────────────────────────────────

    async def GetWorkerStatus(
        self,
        request: pb2.WorkerStatusRequest,
        context: grpc.aio.ServicerContext,
    ) -> pb2.WorkerStatusResponse:
        active = await self._sessions.active_count()
        free_mb = get_free_vram_mb()

        return pb2.WorkerStatusResponse(
            model_ready=self._engine.is_ready,
            engine="faster-whisper",
            model=self._engine.model_name,
            active_sessions=active,
            batch_queue_size=self._dispatch.batch_queue_size(),
            accepting_streams=(active < self._config.max_sessions),
            vram_used_bytes=0,
            vram_total_bytes=0,
        )
