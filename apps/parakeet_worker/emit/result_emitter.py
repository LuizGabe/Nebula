"""
emit/result_emitter.py — Emissão de resultados de transcrição.

Stream:  envia TranscriptResult diretamente para o cliente via result_queue da sessão
Batch:   persiste no PostgreSQL e enfileira pós-processamento no BullMQ

Não acessa Redis pub/sub — o canal de retorno é o próprio gRPC bidirecional.
"""

from __future__ import annotations

import logging
from typing import Optional

from core.logging import session_logger
from inference.engine import InferenceResult
from observability.metrics import ERRORS_TOTAL
from infra.redis_connection import RedisConnection
from infra.database import Database
from infra.bullmq_client import BullMQClient

import json

log = logging.getLogger("emit.result_emitter")


class StreamResultEmitter:
    """
    Enfileira resultados na result_queue da sessão para que o servicer
    gRPC os envie ao cliente.

    O servicer faz `async for result in session.result_queue` e envia
    cada item via `context.write()` no stream bidirecional.
    """
    
    def __init__(self, redis_client: RedisConnection, database: Database):
        self._redis = redis_client
        self._db = database

    async def emit(
        self,
        session: object,          # Session (evita import circular)
        result: InferenceResult,
        is_final: bool = False,
    ) -> None:
        try:
            from proto.transcriber_pb2 import TranscriptResult, Segment, ResultType

            segments = [
                Segment(
                    text=s["text"],
                    start_ms=s["start_ms"],
                    end_ms=s["end_ms"],
                )
                for s in result.segments
            ]
            
            segments_jsonable = [
                {"text": s["text"], "start_ms": s["start_ms"], "end_ms": s["end_ms"]}
                for s in result.segments
            ]

            msg = TranscriptResult(
                session_id=session.id,
                text=result.text,
                segments=segments,
                inference_ms=result.inference_ms,
                is_final=is_final,
                result_type=ResultType.FINAL if is_final else ResultType.PARTIAL,
            )

            await session.result_queue.put(msg)
            
            try:
                channel = f"session:transcription:{session.id}"
                await self._redis.publish(
                    channel=channel,
                    message=json.dumps({
                        "text": result.text,
                        "segments": segments_jsonable,
                        "is_final": is_final,
                        "inference_ms": result.inference_ms,
                    })
                )
            except Exception as exc:
                log.warning("Falha ao publicar transcrição no Redis: %s", exc)

            slog = session_logger("emit.stream", session.id)
            slog.info(
                "resultado enfileirado is_final=%s seg=%d preview=%r",
                is_final, len(result.segments), result.text[:60],
            )
        except Exception as exc:
            log.error(
                "falha ao enfileirar resultado session=%s: %s",
                session.id, exc, exc_info=True,
            )
            ERRORS_TOTAL.labels(layer="emitter", error_type=type(exc).__name__).inc()

    async def persist_flush(
        self,
        session_id: str,
        chunk_index: int,
        text: str,
        start_ms: int,
        end_ms: int,
    ) -> None:
        """
        Salva um bloco consolidado (flush) no banco de dados.
        """
        if not text.strip():
            return
        try:
            await self._db.save_transcript(
                session_id=session_id,
                chunk_index=chunk_index,
                full_text=text,
                timestamp_start_ms=start_ms,
                timestamp_end_ms=end_ms,
            )
            log.debug("Flush persistido session=%s chunk=%d", session_id, chunk_index)
        except Exception as exc:
            log.error(
                "Falha ao persistir flush session=%s chunk=%d: %s",
                session_id, chunk_index, exc, exc_info=True,
            )
            ERRORS_TOTAL.labels(layer="stream_emitter", error_type="persist_flush").inc()


class BatchResultEmitter:
    """
    Persiste transcrições de uploads no PostgreSQL e dispara BullMQ.
    Usado exclusivamente pelo BatchHandler — não no hot path de stream.
    """

    def __init__(self, database: Database, bullmq: BullMQClient, redis_client: RedisConnection) -> None:
        self._db     = database
        self._bullmq = bullmq
        self._redis = redis_client

    async def emit_segment(
        self,
        session_id:      str,
        chunk_index:     int,
        text:            str,
        timestamp_start: int,
        timestamp_end:   int,
    ) -> None:
        """Persiste um chunk de resultado de batch."""
        if not text.strip():
            return
        try:
            await self._db.save_transcript(
                session_id=session_id,
                chunk_index=chunk_index,
                full_text=text,
                timestamp_start_ms=timestamp_start,
                timestamp_end_ms=timestamp_end,
            )
            
            channel = f"session:transcription:{session_id}"
            await self._redis.publish(
                channel=channel,
                message=json.dumps({
                    "text": text,
                    "segment": {"start_ms": timestamp_start, "end_ms": timestamp_end},
                    "is_final": False,
                    "chunk_index": chunk_index,
                })
            )
            
        except Exception as exc:
            log.error(
                "falha ao salvar transcript batch session=%s chunk=%d: %s",
                session_id, chunk_index, exc, exc_info=True,
            )
            ERRORS_TOTAL.labels(layer="batch_emitter", error_type=type(exc).__name__).inc()
            raise

    async def finalize(
        self,
        session_id:  str,
        total_chunks: int,
        saved_chunks: int,
        total_sec:   float,
    ) -> None:
        """Atualiza status da sessão e dispara pós-processamento."""
        try:
            await self._bullmq.enqueue_post_processing(
                session_id=session_id,
                triggered_by="batch_transcription_done",
            )
            
            channel = f"session:transcription:{session_id}"
            await self._redis.publish(
                channel=channel,
                message=json.dumps({"status": "completed", "saved_chunks": saved_chunks})
            )
                
            log.info(
                "batch finalizado session=%s chunks=%d/%d duration=%.1fs",
                session_id, saved_chunks, total_chunks, total_sec,
            )
        except Exception as exc:
            log.error(
                "falha ao finalizar batch session=%s: %s",
                session_id, exc, exc_info=True,
            )
            ERRORS_TOTAL.labels(layer="batch_emitter", error_type="finalize").inc()
            raise
