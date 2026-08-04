"""
session/audio_buffer.py — Ring buffer de áudio PCM em memória.

Mantém os samples PCM int16 de uma sessão como array numpy contíguo.
Não toca em disco — tudo em memória durante o ciclo de vida da sessão.

Contrato com o backend:
  - PCM mono, 16kHz, int16, little-endian
  - O worker NÃO faz resampling
  - Timestamps absolutos (ms) chegam por pacote via gRPC
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

log = logging.getLogger("session.audio_buffer")

SAMPLE_RATE = 16_000  # Hz — fixo, o backend garante


@dataclass
class BufferSnapshot:
    """Fatia do buffer pronta para inferência."""
    pcm:          np.ndarray   # float32 normalizado [-1, 1]
    start_ms:     int          # timestamp absoluto de início (ms desde início da sessão)
    duration_ms:  int          # duração em ms


class AudioBuffer:
    """
    Buffer de áudio de uma sessão. Thread-safe via Lock interno.

    Mantém dois artefatos:
      - _samples:    np.ndarray int16 — todos os samples recebidos
      - _timestamps: list[int]        — timestamp (ms) de cada chunk recebido

    O VAD opera sobre _samples e solicita snapshots via `take_snapshot()`.
    Após inferência, o caller chama `consume(n_samples)` para liberar memória.
    """

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self._lock      = threading.Lock()
        self._samples   = np.empty(0, dtype=np.int16)
        self._base_ms   = 0       # timestamp ms do primeiro sample do buffer atual
        self._total_ms  = 0       # total de ms recebidos na sessão (para offset)

    # ── escrita ───────────────────────────────────────────────────────────────

    def append(self, pcm_bytes: bytes, timestamp_ms: int) -> None:
        """
        Adiciona um pacote PCM ao buffer.

        pcm_bytes: raw bytes PCM int16 little-endian
        timestamp_ms: timestamp absoluto de início do pacote (ms)
        """
        if not pcm_bytes:
            return

        chunk = np.frombuffer(pcm_bytes, dtype=np.int16)
        chunk_ms = int(len(chunk) / SAMPLE_RATE * 1000)

        with self._lock:
            if self._samples.size == 0:
                self._base_ms = timestamp_ms
            self._samples   = np.concatenate([self._samples, chunk])
            self._total_ms  = timestamp_ms + chunk_ms

        log.debug(
            "buffer append session=%s samples=%d total_ms=%d",
            self.session_id, len(chunk), self._total_ms,
        )

    # ── leitura ───────────────────────────────────────────────────────────────

    def duration_sec(self) -> float:
        """Duração atual do buffer em segundos."""
        with self._lock:
            return len(self._samples) / SAMPLE_RATE

    def sample_count(self) -> int:
        with self._lock:
            return len(self._samples)

    def take_snapshot(self, max_samples: Optional[int] = None) -> Optional[BufferSnapshot]:
        """
        Retorna uma cópia do buffer (ou fatia) normalizada para float32.
        Retorna None se o buffer estiver vazio.

        max_samples: se informado, retorna no máximo esse número de samples.
        """
        with self._lock:
            if self._samples.size == 0:
                return None

            raw = self._samples[:max_samples] if max_samples else self._samples
            pcm_f32  = raw.astype(np.float32) / 32768.0
            start_ms = self._base_ms
            dur_ms   = int(len(raw) / SAMPLE_RATE * 1000)

        return BufferSnapshot(
            pcm=pcm_f32,
            start_ms=start_ms,
            duration_ms=dur_ms,
        )

    def consume(self, n_samples: int) -> None:
        """
        Remove os primeiros n_samples do buffer após inferência bem-sucedida.
        Avança _base_ms proporcionalmente.
        """
        with self._lock:
            consumed = min(n_samples, len(self._samples))
            if consumed == 0:
                return
            consumed_ms = int(consumed / SAMPLE_RATE * 1000)
            self._samples  = self._samples[consumed:]
            self._base_ms += consumed_ms

        log.debug(
            "buffer consume session=%s n=%d restante=%d",
            self.session_id, consumed, len(self._samples),
        )

    def drain(self) -> Optional[BufferSnapshot]:
        """
        Retorna snapshot de todo o conteúdo restante e limpa o buffer.
        Usado no encerramento da sessão (end_of_stream=True).
        """
        with self._lock:
            if self._samples.size == 0:
                return None

            pcm_f32  = self._samples.astype(np.float32) / 32768.0
            start_ms = self._base_ms
            dur_ms   = int(len(self._samples) / SAMPLE_RATE * 1000)
            self._samples = np.empty(0, dtype=np.int16)

        return BufferSnapshot(
            pcm=pcm_f32,
            start_ms=start_ms,
            duration_ms=dur_ms,
        )

    def clear(self) -> None:
        """Descarta o buffer inteiro (usado no cleanup de sessão expirada)."""
        with self._lock:
            self._samples = np.empty(0, dtype=np.int16)
            self._base_ms = 0
