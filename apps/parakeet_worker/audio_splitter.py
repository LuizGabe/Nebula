"""
audio_splitter.py — Divisão fonética de áudio para inferência segura no Parakeet TDT.

Estratégia:
  1. Detecta silêncios via ffmpeg silencedetect para encontrar pontos de corte naturais.
  2. Agrupa regiões de fala em chunks <= MAX_CHUNK_SEC.
  3. Se nenhum silêncio existe (fala contínua), força corte em MAX_CHUNK_SEC.
  4. Cada chunk recebe OVERLAP_SEC de contexto anterior E posterior para
     evitar que o modelo perca palavras na fronteira.
  5. Retorna lista de AudioChunk com metadados suficientes para remoção de overlap.

Dependências: ffmpeg no PATH, nenhuma lib Python extra.
"""

from __future__ import annotations

import logging
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("audio_splitter")

# ── constantes (overridáveis via construtor) ──────────────────────────────────
DEFAULT_MAX_CHUNK_SEC   = 55.0   # limite seguro para o encoder (< 60s por folga)
DEFAULT_OVERLAP_SEC     = 2.0    # contexto compartilhado com chunk anterior/posterior
DEFAULT_SILENCE_DB      = -35.0  # limiar de silêncio em dBFS
DEFAULT_SILENCE_MIN_SEC = 0.3    # silêncio mínimo para ser considerado ponto de corte
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class AudioChunk:
    index: int          # posição global no áudio
    path: str           # arquivo WAV temporário desta fatia
    content_start: float  # início do conteúdo útil (sem overlap anterior) em s
    content_end: float    # fim do conteúdo útil (sem overlap posterior) em s
    audio_start: float    # início real do arquivo WAV (com overlap anterior)
    audio_end: float      # fim real do arquivo WAV (com overlap posterior)
    has_overlap_pre: bool   # tem overlap com chunk anterior?
    has_overlap_post: bool  # tem overlap com próximo chunk?

    @property
    def audio_duration(self) -> float:
        return self.audio_end - self.audio_start

    @property
    def pre_overlap_sec(self) -> float:
        """Segundos de overlap no início do arquivo (offset a descontar dos timestamps)."""
        return self.content_start - self.audio_start

    @property
    def post_overlap_sec(self) -> float:
        """Segundos de overlap no fim do arquivo (contexto extra)."""
        return self.audio_end - self.content_end


@dataclass
class SplitPlan:
    chunks: list[AudioChunk] = field(default_factory=list)
    total_duration: float = 0.0
    silence_count: int = 0
    forced_cuts: int = 0          # quantos cortes foram forçados por MAX_CHUNK_SEC


class AudioSplitter:
    """
    Divide um arquivo WAV mono 16kHz em chunks fonéticos seguros para o Parakeet.

    Uso:
        splitter = AudioSplitter()
        plan = splitter.split(wav_path, tmp_dir)
        for chunk in plan.chunks:
            result = transcriber.transcribe(chunk.path, audio_offset_sec=chunk.content_start)
            # ... remove overlap usando chunk.pre_overlap_sec e chunk.post_overlap_sec
        splitter.cleanup(plan)  # remove arquivos temporários
    """

    def __init__(
        self,
        max_chunk_sec: float = DEFAULT_MAX_CHUNK_SEC,
        overlap_sec: float = DEFAULT_OVERLAP_SEC,
        silence_db: float = DEFAULT_SILENCE_DB,
        silence_min_sec: float = DEFAULT_SILENCE_MIN_SEC,
    ) -> None:
        self.max_chunk_sec   = max_chunk_sec
        self.overlap_sec     = overlap_sec
        self.silence_db      = silence_db
        self.silence_min_sec = silence_min_sec

    # ── API pública ───────────────────────────────────────────────────────────

    def split(self, wav_path: str, tmp_dir: str | None = None) -> SplitPlan:
        """
        Analisa o WAV e cria os arquivos de chunk.

        Args:
            wav_path: arquivo WAV mono 16kHz (já convertido).
            tmp_dir:  diretório para arquivos temporários. Se None, usa tempfile padrão.

        Returns:
            SplitPlan com lista de AudioChunk prontos para transcrição.
        """
        total_sec = self._get_duration(wav_path)
        log.info(f"[splitter] duração total: {total_sec:.2f}s")

        # Áudios curtos: chunk único, sem overhead
        if total_sec <= self.max_chunk_sec:
            log.info("[splitter] áudio curto — chunk único sem divisão")
            return self._single_chunk(wav_path, total_sec, tmp_dir)

        silence_points = self._detect_silence(wav_path, total_sec)
        log.info(f"[splitter] {len(silence_points)} ponto(s) de silêncio detectado(s)")

        cut_points = self._build_cut_points(silence_points, total_sec)
        log.info(
            f"[splitter] plano: {len(cut_points) - 1} chunk(s) | "
            f"silêncios={len(silence_points)} forçados=calculado"
        )

        return self._materialise_chunks(wav_path, cut_points, total_sec, tmp_dir)

    def cleanup(self, plan: SplitPlan) -> None:
        """Remove todos os arquivos temporários criados pelo split."""
        for chunk in plan.chunks:
            Path(chunk.path).unlink(missing_ok=True)

    # ── detecção de silêncio ──────────────────────────────────────────────────

    def _detect_silence(self, wav_path: str, total_sec: float) -> list[float]:
        """
        Roda ffmpeg silencedetect e retorna lista de timestamps (centro do silêncio)
        ordenados, excluindo início e fim do áudio.
        """
        cmd = [
            "ffmpeg", "-y", "-i", wav_path,
            "-af", (
                f"silencedetect=noise={self.silence_db}dB"
                f":duration={self.silence_min_sec}"
            ),
            "-f", "null", "-",
        ]
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120
        )
        # silencedetect vai para stderr
        stderr = result.stderr

        silence_starts = [float(m) for m in re.findall(r"silence_start: ([\d.]+)", stderr)]
        silence_ends   = [float(m) for m in re.findall(r"silence_end: ([\d.]+)", stderr)]

        if not silence_starts:
            return []

        # garante paridade start/end (o último silêncio pode não ter end se for o fim)
        pairs = list(zip(silence_starts, silence_ends + [total_sec]))

        # centro de cada silêncio como ponto de corte ideal
        centers = [(s + e) / 2.0 for s, e in pairs]

        # filtra silêncios muito perto do início ou fim (< overlap_sec de margem)
        margin = self.overlap_sec
        centers = [c for c in centers if margin < c < (total_sec - margin)]

        return sorted(centers)

    # ── construção do plano de cortes ────────────────────────────────────────

    def _build_cut_points(
        self, silence_points: list[float], total_sec: float
    ) -> list[float]:
        """
        Constrói lista de pontos de corte [0.0, ..., total_sec] respeitando:
        - Preferência por silêncios para corte natural
        - Hard cap de max_chunk_sec (corte forçado se necessário)
        """
        cuts = [0.0]
        last_cut = 0.0

        # índice no array de silêncios para busca eficiente
        si = 0
        n_silence = len(silence_points)

        while last_cut < total_sec:
            ideal_end = last_cut + self.max_chunk_sec

            if ideal_end >= total_sec:
                # último chunk — vai até o fim
                break

            # procura o silêncio mais próximo ANTES de ideal_end
            best = None
            while si < n_silence and silence_points[si] <= ideal_end:
                best = silence_points[si]
                si += 1

            if best is not None and best > last_cut + 5.0:
                # corte natural no silêncio
                cuts.append(best)
                last_cut = best
            else:
                # corte forçado: não há silêncio próximo, corta em ideal_end
                log.debug(f"[splitter] corte forçado em {ideal_end:.2f}s (sem silêncio disponível)")
                cuts.append(ideal_end)
                last_cut = ideal_end

        cuts.append(total_sec)
        return cuts

    # ── materialização dos chunks em disco ───────────────────────────────────

    def _materialise_chunks(
        self,
        wav_path: str,
        cut_points: list[float],
        total_sec: float,
        tmp_dir: str | None,
    ) -> SplitPlan:
        plan = SplitPlan(total_duration=total_sec)
        forced = 0

        for i in range(len(cut_points) - 1):
            content_start = cut_points[i]
            content_end   = cut_points[i + 1]

            # adiciona overlap: 2s antes (se não for o primeiro) e 2s depois (se não for o último)
            has_pre  = i > 0
            has_post = i < len(cut_points) - 2

            audio_start = max(0.0,        content_start - (self.overlap_sec if has_pre  else 0.0))
            audio_end   = min(total_sec,  content_end   + (self.overlap_sec if has_post else 0.0))

            # detecta se esse corte foi forçado (sem silêncio)
            if has_post and (content_end - content_start) >= self.max_chunk_sec - 0.5:
                forced += 1

            # gera arquivo de chunk
            chunk_path = self._extract_wav(
                wav_path, audio_start, audio_end - audio_start, tmp_dir, index=i
            )

            chunk = AudioChunk(
                index=i,
                path=chunk_path,
                content_start=content_start,
                content_end=content_end,
                audio_start=audio_start,
                audio_end=audio_end,
                has_overlap_pre=has_pre,
                has_overlap_post=has_post,
            )
            plan.chunks.append(chunk)
            plan.silence_count = len(cut_points) - 2 - forced
            plan.forced_cuts   = forced

            log.debug(
                f"[splitter] chunk {i:04d}: "
                f"content=[{content_start:.2f}s → {content_end:.2f}s] "
                f"audio=[{audio_start:.2f}s → {audio_end:.2f}s] "
                f"pre={has_pre} post={has_post}"
            )

        log.info(
            f"[splitter] {len(plan.chunks)} chunk(s) criado(s) | "
            f"cortes naturais={plan.silence_count} forçados={plan.forced_cuts}"
        )
        return plan

    def _single_chunk(
        self, wav_path: str, total_sec: float, tmp_dir: str | None
    ) -> SplitPlan:
        """Cria um SplitPlan com chunk único apontando para o próprio arquivo."""
        # Para chunk único não criamos cópia — apontamos direto pro arquivo original.
        # has_overlap_pre/post = False → pre_overlap_sec = 0, sem desconto necessário.
        chunk = AudioChunk(
            index=0,
            path=wav_path,            # sem cópia
            content_start=0.0,
            content_end=total_sec,
            audio_start=0.0,
            audio_end=total_sec,
            has_overlap_pre=False,
            has_overlap_post=False,
        )
        return SplitPlan(
            chunks=[chunk],
            total_duration=total_sec,
            silence_count=0,
            forced_cuts=0,
        )

    # ── helpers ffmpeg ────────────────────────────────────────────────────────

    def _get_duration(self, wav_path: str) -> float:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            wav_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise RuntimeError(
                f"ffprobe erro: {result.stderr.strip()}"
            )
        return float(result.stdout.strip())

    def _extract_wav(
        self,
        src: str,
        start_sec: float,
        duration_sec: float,
        tmp_dir: str | None,
        index: int,
    ) -> str:
        """Extrai trecho do WAV com seek preciso via ffmpeg."""
        suffix = f".chunk_{index:04d}.wav"
        if tmp_dir:
            dst = str(Path(tmp_dir) / f"chunk_{index:04d}.wav")
        else:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                dst = f.name

        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{start_sec:.6f}",
            "-t",  f"{duration_sec:.6f}",
            "-i",  src,
            "-c",  "copy",
            dst,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg extract chunk {index} erro: {result.stderr.strip()}"
            )
        return dst
