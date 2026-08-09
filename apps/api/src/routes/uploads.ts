// src/routes/uploads.ts — arquivo novo
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../hooks/requireAuth.js";
import { s3Public, BUCKET } from "../lib/storage.js";
import { createEventPublisher } from "@/events/publisher";

const ALLOWED_TYPES = new Set([
  "audio/mpeg",       // .mp3
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
]);

const uploadBody = z.object({
  sessionId:   z.string(),
  filename:    z.string().max(200),
  contentType: z.string(),
  sizeBytes:   z.number().int().positive().max(1000 * 1024 * 1024), // 1GB max (ajustar conforme necessário)
});

const uploads: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);
  const events = createEventPublisher();

  // Pede presigned URL para upload de áudio completo
  fastify.post("/uploads/audio/presigned-url", async (request, reply) => {
    const parsed = uploadBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body' });
    }

    const { sessionId, filename, contentType, sizeBytes } = parsed.data;
    void sizeBytes; // TODO: validar o tamanho do upload depois que o arquivo for enviado para S3
    const ownerId = request.session.get("userId")!;

    if (!ALLOWED_TYPES.has(contentType)) {
      return reply.status(415).send({ error: `Tipo não suportado: ${contentType}` });
    }

    const session = await prisma.recordingSession.findFirst({
      where: { id: sessionId, ownerId },
    });
    if (!session) {
      return reply.status(404).send({ error: "Sessão não encontrada" });
    }

    // extensão original preservada na chave
    const ext = filename.split(".").pop()?.toLowerCase() ?? "audio";
    const key = `sessions/${sessionId}/uploads/${Date.now()}.${ext}`;
    // TODO: pensar em alguma forma de rastreabilidade, pois atualmente o /chunks simplesmente adiciona um chunk
    // porem o upload não pode fazer isso, pq um upload vai gerar varios AudioChunk

    const command = new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(s3Public, command, { expiresIn: 900 }); // 15min para arquivos grandes

    await prisma.$transaction([
      prisma.audioMedia.create({
        data: {
          sessionId,
          storageKey: key,
          source: "UPLOAD",
          status: "PENDING_UPLOAD",
        },
      }),
      prisma.recordingSession.update({
        where: { id: session.id },
        data: { status: "IN_PROGRESS" },
      }),
    ]);

    await events.emit(sessionId, "UPLOAD_RECEIVED", {
      filename,
      storageKey: key,
      sizeBytes,
      status: "waiting_for_upload",
    });

    return reply.send({ url, key, expiresIn: 900 });
  });
};

export default uploads;
