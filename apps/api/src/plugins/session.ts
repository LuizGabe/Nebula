// src/plugins/session.ts
import fp from "fastify-plugin";
import fastifySecureSession from "@fastify/secure-session";
import { createClient } from "redis";
import { config } from "../config/index.js";

declare module "@fastify/secure-session" {
  interface SessionData {
    userId: string;
    username: string;
  }
}

export default fp(async (fastify) => {
  const redis = createClient({ url: config.REDIS_URL });

  redis.on("error", (err) => fastify.log.error(err, "Redis error"));
  await redis.connect();

  // disponibiliza o client redis na instância do fastify
  fastify.decorate("redis", redis);

  await fastify.register(fastifySecureSession, {
    secret: config.SESSION_SECRET,
    salt: config.SESSION_SALT,
    cookie: {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 60 * 60 * 24 * 7, // 7 dias
    },
  });

  fastify.addHook("onClose", async () => {
    await redis.disconnect();
  });
});

// type augmentation do fastify
declare module "fastify" {
  interface FastifyInstance {
    redis: ReturnType<typeof createClient>;
  }
}