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


def test_word_timestamps_restore_original_speed_and_do_not_duplicate_boundaries():
    payload = {"segments": [{"text": "Olá", "start": 0, "end": 1}, {"text": "mundo", "start": 1, "end": 2}],
               "words": [{"word": "Olá", "start": 0.2, "end": 0.7}, {"word": "mundo", "start": 1, "end": 1.8}]}
    result = GroqTranscriptionClient._to_inference_result(payload, 10, 1.5)
    assert result.segments[0]['words'][0]['start_ms'] == 300
    assert result.segments[0]['words'][0]['end_ms'] == 1050
    assert result.segments[1]['words'][0]['start_ms'] == 1500
    assert sum(len(segment['words']) for segment in result.segments) == 2
