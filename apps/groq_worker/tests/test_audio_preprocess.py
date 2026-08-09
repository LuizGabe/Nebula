from __future__ import annotations

import pytest

from audio import preprocess
from audio.preprocess import PreparedAudio, prepare_audio_for_groq, validate_input_audio


def test_validate_input_audio_rejects_unsupported_extension() -> None:
    with pytest.raises(ValueError, match="nao suportado"):
        validate_input_audio("meeting.txt", b"audio")


def test_prepare_audio_falls_back_to_mp3_when_wav_exceeds_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str | None]] = []

    def fake_run_ffmpeg(*args, output_format: str, bitrate: str | None = None, **kwargs) -> bytes:
        calls.append((output_format, bitrate))
        if output_format == "wav":
            return b"w" * 200
        return b"m" * 40

    monkeypatch.setattr(preprocess, "_run_ffmpeg", fake_run_ffmpeg)

    audio = prepare_audio_for_groq(
        b"raw",
        "meeting.wav",
        target_format="wav",
        max_bytes=100,
        speed=1.1,
    )

    assert audio == PreparedAudio(
        filename="audio.mp3",
        content_type="audio/mpeg",
        data=b"m" * 40,
        duration_factor=pytest.approx(1 / 1.1),
    )
    assert calls == [("wav", None), ("mp3", None)]


def test_prepare_audio_raises_when_compressed_audio_still_exceeds_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(preprocess, "_run_ffmpeg", lambda *args, **kwargs: b"x" * 101)

    with pytest.raises(ValueError, match="excede"):
        prepare_audio_for_groq(b"raw", "meeting.wav", max_bytes=100)
