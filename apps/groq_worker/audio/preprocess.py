from __future__ import annotations

import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

ALLOWED_EXTENSIONS = {"flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "aac", "ogg", "wav", "webm"}
MAX_FILE_BYTES = int(19.5 * 1024 * 1024)

_OUTPUT_FORMATS = {
    "wav": ("wav", "audio/wav", ["-f", "wav", "-acodec", "pcm_s16le"]),
    "mp3": ("mp3", "audio/mpeg", ["-f", "mp3", "-codec:a", "libmp3lame", "-b:a", "64k"]),
    "flac": ("flac", "audio/flac", ["-f", "flac", "-compression_level", "8"]),
    "ogg": ("ogg", "audio/ogg", ["-f", "ogg", "-codec:a", "libopus", "-b:a", "32k"]),
}


@dataclass(frozen=True)
class PreparedAudio:
    filename: str
    content_type: str
    data: bytes
    duration_factor: float


def validate_input_audio(filename: str, raw_bytes: bytes) -> str:
    if not raw_bytes:
        raise ValueError("Arquivo de audio vazio")

    ext = Path(filename).suffix.lower().lstrip(".")
    if ext not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise ValueError(f"Tipo de audio nao suportado: .{ext or 'sem extensao'}; permitidos: {allowed}")
    return ext


def prepare_audio_for_groq(
    raw_bytes: bytes,
    filename: str,
    *,
    target_format: str = "wav",
    max_bytes: int = MAX_FILE_BYTES,
    speed: float = 1.08,
    timeout_sec: int = 300,
    start_sec: float = 0,
    duration_sec: float | None = None,
) -> PreparedAudio:
    ext = validate_input_audio(filename, raw_bytes)
    speed = max(0.5, min(speed, 2.0)) if speed > 0 else 1.0
    target = target_format.lower()
    if target not in _OUTPUT_FORMATS:
        raise ValueError(f"Formato alvo nao suportado: {target}")

    prepared = _run_ffmpeg(
        raw_bytes,
        input_ext=ext,
        output_format=target,
        speed=speed,
        timeout_sec=timeout_sec,
        start_sec=start_sec,
        duration_sec=duration_sec,
    )

    if len(prepared) > max_bytes and target != "mp3":
        prepared = _run_ffmpeg(
            raw_bytes,
            input_ext=ext,
            output_format="mp3",
            speed=speed,
            timeout_sec=timeout_sec,
            start_sec=start_sec,
            duration_sec=duration_sec,
        )
        target = "mp3"

    if len(prepared) > max_bytes:
        speed = max(speed, 1.15)
        prepared = _run_ffmpeg(
            raw_bytes,
            input_ext=ext,
            output_format="mp3",
            speed=speed,
            timeout_sec=timeout_sec,
            bitrate="32k",
            start_sec=start_sec,
            duration_sec=duration_sec,
        )
        target = "mp3"

    if len(prepared) > max_bytes:
        raise ValueError(
            f"Audio preparado excede {max_bytes} bytes ({len(prepared)} bytes). "
            "Divida o upload em arquivos menores."
        )

    out_ext, content_type, _ = _OUTPUT_FORMATS[target]
    return PreparedAudio(
        filename=f"audio.{out_ext}",
        content_type=content_type,
        data=prepared,
        duration_factor=speed if speed > 0 else 1.0,
    )


def _run_ffmpeg(
    raw_bytes: bytes,
    *,
    input_ext: str,
    output_format: str,
    speed: float,
    timeout_sec: int,
    bitrate: str | None = None,
    start_sec: float = 0,
    duration_sec: float | None = None,
) -> bytes:
    out_ext, _content_type, output_args = _OUTPUT_FORMATS[output_format]
    if bitrate and output_format == "mp3":
        output_args = ["-f", "mp3", "-codec:a", "libmp3lame", "-b:a", bitrate]

    temp_file_path = None
    input_data = raw_bytes
    input_arg = "pipe:0"

    use_temp_file = input_ext in {"m4a", "mp4", "mov", "3gp"} or duration_sec is not None
    try:
        if use_temp_file:
            with tempfile.NamedTemporaryFile(suffix=f".{input_ext}", delete=False) as tmp:
                tmp.write(raw_bytes)
                temp_file_path = tmp.name
            input_arg = temp_file_path
            input_data = None

        filters = [
            "highpass=f=80",
            "lowpass=f=7600",
            "loudnorm=I=-18:TP=-2:LRA=11",
        ]
        if speed and abs(speed - 1.0) > 0.001:
            filters.append(_atempo_filter(speed))

        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            *(["-ss", str(start_sec)] if start_sec else []),
            *(["-t", str(duration_sec)] if duration_sec is not None else []),
            "-i",
            input_arg,
            "-vn",
            "-map_metadata",
            "-1",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-af",
            ",".join(filters),
            *output_args,
            "pipe:1",
        ]

        proc = subprocess.run(
            cmd,
            input=input_data,
            capture_output=True,
            timeout=timeout_sec,
        )
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
            except OSError:
                pass

    stderr = proc.stderr.decode("utf-8", errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg falhou (code={proc.returncode}): {stderr[:500]}")
    if not proc.stdout:
        raise RuntimeError(f"ffmpeg nao produziu audio de saida: {stderr[:500]}")
    return proc.stdout


def _atempo_filter(speed: float) -> str:
    speed = max(0.5, min(speed, 2.0))
    return f"atempo={speed:.3f}"
