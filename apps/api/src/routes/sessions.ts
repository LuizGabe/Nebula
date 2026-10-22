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
import { postProcessQueue, transcriptionJobsQueue } from "@/jobs/queues";
import { createEventPublisher } from "@/events/publisher";
import { normalizeYouTubeUrl } from "@/lib/youtubeUrl";
import { BUCKET, s3Public } from "@/lib/storage";
import { formatAudioTag } from "@/lib/audioTimestamps";
import {
  DETAIL_LEVEL_VALUES,
  FORMALITY_VALUES,
  TRANSCRIPTION_MODE_VALUES,
  buildTranscriptQuestionMessages,
} from "@/lib/prompts";


const createBody = z.object({
  youtubeUrl: z.string().trim().max(2048).refine((value) => normalizeYouTubeUrl(value) !== null, 'URL do YouTube invalida').optional(),
  promptId: z.string().min(1),
  folderId: z.string().nullable().optional(),
  title: z.string().max(120).optional(),
  sessionContext: z.string().max(4000).optional(),
  instructionsOverride: z.string().max(8000).nullable().optional(),
  formalityOverride: z.enum(FORMALITY_VALUES).nullable().optional(),
  detailLevelOverride: z.enum(DETAIL_LEVEL_VALUES).nullable().optional(),
  useTitleOverride: z.boolean().nullable().optional(),
  useHeadingsOverride: z.boolean().nullable().optional(),
  useSubheadingsOverride: z.boolean().nullable().optional(),
  preferListsOverride: z.boolean().nullable().optional(),
  preferTablesOverride: z.boolean().nullable().optional(),
  includeAudioCitationsOverride: z.boolean().nullable().optional(),
  transcriptionModeOverride: z.enum(TRANSCRIPTION_MODE_VALUES).nullable().optional(),
});

const updateBody = z.object({
  title: z.string().max(120).optional(),
  promptId: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
  sessionContext: z.string().max(4000).nullable().optional(),
  instructionsOverride: z.string().max(8000).nullable().optional(),
  formalityOverride: z.enum(FORMALITY_VALUES).nullable().optional(),
  detailLevelOverride: z.enum(DETAIL_LEVEL_VALUES).nullable().optional(),
  useTitleOverride: z.boolean().nullable().optional(),
  useHeadingsOverride: z.boolean().nullable().optional(),
  useSubheadingsOverride: z.boolean().nullable().optional(),
  preferListsOverride: z.boolean().nullable().optional(),
  preferTablesOverride: z.boolean().nullable().optional(),
  includeAudioCitationsOverride: z.boolean().nullable().optional(),
  transcriptionModeOverride: z.enum(TRANSCRIPTION_MODE_VALUES).nullable().optional(),
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
  const events = createEventPublisher();
  const promptSelect = {
    id: true,
    name: true,
    description: true,
    instructions: true,
    formality: true,
    detailLevel: true,
    useTitle: true,
    useHeadings: true,
    useSubheadings: true,
    preferLists: true,
    preferTables: true,
    includeAudioCitations: true,
    transcriptionMode: true,
    isDefault: true,
    isPublic: true,
    createdAt: true,
    updatedAt: true,
    ownerId: true,
    owner: { select: { id: true, username: true } },
  } as const;

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
  // GET /sessions/:id/status/stream - SSE de status do pos-processamento
  fastify.get("/sessions/:id/status/stream", async (request, reply) => {
    const ownerId = request.session.get("userId")!;

    const params = statusStreamParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "sessionId required" });
    }

    const session = await prisma.recordingSession.findFirst({
      where: { id: params.data.id, ownerId, isDeleted: false },
    });
    if (!session) return reply.status(404).send({ error: "Session not found" });

    const channel = `session:status:${session.id}`;

    const history = await prisma.sessionEvent.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      take: 30
    })

    async function* eventStream() {
      // Flush do historico primeiro
      for (const row of [...history].reverse()) {
        let payloadTratado: any = {}

        if (typeof row.payload === 'string') {
          try {
            // Se for um JSON stringificado valido, vira objeto
            payloadTratado = JSON.parse(row.payload)
          } catch {
            // Se for uma string pura, vira uma propriedade text
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
  // POST /sessions - cria nova sessao
  fastify.post("/sessions", async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Dados invalidos" });
    }

    const ownerId = request.session.get("userId")!;
    const prompt = await prisma.prompt.findFirst({
      where: {
        id: parsed.data.promptId,
        OR: [{ isPublic: true }, { ownerId }],
      },
    });

    if (!prompt) {
      return reply.status(400).send({ error: "Selecione um prompt valido antes de criar sessoes" });
    }

    const folder = await getOwnedFolder(parsed.data.folderId, ownerId);
    if (parsed.data.folderId && !folder) {
      return reply.status(404).send({ error: "Pasta nao encontrada" });
    }

    const session = await prisma.recordingSession.create({
      data: {
        status: parsed.data.youtubeUrl ? "IN_PROGRESS" : "ACTIVE",
        title: parsed.data.title,
        promptId: prompt.id,
        folderId: folder?.id ?? null,
        sessionContext: parsed.data.sessionContext?.trim() || null,
        instructionsOverride: parsed.data.instructionsOverride?.trim() || null,
        formalityOverride: parsed.data.formalityOverride ?? null,
        detailLevelOverride: parsed.data.detailLevelOverride ?? null,
        useTitleOverride: parsed.data.useTitleOverride ?? null,
        useHeadingsOverride: parsed.data.useHeadingsOverride ?? null,
        useSubheadingsOverride: parsed.data.useSubheadingsOverride ?? null,
        preferListsOverride: parsed.data.preferListsOverride ?? null,
        preferTablesOverride: parsed.data.preferTablesOverride ?? null,
        includeAudioCitationsOverride: parsed.data.includeAudioCitationsOverride ?? null,
        transcriptionModeOverride: parsed.data.transcriptionModeOverride ?? null,
        ownerId,
      },
      select: {
        id: true,
        promptId: true,
        prompt: { select: promptSelect },
        folderId: true,
        folder: true,
        status: true,
        title: true,
        sessionContext: true,
        instructionsOverride: true,
        formalityOverride: true,
        detailLevelOverride: true,
        useTitleOverride: true,
        useHeadingsOverride: true,
        useSubheadingsOverride: true,
        preferListsOverride: true,
        preferTablesOverride: true,
        includeAudioCitationsOverride: true,
        transcriptionModeOverride: true,
        createdAt: true,
        updatedAt: true,
        endedAt: true,
        owner: { select: { id: true, username: true } },
      },
    });

    if (parsed.data.youtubeUrl) {
      const youtubeUrl = normalizeYouTubeUrl(parsed.data.youtubeUrl)!;
      // The authenticated owner determines the allowance; never trust a limit from the browser.
      const maxDurationMinutes = session.owner.username === 'luizgabe' ? 300 : 30;
      await events.emit(session.id, 'UPLOAD_RECEIVED', {
        source: 'youtube', stage: 'queued', youtubeUrl, maxDurationMinutes,
        message: 'Video do YouTube aguardando processamento',
      });
      try {
        await transcriptionJobsQueue.add('ingest-youtube', {
          sessionId: session.id, ownerId, youtubeUrl, maxDurationMinutes,
          mode: parsed.data.transcriptionModeOverride ?? prompt.transcriptionMode ?? 'MEETING',
          language: 'pt',
        }, {
          jobId: `youtube-${session.id}`, attempts: 1,
          removeOnComplete: { count: 100 }, removeOnFail: { count: 50 },
        });
      } catch (error) {
        request.log.error(error, 'Falha ao enfileirar video do YouTube');
        await prisma.recordingSession.update({ where: { id: session.id }, data: { status: 'ERROR' } });
        await events.emit(session.id, 'UPLOAD_FAILED', {
          source: 'youtube', stage: 'queued', error: 'Nao foi possivel iniciar a importacao do YouTube. Tente criar a sessao novamente.',
        });
        return reply.status(503).send({ error: 'Nao foi possivel iniciar a importacao do YouTube', sessionId: session.id });
      }
    }
    return reply.status(201).send({ session });
  });
  // GET /sessions - lista sessoes do usuario
  fastify.get("/sessions", async (request, reply) => {
    // TODO: paginacao, filtros, etc
    // TODO: quando listar sessoes, trazer tambem o numero de transcricoes, documentos, etc para evitar multiplas queries na UI
    const ownerId = request.session.get("userId")!;

    await reconcileCompletedSessions(ownerId);

    const list = await prisma.recordingSession.findMany({
      where: { ownerId, isDeleted: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        promptId: true,
        prompt: { select: promptSelect },
        folderId: true,
        folder: true,
        status: true,
        title: true,
        sessionContext: true,
        instructionsOverride: true,
        formalityOverride: true,
        detailLevelOverride: true,
        useTitleOverride: true,
        useHeadingsOverride: true,
        useSubheadingsOverride: true,
        preferListsOverride: true,
        preferTablesOverride: true,
        includeAudioCitationsOverride: true,
        transcriptionModeOverride: true,
        updatedAt: true,
        createdAt: true,
        endedAt: true,
      },
    });

    return reply.send({ sessions: list });
  });
  // GET /sessions/:id - detalhes da sessao
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;

      await reconcileCompletedSessions(ownerId, request.params.id);

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
        include: {
          prompt: { select: promptSelect },
          folder: true,
          documents: { orderBy: { version: "desc" }, take: 1 },
          _count: { select: { transcripts: true } },
        },
      });

      if (!session) return reply.status(404).send({ error: "Nao encontrada" });

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
  // PATCH /sessions/:id/end - encerra sessao e dispara pos-processamento
  fastify.patch<{ Params: { id: string } }>(
    "/sessions/:id/end",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
      });

      if (!session) return reply.status(404).send({ error: "Nao encontrada" });
      // Nao deve finalizar sessao se nao tiver chunks transcritos
      const transcript = await prisma.transcript.findFirst({
        where: { sessionId: session.id, text: { not: "" } },
        select: { id: true },
      });
      if (!transcript) {
        return reply.status(409).send({ error: "Nenhuma fala foi transcrita. O audio foi salvo, mas a sessao nao pode ser concluida sem texto." });
      }

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
  // POST /sessions/:id/question - QA via SSE
  fastify.post<{ Params: { id: string } }>(
    "/sessions/:id/question",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;
      const parsed = questionBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Dados invalidos" });
      }

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
        include: { owner: { select: { config: true } }, prompt: { select: promptSelect } },
      });

      if (!session) return reply.status(404).send({ error: "Nao encontrada" });
      // Busca transcricoes ordenadas
      const transcripts = await prisma.transcript.findMany({
        where: { sessionId: session.id },
        orderBy: { chunkIndex: "asc" },
        select: { text: true, timestampStart: true },
      });

      if (transcripts.length === 0) {
        return reply.status(400).send({ error: "Nenhuma transcricao disponivel" });
      }

      const context = transcripts.map((t) => `${formatAudioTag(t.timestampStart)} ${t.text}`).join("\n");

      // Determina modelo
      const userConfig = (session.owner.config ?? {}) as UserConfig;
      const modelId = userConfig.defaultModel ?? DEFAULT_MODEL;

      if (!session.prompt) {
        return reply.status(400).send({ error: "Sessao sem prompt configurado" });
      }

      const adapter = createAdapter(modelId);
      const messages = buildTranscriptQuestionMessages({
        includeAudioCitations: session.prompt.includeAudioCitations,
        transcript: context,
        question: parsed.data.question,
      });

      // SSE headers
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      try {
        for await (const token of adapter.stream(
          messages,
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
  // GET /sessions/:id/job-status - status do job de pos-processamento
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/job-status",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;
      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
      });
      if (!session) return reply.status(404).send({ error: "Nao encontrada" });

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
  // PATCH /sessions/:id - renomear titulo
  fastify.patch<{ Params: { id: string } }>(
    '/sessions/:id',
    async (request, reply) => {
      const ownerId = request.session.get('userId')!
      const parsed = updateBody.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ error: 'Dados invalidos' })

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
      })
      if (!session) return reply.status(404).send({ error: 'Nao encontrada' })

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
          ...(parsed.data.sessionContext !== undefined ? { sessionContext: parsed.data.sessionContext?.trim() || null } : {}),
          ...(parsed.data.instructionsOverride !== undefined ? { instructionsOverride: parsed.data.instructionsOverride?.trim() || null } : {}),
          ...(parsed.data.formalityOverride !== undefined ? { formalityOverride: parsed.data.formalityOverride } : {}),
          ...(parsed.data.detailLevelOverride !== undefined ? { detailLevelOverride: parsed.data.detailLevelOverride } : {}),
          ...(parsed.data.useTitleOverride !== undefined ? { useTitleOverride: parsed.data.useTitleOverride } : {}),
          ...(parsed.data.useHeadingsOverride !== undefined ? { useHeadingsOverride: parsed.data.useHeadingsOverride } : {}),
          ...(parsed.data.useSubheadingsOverride !== undefined ? { useSubheadingsOverride: parsed.data.useSubheadingsOverride } : {}),
          ...(parsed.data.preferListsOverride !== undefined ? { preferListsOverride: parsed.data.preferListsOverride } : {}),
          ...(parsed.data.preferTablesOverride !== undefined ? { preferTablesOverride: parsed.data.preferTablesOverride } : {}),
          ...(parsed.data.includeAudioCitationsOverride !== undefined ? { includeAudioCitationsOverride: parsed.data.includeAudioCitationsOverride } : {}),
          ...(parsed.data.transcriptionModeOverride !== undefined ? { transcriptionModeOverride: parsed.data.transcriptionModeOverride } : {}),
        },
        select: {
          id: true,
          title: true,
          promptId: true,
          prompt: { select: promptSelect },
          folderId: true,
          folder: true,
          status: true,
          sessionContext: true,
          instructionsOverride: true,
          formalityOverride: true,
          detailLevelOverride: true,
          useTitleOverride: true,
          useHeadingsOverride: true,
          useSubheadingsOverride: true,
          preferListsOverride: true,
          preferTablesOverride: true,
          includeAudioCitationsOverride: true,
          transcriptionModeOverride: true,
          createdAt: true,
          updatedAt: true,
          endedAt: true,
        },
      })

      return reply.send({ session: updated })
    }
  )
  // DELETE /sessions/:id - excluir sessao
  fastify.delete<{ Params: { id: string } }>(
    '/sessions/:id',
    async (request, reply) => {
      const ownerId = request.session.get('userId')!

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId },
      })
      if (!session) return reply.status(404).send({ error: 'Nao encontrada' })

      await prisma.recordingSession.update({
        where: { id: session.id },
        data: { isDeleted: true },
      })

      return reply.status(204).send()
    }
  )
};



export default sessions;
