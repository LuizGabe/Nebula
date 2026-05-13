// src/lib/prisma.ts
import { config } from "../config/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      config.NODE_ENV === "development"
        ? ["query", "info", "warn", "error"]
        : ["error"],
  });

if (config.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export { prisma };