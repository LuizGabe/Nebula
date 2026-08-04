import redis.asyncio as aioredis

import logging

log = logging.getLogger("infra.redis_connection")

class RedisConnection:
  
    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url
        self._redis: aioredis.Redis | None = None

    async def connect(self) -> None:
        self._redis_pool = aioredis.ConnectionPool.from_url(
            self._redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
        log.info("Redis connection pool criado")

    async def disconnect(self) -> None:
        if self._redis:
            await self._redis.aclose()  
            
    async def get_redis_from_pool(self) -> aioredis.Redis:
        if not self._redis_pool:
            raise RuntimeError("RedisConnection não conectado")
        return aioredis.Redis(connection_pool=self._redis_pool)

    async def healthcheck(self) -> bool:
        try:
            redis = await self.get_redis_from_pool()
            await redis.ping()
            return True
        except Exception as exc:
            log.warning("Redis healthcheck falhou: %s", exc)
            return False
          
    async def publish(self, channel: str, message: str) -> None:
        redis = await self.get_redis_from_pool()
        await redis.publish(channel, message)
        log.debug("Mensagem publicada no Redis channel=%s", channel)
      