from __future__ import annotations

from dataclasses import dataclass


@dataclass
class InferenceResult:
    text: str
    segments: list[dict]
    inference_ms: int
