"""
infra/minio_client.py — Cliente MinIO/S3 para download de uploads batch.

Usado APENAS pelo BatchHandler. Stream não acessa MinIO.

get_object_bytes() é síncrono (chamado via run_in_executor no BatchHandler)
porque o SDK minio-py não é nativo async.
"""

from __future__ import annotations

import io
import logging

from core.config import Config

log = logging.getLogger("infra.minio_client")


class MinIOClient:

    def __init__(self, config: Config) -> None:
        from minio import Minio
        self._bucket = config.minio_bucket
        self._client = Minio(
            endpoint=config.minio_endpoint,
            access_key=config.minio_access_key,
            secret_key=config.minio_secret_key,
            secure=config.minio_secure,
        )
        log.info(
            "MinIO client configurado endpoint=%s bucket=%s",
            config.minio_endpoint, self._bucket,
        )

    def get_object_bytes(self, storage_key: str) -> bytes:
        """
        Baixa o objeto completo do MinIO e retorna como bytes.
        Síncrono — deve ser chamado via run_in_executor.
        """
        response = None
        try:
            response = self._client.get_object(self._bucket, storage_key)
            data = response.read()
            log.debug("download ok key=%s size=%d", storage_key, len(data))
            return data
        except Exception as exc:
            log.error("falha ao baixar key=%s: %s", storage_key, exc)
            raise
        finally:
            if response:
                response.close()
                response.release_conn()

    def healthcheck(self) -> bool:
        try:
            self._client.bucket_exists(self._bucket)
            return True
        except Exception as exc:
            log.warning("MinIO healthcheck falhou: %s", exc)
            return False
