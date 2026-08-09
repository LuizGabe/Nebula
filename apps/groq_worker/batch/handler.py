from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from functools import partial
from typing import Optional

from audio.preprocess import prepare_audio_for_groq
from core.config import Config
from core.logging import session_logger
from emit.result_emitter import BatchResultEmitter
from events.enums import EventType
from events.service import EventService
from inference.groq_client import GroqTranscriptionClient
from observability.metrics import BATCH_QUEUE_SIZE, ERRORS_TOTAL

log = logging.getLogger("batch.handler")
_instance: Optional["BatchHandler"] = None


@dataclass
class BatchJob:
    job_id: str
    session_id: str
    storage_key: str
    filename: str
    mode: str
    language: str = "pt"
    enqueued_at: float = field(default_factory=time.monotonic)


class BatchHandler:
    def __init__(
        self,
        config: Config,
        groq: GroqTranscriptionClient,
        database: object,
        bullmq: object,
        minio: object,
        redis_conn: object,
        event_service: EventService,
    ) -> None:
        self._config = config
        self._groq = groq
        self._emitter = BatchResultEmitter(database, bullmq, redis_client=redis_conn)
        self._minio = minio
        self._queue: asyncio.Queue[Optional[BatchJob]] = asyncio.Queue()
        self._workers: list[asyncio.Task] = []
        self._api_sem = asyncio.Semaphore(max(1, config.batch_concurrency))
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
            task = asyncio.create_task(self._worker_loop(worker_id=i), name=f"groq-batch-worker-{i}")
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
        job_id: str,
        session_id: str,
        storage_key: str,
        filename: str,
        mode: str = "MEETING",
        language: str = "pt",
    ) -> None:
        await self._queue.put(
            BatchJob(
                job_id=job_id,
                session_id=session_id,
                storage_key=storage_key,
                filename=filename,
                mode=mode,
                language=language,
            )
        )
        await self._event_service.emit(
            session_id,
            EventType.UPLOAD_QUEUED,
            {"job_id": job_id, "storage_key": storage_key, "filename": filename},
        )
        BATCH_QUEUE_SIZE.set(self._queue.qsize())

    async def _worker_loop(self, worker_id: int) -> None:
        while True:
            job = await self._queue.get()
            if job is None:
                break
            BATCH_QUEUE_SIZE.set(self._queue.qsize())
            await self._process_job(job)

    async def _process_job(self, job: BatchJob) -> None:
        slog = session_logger("batch.handler", job.session_id)
        t0 = time.monotonic()

        try:
            await self._event_service.emit(
                job.session_id,
                EventType.UPLOAD_RECEIVED,
                {"job_id": job.job_id, "storage_key": job.storage_key},
            )

            raw_bytes = await self._download(job.storage_key)
            audio = await self._prepare_audio(raw_bytes, job.filename)
            slog.info(
                "audio preparado filename=%s size=%d bytes",
                audio.filename,
                len(audio.data),
            )

            await self._event_service.emit(
                job.session_id,
                EventType.UPLOAD_TRANSCRIPTION_STARTED,
                {
                    "job_id": job.job_id,
                    "provider": "groq",
                    "model": self._config.groq_model,
                    "prepared_filename": audio.filename,
                    "prepared_size_bytes": len(audio.data),
                },
            )

            async with self._api_sem:
                result = await self._groq.transcribe(
                    audio,
                    session_id=job.session_id,
                    language=job.language,
                )

            saved_chunks = await self._emit_segments(job.session_id, result.segments)
            total_sec = time.monotonic() - t0

            await self._event_service.emit(
                job.session_id,
                EventType.UPLOAD_TRANSCRIBED,
                {
                    "job_id": job.job_id,
                    "total_chunks": len(result.segments),
                    "saved_chunks": saved_chunks,
                    "provider": "groq",
                    "model": self._config.groq_model,
                    "inference_ms": result.inference_ms,
                },
            )
            await self._emitter.finalize(
                session_id=job.session_id,
                total_chunks=len(result.segments),
                saved_chunks=saved_chunks,
                total_sec=total_sec,
            )
        except Exception as exc:
            await self._event_service.emit(
                job.session_id,
                EventType.UPLOAD_FAILED,
                {"error": str(exc), "job_type": "upload", "provider": "groq"},
            )
            slog.error("falha no job job_id=%s: %s", job.job_id, exc, exc_info=True)
            ERRORS_TOTAL.labels(layer="batch_handler", error_type=type(exc).__name__).inc()

    async def _download(self, storage_key: str) -> bytes:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._minio.get_object_bytes, storage_key)

    async def _prepare_audio(self, raw_bytes: bytes, filename: str):
        loop = asyncio.get_running_loop()
        prepare = partial(
            prepare_audio_for_groq,
            raw_bytes,
            filename,
            target_format=self._config.audio_target_format,
            max_bytes=int(self._config.max_groq_file_mb * 1024 * 1024),
            speed=self._config.audio_speed,
            timeout_sec=self._config.ffmpeg_timeout_sec,
        )
        return await loop.run_in_executor(
            None,
            prepare,
        )

    async def _emit_segments(self, session_id: str, segments: list[dict]) -> int:
        saved = 0
        for chunk_index, segment in enumerate(segments):
            text = str(segment.get("text") or "").strip()
            if not text:
                continue
            await self._emitter.emit_segment(
                session_id=session_id,
                chunk_index=chunk_index,
                text=text,
                timestamp_start=int(segment.get("start_ms") or 0),
                timestamp_end=int(segment.get("end_ms") or 0),
            )
            saved += 1
        return saved
