"""
core/logging.py — Configuração centralizada de logging.

Saída em texto (dev) ou JSON estruturado (produção).
Suporta campos extras via LoggerAdapter para session_id e trace_id.

Variáveis de ambiente:
  LOG_LEVEL  → nível mínimo (default: INFO)
  LOG_FORMAT → "json" | "text" (default: text)
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any, MutableMapping


LOG_LEVEL  = os.environ.get("LOG_LEVEL",  "INFO").upper()
LOG_FORMAT = os.environ.get("LOG_FORMAT", "text").lower()


class _JsonFormatter(logging.Formatter):
    """Serializa cada LogRecord como uma linha JSON estruturada."""

    _SKIP = frozenset({
        "msg", "args", "exc_info", "exc_text", "stack_info",
        "name", "levelname", "pathname", "filename", "module",
        "lineno", "funcName", "created", "msecs", "relativeCreated",
        "thread", "threadName", "processName", "process",
        "taskName", "levelno", "getMessage",
    })

    def format(self, record: logging.LogRecord) -> str:
        record.getMessage()
        payload: dict[str, Any] = {
            "ts":      time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level":   record.levelname,
            "logger":  record.name,
            "message": record.getMessage(),
        }
        for key, val in record.__dict__.items():
            if key.startswith("_") or key in logging.LogRecord.__dict__ or key in self._SKIP:
                continue
            payload[key] = val

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(level: str = LOG_LEVEL, fmt: str = LOG_FORMAT) -> None:
    """Deve ser chamado uma vez antes de qualquer import que crie loggers."""
    root = logging.getLogger()
    root.setLevel(getattr(logging, level, logging.INFO))
    root.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(root.level)

    if fmt == "json":
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter(
            fmt="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S",
        ))

    root.addHandler(handler)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def session_logger(name: str, session_id: str, trace_id: str = "") -> logging.LoggerAdapter:
    """
    Retorna um LoggerAdapter que injeta session_id (e trace_id opcional)
    em todos os registros emitidos — sem modificar o logger raiz.
    """
    extra: dict[str, Any] = {"session_id": session_id}
    if trace_id:
        extra["trace_id"] = trace_id

    class _Adapter(logging.LoggerAdapter):
        def process(
            self, msg: str, kwargs: MutableMapping[str, Any]
        ) -> tuple[str, MutableMapping[str, Any]]:
            merged = dict(self.extra)
            merged.update(kwargs.get("extra", {}))
            kwargs["extra"] = merged
            return msg, kwargs

    return _Adapter(logging.getLogger(name), extra)
