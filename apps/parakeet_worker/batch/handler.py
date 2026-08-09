"""
batch/handler.py — Processamento assíncrono de uploads via MinIO + ffmpeg.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from typing import Optional

from core.config import Config
from core.logging import session_logger
from emit.result_emitter import BatchResultEmitter
from inference.dispatcher import GPUDispatcher
from inference.engine import WhisperInferenceEngine
from observability.metrics import BATCH_QUEUE_SIZE, ERRORS_TOTAL
from events.service import EventService, EventType
from infra.redis_connection import RedisConnection

log = logging.getLogger("batch.handler")

_instance: Optional["BatchHandler"] = None


@dataclass
class BatchJob:
    job_id:      str
    session_id:  str
    storage_key: str
    filename:    str
    mode:        str
    language:    str = "pt"
    enqueued_at: float = field(default_factory=time.monotonic)


class BatchHandler:
    """
    Gerencia a fila de jobs de upload e executa inferência batch.
    Singleton — use BatchHandler.get_instance() após init_instance().
    """

    def __init__(
        self,
        config:     Config,
        engine:     WhisperInferenceEngine,
        dispatcher: GPUDispatcher,
        database:   object,
        bullmq:     object,
        minio:      object,
        redis_conn: RedisConnection,
        event_service: EventService,
    ) -> None:
        self._config     = config
        self._engine     = engine
        self._dispatcher = dispatcher
        self._emitter    = BatchResultEmitter(database, bullmq, redis_client=redis_conn)
        self._minio      = minio
        self._queue: asyncio.Queue[Optional[BatchJob]] = asyncio.Queue()
        self._workers: list[asyncio.Task] = []
        self._batch_sem  = asyncio.Semaphore(1)
        self._event_service = event_service

    @classmethod
    def init_instance(cls, **kwargs) -> "BatchHandler":
        global _instance
        _instance = cls(**kwargs)
        return _instance

    @classmethod
    def get_instance(cls) -> Optional["BatchHandler"]:
        return _instance

    async def start(self) -> None:
        for i in range(self._config.batch_concurrency):
            task = asyncio.create_task(
                self._worker_loop(worker_id=i),
                name=f"batch-worker-{i}",
            )
            self._workers.append(task)
        log.info("BatchHandler iniciado com %d workers", self._config.batch_concurrency)

    async def stop(self) -> None:
        for _ in self._workers:
            await self._queue.put(None)
        if self._workers:
            await asyncio.gather(*self._workers, return_exceptions=True)
        log.info("BatchHandler encerrado")

    async def enqueue(
        self,
        job_id:      str,
        session_id:  str,
        storage_key: str,
        filename:    str,
        mode:        str = "MEETING",
        language:    str = "pt",
    ) -> None:
        job = BatchJob(
            job_id=job_id,
            session_id=session_id,
            storage_key=storage_key,
            filename=filename,
            mode=mode,
            language=language,
        )
        await self._queue.put(job)
        
        await self._event_service.emit(
            session_id, EventType.UPLOAD_QUEUED,
            {"job_id": job_id, "storage_key": storage_key, "filename": filename}
        )
        
        BATCH_QUEUE_SIZE.set(self._queue.qsize())
        log.info("batch enfileirado job_id=%s session=%s key=%s", job_id, session_id, storage_key)

    async def _worker_loop(self, worker_id: int) -> None:
        log.debug("batch worker %d iniciado", worker_id)
        while True:
            job = await self._queue.get()
            if job is None:
                break
            BATCH_QUEUE_SIZE.set(self._queue.qsize())
            await self._process_job(job)
        log.debug("batch worker %d encerrado", worker_id)

    async def _process_job(self, job: BatchJob) -> None:
        slog = session_logger("batch.handler", job.session_id)
        slog.info("iniciando job job_id=%s filename=%s", job.job_id, job.filename)
        t0 = time.monotonic()

        try:
            
            await self._event_service.emit(
                job.session_id, EventType.UPLOAD_RECEIVED,
                {"job_id": job.job_id, "storage_key": job.storage_key}
            )
            
            # 1. Download do MinIO
            raw_bytes = await self._download(job.storage_key)
            slog.info("download ok size=%d bytes", len(raw_bytes))

            # 2. Conversão inteligente híbrida (Memória / Arquivo Temporário para M4A)
            pcm_bytes = await self._convert_to_pcm(raw_bytes, job.filename)
            slog.info("ffmpeg ok pcm_size=%d bytes", len(pcm_bytes))
            
            await self._event_service.emit(
                job.session_id, EventType.UPLOAD_TRANSCRIPTION_STARTED,
                {"job_id": job.job_id}
            )

            # 3. Inferência batch com proteção de VRAM
            result = await self._infer_batch(
                session_id=job.session_id,
                pcm_bytes=pcm_bytes,
                language=job.language,
            )

            if result:
                # Inicializa as variáveis de controle do buffer
                current_text_parts = []
                start_ms = None
                end_ms = None
                chunk_idx = 0  # Índice do novo bloco agrupado

                for seg in result.segments:
                    # Se for o início de um novo bloco agrupado, define o timestamp inicial
                    if start_ms is None:
                        start_ms = seg["start_ms"]
                    
                    # Atualiza sempre o fim com o bloco atual
                    end_ms = seg["end_ms"]
                    current_text_parts.append(seg["text"])
                    
                    # Calcula a duração total acumulada neste bloco atual
                    duration_ms = end_ms - start_ms
                    
                    # Se atingiu ou passou de 15 segundos (15000 ms), emite o registro
                    if duration_ms >= 15000:
                        await self._emitter.emit_segment(
                            session_id=job.session_id,
                            chunk_index=chunk_idx,
                            text=" ".join(current_text_parts), # Concatena o texto com um espaço
                            timestamp_start=start_ms,
                            timestamp_end=end_ms,
                        )
                        await self._event_service.emit(
                            job.session_id,
                            EventType.UPLOAD_TRANSCRIPTION_PROGRESS,
                            {
                                "chunkIndex": chunk_idx,
                                "current": chunk_idx + 1,
                                "totalChunks": len(result.segments),
                                "text": " ".join(current_text_parts),
                                "timestampStartMs": start_ms,
                                "timestampEndMs": end_ms,
                            },
                        )
                        
                        # Incrementa o índice para o próximo grupo e limpa o buffer
                        chunk_idx += 1
                        current_text_parts = []
                        start_ms = None
                        end_ms = None

                # Garante que qualquer resíduo menor que 15s no final do áudio seja enviado
                if current_text_parts:
                    await self._emitter.emit_segment(
                        session_id=job.session_id,
                        chunk_index=chunk_idx,
                        text=" ".join(current_text_parts),
                        timestamp_start=start_ms,
                        timestamp_end=end_ms,
                    )
                    await self._event_service.emit(
                        job.session_id,
                        EventType.UPLOAD_TRANSCRIPTION_PROGRESS,
                        {
                            "chunkIndex": chunk_idx,
                            "current": chunk_idx + 1,
                            "totalChunks": len(result.segments),
                            "text": " ".join(current_text_parts),
                            "timestampStartMs": start_ms,
                            "timestampEndMs": end_ms,
                        },
                    )

            total_sec = time.monotonic() - t0
            
            await self._event_service.emit(
                job.session_id, EventType.UPLOAD_TRANSCRIBED,
                {"job_id": job.job_id, "total_chunks": 1, "saved_chunks": 1 if result else 0}
            )
            
            await self._emitter.finalize(
                session_id=job.session_id,
                total_chunks=1,
                saved_chunks=1 if result else 0,
                total_sec=total_sec,
            )

        except Exception as exc:
            
            await self._event_service.emit(
                job.session_id, EventType.UPLOAD_FAILED,
                {"error": str(exc), "job_type": "upload"}
            )
            
            slog.error("falha no job job_id=%s: %s", job.job_id, exc, exc_info=True)
            ERRORS_TOTAL.labels(layer="batch_handler", error_type=type(exc).__name__).inc()

    async def _download(self, storage_key: str) -> bytes:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            self._minio.get_object_bytes,
            storage_key,
        )

    async def _convert_to_pcm(self, raw_bytes: bytes, filename: str) -> bytes:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            _ffmpeg_to_pcm,
            raw_bytes,
            filename,
        )

    async def _infer_batch(
        self,
        session_id: str,
        pcm_bytes:  bytes,
        language:   str,
    ) -> Optional[object]:
        result_holder: list = []
        done = asyncio.Event()

        async def _run() -> None:
            async with self._batch_sem:
                r = await self._engine.transcribe_batch(
                    audio_data=pcm_bytes,
                    session_id=session_id,
                    language=language,
                    job_type="batch",
                )
                result_holder.append(r)
            done.set()

        await self._dispatcher.submit_batch(_run)
        await done.wait()
        return result_holder[0] if result_holder else None


# ── ffmpeg helper (síncrono — chamado via executor) ───────────────────────────

def _ffmpeg_to_pcm(raw_bytes: bytes, filename: str) -> bytes:
    """
    Converte raw_bytes para PCM mono 16kHz int16 raw.
    Para formatos baseados em ISO (.m4a, .mp4), usa arquivo temporário em disco 
    para permitir que o FFmpeg faça seek e reconstrua arquivos sem metadados lineares.
    Para outros formatos, mantém processamento 100% in-memory via stdin.
    """
    if not raw_bytes:
        raise RuntimeError("Recebido 0 bytes para conversão. O arquivo de entrada está vazio.")

    ext = os.path.splitext(filename.lower())[1]
    
    # Formatos problemáticos que necessitam de seek para ler tabelas de indexação (ex: moov atom)
    use_temp_file = ext in [".m4a", ".mp4", ".mov", ".3gp"]
    temp_file_path = None

    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "warning",
    ]

    try:
        if use_temp_file:
            # Cria arquivo temporário seguro contendo a extensão correta
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                tmp.write(raw_bytes)
                temp_file_path = tmp.name
            
            cmd.extend(["-i", temp_file_path])
            input_data = None
        else:
            cmd.extend(["-i", "pipe:0"])
            input_data = raw_bytes

        # Parâmetros de saída padronizados para o faster-whisper
        cmd.extend([
            "-ar", "16000",
            "-ac", "1",
            "-f", "s16le",
            "-acodec", "pcm_s16le",
            "pipe:1"
        ])

        proc = subprocess.run(
            cmd,
            input=input_data,
            capture_output=True,
            timeout=300,
        )

    finally:
        # Garante a limpeza do arquivo do /tmp em qualquer cenário de erro/sucesso
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
            except Exception:
                pass

    stderr_str = proc.stderr.decode("utf-8", errors="replace")

    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg falhou (code={proc.returncode}): {stderr_str[:500]}")

    if not proc.stdout:
        contexto_erro = f" | FFmpeg Stderr: {stderr_str[:500]}" if stderr_str else " (Sem mensagens no stderr)"
        raise RuntimeError(f"ffmpeg não produziu saída PCM, mas retornou code 0.{contexto_erro}")

    return proc.stdout
