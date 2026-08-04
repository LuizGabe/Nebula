"""
worker.py — Entrypoint do Worker (faster-whisper / CTranslate2, GPU-first).

Ordem de startup:
  1. Logging + Config
  2. NVML (métricas GPU) + servidor Prometheus
  3. OpenTelemetry tracing
  4. Injeção de LD_LIBRARY_PATH (cuBLAS/cuDNN via pip) + WhisperModel
  5. Infraestrutura (DB, Redis, MinIO)
  6. SessionManager + GPUDispatcher
  7. BatchHandler
  8. gRPC server (Transcriber + Health)
  9. Watchdog de sessões
  10. Loop principal + graceful shutdown (drain)
"""

from __future__ import annotations

import asyncio
import logging
import signal
import sys

import grpc
from grpc_health.v1 import health_pb2_grpc

from core.config import load_config
from core.logging import setup_logging
from batch.handler import BatchHandler
from grpc_server.health import HealthServicer
from grpc_server.servicer import TranscriberServicer
from inference.dispatcher import GPUDispatcher
from inference.engine import WhisperInferenceEngine
from infra.bullmq_client import BullMQClient
from infra.bullmq_consumer import BullMQConsumer
from infra.database import Database
from infra.minio_client import MinIOClient
from observability.metrics import (
    init_nvml,
    shutdown_nvml,
    start_gpu_collector,
    start_metrics_server,
)
from observability.tracing import init_tracing
from proto import transcriber_pb2_grpc as pb2_grpc
from session.manager import SessionManager
from infra.redis_connection import RedisConnection
from events.service import EventService


async def main() -> None:
    # ── 1. Logging + Config ───────────────────────────────────────────────────
    setup_logging()
    config = load_config()
    setup_logging(config.log_level, config.log_format)
    log = logging.getLogger("worker")
    log.info("Worker iniciando (faster-whisper)…")

    # ── 2. NVML + Prometheus ──────────────────────────────────────────────────
    init_nvml()
    start_gpu_collector(interval_sec=5.0)
    start_metrics_server(config.metrics_port)

    # ── 3. OpenTelemetry ──────────────────────────────────────────────────────
    init_tracing(config.otel_endpoint, service_name="whisper-worker")

    # ── 4. WhisperModel ───────────────────────────────────────────────────────
    # _inject_cuda_libs() é chamado dentro do create() antes de qualquer
    # import do CTranslate2/faster-whisper.
    log.info("carregando WhisperModel → device=%s compute=%s",
             config.model_device, config.compute_type)
    engine = WhisperInferenceEngine.create(
        model_path=config.model_path,
        device=config.model_device,
        compute_type=config.compute_type,
        cpu_threads=config.cpu_threads,
    )
    log.info("modelo pronto device=%s", engine.device)

    # ── 5. Infraestrutura ─────────────────────────────────────────────────────
    db = Database(config.database_url)
    await db.connect()

    minio = MinIOClient(config)

    # ── 6. SessionManager + Dispatcher ───────────────────────────────────────
    session_manager = SessionManager(config)
    dispatcher = GPUDispatcher()
    await dispatcher.start()

    redis_conn = RedisConnection(config.redis_url)
    await redis_conn.connect()

    # redis_conn é a instância de RedisConnection
    event_service = EventService(db, redis_conn)
    await event_service.start()
    
    bullmq = BullMQClient(config.redis_url, config.queue_post_processing, event_service=event_service)
    await bullmq.connect()

    # ── 7. BatchHandler ───────────────────────────────────────────────────────
    batch_handler = BatchHandler.init_instance(
        config=config,
        engine=engine,
        dispatcher=dispatcher,
        database=db,
        bullmq=bullmq,
        minio=minio,
        redis_conn=redis_conn,
        event_service=event_service
    )
    await batch_handler.start()

    # ── 7b. BullMQ Worker (uploads assíncronos via fila) ──────────────────────
    bullmq_consumer = BullMQConsumer(
        redis_url=config.redis_url,
        queue_name=config.queue_transcription_jobs,
        batch_handler=batch_handler,
    )
    await bullmq_consumer.start(concurrency=config.batch_concurrency)

    # ── 8. gRPC server ────────────────────────────────────────────────────────
    servicer = TranscriberServicer(
        config=config,
        session_manager=session_manager,
        engine=engine,
        dispatcher=dispatcher,
        redis_conn=redis_conn,
        event_service=event_service,
        database=db
    )

    health_servicer = HealthServicer(
        config=config,
        engine=engine,
        session_manager=session_manager,
    )

    server = grpc.aio.server(
        options=[
            ("grpc.max_receive_message_length",
             config.grpc_max_recv_mb * 1024 * 1024),
            ("grpc.keepalive_time_ms",              30_000),
            ("grpc.keepalive_timeout_ms",            5_000),
            ("grpc.keepalive_permit_without_calls",  True),
            ("grpc.http2.min_ping_interval_without_data_ms", 10_000),
        ]
    )

    pb2_grpc.add_TranscriberServicer_to_server(servicer, server)
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)

    listen_addr = f"{config.grpc_host}:{config.grpc_port}"
    server.add_insecure_port(listen_addr)
    await server.start()
    log.info("gRPC server ouvindo em %s", listen_addr)

    # ── 9. Watchdog de sessões ────────────────────────────────────────────────
    watchdog_task = asyncio.create_task(
        session_manager.watchdog(),
        name="session-watchdog",
    )

    # ── 10. Graceful shutdown ─────────────────────────────────────────────────
    shutdown_event = asyncio.Event()

    def _handle_signal(sig: int) -> None:
        log.info("sinal %s recebido — iniciando shutdown gracioso",
                 signal.Signals(sig).name)
        shutdown_event.set()

    loop = asyncio.get_running_loop()
    if sys.platform == "win32":
        # No Windows, usamos call_soon_threadsafe para disparar a função síncrona com segurança
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda s, f, sig=sig: loop.call_soon_threadsafe(
                _handle_signal, sig))
    else:
        # No Linux/Mac, passamos a função síncrona direto para o add_signal_handler
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, _handle_signal, sig)

    log.info("worker pronto — aguardando conexões")
    await shutdown_event.wait()

    # ── Drain ─────────────────────────────────────────────────────────────────
    log.info("iniciando drain de sessões…")
    health_servicer.set_draining(True)

    drain_timeout = config.session_timeout_sec * 2
    deadline = loop.time() + drain_timeout

    while loop.time() < deadline:
        active = await session_manager.active_count()
        if active == 0:
            break
        log.info("drain: %d sessão(ões) ainda ativas…", active)
        await asyncio.sleep(2.0)

    active = await session_manager.active_count()
    if active > 0:
        log.warning(
            "drain timeout: %d sessão(ões) forçadamente encerradas", active)

    watchdog_task.cancel()
    try:
        await watchdog_task
    except asyncio.CancelledError:
        pass

    await bullmq_consumer.stop()
    await batch_handler.stop()
    await dispatcher.stop()
    await server.stop(grace=5)
    await db.disconnect()
    await bullmq.disconnect()
    await event_service.stop()
    shutdown_nvml()

    log.info("worker encerrado")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    sys.exit(0)
