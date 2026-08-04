// src/routes/sessions.ts
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { readFileSync } from "fs";
import { resolve } from "path";
import Redis from "ioredis";
import { EventEmitter, on } from 'node:events'

import { prisma } from "@/lib/prisma.js";
import { requireAuth } from "@/hooks/requireAuth";
import { createAdapter, DEFAULT_MODEL } from "@/lib/llm";
import { config, type UserConfig } from "@/config";
import { postProcessQueue } from "@/jobs/queues";


const createBody = z.object({
  mode: z.enum(["MEETING", "CLASS"]),
  title: z.string().max(120).optional(),
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
      take: 10
    })

    async function* eventStream() {
      // Flush do histórico primeiro
      for (const row of history) {
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
              type: parsed.status,
              data: JSON.stringify({
              timestamp: new Date().toISOString(),
              ...payloadTratado,
              })
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

    const session = await prisma.recordingSession.create({
      data: { ...parsed.data, ownerId },
      select: {
        id: true,
        mode: true,
        status: true,
        title: true,
        createdAt: true,
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

    const list = await prisma.recordingSession.findMany({
      where: { ownerId, isDeleted: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        mode: true,
        status: true,
        title: true,
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

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
        include: {
          documents: { orderBy: { version: "desc" }, take: 1 },
          _count: { select: { transcripts: true } },
        },
      });

      if (!session) return reply.status(404).send({ error: "Não encontrada" });

      return reply.send({ session });
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
        include: { owner: { select: { config: true } } },
      });

      if (!session) return reply.status(404).send({ error: "Não encontrada" });

      // Busca transcrições ordenadas
      const transcripts = await prisma.transcript.findMany({
        where: { sessionId: session.id },
        orderBy: { chunkIndex: "asc" },
        select: { text: true },
      });

      if (transcripts.length === 0) {
        return reply.status(400).send({ error: "Nenhuma transcrição disponível" });
      }

      const context = transcripts.map((t) => t.text).join("\n");

      // Determina modelo
      const userConfig = (session.owner.config ?? {}) as UserConfig;
      const modelId = userConfig.defaultModel ?? DEFAULT_MODEL;

      // Carrega prompt de question
      const promptMode = session.mode === "MEETING" ? "meeting" : "class";
      const promptPath = resolve(
        import.meta.dirname,
        "../../../../packages/prompts/question",
        `${promptMode}.txt`
      );
      let promptTemplate: string;
      try {
        promptTemplate = readFileSync(promptPath, "utf-8");
      } catch {
        promptTemplate =
          "Use o contexto abaixo para responder a pergunta.\n\nCONTEXTO:\n{{context}}\n\nPERGUNTA: {{question}}";
      }

      const userPrompt = promptTemplate
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
  fastify.patch<{ Params: { id: string }, Body: { title: string } }>(
    '/sessions/:id',
    async (request, reply) => {
      const ownerId = request.session.get('userId')!
      const { title } = request.body as { title: string }

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId, isDeleted: false },
      })
      if (!session) return reply.status(404).send({ error: 'Não encontrada' })

      const updated = await prisma.recordingSession.update({
        where: { id: session.id, ownerId, isDeleted: false },
        data: { title },
        select: { id: true, title: true },
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