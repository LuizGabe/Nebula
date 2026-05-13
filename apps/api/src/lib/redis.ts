import IORedis from 'ioredis'
import { config } from '@/config'

const REDIS_URL = config.REDIS_URL;
const url = new URL(REDIS_URL);

const redisConnection = new IORedis({
  maxRetriesPerRequest: null, // Required by BullMQ for proper error handling
  enableReadyCheck: true,
  host: url.hostname,
  port: parseInt(url.port) || 6379,
  password: url.password || undefined,
  db: parseInt(url.pathname.split('/')[1]) || 0,
})

export {
  redisConnection
}