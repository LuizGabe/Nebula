import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../hooks/requireAuth.js";
import { createEventPublisher } from "@/events/publisher";

const manualTranscriptBody = z.object({
  text: z.string().trim().min(1).max(20_000),
  timestampStart: z.number().min(0).default(0),
  timestampEnd: z.number().min(0).default(0),
  chunkIndex: z.number().int().min(0).optional(),
});

const transcripts: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);
  const events = createEventPublisher();

  // lista versões do documento de uma sessão
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/transcripts",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId },
      });
      if (!session) return reply.status(404).send({ error: "Não encontrada" });

      const transcripts = await prisma.transcript.findMany({
        where:   { sessionId: session.id },
        orderBy: { chunkIndex: "asc" },
        select:  {
          id: true, 
          chunkIndex: true,
          text: true, 
          timestampStart: true, 
          timestampEnd: true
        },
      });

      return reply.send({ transcripts });
    }
  );

  // TODO: Adicionar uma edição manual da transcrição, para corrigir erros de ASR
  fastify.post<{ Params: { id: string } }>(
    "/sessions/:id/transcripts/manual",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;
      const parsed = manualTranscriptBody.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Dados invalidos" });

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
      });
      if (!session) return reply.status(404).send({ error: "Sessao nao encontrada" });

      const last = parsed.data.chunkIndex === undefined
        ? await prisma.transcript.findFirst({
            where: { sessionId: session.id },
            orderBy: { chunkIndex: "desc" },
            select: { chunkIndex: true },
          })
        : null;

      const chunkIndex = parsed.data.chunkIndex ?? ((last?.chunkIndex ?? -1) + 1);
      const timestampEnd = Math.max(parsed.data.timestampEnd, parsed.data.timestampStart);

      const transcript = await prisma.transcript.upsert({
        where: {
          sessionId_chunkIndex: {
            sessionId: session.id,
            chunkIndex,
          },
        },
        update: {
          text: parsed.data.text,
          timestampStart: parsed.data.timestampStart,
          timestampEnd,
        },
        create: {
          sessionId: session.id,
          chunkIndex,
          text: parsed.data.text,
          timestampStart: parsed.data.timestampStart,
          timestampEnd,
        },
        select: {
          id: true,
          chunkIndex: true,
          text: true,
          timestampStart: true,
          timestampEnd: true,
        },
      });

      await events.emit(session.id, "CHUNK_TRANSCRIPTION_PROGRESS", {
        source: "web_speech",
        text: transcript.text,
        chunkIndex: transcript.chunkIndex,
        timestampStartMs: transcript.timestampStart,
        timestampEndMs: transcript.timestampEnd,
      });

      return reply.status(201).send({ transcript });
    }
  );

};

export default transcripts;
