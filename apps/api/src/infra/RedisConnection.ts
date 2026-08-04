
import { RedisPoolOptions, createClientPool } from "redis";



class RedisConnection {
  private static redisPool = createClientPool({
    url: process.env.REDIS_URL || "redis://localhost:6379",
    pingInterval: 10 * 1000, // 10 seconds
    
  })

  private constructor() {}

  public static getRedisFromPool(): any  {
  
    return this.redisPool.getClient();
  }

  public static subscribeToChannel(channel: string, callback: (message: string) => void): void {
    const subscriber = this.redisPool.getClient();
    subscriber.subscribe(channel, (message: string) => {
      callback(message);
    });
  }
}