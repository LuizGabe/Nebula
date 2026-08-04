"""
grpc_server/health.py — Health check compatível com grpc.health.v1.

Implementa três verificações:
  1. model_ready    — modelo NeMo carregado e GPU disponível
  2. vram_available — VRAM livre > threshold configurado
  3. session_capacity — sessões ativas < MAX_SESSIONS

O protocolo grpc.health.v1 é o padrão usado por load balancers
(nginx, envoy, k8s readiness probe) para rotear tráfego.

Durante Blue-Green deploy:
  - Worker antigo: continua SERVING para sessões ativas, muda para
    NOT_SERVING quando session_count == 0
  - Worker novo: SERVING assim que modelo estiver pronto
"""

from __future__ import annotations

import logging

import grpc
from grpc_health.v1 import health_pb2, health_pb2_grpc

from core.config import Config
from inference.engine import GPUInferenceEngine
from observability.metrics import get_free_vram_mb
from session.manager import SessionManager

log = logging.getLogger("grpc_server.health")


class HealthServicer(health_pb2_grpc.HealthServicer):
    """
    Implementação do serviço de health check gRPC.

    Serviços verificados:
      ""                         → status global do worker
      "transcriber.Transcriber"  → disponibilidade do serviço principal
    """

    def __init__(
        self,
        config:          Config,
        engine:          GPUInferenceEngine,
        session_manager: SessionManager,
        draining:        bool = False,
    ) -> None:
        self._config   = config
        self._engine   = engine
        self._sessions = session_manager
        self._draining = draining   # True durante Blue-Green drain

    def set_draining(self, value: bool) -> None:
        """Ativa modo de drain — novas conexões devem ir para o novo worker."""
        self._draining = value
        log.info("health: modo draining=%s", value)

    async def Check(
        self,
        request: health_pb2.HealthCheckRequest,
        context: grpc.aio.ServicerContext,
    ) -> health_pb2.HealthCheckResponse:
        status = await self._evaluate()
        log.debug("health check service=%r → %s", request.service, _status_name(status))
        return health_pb2.HealthCheckResponse(status=status)

    async def Watch(
        self,
        request: health_pb2.HealthCheckRequest,
        context: grpc.aio.ServicerContext,
    ) -> None:
        """Streaming watch — envia status atual e notifica mudanças."""
        last_status = None
        while context.is_active():
            status = await self._evaluate()
            if status != last_status:
                await context.write(health_pb2.HealthCheckResponse(status=status))
                last_status = status
            import asyncio
            await asyncio.sleep(5.0)

    # ── avaliação ─────────────────────────────────────────────────────────────

    async def _evaluate(self) -> int:
        """
        Retorna SERVING ou NOT_SERVING baseado nos três checks.
        """
        SERVING     = health_pb2.HealthCheckResponse.SERVING
        NOT_SERVING = health_pb2.HealthCheckResponse.NOT_SERVING

        # 1. Modelo pronto
        if not self._engine.is_ready:
            log.warning("health: modelo não está pronto")
            return NOT_SERVING

        # 2. VRAM suficiente
        free_mb = get_free_vram_mb()
        if free_mb > 0 and free_mb < self._config.vram_min_free_mb:
            log.warning("health: VRAM insuficiente (%dMB livre)", free_mb)
            return NOT_SERVING

        # 3. Capacidade de sessões
        active = await self._sessions.active_count()
        if active >= self._config.max_sessions:
            log.warning("health: capacidade máxima atingida (%d sessões)", active)
            return NOT_SERVING

        # 4. Modo drain (Blue-Green)
        if self._draining:
            if active == 0:
                log.info("health: drain concluído, sem sessões ativas")
            return NOT_SERVING

        return SERVING


def _status_name(status: int) -> str:
    mapping = {
        health_pb2.HealthCheckResponse.UNKNOWN:     "UNKNOWN",
        health_pb2.HealthCheckResponse.SERVING:     "SERVING",
        health_pb2.HealthCheckResponse.NOT_SERVING: "NOT_SERVING",
    }
    return mapping.get(status, str(status))
