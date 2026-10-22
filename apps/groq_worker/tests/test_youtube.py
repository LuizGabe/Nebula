from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from batch.youtube import YouTubeHandler
from infra.youtube_downloader import (
    DownloadedYouTubeAudio, YouTubeDownloader, YouTubeError, normalize_youtube_url, validate_metadata,
)


@pytest.mark.parametrize("url", [
    "https://www.youtube.com/watch?v=jNQXAC9IVRw&list=ignored",
    "https://youtu.be/jNQXAC9IVRw?t=5",
    "https://youtube.com/shorts/jNQXAC9IVRw",
])
def test_normalizes_only_one_youtube_video(url):
    assert normalize_youtube_url(url) == "https://www.youtube.com/watch?v=jNQXAC9IVRw"


@pytest.mark.parametrize("url", [
    "https://youtube.com.evil.test/watch?v=jNQXAC9IVRw", "https://localhost/watch?v=jNQXAC9IVRw",
    "https://youtube.com/playlist?list=foo", "file:///etc/passwd", "https://youtu.be/x",
    "https://user@youtube.com/watch?v=jNQXAC9IVRw", "https://youtube.com:8080/watch?v=jNQXAC9IVRw",
])
def test_rejects_non_video_and_untrusted_urls(url):
    with pytest.raises(YouTubeError):
        normalize_youtube_url(url)


def test_duration_limits_and_unknown_or_live_videos():
    assert validate_metadata({"duration": 1800}, 30) == 1800
    assert validate_metadata({"duration": 18000}, 300) == 18000
    for duration, limit in [(2100, 30), (1800.01, 30), (18000.01, 300)]:
        with pytest.raises(YouTubeError, match=f"{limit} minutos"):
            validate_metadata({"duration": duration}, limit)
    for info in [{"duration": None}, {"duration": float("nan")}, {"duration": 1, "is_live": True}, {"duration": 1, "age_limit": 18}]:
        with pytest.raises(YouTubeError):
            validate_metadata(info, 30)


def test_duration_rejected_before_download_without_retry(monkeypatch, tmp_path):
    calls = []

    class FakeDownloader:
        def __init__(self, options): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def extract_info(self, url, download=False):
            calls.append(download)
            return {"duration": 2100}
        def process_ie_result(self, *args, **kwargs):
            pytest.fail("An over-limit video must never be downloaded")

    monkeypatch.setitem(sys.modules, "yt_dlp", SimpleNamespace(YoutubeDL=FakeDownloader))
    with pytest.raises(YouTubeError, match="30 minutos"):
        asyncio.run(YouTubeDownloader().download("https://youtu.be/jNQXAC9IVRw", 30, tmp_path, AsyncMock()))
    assert calls == [False]


def test_three_attempts_change_options_and_then_succeed(monkeypatch, tmp_path):
    configurations = []
    monkeypatch.setattr(asyncio, "sleep", AsyncMock())

    class FakeDownloader:
        def __init__(self, options):
            self.options = options
            configurations.append(options)
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def extract_info(self, url, download=False):
            if len(configurations) < 3:
                raise RuntimeError("HTTP Error 503")
            return {"duration": 19, "title": "Public video"}
        def process_ie_result(self, info, download=True):
            self.options["match_filter"](info)
            Path(self.options["outtmpl"].replace("%(ext)s", "mp3")).write_bytes(b"audio")

    monkeypatch.setitem(sys.modules, "yt_dlp", SimpleNamespace(YoutubeDL=FakeDownloader))
    audio = asyncio.run(YouTubeDownloader().download("https://youtu.be/jNQXAC9IVRw", 30, tmp_path, AsyncMock()))
    assert audio.path.read_bytes() == b"audio"
    assert len(configurations) == 3
    assert len({options["format"] for options in configurations}) == 3
    assert len({options["http_headers"]["User-Agent"] for options in configurations}) == 3


@pytest.mark.parametrize("error, attempts", [("HTTP Error 503", 3), ("Private video", 1)])
def test_retry_exhaustion_and_private_video(monkeypatch, tmp_path, error, attempts):
    downloader = YouTubeDownloader()
    calls = []
    monkeypatch.setattr(asyncio, "sleep", AsyncMock())
    def fail(*args):
        calls.append(args)
        raise RuntimeError(error)
    monkeypatch.setattr(downloader, "_attempt", fail)
    with pytest.raises(YouTubeError):
        asyncio.run(downloader.download("https://youtu.be/jNQXAC9IVRw", 30, tmp_path, AsyncMock()))
    assert len(calls) == attempts


def make_handler(username="common", fail=False):
    database = SimpleNamespace(
        youtube_session=AsyncMock(return_value={"username": username, "completed": False}),
        youtube_audio_exists=AsyncMock(return_value=None),
        register_youtube_audio=AsyncMock(), fail_youtube_session=AsyncMock(),
        set_youtube_title_if_empty=AsyncMock(),
    )
    stored = []
    minio = SimpleNamespace(put_audio_file=lambda key, file: stored.append((key, Path(file).read_bytes())))
    events = SimpleNamespace(emit=AsyncMock(), flush=AsyncMock())
    batch = SimpleNamespace(process_job=AsyncMock())
    async def download(url, limit, directory, progress):
        if fail:
            raise YouTubeError("Video privado")
        path = directory / "audio.mp3"
        path.write_bytes(b"audio")
        return DownloadedYouTubeAudio(path, 19, "Video")
    downloader = SimpleNamespace(download=AsyncMock(side_effect=download))
    handler = YouTubeHandler(database, minio, events, batch, downloader)
    return handler, database, events, batch, downloader, stored


@pytest.mark.parametrize("username,limit", [("common", 30), ("luizgabe", 300)])
def test_ingestion_uses_database_owner_limit_stores_audio_and_reuses_batch(username, limit):
    handler, db, events, batch, downloader, stored = make_handler(username)
    result = asyncio.run(handler.process("job", {"sessionId": "s1", "ownerId": "owner", "youtubeUrl": "https://youtu.be/jNQXAC9IVRw", "maxDurationMinutes": 999999}))
    assert downloader.download.call_args.args[1] == limit
    assert stored == [("sessions/s1/youtube/audio.mp3", b"audio")]
    db.register_youtube_audio.assert_awaited_once_with("s1", result["storageKey"], 19000)
    assert batch.process_job.call_args.args[0].duration_seconds == 19
    db.set_youtube_title_if_empty.assert_awaited_once_with("s1", "owner", "Video")
    assert not db.fail_youtube_session.called


def test_ingestion_failure_updates_status_emits_error_and_never_transcribes():
    handler, db, events, batch, downloader, stored = make_handler(fail=True)
    with pytest.raises(YouTubeError):
        asyncio.run(handler.process("job", {"sessionId": "s1", "ownerId": "owner", "youtubeUrl": "https://youtu.be/jNQXAC9IVRw"}))
    db.fail_youtube_session.assert_awaited_once_with("s1")
    assert events.emit.call_args.args[1].value == "UPLOAD_FAILED"
    assert events.emit.call_args.args[2]["error"] == "Video privado"
    assert not batch.process_job.called
    assert not stored


def test_deleted_session_does_not_download_or_transcribe():
    handler, db, events, batch, downloader, stored = make_handler()
    db.youtube_session.return_value = None
    assert asyncio.run(handler.process("job", {"sessionId": "s1", "ownerId": "other"})) == {"skipped": True}
    assert not downloader.download.called
    assert not batch.process_job.called
