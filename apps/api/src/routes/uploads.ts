// src/routes/uploads.ts — arquivo novo
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../hooks/requireAuth.js";
import { s3Public, BUCKET } from "../lib/storage.js";

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
  sizeBytes:   z.number().int().positive().max(500 * 1024 * 1024), // 500MB
});

const uploads: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);

  // Pede presigned URL para upload de áudio completo
  fastify.post("/uploads/audio/presigned-url", async (request, reply) => {
    const parsed = uploadBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body' });
    }

    const { sessionId, filename, contentType, sizeBytes } = parsed.data; // TODO: usar sizeBytes para validar o tamanho do upload depois que o arquivo for enviado para S3
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

    const command = new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(s3Public, command, { expiresIn: 900 }); // 15min para arquivos grandes

    return reply.send({ url, key, expiresIn: 900 });
  });
};

export default uploads;