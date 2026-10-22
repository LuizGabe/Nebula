from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from events.enums import EventType

log = logging.getLogger("events.service")


@dataclass
class Event:
    session_id: str
    event_type: EventType
    payload: dict[str, Any] = field(default_factory=dict)


class EventService:
    def __init__(self, db: object, redis: object) -> None:
        self._db = db
        self._redis = redis
        self._queue: asyncio.Queue[Event] = asyncio.Queue()
        self._task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._processor_loop(), name="event-service")
        log.info("EventService iniciado")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            await self._task
        log.info("EventService encerrado")

    async def emit(self, session_id: str, event_type: EventType, payload: dict[str, Any] | None = None) -> None:
        await self._queue.put(Event(session_id=session_id, event_type=event_type, payload=payload or {}))

    async def flush(self) -> None:
        await self._queue.join()

    async def _processor_loop(self) -> None:
        while self._running or not self._queue.empty():
            try:
                event = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            try:
                message = {
                    "session_id": event.session_id,
                    "event_type": event.event_type.value,
                    "timestamp_ms": int(asyncio.get_event_loop().time() * 1000),
                    "payload": event.payload,
                }
                await self._db.save_event(
                    session_id=event.session_id,
                    event_type=event.event_type.value,
                    payload=event.payload,
                )
                await self._redis.publish(
                    channel=f"session:status:{event.session_id}",
                    message=json.dumps(message),
                )
            except Exception as exc:
                log.error("Falha ao processar evento: %s", exc, exc_info=True)
            finally:
                self._queue.task_done()
