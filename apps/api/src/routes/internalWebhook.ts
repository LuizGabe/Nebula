import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { transcriptionJobsQueue } from "@/jobs/queues";
import { promptNameToTranscriptionMode } from "@/lib/prompts";

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
// extrair dados de: transcriber/sessions/cmofd1fdm0000js1ft0w6t1tg/uploads/1777183309183.mp3
function parseUploadKey(key: string): { sessionId: string, filename: string } | null {
  const decoded = decodeURIComponent(key);
  const match = decoded.match(/^sessions\/([^\/]+)\/uploads\/(.+)$/);
  if (!match) return null;
  
  return  {
    sessionId: match[1],
    filename: match[2],
  }
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
     
      const { sessionId, filename } = parseUploadKey(key) ?? {};
      if (!sessionId) {
        fastify.log.warn(`[webhook] upload com key inesperada: ${key}`);
        continue;
      }

      const session = await prisma.recordingSession.findUnique({
        where: { id: sessionId },
        select: { prompt: { select: { name: true } } },
      });
      if (!session) {
        fastify.log.warn(`[webhook] sessão não encontrada para chunk upload: sessionId=${sessionId} key=${key}`);
        continue;
      }

      fastify.log.info(`[webhook] upload detectado: sessão=${sessionId} key=${key}`);

      await transcriptionJobsQueue.add('transcribe-upload', {
          sessionId: sessionId,
          storageKey: key,
          filename: filename,
          mode: promptNameToTranscriptionMode(session.prompt?.name),
          language: 'pt'
        }, {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        });
    }

    return reply.status(200).send({ ok: true });
  });
};

export default internalWebhook;
