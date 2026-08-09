from __future__ import annotations

import pytest

from inference.groq_client import GroqTranscriptionClient


def test_to_inference_result_maps_verbose_json_segments_and_speed_factor() -> None:
    payload = {
        "text": "Ola mundo",
        "segments": [
            {"start": 0.0, "end": 1.5, "text": " Ola "},
            {"start": 1.5, "end": 3.0, "text": "mundo"},
        ],
    }

    result = GroqTranscriptionClient._to_inference_result(payload, elapsed_ms=123, duration_factor=2.0)

    assert result.text == "Ola mundo"
    assert result.inference_ms == 123
    assert result.segments == [
        {"text": "Ola", "start_ms": 0, "end_ms": 3000, "index": 0},
        {"text": "mundo", "start_ms": 3000, "end_ms": 6000, "index": 1},
    ]


def test_to_inference_result_falls_back_to_plain_text() -> None:
    result = GroqTranscriptionClient._to_inference_result({"text": "sem segmentos"}, elapsed_ms=10)

    assert result.text == "sem segmentos"
    assert result.segments == [{"text": "sem segmentos", "start_ms": 0, "end_ms": 0, "index": 0}]
