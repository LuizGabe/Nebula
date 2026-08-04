"""
core/config.py — Configuração do worker (faster-whisper).
"""

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
    # ── gRPC ──────────────────────────────────────────────────────────────────
    grpc_host:       str
    grpc_port:       int
    grpc_workers:    int
    grpc_max_recv_mb: int

    # ── modelo (faster-whisper) ───────────────────────────────────────────────
    model_path:     str    # HF repo id ou caminho local com o modelo CT2
    model_device:   str    # "cuda" | "cpu"
    compute_type:   str    # "float16" | "bfloat16" | "int8" (CPU dev)
    cpu_threads:    int    # threads CTranslate2 (ignorado em cuda)

    # ── sessão / stream ───────────────────────────────────────────────────────
    max_sessions:        int
    session_timeout_sec: float
    vram_min_free_mb:    int

    # ── scheduler ────────────────────────────────────────────────────────────
    batch_concurrency: int

    # ── banco de dados ────────────────────────────────────────────────────────
    database_url: str

    # ── Redis ────────────────────────────────────────────────────────────────
    redis_url:  str
    redis_host: str
    redis_port: int

    # ── MinIO / S3 ────────────────────────────────────────────────────────────
    minio_endpoint:   str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket:     str
    minio_secure:     bool

    # ── BullMQ ────────────────────────────────────────────────────────────────
    queue_post_processing: str
    queue_transcription_jobs: str

    # ── parâmetros de parágrafo ───────────────────────────────────────────────
    paragraph_gap_meeting: float
    paragraph_gap_class:   float

    # ── observabilidade ───────────────────────────────────────────────────────
    metrics_port:  int
    otel_endpoint: str
    log_level:     str
    log_format:    str


def load_config() -> Config:
    database_url = _require("DATABASE_URL")
    redis_url    = _require("REDIS_URL")
    _parsed      = urllib.parse.urlparse(redis_url)

    return Config(
        grpc_host        = os.environ.get("GRPC_HOST",        "0.0.0.0"),
        grpc_port        = int(os.environ.get("GRPC_PORT",        "50051")),
        grpc_workers     = int(os.environ.get("GRPC_WORKERS",     "4")),
        grpc_max_recv_mb = int(os.environ.get("GRPC_MAX_RECV_MB", "16")),

        model_path    = os.environ.get("MODEL_PATH",    "deepdml/whisper-large-v3-turbo-ct2"),
        model_device  = os.environ.get("MODEL_DEVICE",  "cuda"),
        compute_type  = os.environ.get("COMPUTE_TYPE",  "float16"),
        cpu_threads   = int(os.environ.get("CPU_THREADS", "4")),

        max_sessions        = int(os.environ.get("MAX_SESSIONS",        "8")),
        session_timeout_sec = float(os.environ.get("SESSION_TIMEOUT_SEC", "30.0")),
        vram_min_free_mb    = int(os.environ.get("VRAM_MIN_FREE_MB",    "512")),

        batch_concurrency = int(os.environ.get("BATCH_CONCURRENCY", "1")),

        database_url = database_url,
        redis_url    = redis_url,
        redis_host   = _parsed.hostname or "localhost",
        redis_port   = _parsed.port or 6379,

        minio_endpoint   = _require("MINIO_ENDPOINT"),
        minio_access_key = _require("MINIO_ACCESS_KEY"),
        minio_secret_key = _require("MINIO_SECRET_KEY"),
        minio_bucket     = os.environ.get("MINIO_BUCKET",  "transcriber"),
        minio_secure     = os.environ.get("MINIO_SECURE",  "false").lower() == "true",

        queue_post_processing = os.environ.get("QUEUE_POST_PROCESSING", "post-processing"),
        queue_transcription_jobs = os.environ.get("QUEUE_TRANSCRIPTION_JOBS", "transcription-jobs"),

        paragraph_gap_meeting = float(os.environ.get("PARAGRAPH_GAP_MEETING", "1.2")),
        paragraph_gap_class   = float(os.environ.get("PARAGRAPH_GAP_CLASS",   "2.0")),

        metrics_port  = int(os.environ.get("METRICS_PORT",  "9090")),
        otel_endpoint = os.environ.get("OTEL_ENDPOINT", ""),
        log_level     = os.environ.get("LOG_LEVEL",  "INFO").upper(),
        log_format    = os.environ.get("LOG_FORMAT", "text").lower(),
    )


def _require(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise RuntimeError(f"Variável de ambiente obrigatória ausente: {key}")
    return val
