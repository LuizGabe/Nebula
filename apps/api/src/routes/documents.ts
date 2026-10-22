import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { canUseTemplate } from '@/lib/prompts';
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../hooks/requireAuth.js";
import { postProcessQueue } from "../jobs/queues.js";
import { createEventPublisher } from '@/events/publisher';

const sessionParams = z.object({ id: z.string().min(1).max(128) });
const jobStatusQuery = z.object({ jobId: z.string().min(1).max(200).optional() });
const versionQuery = z.object({ version: z.coerce.number().int().positive().optional() });
const reprocessBody = z.object({}).strict();

const editBody = z.object({
  content: z.string().min(1),
});

const documents: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);
  fastify.addHook('preValidation', async (request, reply) => {
    if (!sessionParams.safeParse(request.params).success) return reply.status(400).send({ error: 'Sessao invalida' });
  });
  const events = createEventPublisher();

  // lista versões do documento de uma sessão
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/document",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
      });
      if (!session) return reply.status(404).send({ error: "Não encontrada" });

      const documents = await prisma.document.findMany({
        where:   { sessionId: session.id },
        orderBy: { version: "desc" },
        select:  {
          id: true, version: true, type: true,
          modelUsed: true, createdAt: true,
          // omite content na listagem — carrega sob demanda
        },
      });

      return reply.send({ documents });
    }
  );

  // retorna conteúdo de uma versão específica (ou a mais recente)
  fastify.get<{ Params: { id: string }; Querystring: { version?: string } }>(
    "/sessions/:id/document/content",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
      });
      if (!session) return reply.status(404).send({ error: "Não encontrada" });

      const parsedQuery = versionQuery.safeParse(request.query);
      if (!parsedQuery.success) return reply.status(400).send({ error: 'Versao invalida' });
      const version = parsedQuery.data.version;

      const document = await prisma.document.findFirst({
        select: {
          id: true,
          type:  true,
          content:  true,
          version:  true,
          modelUsed:  true,
          createdAt:  true,
        },
        where:   { sessionId: session.id, ...(version ? { version } : {}) },
        orderBy: { version: "desc" },
      });

      if (!document) return reply.status(404).send({ error: "Documento não encontrado" });

      return reply.send({ document });
    }
  );

  // salva edição manual — cria nova versão
  fastify.patch<{ Params: { id: string } }>(
    "/sessions/:id/document",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;
      const parsed  = editBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
      });
      if (!session) return reply.status(404).send({ error: "Não encontrada" });

      const latest = await prisma.document.findFirst({
        where:   { sessionId: session.id },
        orderBy: { version: "desc" },
      });

      if (!latest) return reply.status(404).send({ error: "Nenhum documento gerado ainda" });

      const document = await prisma.document.create({
        data: {
          sessionId: session.id,
          type:      latest.type,
          promptId:  latest.promptId,
          content:   parsed.data.content,
          version:   latest.version + 1,
          modelUsed: "human",   // identifica edição manual
        },
      });

      return reply.send({ document });
    }
  );

  // reprocessa — gera nova versão com LLM
  fastify.post<{ Params: { id: string } }>(
    "/sessions/:id/document/reprocess",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;

      if (!reprocessBody.safeParse(request.body ?? {}).success) return reply.status(400).send({ error: 'Dados invalidos' });

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
        include: { prompt: true },
      });
      if (!session) {
        return reply.status(404).send({ error: "Sessao nao encontrada" });
      }

      if (!canUseTemplate(session.prompt, ownerId)) return reply.status(409).send({ error: 'Template indisponível. Selecione outro template antes de gerar.' });
      if (!['ENDED', 'ERROR'].includes(session.status)) return reply.status(409).send({ error: 'Aguarde a transcricao terminar antes de gerar o documento' });
      const transcripts = await prisma.transcript.count({ where: { sessionId: session.id, text: { not: '' } } });
      if (!transcripts) return reply.status(409).send({ error: 'Nenhuma transcricao disponivel para gerar o documento' });

      const reprocessId = `reprocess-${session.id}`;
      for (const id of [`session-${session.id}`, reprocessId]) {
        const existing = await postProcessQueue.getJob(id);
        if (!existing) continue;
        if (!['completed', 'failed'].includes(await existing.getState())) {
          return reply.status(409).send({ error: 'Ja existe uma geracao de documento em andamento para esta sessao' });
        }
        if (id === reprocessId) await existing.remove();
      }

      const job = await postProcessQueue.add(
        "generate-document",
        { sessionId: session.id, triggeredBy: "user_reprocess" },
        { jobId: reprocessId }
      );

      await events.emit(session.id, 'DOCUMENT_QUEUED', { jobId: job.id, triggeredBy: 'user_reprocess' });

      return reply.status(202).send({ jobId: job.id });
    }
  );

  // status do job de geração
  fastify.get<{ Params: { id: string }; Querystring: { jobId?: string } }>(
    "/sessions/:id/document/job-status",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
      });
      if (!session) return reply.status(404).send({ error: "Não encontrada" });

      const parsedQuery = jobStatusQuery.safeParse(request.query);
      if (!parsedQuery.success) return reply.status(400).send({ error: 'Job invalido' });
      const candidates = await Promise.all((parsedQuery.data.jobId
        ? [parsedQuery.data.jobId]
        : [`session-${session.id}`, `reprocess-${session.id}`]).map((id) => postProcessQueue.getJob(id)));
      const job = candidates.filter((candidate) => candidate && candidate.data.sessionId === session.id)
        .sort((left, right) => right!.timestamp - left!.timestamp)[0];
      if (!job) return reply.send({ status: "not_found" });

      return reply.send({
        jobId: job.id,
        status:   await job.getState(),  // waiting | active | completed | failed
        progress: job.progress,
        result:   job.returnvalue ?? null,
        error:    job.failedReason ?? null,
      });
    }
  );
};

export default documents;
