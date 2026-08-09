from __future__ import annotations

import asyncio
import logging
import signal
import sys

from batch.handler import BatchHandler
from core.config import load_config
from core.logging import setup_logging
from events.service import EventService
from inference.groq_client import GroqTranscriptionClient
from infra.bullmq_client import BullMQClient
from infra.bullmq_consumer import BullMQConsumer
from infra.database import Database
from infra.minio_client import MinIOClient
from infra.redis_connection import RedisConnection
from observability.metrics import start_metrics_server
from observability.tracing import init_tracing


async def main() -> None:
    setup_logging()
    config = load_config()
    setup_logging(config.log_level, config.log_format)
    log = logging.getLogger("worker")
    log.info("Groq batch worker iniciando")

    start_metrics_server(config.metrics_port)
    init_tracing(config.otel_endpoint, service_name="groq-worker")

    db = Database(config.database_url)
    await db.connect()

    redis_conn = RedisConnection(config.redis_url)
    await redis_conn.connect()

    event_service = EventService(db, redis_conn)
    await event_service.start()

    minio = MinIOClient(config)
    bullmq = BullMQClient(config.redis_url, config.queue_post_processing, event_service=event_service)
    await bullmq.connect()

    groq = GroqTranscriptionClient(
        api_key=config.groq_api_key,
        base_url=config.groq_base_url,
        model=config.groq_model,
        timeout_sec=config.groq_timeout_sec,
    )

    batch_handler = BatchHandler.init_instance(
        config=config,
        groq=groq,
        database=db,
        bullmq=bullmq,
        minio=minio,
        redis_conn=redis_conn,
        event_service=event_service,
    )
    await batch_handler.start()

    bullmq_consumer = BullMQConsumer(
        redis_url=config.redis_url,
        queue_name=config.queue_transcription_jobs,
        batch_handler=batch_handler,
    )
    await bullmq_consumer.start(concurrency=config.batch_concurrency)

    shutdown_event = asyncio.Event()

    def _handle_signal(sig: int) -> None:
        log.info("sinal %s recebido; encerrando", signal.Signals(sig).name)
        shutdown_event.set()

    loop = asyncio.get_running_loop()
    if sys.platform == "win32":
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda s, f, sig=sig: loop.call_soon_threadsafe(_handle_signal, sig))
    else:
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, _handle_signal, sig)

    log.info("groq worker pronto; aguardando jobs batch")
    await shutdown_event.wait()

    await bullmq_consumer.stop()
    await batch_handler.stop()
    await bullmq.disconnect()
    await event_service.stop()
    await redis_conn.disconnect()
    await db.disconnect()
    log.info("groq worker encerrado")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
