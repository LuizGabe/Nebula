import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../hooks/requireAuth.js";
import { createEventPublisher } from "@/events/publisher";
import { Prisma } from '@/generated/prisma/client';
import { parseWords } from '@/lib/transcriptWords';

const manualTranscriptBody = z.object({
  text: z.string().trim().min(1).max(20_000),
  timestampStart: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  timestampEnd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  chunkIndex: z.number().int().min(0).optional(),
});
const browserStatusBody = z.object({
  stage: z.enum(['starting', 'listening', 'audio', 'speech', 'result', 'error', 'end']),
  errorCode: z.string().max(100).optional(),
});
const sessionParams = z.object({ id: z.string().min(1).max(128) });
const editsBody = z.object({
  edits: z.array(z.object({
    id: z.string().min(1), text: z.string().min(1).max(20_000), revision: z.number().int().nonnegative(),
  })).min(1).max(1000),
});
const speakerBody = z.object({ speakerId: z.string().regex(/^SPEAKER_\d{2,}$/), name: z.string().trim().min(1).max(100) });

const transcripts: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);
  fastify.addHook('preValidation', async (request, reply) => {
    if (!sessionParams.safeParse(request.params).success) return reply.status(400).send({ error: 'Sessão inválida' });
  });
  const events = createEventPublisher();
  fastify.post('/sessions/:id/transcripts/browser-status', async (request, reply) => {
    const params = sessionParams.safeParse(request.params);
    const body = browserStatusBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: 'Dados invalidos' });
    const session = await prisma.recordingSession.findFirst({
      where: { id: params.data.id, ownerId: request.session.get('userId')!, isDeleted: false },
      select: { id: true },
    });
    if (!session) return reply.status(404).send({ error: 'Sessao nao encontrada' });
    fastify.log.info({ sessionId: session.id, ...body.data }, 'Browser speech status');
    if (body.data.stage === 'error' && body.data.errorCode !== 'no-speech') {
      await events.emit(session.id, 'CHUNK_FAILED', { source: 'web_speech', ...body.data });
    }
    return reply.status(204).send();
  });

  // lista versões do documento de uma sessão
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/transcripts",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
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
          timestampEnd: true,
          words: true, speakerId: true, edited: true, revision: true,
        },
      });

      return reply.send({ transcripts: transcripts.map(t => ({ ...t, words: parseWords(t.words), timestampStart: Math.round(t.timestampStart), timestampEnd: Math.round(t.timestampEnd) })), speakerNames: session.speakerNames ?? {} });
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

  fastify.patch('/sessions/:id/transcripts', async (request, reply) => {
    const params = sessionParams.safeParse(request.params);
    const body = editsBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: 'Dados inválidos' });
    const session = await prisma.recordingSession.findFirst({ where: { id: params.data.id, ownerId: request.session.get('userId')!, isDeleted: false } });
    if (!session) return reply.status(404).send({ error: 'Sessão não encontrada' });
    if (session.status !== 'ENDED' && session.status !== 'ERROR') return reply.status(409).send({ error: 'Aguarde a transcrição terminar para editar' });
    if (new Set(body.data.edits.map(e => e.id)).size !== body.data.edits.length) return reply.status(400).send({ error: 'Segmentos duplicados' });
    try {
      await prisma.$transaction(async tx => {
        for (const edit of body.data.edits) {
          const current = await tx.transcript.findFirst({ where: { id: edit.id, sessionId: session.id, revision: edit.revision } });
          if (!current) throw new Error('conflict');
          const result = await tx.transcript.updateMany({
            where: { id: current.id, sessionId: session.id, revision: edit.revision },
            data: { text: edit.text, originalText: current.originalText ?? current.text, edited: true, revision: { increment: 1 } },
          });
          if (result.count !== 1) throw new Error('conflict');
        }
        // Derived insights no longer describe the current transcript.
        await tx.recordingSession.update({ where: { id: session.id }, data: { insights: Prisma.DbNull } });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'conflict') return reply.status(409).send({ error: 'A transcrição mudou. Recarregue antes de salvar.' });
      throw error;
    }
    return reply.send({ updated: body.data.edits.length });
  });
  fastify.patch('/sessions/:id/transcripts/speaker', async (request, reply) => {
    const params = sessionParams.safeParse(request.params); const body = speakerBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: 'Dados inválidos' });
    // jsonb_set updates one mapping atomically, avoiding lost concurrent renames.
    const changed = await prisma.$executeRaw`UPDATE recording_sessions
      SET "speakerNames" = jsonb_set(COALESCE("speakerNames", '{}'::jsonb), ARRAY[${body.data.speakerId}]::text[], to_jsonb(${body.data.name}::text)), "updatedAt" = NOW()
      WHERE id = ${params.data.id} AND "ownerId" = ${request.session.get('userId')!} AND NOT "isDeleted"`;
    if (!changed) return reply.status(404).send({ error: 'Sessão não encontrada' });
    return reply.send({ renamed: true });
  });
};

export default transcripts;
