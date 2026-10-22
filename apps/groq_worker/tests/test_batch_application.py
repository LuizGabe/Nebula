from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

import batch.handler as handler_module
from audio.preprocess import PreparedAudio
from batch.handler import BatchHandler, BatchJob
from inference.types import InferenceResult


class FakeMinio:
    def get_object_bytes(self, storage_key: str) -> bytes:
        assert storage_key == "sessions/s1/audio.wav"
        return b"raw-wav"


class FakeGroq:
    async def transcribe(self, audio: PreparedAudio, *, session_id: str, language: str) -> InferenceResult:
        assert audio.filename == "audio.wav"
        assert session_id == "s1"
        assert language == "pt"
        return InferenceResult(
            text="primeiro segundo",
            segments=[
                {"text": "primeiro", "start_ms": 0, "end_ms": 1000},
                {"text": "segundo", "start_ms": 1000, "end_ms": 2000},
            ],
            inference_ms=55,
        )


class FakeDatabase:
    def __init__(self) -> None:
        self.transcripts = []
        self.events = []

    async def save_transcript(self, **kwargs) -> None:
        self.transcripts.append(kwargs)

    async def save_event(self, **kwargs) -> None:
        self.events.append(kwargs)


class FakeBullMQ:
    def __init__(self) -> None:
        self.post_process_sessions = []

    async def enqueue_post_processing(self, session_id: str, triggered_by: str) -> str:
        self.post_process_sessions.append((session_id, triggered_by))
        return "post-1"


class FakeRedis:
    def __init__(self) -> None:
        self.messages = []

    async def publish(self, channel: str, message: str) -> None:
        self.messages.append((channel, message))


class FakeEventService:
    def __init__(self) -> None:
        self.events = []

    async def emit(self, session_id, event_type, payload=None) -> None:
        self.events.append((session_id, event_type.value, payload or {}))


def test_batch_handler_processes_job_and_keeps_parakeet_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    asyncio.run(_run_batch_handler_processes_job_and_keeps_parakeet_contract(monkeypatch))


async def _run_batch_handler_processes_job_and_keeps_parakeet_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        handler_module,
        "prepare_audio_for_groq",
        lambda *args, **kwargs: PreparedAudio(
            filename="audio.wav",
            content_type="audio/wav",
            data=b"prepared",
            duration_factor=1.0,
        ),
    )

    config = SimpleNamespace(
        batch_concurrency=1,
        audio_target_format="wav",
        max_groq_file_mb=19.5,
        audio_speed=1.08,
        ffmpeg_timeout_sec=300,
        groq_model="whisper-large-v3-turbo",
    )
    db = FakeDatabase()
    bullmq = FakeBullMQ()
    redis = FakeRedis()
    events = FakeEventService()
    batch = BatchHandler(
        config=config,
        groq=FakeGroq(),
        database=db,
        bullmq=bullmq,
        minio=FakeMinio(),
        redis_conn=redis,
        event_service=events,
    )

    await batch._process_job(
        BatchJob(
            job_id="job-1",
            session_id="s1",
            storage_key="sessions/s1/audio.wav",
            filename="audio.wav",
            mode="MEETING",
            language="pt",
        )
    )

    assert [event[1] for event in events.events] == [
        "UPLOAD_RECEIVED",
        "UPLOAD_TRANSCRIPTION_STARTED",
        "UPLOAD_TRANSCRIPTION_PROGRESS",
        "UPLOAD_TRANSCRIPTION_PROGRESS",
        "UPLOAD_TRANSCRIBED",
    ]
    assert len(db.transcripts) == 2
    assert db.transcripts[0]["full_text"] == "primeiro"
    assert bullmq.post_process_sessions == [("s1", "batch_transcription_done")]
    assert redis.messages[-1][0] == "session:transcription:s1"


def test_long_video_preserves_offsets_and_only_enqueues_one_document(monkeypatch):
    async def run():
        slices = []
        def prepare(*args, **kwargs):
            slices.append((kwargs.get("start_sec"), kwargs.get("duration_sec")))
            return PreparedAudio("audio.wav", "audio/wav", b"prepared", 1)
        monkeypatch.setattr(handler_module, "prepare_audio_for_groq", prepare)
        config = SimpleNamespace(batch_concurrency=1, audio_target_format="wav", max_groq_file_mb=19.5,
                                 audio_speed=1.08, ffmpeg_timeout_sec=300, groq_model="test")
        db, bullmq, redis, events = FakeDatabase(), FakeBullMQ(), FakeRedis(), FakeEventService()
        handler = BatchHandler(config, FakeGroq(), db, bullmq, FakeMinio(), redis, events)
        await handler.process_job(BatchJob("j", "s1", "sessions/s1/audio.wav", "audio.wav", "MEETING", duration_seconds=1201))
        assert slices == [(0, 600), (600, 600), (1200, 1)]
        assert [row["timestamp_start_ms"] for row in db.transcripts] == [0, 1000, 600000, 601000, 1200000, 1201000]
        assert [row["chunk_index"] for row in db.transcripts] == list(range(6))
        assert bullmq.post_process_sessions == [("s1", "batch_transcription_done")]
    asyncio.run(run())
