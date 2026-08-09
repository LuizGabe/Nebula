
import { createClientPool } from "redis";



export class RedisConnection {
  private static redisPool = createClientPool({
    url: process.env.REDIS_URL || "redis://localhost:6379",
    pingInterval: 10 * 1000, // 10 seconds
    
  })

  private constructor() {}

  public static getRedisFromPool(): any  {
  
    return this.redisPool.getClient();
  }

  public static async subscribeToChannel(channel: string, callback: (message: string) => void): Promise<void> {
    const subscriber = await this.redisPool.getClient() as any;
    subscriber.subscribe(channel, (message: string) => {
      callback(message);
    });
  }
}
