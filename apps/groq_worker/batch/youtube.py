from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path

from batch.handler import BatchJob
from events.enums import EventType
from infra.youtube_downloader import YouTubeDownloader, validate_metadata

log = logging.getLogger("batch.youtube")


class YouTubeHandler:
    def __init__(self, database, minio, events, batch_handler, downloader=None):
        self._db = database
        self._minio = minio
        self._events = events
        self._batch = batch_handler
        self._downloader = downloader or YouTubeDownloader()

    async def process(self, job_id: str, data: dict):
        session_id = data["sessionId"]
        session = await self._db.youtube_session(session_id, data["ownerId"])
        if not session or session["completed"]:
            return {"skipped": True}
        max_minutes = 300 if session["username"] == "luizgabe" else 30

        async def progress(payload):
            if payload.get("title"):
                await self._db.set_youtube_title_if_empty(session_id, data["ownerId"], payload["title"])
            await self._events.emit(session_id, EventType.UPLOAD_RECEIVED, {"source": "youtube", **payload})

        stage = "ingestion"
        try:
            cached = await self._db.youtube_audio_exists(session_id)
            storage_key = f"sessions/{session_id}/youtube/audio.mp3"
            if cached:
                duration = cached["timestampEnd"] / 1000
                validate_metadata({"duration": duration}, max_minutes)
            else:
                with tempfile.TemporaryDirectory(prefix="nebula-youtube-") as directory:
                    audio = await self._downloader.download(data["youtubeUrl"], max_minutes, Path(directory), progress)
                    await self._db.set_youtube_title_if_empty(session_id, data["ownerId"], audio.title)
                    # The session can be removed while the download is in progress.
                    if not await self._db.youtube_session(session_id, data["ownerId"]):
                        return {"skipped": True}
                    await progress({"stage": "storing", "message": "Salvando audio do YouTube"})
                    await asyncio.to_thread(self._minio.put_audio_file, storage_key, str(audio.path))
                    duration = audio.duration_seconds
                    await self._db.register_youtube_audio(session_id, storage_key, round(duration * 1000))
            await progress({"stage": "stored", "message": "Audio salvo. Iniciando transcricao.", "durationSeconds": duration})
            stage = "transcript"
            await self._batch.process_job(BatchJob(
                job_id=job_id, session_id=session_id, storage_key=storage_key, filename="audio.mp3",
                mode=data.get("mode") or "MEETING", language=data.get("language") or "pt",
                duration_seconds=duration,
            ))
            await self._events.flush()
            return {"storageKey": storage_key}
        except Exception as exc:
            log.exception("YouTube job failed session=%s", session_id)
            await self._db.fail_youtube_session(session_id)
            message = str(exc) if isinstance(exc, ValueError) else "Nao foi possivel processar o audio do YouTube. Tente novamente mais tarde."
            await self._events.emit(session_id, EventType.UPLOAD_FAILED, {"source": "youtube", "stage": stage, "error": message})
            await self._events.flush()
            raise
