"""Optional batch diarization. No model is imported/downloaded unless enabled."""
from __future__ import annotations

import os
import threading
import subprocess
import tempfile
from pathlib import Path


def assign_speakers(segments: list[dict], turns: list[tuple[int, int, str]]) -> list[dict]:
    def speaker(start: int, end: int) -> str | None:
        scores: dict[str, int] = {}
        for ts, te, label in turns:
            scores[label] = scores.get(label, 0) + max(0, min(end, te) - max(start, ts))
        best = max(scores, key=scores.get) if scores else None
        return best if best is not None and scores[best] > 0 else None

    for segment in segments:
        segment['speaker_id'] = speaker(segment['start_ms'], segment['end_ms'])
        for word in segment.get('words', []):
            word['speaker_id'] = speaker(word['start_ms'], word['end_ms']) or segment['speaker_id'] or ''
    # A speaker turn inside one ASR segment becomes an independently editable row.
    output: list[dict] = []
    for segment in segments:
        groups: list[list[dict]] = []
        for word in segment.get('words', []):
            if not groups or groups[-1][-1].get('speaker_id') != word.get('speaker_id'):
                groups.append([])
            groups[-1].append(word)
        if len(groups) <= 1:
            output.append(segment)
        else:
            for group in groups:
                output.append({**segment, 'text': ' '.join(w['text'].strip() for w in group),
                               'start_ms': group[0]['start_ms'], 'end_ms': group[-1]['end_ms'],
                               'speaker_id': group[0].get('speaker_id') or None, 'words': group})
    return output


class DiarizationService:
    def __init__(self) -> None:
        self.enabled = os.getenv('DIARIZATION_ENABLED', 'false').lower() == 'true'
        self._pipeline = None
        self._lock = threading.Lock()

    def process_file(self, raw_bytes: bytes, filename: str, segments: list[dict]) -> list[dict]:
        if not self.enabled:
            return segments
        with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix[:12], delete=False) as source:
            source.write(raw_bytes)
            path = source.name
        try:
            result = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path,
                                     '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'],
                                    capture_output=True, timeout=300, check=True)
            return self.process(result.stdout, segments)
        finally:
            os.unlink(path)

    def process(self, pcm_bytes: bytes, segments: list[dict]) -> list[dict]:
        if not self.enabled:
            return segments
        import numpy as np
        import torch
        from pyannote.audio import Pipeline

        # Pipeline reuse is serialized, including its first initialization.
        with self._lock:
            if self._pipeline is None:
                token = os.getenv('HF_TOKEN')
                if not token:
                    raise RuntimeError('DIARIZATION_ENABLED requer HF_TOKEN e acesso ao modelo pyannote.')
                self._pipeline = Pipeline.from_pretrained(
                    os.getenv('DIARIZATION_MODEL', 'pyannote/speaker-diarization-community-1'), token=token,
                )
            samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768
            result = self._pipeline({'waveform': torch.from_numpy(samples).unsqueeze(0), 'sample_rate': 16000})
            annotation = getattr(result, 'exclusive_speaker_diarization', None)
            if annotation is None:
                annotation = getattr(result, 'speaker_diarization', result)
            turns = [(round(t.start * 1000), round(t.end * 1000), label)
                     for t, _, label in annotation.itertracks(yield_label=True)]
            return assign_speakers(segments, turns)
