// src/routes/uploads.ts — arquivo novo
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../hooks/requireAuth.js";
import { s3Public, BUCKET } from "../lib/storage.js";
import { createEventPublisher } from "@/events/publisher";
import { randomUUID } from 'node:crypto';

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
  "audio/aac",
]);

const uploadBody = z.object({
  sessionId:   z.string(),
  filename:    z.string().max(200),
  contentType: z.string(),
  sizeBytes:   z.number().int().positive().max(1000 * 1024 * 1024), // 1GB max (ajustar conforme necessário)
  transcribe: z.boolean().default(true),
  uploadId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/).optional(),
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

    const { sessionId, filename, sizeBytes, transcribe, uploadId } = parsed.data;
    const contentType = parsed.data.contentType.split(';')[0].trim().toLowerCase();
    void sizeBytes; // TODO: validar o tamanho do upload depois que o arquivo for enviado para S3
    const ownerId = request.session.get("userId")!;

    if (!ALLOWED_TYPES.has(contentType)) {
      return reply.status(415).send({ error: `Tipo não suportado: ${contentType}` });
    }

    const session = await prisma.recordingSession.findFirst({
      where: { id: sessionId, ownerId, isDeleted: false },
    });
    if (!session) {
      return reply.status(404).send({ error: "Sessão não encontrada" });
    }

    // extensão original preservada na chave
    const ext = (filename.split('.').pop()?.toLowerCase() ?? 'audio').replace(/[^a-z0-9]/g, '');
    const key = `sessions/${sessionId}/${transcribe ? 'uploads' : 'recordings'}/${uploadId ?? Date.now()}.${ext}`;
    const mediaId = uploadId ? `recording-${sessionId}-${uploadId}` : undefined;
    if (mediaId) {
      const existing = await prisma.audioMedia.findUnique({ where: { id: mediaId } });
      if (existing && existing.storageKey !== key) return reply.status(409).send({ error: 'Identificador de upload já utilizado' });
      if (existing && existing.status !== 'PENDING_UPLOAD') return reply.send({ alreadyUploaded: true, key, url: '', expiresIn: 0 });
    }
    // TODO: pensar em alguma forma de rastreabilidade, pois atualmente o /chunks simplesmente adiciona um chunk
    // porem o upload não pode fazer isso, pq um upload vai gerar varios AudioChunk

    const command = new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(s3Public, command, { expiresIn: 900 }); // 15min para arquivos grandes

    await prisma.$transaction([
      prisma.audioMedia.upsert({
        where: { id: mediaId ?? `upload-${randomUUID()}` },
        update: {},
        create: {
          ...(mediaId ? { id: mediaId } : {}),
          sessionId,
          storageKey: key,
          source: "UPLOAD",
          status: "PENDING_UPLOAD",
        },
      }),
      ...(transcribe ? [prisma.recordingSession.update({
        where: { id: session.id },
        data: { status: "IN_PROGRESS" },
      })] : []),
    ]);

    if (transcribe) await events.emit(sessionId, "UPLOAD_RECEIVED", {
      filename,
      storageKey: key,
      sizeBytes,
      status: "waiting_for_upload",
    });

    return reply.send({ url, key, expiresIn: 900 });
  });
};

export default uploads;
