"""
session/manager.py — Gerenciamento de ciclo de vida das sessões de transcrição.

Mudança em relação à versão NeMo:
  - VadGate removido do Session — VAD é responsabilidade do faster-whisper
    (vad_filter=True interno). A Session não precisa mais de estado de VAD.
  - A lógica de janela deslizante (quando inferir, quando fazer flush)
    está no servicer._receive_loop.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Optional

from core.config import Config
from core.logging import session_logger
from observability.metrics import ACTIVE_SESSIONS, SESSIONS_TOTAL, get_free_vram_mb
from session.audio_buffer import AudioBuffer

log = logging.getLogger("session.manager")


class SessionStatus(Enum):
    ACTIVE    = auto()
    DRAINING  = auto()
    TIMED_OUT = auto()
    CLOSED    = auto()
    ERROR     = auto()


@dataclass
class Session:
    id:            str
    status:        SessionStatus
    buffer:        AudioBuffer
    mode:          str           # "MEETING" | "CLASS"
    language_hint: str
    grpc_context:  object        # grpc.ServicerContext
    created_at:    float = field(default_factory=time.monotonic)
    last_active:   float = field(default_factory=time.monotonic)

    # Contexto de transcrição acumulado em memória (frases consolidadas)
    transcript_ctx: list[str] = field(default_factory=list)

    # Fila onde o servicer deposita resultados para o send_loop
    result_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    
    chunk_counter: int = 0

    def touch(self) -> None:
        self.last_active = time.monotonic()

    def age_sec(self) -> float:
        return time.monotonic() - self.last_active

    def is_grpc_alive(self) -> bool:
        try:
            # No grpc.aio, se o cliente desconectar, o contexto sinaliza cancelamento
            # ou a chamada é marcada como concluída/fechada.
            if self.grpc_context.done():
                return False
            return True
        except Exception as e:
            log.debug("Erro ao checar status do gRPC: %s", e)
            return False

    @property
    def log(self):
        return session_logger("session", self.id)


class SessionManager:
    """
    Registro centralizado de todas as sessões ativas.
    Thread-safe via asyncio.Lock.
    """

    def __init__(self, config: Config) -> None:
        self._config   = config
        self._sessions: dict[str, Session] = {}
        self._lock     = asyncio.Lock()

    # ── criação ───────────────────────────────────────────────────────────────

    async def create(
        self,
        session_id:    str,
        grpc_context:  object,
        mode:          str = "MEETING",
        language_hint: str = "pt",
    ) -> Session:
        async with self._lock:
            self._check_capacity()

            session = Session(
                id=session_id,
                status=SessionStatus.ACTIVE,
                buffer=AudioBuffer(session_id),
                mode=mode,
                language_hint=language_hint,
                grpc_context=grpc_context,
            )
            self._sessions[session_id] = session

        ACTIVE_SESSIONS.inc()
        SESSIONS_TOTAL.inc()
        log.info("sessão criada session=%s mode=%s", session_id, mode)
        return session

    # ── leitura ───────────────────────────────────────────────────────────────

    async def get(self, session_id: str) -> Optional[Session]:
        async with self._lock:
            return self._sessions.get(session_id)

    async def active_count(self) -> int:
        async with self._lock:
            return len(self._sessions)

    async def all_sessions(self) -> list[Session]:
        async with self._lock:
            return list(self._sessions.values())

    # ── encerramento ──────────────────────────────────────────────────────────

    async def close(self, session_id: str, status: SessionStatus = SessionStatus.CLOSED) -> None:
        async with self._lock:
            session = self._sessions.pop(session_id, None)

        if session is None:
            return

        session.status = status
        session.buffer.clear()
        await session.result_queue.put(None)

        ACTIVE_SESSIONS.dec()
        log.info("sessão encerrada session=%s status=%s", session_id, status.name)

    # ── watchdog ──────────────────────────────────────────────────────────────

    async def watchdog(self) -> None:
        log.info("watchdog de sessões iniciado (timeout=%.1fs)", self._config.session_timeout_sec)
        while True:
            await asyncio.sleep(5)
            await self._tick()

    async def _tick(self) -> None:
        now = time.monotonic()
        async with self._lock:
            stale: list[str] = []
            for sid, session in self._sessions.items():
                if session.status == SessionStatus.ACTIVE and not session.is_grpc_alive():
                    log.warning("sessão desconectada session=%s", sid)
                    stale.append(sid)
                    continue
                age = now - session.last_active
                if age > self._config.session_timeout_sec:
                    log.warning("sessão expirada session=%s age=%.1fs", sid, age)
                    stale.append(sid)

        for sid in stale:
            await self.close(sid, SessionStatus.TIMED_OUT)

    # ── capacidade ────────────────────────────────────────────────────────────

    def _check_capacity(self) -> None:
        if len(self._sessions) >= self._config.max_sessions:
            raise RuntimeError(
                f"capacidade máxima atingida ({self._config.max_sessions} sessões)"
            )
        free_mb = get_free_vram_mb()
        if free_mb > 0 and free_mb < self._config.vram_min_free_mb:
            raise RuntimeError(
                f"VRAM insuficiente: {free_mb}MB livre < mínimo {self._config.vram_min_free_mb}MB"
            )
