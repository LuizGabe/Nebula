from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from audio.preprocess import PreparedAudio
from inference.types import InferenceResult

log = logging.getLogger("inference.groq_client")


class GroqTranscriptionClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = "https://api.groq.com/openai/v1",
        model: str = "whisper-large-v3-turbo",
        timeout_sec: float = 120,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout_sec = timeout_sec

    async def transcribe(
        self,
        audio: PreparedAudio,
        *,
        session_id: str,
        language: str = "pt",
    ) -> InferenceResult:
        t0 = time.perf_counter()
        payload = await self._request(audio, language=language)
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        result = self._to_inference_result(payload, elapsed_ms, audio.duration_factor)
        log.info("groq transcricao ok session=%s segments=%d", session_id, len(result.segments))
        return result

    async def _request(self, audio: PreparedAudio, *, language: str) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        data = {
            "model": self._model,
            "response_format": "verbose_json",
            "temperature": "0",
        }
        if language:
            data["language"] = language

        files = {
            "file": (
                audio.filename,
                audio.data,
                audio.content_type,
            )
        }

        async with httpx.AsyncClient(timeout=self._timeout_sec) as client:
            response = await client.post(
                f"{self._base_url}/audio/transcriptions",
                headers=headers,
                data=data,
                files=files,
            )
            response.raise_for_status()
            return response.json()

    @staticmethod
    def _to_inference_result(payload: dict[str, Any], elapsed_ms: int, duration_factor: float = 1.0) -> InferenceResult:
        raw_segments = payload.get("segments") or []
        segments: list[dict] = []
        texts: list[str] = []

        for index, segment in enumerate(raw_segments):
            text = str(segment.get("text") or "").strip()
            if not text:
                continue
            start = _scaled_ms(segment.get("start", 0), duration_factor)
            end = _scaled_ms(segment.get("end", 0), duration_factor)
            if end < start:
                end = start
            texts.append(text)
            segments.append({"text": text, "start_ms": start, "end_ms": end, "index": index})

        if not texts:
            text = str(payload.get("text") or "").strip()
            if text:
                texts.append(text)
                segments.append({"text": text, "start_ms": 0, "end_ms": 0, "index": 0})

        return InferenceResult(text=" ".join(texts), segments=segments, inference_ms=elapsed_ms)


def _scaled_ms(value: Any, factor: float) -> int:
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        seconds = 0.0
    return int(seconds * 1000 * factor)
