// src/routes/chunks.ts
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../hooks/requireAuth.js";
import { s3Public, BUCKET } from "../lib/storage.js";

const presignedBody = z.object({
  sessionId: z.string(),
  chunkIndex: z.number().int().min(0),
  
  contentType: z.string().default("audio/webm"),

  // informações que antes iam no /confirm
  timestampStart: z.number().int().positive(),
  timestampEnd: z.number().int().positive(),
});

const chunks: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);

  fastify.post("/chunks/presigned-url", async (request, reply) => {
    const parsed = presignedBody.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        hint: "Body should contain sessionId (string), chunkIndex (integer), contentType (string), timestampStart (integer), timestampEnd (integer)",
      });
    }

    const {
      sessionId,
      chunkIndex,
      contentType,
      timestampStart,
      timestampEnd,
    } = parsed.data;

    const ownerId = request.session.get("userId")!;

    const session = await prisma.recordingSession.findFirst({
      where: {
        id: sessionId,
        ownerId,
      },
    });

    if (session && session.status !== "ACTIVE") {
      return reply.status(404).send({
        error: "Session not active",
      });
    }

    if (!session) {
      return reply.status(404).send({
        error: "Session not found",
      });
    }

    const key = `sessions/${sessionId}/chunks/${String(chunkIndex).padStart(4, "0")}.webm`;
    

    // cria registro PENDENTE antes do upload
    await prisma.audioMedia.upsert({
      where: {
        sessionId_chunkIndex: {
          sessionId,
          chunkIndex,
        },
      },

      update: {
        storageKey: key,
        timestampStart: BigInt(timestampStart),
        timestampEnd: BigInt(timestampEnd),
        status: "PENDING_UPLOAD",
      },

      create: {
        sessionId,
        chunkIndex,
        storageKey: key,

        timestampStart: BigInt(timestampStart),
        timestampEnd: BigInt(timestampEnd),

        status: "PENDING_UPLOAD",
        source: "STREAM",
      },
    });

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(s3Public, command, {
      expiresIn: 300,
    });

    return reply.send({
      url,
      key,
      expiresIn: 300,
    });
  });
};

export default chunks;