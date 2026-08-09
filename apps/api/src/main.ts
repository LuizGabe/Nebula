// src/main.ts
import Fastify, { FastifyError } from "fastify";
import cors from '@fastify/cors'
import sessionPlugin from "@/plugins/session";
import { FastifySSEPlugin } from 'fastify-sse-v2';
import websocket from '@fastify/websocket'

import { config } from "@/config";
import { ensureBucketExists } from "@/lib/storage";

import { startWorkers } from "@/workers";

import authRoutes from "@/routes/auth.js";
import internalWebhookRoutes from "@/routes/internalWebhook";
import sessionRoutes from "@/routes/sessions.js";
import chunkRoutes from "@/routes/chunks.js";
import llmRoutes from "@/routes/llm.js";
import uploadRoutes from "@/routes/uploads.js";
import documentsRoutes from "@/routes/documents.js";
import transcriptsRoutes from "@/routes/transcripts.js";
import promptsRoutes from "@/routes/prompts.js";
import foldersRoutes from "@/routes/folders.js";
import wsRoutes from '@/routes/ws'
import transcriptionStreamRoutes from '@/routes/transcription-stream'

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport:
      config.NODE_ENV === "development"
        ? { target: "pino-pretty" }
        : undefined,
  }
});

app.setErrorHandler((error: FastifyError, request, reply) => {
  request.log.error(error);

  if (error.statusCode === 400) {
    return reply.status(400).send({ error: "Invalid Request" });
  }
  
  return reply.status(500).send({ error: "Internal Server Error" });
});

await app.register(cors, {
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5500'],
  credentials: true,
  methods: ['GET', 'PATCH', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  exposedHeaders: ['Content-Type', 'Set-Cookie']
})

await app.register(websocket)

app.get("/health", async () => "OK");

await app.register(sessionPlugin);
await app.register(FastifySSEPlugin);
await app.register(authRoutes);
await app.register(sessionRoutes);
await app.register(chunkRoutes);
await app.register(llmRoutes);
await app.register(uploadRoutes);
await app.register(internalWebhookRoutes);
await app.register(documentsRoutes);
await app.register(transcriptsRoutes);
await app.register(promptsRoutes);
await app.register(foldersRoutes);
await app.register(wsRoutes);
await app.register(transcriptionStreamRoutes);

try {
  await ensureBucketExists();
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  const { postProcessWorker } = startWorkers();
  console.log(`Servidor rodando em http://localhost:${config.PORT}`);

  const shutdown = async () => {
    app.log.info("Graceful shutdown…");
    await postProcessWorker.close();
    await app.close();
    process.exit(0);
  };

  // ── Graceful shutdown ────────────────────────────────
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

} catch (err) {
  app.log.error(err);
  process.exit(1);
}

