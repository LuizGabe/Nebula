from __future__ import annotations

import logging

log = logging.getLogger("observability.tracing")


def init_tracing(endpoint: str, service_name: str = "groq-worker") -> None:
    if endpoint:
        log.info("OTel endpoint configurado para %s service=%s", endpoint, service_name)
