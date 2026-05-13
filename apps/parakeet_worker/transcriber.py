"""
transcriber.py — Inferência do Parakeet TDT 0.6B v3 via onnx-asr
Retorna segmentos com timestamps agrupados por pausa (paragraphs).

v2: transcrição chunk-safe via AudioSplitter — nunca envia mais de MAX_CHUNK_SEC
    de áudio ao encoder, independente do tamanho do arquivo original.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from dataclasses import dataclass

import onnx_asr
import onnxruntime as ort
import dotenv

dotenv.load_dotenv()

log = logging.getLogger("transcriber")

MODELS_DIR_ENV = os.environ.get("MODELS_DIR", "/app/models")

# Gap mínimo em segundos entre tokens para quebrar parágrafo
PARAGRAPH_GAP_SEC = float(os.environ.get("PARAGRAPH_GAP_SEC", "0.5"))
# Número mínimo de tokens por parágrafo (evita parágrafos de 1 palavra)
MIN_TOKENS_PER_PARAGRAPH = int(os.environ.get("MIN_TOKENS_PER_PARAGRAPH", "3"))

# Limite máximo de áudio por chamada ao encoder (segurança contra OOM/ONNX crash)
MAX_SINGLE_CALL_SEC = float(os.environ.get("MAX_SINGLE_CALL_SEC", "55.0"))


@dataclass
class Segment:
    text: str
    start: float  # segundos dentro do áudio
    end: float    # segundos dentro do áudio


def _make_sess_options() -> ort.SessionOptions:
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = int(os.environ.get("OMP_NUM_THREADS", "4"))
    opts.inter_op_num_threads = 1
    opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return opts


def _group_into_paragraphs(
    tokens: list[str],
    timestamps: list[float],
    gap_sec: float = PARAGRAPH_GAP_SEC,
    min_tokens: int = MIN_TOKENS_PER_PARAGRAPH,
    max_segment_sec: float = 45.0,
) -> list[Segment]:
    if not tokens or not timestamps:
        return []

    segments: list[Segment] = []
    current_tokens: list[str] = []
    current_start: float = timestamps[0]
    prev_ts: float = timestamps[0]

    for token, ts in zip(tokens, timestamps):
        gap = ts - prev_ts
        segment_duration = ts - current_start

        force_break  = segment_duration >= max_segment_sec
        natural_break = gap >= gap_sec and len(current_tokens) >= min_tokens

        if (natural_break or force_break) and current_tokens:
            text = "".join(current_tokens).strip()
            if text:
                segments.append(Segment(text=text, start=current_start, end=prev_ts))
            current_tokens = []
            current_start = ts

        current_tokens.append(token)
        prev_ts = ts

    if current_tokens:
        text = "".join(current_tokens).strip()
        if text:
            segments.append(Segment(text=text, start=current_start, end=prev_ts))

    return segments


def _filter_overlap_segments(
    segments: list[Segment],
    content_start: float,
    content_end: float,
) -> list[Segment]:
    """
    Remove segmentos que estão inteiramente na região de overlap.
    Segmentos que cruzam a fronteira são mantidos e trimados nos timestamps.
    """
    result: list[Segment] = []
    for seg in segments:
        # ignora completamente se está fora da janela de conteúdo
        if seg.end <= content_start or seg.start >= content_end:
            continue
        # trima timestamps para a janela de conteúdo
        trimmed = Segment(
            text=seg.text,
            start=max(seg.start, content_start),
            end=min(seg.end, content_end),
        )
        result.append(trimmed)
    return result


class ParakeetTranscriber:
    def __init__(self, models_dir: str = MODELS_DIR_ENV):
        models_dir = str(Path(models_dir).resolve())
        log.info(f"[parakeet] Carregando modelo de {models_dir} …")

        base_model = onnx_asr.load_model(
            "nemo-parakeet-tdt-0.6b-v3",
            models_dir,
            quantization="int8",
            sess_options=_make_sess_options(),
            providers=["CPUExecutionProvider"],
        )

        self.model = base_model.with_timestamps()
        log.info("[parakeet] Modelo pronto.")

    def transcribe(
        self,
        audio_path: str,
        audio_offset_sec: float = 0.0,
        gap_sec: float = PARAGRAPH_GAP_SEC,
        content_start_sec: float | None = None,
        content_end_sec: float | None = None,
    ) -> dict:
        """
        Transcreve um arquivo de áudio e retorna segmentos com timestamps.

        Args:
            audio_path:        caminho para o WAV mono 16kHz
            audio_offset_sec:  offset em segundos para somar aos timestamps
                               (usado quando o chunk não começa do zero no áudio original)
            gap_sec:           gap mínimo para quebrar parágrafo
            content_start_sec: início da janela de conteúdo dentro do arquivo
                               (para descartar overlap pré). None = 0.
            content_end_sec:   fim da janela de conteúdo dentro do arquivo
                               (para descartar overlap pós). None = fim do arquivo.

        Returns:
            {
                "text":     str,         # texto completo do conteúdo útil
                "segments": list[dict],  # parágrafos com start/end em segundos absolutos
                "elapsed":  float,
            }

        Raises:
            RuntimeError: se o encoder falhar (ex.: áudio excede capacidade do modelo).
                          Nesse caso o chamador deve dividir o áudio e tentar novamente.
        """
        t0 = time.perf_counter()

        try:
            result = self.model.recognize(audio_path)
        except Exception as exc:
            raise RuntimeError(
                f"[parakeet] falha no encoder para '{audio_path}': {exc}"
            ) from exc

        elapsed = time.perf_counter() - t0

        full_text = result.text.strip()

        segments: list[Segment] = []
        if result.tokens and result.timestamps:
            # os timestamps do modelo são relativos ao início do arquivo WAV
            segments = _group_into_paragraphs(result.tokens, result.timestamps, gap_sec=gap_sec)

            # descarta regiões de overlap se as janelas foram informadas
            if content_start_sec is not None or content_end_sec is not None:
                cs = content_start_sec if content_start_sec is not None else 0.0
                # content_end_sec None significa "até o fim" — usamos valor grande
                ce = content_end_sec if content_end_sec is not None else float("inf")
                segments = _filter_overlap_segments(segments, cs, ce)

        # aplica offset absoluto e converte para ms inteiros desde o início do áudio
        serialised = [
            {
                "text":  s.text,
                "start": int((s.start + audio_offset_sec) * 1000),
                "end":   int((s.end   + audio_offset_sec) * 1000),
            }
            for s in segments
        ]

        # reconstrói full_text apenas com o conteúdo útil (pós-filtragem)
        useful_text = " ".join(s["text"] for s in serialised).strip() or full_text

        return {
            "text":     useful_text,
            "segments": serialised,
            "elapsed":  round(elapsed, 3),
        }