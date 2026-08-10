// src/routes/sessions.ts
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import Redis from "ioredis";
import { EventEmitter, on } from 'node:events'
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { prisma } from "@/lib/prisma.js";
import { requireAuth } from "@/hooks/requireAuth";
import { createAdapter, DEFAULT_MODEL } from "@/lib/llm";
import { config, type UserConfig } from "@/config";
import { postProcessQueue } from "@/jobs/queues";
import { getDefaultPrompt } from "@/lib/prompts";
import { BUCKET, s3Public } from "@/lib/storage";
import { formatAudioTag } from "@/lib/audioTimestamps";


const createBody = z.object({
  promptId: z.string().optional(),
  folderId: z.string().nullable().optional(),
  title: z.string().max(120).optional(),
});

const updateBody = z.object({
  title: z.string().max(120).optional(),
  promptId: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
});

const questionBody = z.object({
  question: z.string().min(1),
});

const statusStreamParams = z.object({
  id: z.string(),
});

const sessions: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);
  const subscriber = new Redis(config.REDIS_URL);

  async function getVisiblePrompt(promptId: string | null | undefined, ownerId: string) {
    if (!promptId) return null;
    return prisma.prompt.findFirst({
      where: {
        id: promptId,
        OR: [{ isPublic: true }, { ownerId }],
      },
      select: { id: true },
    });
  }

  async function getOwnedFolder(folderId: string | null | undefined, ownerId: string) {
    if (!folderId) return null;
    return prisma.folder.findFirst({
      where: { id: folderId, ownerId },
      select: { id: true },
    });
  }

  async function reconcileCompletedSessions(ownerId: string, sessionId?: string) {
    await prisma.recordingSession.updateMany({
      where: {
        ownerId,
        ...(sessionId ? { id: sessionId } : {}),
        status: "IN_PROGRESS",
        OR: [
          { documents: { some: {} } },
          {
            sessionEvents: {
              some: {
                type: {
                  in: ["UPLOAD_TRANSCRIBED", "DOCUMENT_READY", "DOCUMENT_SKIPPED", "DOCUMENT_FAILED"],
                },
              },
            },
          },
        ],
      },
      data: { status: "ENDED", endedAt: new Date() },
    });
  }

  // GET /sessions/:id/status/stream — SSE de status do pós-processamento
  fastify.get("/sessions/:id/status/stream", async (request, reply) => {
    const ownerId = request.session.get("userId")!;

    const params = statusStreamParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "sessionId required" });
    }

    const session = await prisma.recordingSession.findFirst({
      where: { id: params.data.id, ownerId },
    });
    if (!session) return reply.status(404).send({ error: "Session not found" });

    const channel = `session:status:${session.id}`;

    const history = await prisma.sessionEvent.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      take: 30
    })

    async function* eventStream() {
      // Flush do histórico primeiro
      for (const row of [...history].reverse()) {
        let payloadTratado: any = {}

        if (typeof row.payload === 'string') {
          try {
            // Se for um JSON stringificado válido (ex: '{"totalChunks":11}'), vira objeto
            payloadTratado = JSON.parse(row.payload)
          } catch {
            // Se for uma string pura (ex: "onde blocos são atualizados"), vira uma propriedade text
            payloadTratado = { text: row.payload }
          }
        } else {
          payloadTratado = row.payload ?? {}
        }
        yield {
          id:   row.id,
          event: 'progress',
          data: JSON.stringify({
            type: row.type,
            data: payloadTratado,
          }),
        }
      }

      await subscriber.subscribe(channel)

      const emitter = new EventEmitter()

      const onMessage = (chan: string, message: string) => {
        if (chan === channel) emitter.emit('workflow', message)
      }

      subscriber.on('message', onMessage)

      try {
        for await (const [message] of on(emitter, 'workflow')) {
          const parsed = JSON.parse(message)
          const eventType = parsed.status ?? parsed.event_type ?? parsed.type
          let payloadTratado: any = {}
          if (typeof parsed.payload === 'string') {
            try {
              payloadTratado = JSON.parse(parsed.payload)
            } catch {
              payloadTratado = { text: parsed.payload }
            }
          } else {
            payloadTratado = parsed.payload ?? {}
          }
          yield {
            id:    parsed.id ?? Date.now().toString(),
            event: 'progress',
            data:  JSON.stringify({
              type: eventType,
              data: {
                timestamp: parsed.timestamp ?? parsed.timestamp_ms ?? new Date().toISOString(),
                ...payloadTratado,
              }
            }),
          }
        }
      } finally {
        subscriber.off('message', onMessage)
        await subscriber.unsubscribe(channel)
      }
    }

    reply.sse(eventStream())

  });

  // POST /sessions — cria nova sessão
  fastify.post("/sessions", async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Dados inválidos" });
    }

    const ownerId = request.session.get("userId")!;
    const prompt = parsed.data.promptId
      ? await prisma.prompt.findFirst({
          where: {
            id: parsed.data.promptId,
            OR: [{ isPublic: true }, { ownerId }],
          },
        })
      : await getDefaultPrompt(ownerId);

    if (!prompt) {
      return reply.status(400).send({ error: "Cadastre um prompt antes de criar sessões" });
    }

    const folder = await getOwnedFolder(parsed.data.folderId, ownerId);
    if (parsed.data.folderId && !folder) {
      return reply.status(404).send({ error: "Pasta nao encontrada" });
    }

    const session = await prisma.recordingSession.create({
      data: { title: parsed.data.title, promptId: prompt.id, folderId: folder?.id ?? null, ownerId },
      select: {
        id: true,
        promptId: true,
        prompt: true,
        folderId: true,
        folder: true,
        status: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        endedAt: true,
        owner: { select: { id: true, username: true } },
      },
    });

    return reply.status(201).send({ session });
  });

  // GET /sessions — lista sessões do usuário
  fastify.get("/sessions", async (request, reply) => {
    // TODO: paginação, filtros, etc
    // TODO: quando listar sessões, trazer também o número de transcrições, documentos, etc para evitar múltiplas queries na UI
    const ownerId = request.session.get("userId")!;

    await reconcileCompletedSessions(ownerId);

    const list = await prisma.recordingSession.findMany({
      where: { ownerId, isDeleted: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        promptId: true,
        prompt: true,
        folderId: true,
        folder: true,
        status: true,
        title: true,
        updatedAt: true,
        createdAt: true,
        endedAt: true,
      },
    });

    return reply.send({ sessions: list });
  });

  // GET /sessions/:id — detalhes da sessão
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;

      await reconcileCompletedSessions(ownerId, request.params.id);

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
        include: {
          prompt: true,
          folder: true,
          documents: { orderBy: { version: "desc" }, take: 1 },
          _count: { select: { transcripts: true } },
        },
      });

      if (!session) return reply.status(404).send({ error: "Não encontrada" });

      return reply.send({ session });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/audio-media",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
        select: { id: true },
      });

      if (!session) return reply.status(404).send({ error: "Nao encontrada" });

      const medias = await prisma.audioMedia.findMany({
        where: {
          sessionId: session.id,
          status: { in: ["PENDING_UPLOAD", "UPLOADED", "PROCESSING", "TRANSCRIBED"] },
        },
        orderBy: [{ source: "desc" }, { chunkIndex: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          source: true,
          storageKey: true,
          chunkIndex: true,
          timestampStart: true,
          timestampEnd: true,
          createdAt: true,
        },
      });

      const audioMedia = await Promise.all(medias.map(async (media) => ({
        id: media.id,
        source: media.source,
        url: await getSignedUrl(
          s3Public,
          new GetObjectCommand({ Bucket: BUCKET, Key: media.storageKey }),
          { expiresIn: 900 },
        ),
        chunkIndex: media.chunkIndex,
        timestampStart: media.timestampStart != null ? Number(media.timestampStart) : null,
        timestampEnd: media.timestampEnd != null ? Number(media.timestampEnd) : null,
        createdAt: media.createdAt,
      })));

      return reply.send({ audioMedia });
    }
  );

  // ── PATCH /sessions/:id/end — encerra sessão e dispara pós-processamento ──────
  fastify.patch<{ Params: { id: string } }>(
    "/sessions/:id/end",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
      });

      if (!session) return reply.status(404).send({ error: "Não encontrada" });

      // não deve finalizar sessão se não tiver chunks transcritos

      const updated = await prisma.recordingSession.update({
        where: { id: session.id },
        data: { status: "ENDED", endedAt: new Date() },
        select: { id: true, status: true, endedAt: true },
      });

      await postProcessQueue.add(
        "generate-document",
        { sessionId: session.id, triggeredBy: "session_end" },
        { jobId: `postprocess-${session.id}` }
      )

      return reply.send({ session: updated });
    }
  );

  // ── POST /sessions/:id/question — QA via SSE ──────
  fastify.post<{ Params: { id: string } }>(
    "/sessions/:id/question",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;
      const parsed = questionBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Dados inválidos" });
      }

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
        include: { owner: { select: { config: true } }, prompt: true },
      });

      if (!session) return reply.status(404).send({ error: "Não encontrada" });

      // Busca transcrições ordenadas
      const transcripts = await prisma.transcript.findMany({
        where: { sessionId: session.id },
        orderBy: { chunkIndex: "asc" },
        select: { text: true, timestampStart: true },
      });

      if (transcripts.length === 0) {
        return reply.status(400).send({ error: "Nenhuma transcrição disponível" });
      }

      const context = transcripts.map((t) => `${formatAudioTag(t.timestampStart)} ${t.text}`).join("\n");

      // Determina modelo
      const userConfig = (session.owner.config ?? {}) as UserConfig;
      const modelId = userConfig.defaultModel ?? DEFAULT_MODEL;

      const promptTemplate =
        "Use o contexto abaixo para responder a pergunta considerando o tipo de documento \"{{promptName}}\".\n\nCONTEXTO:\n{{context}}\n\nPERGUNTA: {{question}}";

      const userPrompt = promptTemplate
        .replaceAll("{{promptName}}", session.prompt?.name ?? "Documento")
        .replaceAll("{{context}}", context)
        .replaceAll("{{question}}", parsed.data.question);

      const adapter = createAdapter(modelId);

      // SSE headers
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      try {
        for await (const token of adapter.stream(
          [
            { role: "system", content: "Responda em português brasileiro, de forma direta e baseada no contexto fornecido." },
            { role: "user", content: userPrompt },
          ],
          { temperature: 0.3 }
        )) {
          reply.raw.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      } catch (err) {
        reply.raw.write(`data: ${JSON.stringify({ error: "Erro ao gerar resposta" })}\n\n`);
      }

      reply.raw.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      reply.raw.end();
    }
  );

  // ── GET /sessions/:id/job-status — status do job de pós-processamento ──────
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/job-status",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;
      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
      });
      if (!session) return reply.status(404).send({ error: "Não encontrada" });

      const job = await postProcessQueue.getJob(`session-${session.id}`);
      if (!job) return reply.send({ status: "not_found" });

      return reply.send({
        status: await job.getState(),
        progress: job.progress,
        result: job.returnvalue,
        failed: job.failedReason ?? null,
      });
    }
  );

  // PATCH /sessions/:id — renomear título
  fastify.patch<{ Params: { id: string } }>(
    '/sessions/:id',
    async (request, reply) => {
      const ownerId = request.session.get('userId')!
      const parsed = updateBody.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ error: 'Dados invalidos' })

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
      })
      if (!session) return reply.status(404).send({ error: 'Não encontrada' })

      const prompt = await getVisiblePrompt(parsed.data.promptId, ownerId)
      if (parsed.data.promptId && !prompt) {
        return reply.status(404).send({ error: 'Prompt nao encontrado' })
      }

      const folder = await getOwnedFolder(parsed.data.folderId, ownerId)
      if (parsed.data.folderId && !folder) {
        return reply.status(404).send({ error: 'Pasta nao encontrada' })
      }

      const updated = await prisma.recordingSession.update({
        where: { id: session.id },
        data: {
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.promptId !== undefined ? { promptId: prompt?.id ?? null } : {}),
          ...(parsed.data.folderId !== undefined ? { folderId: folder?.id ?? null } : {}),
        },
        select: {
          id: true,
          title: true,
          promptId: true,
          prompt: true,
          folderId: true,
          folder: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          endedAt: true,
        },
      })

      return reply.send({ session: updated })
    }
  )

  // DELETE /sessions/:id — excluir sessão
  fastify.delete<{ Params: { id: string } }>(
    '/sessions/:id',
    async (request, reply) => {
      const ownerId = request.session.get('userId')!

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId },
      })
      if (!session) return reply.status(404).send({ error: 'Não encontrada' })

      await prisma.recordingSession.update({
        where: { id: session.id },
        data: { isDeleted: true },
      })

      return reply.status(204).send()
    }
  )
};



export default sessions;
