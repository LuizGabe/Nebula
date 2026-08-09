from __future__ import annotations

import logging

from prometheus_client import Counter, Gauge, start_http_server

log = logging.getLogger("observability.metrics")

BATCH_QUEUE_SIZE = Gauge("groq_worker_batch_queue_size", "Jobs aguardando na fila batch interna")
ERRORS_TOTAL = Counter("groq_worker_errors_total", "Erros do worker", ["layer", "error_type"])


def start_metrics_server(port: int) -> None:
    try:
        start_http_server(port)
        log.info("Prometheus metrics ouvindo em :%d", port)
    except OSError as exc:
        log.warning("nao foi possivel iniciar metrics server na porta %d: %s", port, exc)
