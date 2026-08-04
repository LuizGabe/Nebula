"""
observability/tracing.py — Configuração do OpenTelemetry.

Cria um TracerProvider com exporter OTLP (gRPC) para Jaeger/Grafana Tempo.
Se OTEL_ENDPOINT estiver vazio, usa NoOpTracerProvider (sem overhead).

Uso:
    from observability.tracing import get_tracer, start_session_span

    tracer = get_tracer("inference.engine")
    with tracer.start_as_current_span("gpu_inference") as span:
        span.set_attribute("session_id", session_id)
        span.set_attribute("audio_duration_ms", duration_ms)
        ...
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator

log = logging.getLogger("observability.tracing")

# Flags de disponibilidade
try:
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    _OTEL_AVAILABLE = True
except ImportError:
    _OTEL_AVAILABLE = False

_provider_initialized = False


def init_tracing(endpoint: str, service_name: str = "parakeet-worker") -> None:
    """
    Inicializa o TracerProvider global.
    Deve ser chamada uma vez no startup, antes de qualquer get_tracer().

    endpoint: URL do OTLP collector gRPC (ex: "http://jaeger:4317").
              String vazia desabilita — usa NoOp sem overhead.
    """
    global _provider_initialized

    if not _OTEL_AVAILABLE:
        log.warning("opentelemetry não disponível — tracing desabilitado")
        return

    if not endpoint:
        log.info("OTEL_ENDPOINT vazio — tracing desabilitado (NoOp)")
        return

    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)
    provider.add_span_processor(BatchSpanProcessor(exporter))

    trace.set_tracer_provider(provider)
    _provider_initialized = True
    log.info("OpenTelemetry inicializado → %s", endpoint)


def get_tracer(name: str) -> "trace.Tracer":
    """Retorna um Tracer para o módulo informado."""
    if not _OTEL_AVAILABLE:
        return _NoOpTracer()  # type: ignore[return-value]
    from opentelemetry import trace as _trace
    return _trace.get_tracer(name)


@contextmanager
def session_span(
    session_id: str,
    job_type: str = "stream",
) -> Iterator[object]:
    """
    Context manager que abre um span raiz para uma sessão completa.
    Injeta session_id e job_type como atributos.

    Uso:
        with session_span(session_id) as span:
            span.set_attribute("language_hint", "pt")
            ...
    """
    tracer = get_tracer("session")
    with tracer.start_as_current_span(f"session.{job_type}") as span:
        if _OTEL_AVAILABLE:
            span.set_attribute("session.id",   session_id)
            span.set_attribute("session.type", job_type)
        yield span


@contextmanager
def inference_span(
    session_id: str,
    audio_duration_ms: int,
    job_type: str = "stream",
) -> Iterator[object]:
    """
    Context manager para um único ciclo de inferência GPU.
    Deve ser usado dentro de session_span.
    """
    tracer = get_tracer("inference")
    with tracer.start_as_current_span("gpu.inference") as span:
        if _OTEL_AVAILABLE:
            span.set_attribute("session.id",        session_id)
            span.set_attribute("audio.duration_ms", audio_duration_ms)
            span.set_attribute("job.type",          job_type)
        yield span


# ── stub no-op para quando OTEL não está disponível ──────────────────────────

class _NoOpSpan:
    def set_attribute(self, *a, **kw) -> None: pass
    def record_exception(self, *a, **kw) -> None: pass
    def set_status(self, *a, **kw) -> None: pass
    def __enter__(self): return self
    def __exit__(self, *a): pass


class _NoOpTracer:
    def start_as_current_span(self, *a, **kw):
        return _NoOpSpan()

    def start_span(self, *a, **kw):
        return _NoOpSpan()
