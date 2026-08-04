import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Optional
from enum import Enum

from infra.database import Database
from infra.redis_connection import RedisConnection
from events.enums import EventType

log = logging.getLogger("events.service")

@dataclass
class Event:
    session_id: str
    event_type: EventType
    payload: dict[str, Any] = field(default_factory=dict)
    timestamp_ms: Optional[int] = None

class EventService:
    def __init__(self, db: Database, redis: RedisConnection, event_channel: str = "status_events"):
        self._db = db
        self._redis = redis
        self._channel = event_channel
        self._queue: asyncio.Queue[Event] = asyncio.Queue()
        self._task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self):
        """Inicia o worker de fundo que processa a fila de eventos."""
        self._running = True
        self._task = asyncio.create_task(self._processor_loop())
        log.info("EventService iniciado")

    async def stop(self):
        """Encerra o worker aguardando os eventos pendentes."""
        self._running = False
        if self._task:
            await self._task
        log.info("EventService encerrado")

    async def emit(self, session_id: str, event_type: EventType, payload: dict[str, Any] = None):
        """Enfileira um evento para processamento assíncrono (non-blocking)."""
        event = Event(session_id=session_id, event_type=event_type, payload=payload or {})
        await self._queue.put(event)

    async def _processor_loop(self):
        """Consome eventos da fila, publica no Redis e persiste no banco."""
        while self._running or not self._queue.empty():
            try:
                event = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            try:
                # Publicação no Redis
                message = {
                    "session_id": event.session_id,
                    "event_type": event.event_type.value,
                    "timestamp_ms": event.timestamp_ms or int(asyncio.get_event_loop().time() * 1000),
                    "payload": event.payload,
                }
                channel = f"session:status:{event.session_id}"
                await self._redis.publish(channel=channel, message=json.dumps(message))

                # Persistência no banco (append-only)
                await self._db.save_event(
                    session_id=event.session_id,
                    event_type=event.event_type.value,
                    payload=event.payload,
                )
            except Exception as exc:
                log.error("Falha ao processar evento: %s", exc, exc_info=True)
            finally:
                self._queue.task_done()