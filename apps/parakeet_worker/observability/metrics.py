"""
observability/metrics.py — Métricas Prometheus do worker.

Todas as métricas são singletons de módulo. Importar em qualquer camada
e chamar diretamente — sem passar instâncias por parâmetro.

Métricas expostas:
  worker_active_sessions          Gauge    — streams abertos agora
  worker_gpu_utilization_percent  Gauge    — % de uso da GPU (via pynvml)
  worker_vram_used_bytes          Gauge    — VRAM em uso (bytes)
  worker_vram_total_bytes         Gauge    — VRAM total (bytes)
  worker_inference_duration_ms    Histogram — latência de inferência por tipo
  worker_stream_latency_ms        Histogram — tempo entre chunk recebido e resultado enviado
  worker_batch_queue_size         Gauge    — jobs aguardando na fila batch
  worker_stream_queue_size        Gauge    — utterances aguardando na fila stream
  worker_sessions_total           Counter  — total de sessões abertas (lifetime)
  worker_errors_total             Counter  — erros por tipo e camada
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Optional

try:
    import pynvml
    _NVML_AVAILABLE = True
except ImportError:
    _NVML_AVAILABLE = False

try:
    from prometheus_client import (
        Counter,
        Gauge,
        Histogram,
        start_http_server,
        REGISTRY,
    )
    _PROMETHEUS_AVAILABLE = True
except ImportError:
    _PROMETHEUS_AVAILABLE = False

log = logging.getLogger("observability.metrics")

# ── definição das métricas ────────────────────────────────────────────────────

if _PROMETHEUS_AVAILABLE:
    ACTIVE_SESSIONS = Gauge(
        "worker_active_sessions",
        "Número de streams gRPC ativos no momento",
    )
    GPU_UTILIZATION = Gauge(
        "worker_gpu_utilization_percent",
        "Percentual de utilização da GPU (0-100)",
    )
    VRAM_USED = Gauge(
        "worker_vram_used_bytes",
        "VRAM em uso em bytes",
    )
    VRAM_TOTAL = Gauge(
        "worker_vram_total_bytes",
        "VRAM total disponível em bytes",
    )
    INFERENCE_DURATION = Histogram(
        "worker_inference_duration_ms",
        "Latência de inferência GPU em milissegundos",
        labelnames=["job_type"],   # "stream" | "batch"
        buckets=[50, 100, 200, 500, 1000, 2000, 5000],
    )
    STREAM_LATENCY = Histogram(
        "worker_stream_latency_ms",
        "Tempo entre recebimento do chunk e envio do resultado (ms)",
        buckets=[100, 200, 500, 1000, 2000, 5000],
    )
    BATCH_QUEUE_SIZE = Gauge(
        "worker_batch_queue_size",
        "Jobs de upload aguardando processamento",
    )
    STREAM_QUEUE_SIZE = Gauge(
        "worker_stream_queue_size",
        "Utterances aguardando inferência na fila stream",
    )
    SESSIONS_TOTAL = Counter(
        "worker_sessions_total",
        "Total de sessões abertas desde o início do worker",
    )
    ERRORS_TOTAL = Counter(
        "worker_errors_total",
        "Total de erros por tipo e camada",
        labelnames=["layer", "error_type"],
    )
else:
    # Stubs no-op para ambientes sem prometheus_client
    class _Noop:
        def inc(self, *a, **kw): pass
        def dec(self, *a, **kw): pass
        def set(self, *a, **kw): pass
        def observe(self, *a, **kw): pass
        def labels(self, *a, **kw): return self
        def __call__(self, *a, **kw): return self

    ACTIVE_SESSIONS     = _Noop()  # type: ignore[assignment]
    GPU_UTILIZATION     = _Noop()  # type: ignore[assignment]
    VRAM_USED           = _Noop()  # type: ignore[assignment]
    VRAM_TOTAL          = _Noop()  # type: ignore[assignment]
    INFERENCE_DURATION  = _Noop()  # type: ignore[assignment]
    STREAM_LATENCY      = _Noop()  # type: ignore[assignment]
    BATCH_QUEUE_SIZE    = _Noop()  # type: ignore[assignment]
    STREAM_QUEUE_SIZE   = _Noop()  # type: ignore[assignment]
    SESSIONS_TOTAL      = _Noop()  # type: ignore[assignment]
    ERRORS_TOTAL        = _Noop()  # type: ignore[assignment]


# ── servidor HTTP de métricas ─────────────────────────────────────────────────

def start_metrics_server(port: int) -> None:
    """Inicia o servidor HTTP para scraping Prometheus em background."""
    if not _PROMETHEUS_AVAILABLE:
        log.warning("prometheus_client não disponível — servidor de métricas desabilitado")
        return
    start_http_server(port)
    log.info("servidor de métricas Prometheus em :%d/metrics", port)


# ── coleta de métricas GPU ────────────────────────────────────────────────────

_nvml_handle: Optional[object] = None
_nvml_lock   = threading.Lock()


def init_nvml() -> bool:
    """Inicializa pynvml. Retorna True se bem-sucedido."""
    global _nvml_handle
    if not _NVML_AVAILABLE:
        log.warning("pynvml não disponível — métricas de GPU desabilitadas")
        return False
    try:
        pynvml.nvmlInit()
        _nvml_handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        name = pynvml.nvmlDeviceGetName(_nvml_handle)
        log.info("GPU detectada: %s", name)
        return True
    except Exception as exc:
        log.warning("falha ao inicializar pynvml: %s", exc)
        return False


def collect_gpu_metrics() -> None:
    """Atualiza as métricas de GPU/VRAM. Deve ser chamada periodicamente."""
    if _nvml_handle is None:
        return
    try:
        with _nvml_lock:
            util  = pynvml.nvmlDeviceGetUtilizationRates(_nvml_handle)
            mem   = pynvml.nvmlDeviceGetMemoryInfo(_nvml_handle)
        GPU_UTILIZATION.set(util.gpu)
        VRAM_USED.set(mem.used)
        VRAM_TOTAL.set(mem.total)
    except Exception as exc:
        log.debug("falha ao coletar métricas GPU: %s", exc)


def get_free_vram_mb() -> int:
    """Retorna VRAM livre em MB. Retorna 0 se pynvml não disponível."""
    if _nvml_handle is None:
        return 0
    try:
        with _nvml_lock:
            mem = pynvml.nvmlDeviceGetMemoryInfo(_nvml_handle)
        return mem.free // (1024 * 1024)
    except Exception:
        return 0


def shutdown_nvml() -> None:
    if _NVML_AVAILABLE:
        try:
            pynvml.nvmlShutdown()
        except Exception:
            pass


# ── loop de coleta periódica ──────────────────────────────────────────────────

def start_gpu_collector(interval_sec: float = 5.0) -> threading.Thread:
    """
    Inicia thread daemon que coleta métricas GPU a cada `interval_sec`.
    Retorna a thread para o caller poder referenciá-la.
    """
    def _loop() -> None:
        while True:
            collect_gpu_metrics()
            time.sleep(interval_sec)

    t = threading.Thread(target=_loop, name="gpu-metrics-collector", daemon=True)
    t.start()
    log.info("coletor de métricas GPU iniciado (intervalo=%.1fs)", interval_sec)
    return t
