"""
inference/engine.py — GPU Inference Engine (faster-whisper / CTranslate2).

Substitui o ecossistema NeMo por faster-whisper rodando sobre CTranslate2.
O modelo é carregado UMA VEZ no startup e compartilhado entre todas as sessões.

Por que faster-whisper + CTranslate2:
  - Execução C++ com float16/bfloat16 nos Tensor Cores da RTX 4060
  - beam_size=1 (Greedy) — fundamental para streaming: beam search bloqueia
    a geração de tokens até avaliar todas as hipóteses do beam, quebrando
    a latência do canal bidirecional gRPC
  - VAD interno (Silero) via vad_filter=True — sem dependência externa
  - API de generator: segmentos chegam incrementalmente, não em batch

Dois modos de operação:
  - transcribe_stream(): recebe PCM float32, retorna InferenceResult com
    segmentos e timestamps. Usado pelo StreamingSessionProcessor.
  - transcribe_batch(): recebe BinaryIO (bytes do ffmpeg), deixa o
    faster-whisper fazer o chunking nativo de arquivos longos.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import sysconfig
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Optional

import numpy as np
from core.logging import session_logger
from observability.tracing import inference_span

    


log = logging.getLogger("inference.engine")

SAMPLE_RATE = 16_000

# Executor dedicado para inferência — isolado do executor padrão do asyncio
# para não interferir com I/O do gRPC
_INFERENCE_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="inference")


def _inject_cuda_libs() -> None:
    """
    Injeta os caminhos das libs CUDA instaladas via pip (cublas, cudnn)
    no ambiente operacional ANTES de qualquer import do CTranslate2/faster-whisper.

    Suporta Linux (via LD_LIBRARY_PATH) e Windows (via os.add_dll_directory).
    Detecta automaticamente o site-packages do Python em uso.
    """

    site = sysconfig.get_path("purelib")  # ex: /usr/local/lib/python3.13/site-packages
    
    if sys.platform == "win32":
        # No Windows, os binários (.dll) ficam na pasta 'bin' dentro do pacote nvidia
        cuda_paths = [
            os.path.join(site, "nvidia", "cublas",  "bin"),
            os.path.join(site, "nvidia", "cudnn",   "bin"),
            os.path.join(site, "nvidia", "cuda_runtime", "bin"),
        ]
        
        for p in cuda_paths:
            if os.path.isdir(p):
                try:
                    os.add_dll_directory(p)
                    log.debug("Windows DLL directory adicionado: %s", p)
                except Exception as e:
                    log.warning("Falha ao adicionar DLL directory %s: %s", p, e)
                    
    else:
        # No Linux, os binários (.so) ficam na pasta 'lib'
        cuda_paths = [
            os.path.join(site, "nvidia", "cublas",  "lib"),
            os.path.join(site, "nvidia", "cudnn",   "lib"),
            os.path.join(site, "nvidia", "cuda_runtime", "lib"),
        ]
        
        existing = os.environ.get("LD_LIBRARY_PATH", "")
        extra    = ":".join(p for p in cuda_paths if os.path.isdir(p))

        if extra:
            os.environ["LD_LIBRARY_PATH"] = f"{existing}:{extra}" if existing else extra
            log.debug("LD_LIBRARY_PATH += %s", extra)


_inject_cuda_libs()

@dataclass
class InferenceResult:
    text:          str
    segments:      list[dict]   # [{text, start_ms, end_ms}]
    inference_ms:  int


class WhisperInferenceEngine:
    """
    Wrapper do WhisperModel (faster-whisper). Singleton via factory `create()`.

    Thread-safety: o CTranslate2 é thread-safe para leituras concorrentes,
    mas na prática a GPU é um recurso único — o GPUDispatcher serializa
    as chamadas de inferência para evitar contenção de VRAM.
    """

    def __init__(self, model: object, device: str, compute_type: str) -> None:
        self._model        = model
        self._device       = device
        self._compute_type = compute_type
        self._ready        = True

    # ── factory ───────────────────────────────────────────────────────────────

    @classmethod
    def create(
        cls,
        model_path:    str   = "deepdml/whisper-large-v3-turbo-ct2",
        device:        str   = "cuda",
        compute_type:  str   = "float16",
        cpu_threads:   int   = 4,
    ) -> "WhisperInferenceEngine":
        """
        Carrega o WhisperModel e retorna a instância pronta.
        Bloqueia o startup do worker — chamado antes de aceitar conexões gRPC.

        compute_type "float16" ou "bfloat16" usa os Tensor Cores da RTX 4060.
        Para CPU de desenvolvimento, use "int8".
        """

        from faster_whisper import WhisperModel

        log.info("carregando WhisperModel: %s device=%s compute=%s", model_path, device, compute_type)
        t0 = time.perf_counter()

        model = WhisperModel(
            model_size_or_path=model_path,
            device=device,
            compute_type=compute_type,
            cpu_threads=cpu_threads,
            # download_root é resolvido pelo HF_HOME — já definido via env
        )

        elapsed = time.perf_counter() - t0
        log.info("WhisperModel pronto em %.2fs", elapsed)

        return cls(model=model, device=device, compute_type=compute_type)

    # ── inferência de stream (PCM float32 em memória) ─────────────────────────

    async def transcribe_stream(
        self,
        pcm:             np.ndarray,   # float32 [-1.0, 1.0], 16kHz mono
        session_id:      str,
        audio_offset_ms: int   = 0,
        language:        str   = "pt",
        job_type:        str   = "stream",
    ) -> Optional[InferenceResult]:
        """
        Transcreve um bloco PCM proveniente do buffer de stream.

        beam_size=1 (Greedy) é mandatório para streaming: garante que
        os tokens saem imediatamente sem esperar avaliação de beam.

        vad_filter=True ativa o Silero VAD interno do faster-whisper:
        descarta janelas sem fala antes de alimentar o encoder, reduzindo
        inferências espúrias em silêncio.
        """
        if pcm is None or len(pcm) < SAMPLE_RATE * 0.2:  # < 200ms → ignora
            return None

        duration_ms = int(len(pcm) / SAMPLE_RATE * 1000)
        slog = session_logger("inference.engine", session_id)
        slog.debug("stream infer duration_ms=%d offset_ms=%d", duration_ms, audio_offset_ms)

        loop = asyncio.get_running_loop()
        with inference_span(session_id, duration_ms, job_type):
            t0 = time.perf_counter()
            result = await loop.run_in_executor(
                _INFERENCE_EXECUTOR,
                self._run_stream,
                pcm,
                session_id,
                audio_offset_ms,
                language,
            )
            elapsed_ms = int((time.perf_counter() - t0) * 1000)

        if result is None:
            return None

        slog.info(
            "stream ok elapsed_ms=%d seg=%d preview=%r",
            elapsed_ms, len(result.segments), result.text[:80],
        )
        return InferenceResult(text=result.text, segments=result.segments, inference_ms=elapsed_ms)

    def _run_stream(
        self,
        pcm:             np.ndarray,
        session_id:      str,
        audio_offset_ms: int,
        language:        str,
    ) -> Optional["_RawResult"]:
        """Síncrono — chamado pelo executor. Não chamar diretamente."""
        try:
            segments_gen, _info = self._model.transcribe(
                pcm,
                language=language or None,
                beam_size=1,                   # Greedy — obrigatório para streaming
                vad_filter=True,
                vad_parameters=dict(
                    min_speech_duration_ms=200,
                    min_silence_duration_ms=300,
                ),
                word_timestamps=True,
                condition_on_previous_text=False,  # evita alucinação em janelas curtas
            )

            all_text:     list[str]  = []
            all_segments: list[dict] = []

            for seg in segments_gen:
                text = seg.text.strip()
                if not text:
                    continue
                all_text.append(text)
                all_segments.append({
                    "text":     text,
                    "start_ms": audio_offset_ms + int(seg.start * 1000),
                    "end_ms":   audio_offset_ms + int(seg.end   * 1000),
                })

            if not all_text:
                return None

            return _RawResult(
                text=" ".join(all_text),
                segments=all_segments,
            )

        except Exception as exc:
            log.error("falha stream session=%s: %s", session_id, exc, exc_info=True)
            return None

    # ── inferência de batch (BinaryIO — bytes do ffmpeg) ──────────────────────

    async def transcribe_batch(
        self,
        audio_data:  bytes,
        session_id:  str,
        language:    str   = "pt",
        job_type:    str   = "batch",
    ) -> Optional[InferenceResult]:
        """
        Transcreve um arquivo de áudio completo (bytes PCM 16kHz mono
        convertidos pelo ffmpeg em memória).

        O faster-whisper faz o chunking nativo de arquivos longos internamente
        — sem necessidade de AudioSplitter manual.

        beam_size=5 para batch: qualidade máxima, latência não é crítica.
        """
        if not audio_data:
            return None

        slog = session_logger("inference.engine", session_id)
        slog.info("batch infer size=%d bytes", len(audio_data))

        loop = asyncio.get_running_loop()
        with inference_span(session_id, 0, job_type):
            t0 = time.perf_counter()
            result = await loop.run_in_executor(
                _INFERENCE_EXECUTOR,
                self._run_batch,
                audio_data,
                session_id,
                language,
            )
            elapsed_ms = int((time.perf_counter() - t0) * 1000)

        if result is None:
            return None

        slog.info("batch ok elapsed_ms=%d seg=%d", elapsed_ms, len(result.segments))
        return InferenceResult(text=result.text, segments=result.segments, inference_ms=elapsed_ms)

    def _run_batch(
        self,
        audio_data:  bytes,
        session_id:  str,
        language:    str,
    ) -> Optional["_RawResult"]:
        """Síncrono — chamado pelo executor."""
        try:
            # O ffmpeg produziu PCM raw s16le — sem container, sem header.
            # Passar BytesIO faria o PyAV tentar detectar o formato pelo header
            # e falhar com InvalidDataError ('<none>').
            # Converter para numpy float32 bypassa o PyAV completamente:
            # o faster-whisper detecta ndarray e usa o array diretamente.
            pcm = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0

            segments_gen, _info = self._model.transcribe(
                pcm,
                language=language or None,
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(min_speech_duration_ms=200),
                word_timestamps=True,
            )

            all_text:     list[str]  = []
            all_segments: list[dict] = []

            for seg in segments_gen:
                text = seg.text.strip()
                if not text:
                    continue
                all_text.append(text)
                all_segments.append({
                    "text":     text,
                    "start_ms": int(seg.start * 1000),
                    "end_ms":   int(seg.end   * 1000),
                })

            if not all_text:
                return None

            return _RawResult(text=" ".join(all_text), segments=all_segments)

        except Exception as exc:
            log.error("falha batch session=%s: %s", session_id, exc, exc_info=True)
            return None

    # ── estado ────────────────────────────────────────────────────────────────

    @property
    def is_ready(self) -> bool:
        return self._ready

    @property
    def device(self) -> str:
        return self._device


class _RawResult:
    __slots__ = ("text", "segments")
    def __init__(self, text: str, segments: list[dict]) -> None:
        self.text     = text
        self.segments = segments


# Alias mantido para compatibilidade com worker.py e health.py
GPUInferenceEngine = WhisperInferenceEngine