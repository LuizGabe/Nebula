from __future__ import annotations

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
        log.info("MinIO client configurado endpoint=%s bucket=%s", config.minio_endpoint, self._bucket)

    def get_object_bytes(self, storage_key: str) -> bytes:
        response = None
        try:
            response = self._client.get_object(self._bucket, storage_key)
            return response.read()
        finally:
            if response:
                response.close()
                response.release_conn()
