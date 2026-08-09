from __future__ import annotations

import os
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

import dotenv

_current = Path(__file__).resolve()
for _parent in [_current] + list(_current.parents):
    _env_path = _parent / ".env"
    if _env_path.exists():
        dotenv.load_dotenv(_env_path)
        break


@dataclass(frozen=True)
class Config:
    groq_api_key: str
    groq_base_url: str
    groq_model: str
    groq_timeout_sec: float

    max_groq_file_mb: float
    audio_speed: float
    audio_target_format: str
    ffmpeg_timeout_sec: int

    batch_concurrency: int

    database_url: str
    redis_url: str
    redis_host: str
    redis_port: int

    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str
    minio_secure: bool

    queue_post_processing: str
    queue_transcription_jobs: str

    metrics_port: int
    otel_endpoint: str
    log_level: str
    log_format: str


def load_config() -> Config:
    redis_url = _require("REDIS_URL")
    parsed = urllib.parse.urlparse(redis_url)

    return Config(
        groq_api_key=_require("GROQ_API_KEY"),
        groq_base_url=os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
        groq_model=os.environ.get("GROQ_MODEL", "whisper-large-v3-turbo"),
        groq_timeout_sec=float(os.environ.get("GROQ_TIMEOUT_SEC", "120")),
        max_groq_file_mb=float(os.environ.get("GROQ_MAX_FILE_MB", "19.5")),
        audio_speed=float(os.environ.get("GROQ_AUDIO_SPEED", "1.08")),
        audio_target_format=os.environ.get("GROQ_AUDIO_TARGET_FORMAT", "wav").lower(),
        ffmpeg_timeout_sec=int(os.environ.get("FFMPEG_TIMEOUT_SEC", "300")),
        batch_concurrency=int(os.environ.get("BATCH_CONCURRENCY", "1")),
        database_url=_require("DATABASE_URL"),
        redis_url=redis_url,
        redis_host=parsed.hostname or "localhost",
        redis_port=parsed.port or 6379,
        minio_endpoint=_require("MINIO_ENDPOINT"),
        minio_access_key=_require("MINIO_ACCESS_KEY"),
        minio_secret_key=_require("MINIO_SECRET_KEY"),
        minio_bucket=os.environ.get("MINIO_BUCKET", "transcriber"),
        minio_secure=os.environ.get("MINIO_SECURE", "false").lower() == "true",
        queue_post_processing=os.environ.get("QUEUE_POST_PROCESSING", "post-processing"),
        queue_transcription_jobs=os.environ.get("QUEUE_TRANSCRIPTION_JOBS", "transcription-jobs"),
        metrics_port=int(os.environ.get("METRICS_PORT", "9091")),
        otel_endpoint=os.environ.get("OTEL_ENDPOINT", ""),
        log_level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        log_format=os.environ.get("LOG_FORMAT", "text").lower(),
    )


def _require(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        raise RuntimeError(f"Variavel de ambiente obrigatoria ausente: {key}")
    return value
