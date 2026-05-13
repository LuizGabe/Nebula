import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// shape mínimo do evento MinIO
const minioEventSchema = z.object({
  EventName: z.string(),
  Records: z.array(z.object({
    s3: z.object({
      bucket: z.object({ name: z.string() }),
      object: z.object({
        key:  z.string(),
        size: z.number().optional(),
        contentType: z.string().optional(),
      }),
    }),
  })),
});

const WEBHOOK_SECRET = process.env.MINIO_WEBHOOK_SECRET ?? "";

// extrai sessionId da key: sessions/{sessionId}/uploads/...
function parseUploadKey(key: string): { sessionId: string } | null {
  const decoded = decodeURIComponent(key);
  const match = decoded.match(/^sessions\/([^/]+)\/uploads\//);
  if (!match) return null;
  return { sessionId: match[1] };
}

const internalWebhook: FastifyPluginAsync = async (fastify) => {

  fastify.post("/internal/minio-webhook", async (request, reply) => {
    // valida secret
    const auth = request.headers["authorization"] ?? "";
    if (WEBHOOK_SECRET && auth !== `Bearer ${WEBHOOK_SECRET}`) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const parsed = minioEventSchema.safeParse(request.body);
    if (!parsed.success) {
      // MinIO manda health checks com body vazio — responde 200 silenciosamente
      return reply.status(200).send({ ok: true });
    }

    const { EventName, Records } = parsed.data;
    
    // só interessa eventos de criação de objeto
    if (!EventName.startsWith("s3:ObjectCreated")) {
      return reply.status(200).send({ ok: true });
    }
    
    for (const record of Records) {
      const key = decodeURIComponent(record.s3.object.key);
     
      // ignora chunks de streaming — eles têm path /chunks/
      const isChunk = key.includes("/chunks/");

      if (isChunk) {
      // extrai sessionId e chunkIndex da key: sessions/{id}/chunks/0001.webm
      const chunkMatch = decodeURIComponent(key).match(
        /^sessions\/([^/]+)\/chunks\/(\d+)\.webm$/
      );
      if (!chunkMatch) continue;

      const sessionId  = chunkMatch[1];
      const chunkIndex = parseInt(chunkMatch[2], 10);

      // busca timestamps do AudioChunk que foi criado no presigned-url
      const audioChunk = await prisma.audioChunk.findUnique({
        where: { sessionId_chunkIndex: { sessionId, chunkIndex } },
      });
      if (!audioChunk) continue;

      // marca como uploaded
      await prisma.audioChunk.update({
        where: { sessionId_chunkIndex: { sessionId, chunkIndex } },
        data: { status: "UPLOADED" },
      });

      // busca mode da sessão
      const session = await prisma.recordingSession.findUnique({
        where: { id: sessionId },
        select: { mode: true },
      });
      if (!session) {
        fastify.log.warn(`[webhook] sessão não encontrada para chunk upload: sessionId=${sessionId} chunkIndex=${chunkIndex}`);
        continue;
      }

        await fastify.redis.lPush(
          "queue:transcription",
          JSON.stringify({
            type:           "chunk",
            sessionId,
            chunkIndex,
            key,
            mode:           session.mode,
            timestampStart: Number(audioChunk.timestampStart),
            timestampEnd:   Number(audioChunk.timestampEnd),
            queuedAt:       Date.now(),
          })
        );

        fastify.log.info(`[webhook] chunk enfileirado: sessão=${sessionId} chunk=${chunkIndex}`);
        continue;
      }

      const { sessionId } = parseUploadKey(key) ?? {};
      if (!sessionId) {
        fastify.log.warn(`[webhook] upload com key inesperada: ${key}`);
        continue;
      }

      const session = await prisma.recordingSession.findUnique({
        where: { id: sessionId },
        select: { mode: true },
      });
      if (!session) {
        fastify.log.warn(`[webhook] sessão não encontrada para chunk upload: sessionId=${sessionId} key=${key}`);
        continue;
      }

      fastify.log.info(`[webhook] upload detectado: sessão=${sessionId} key=${key}`);

      await fastify.redis.lPush(
        "queue:transcription",
        JSON.stringify({
          type:      "upload",
          sessionId: sessionId,
          key,
          mode:      session.mode,
          queuedAt:  Date.now(),
        })
      );
    }

    return reply.status(200).send({ ok: true });
  });
};

export default internalWebhook;