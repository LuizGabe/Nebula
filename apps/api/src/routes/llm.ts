// src/routes/llm.ts
import { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../hooks/requireAuth.js";
import { createAdapter, AVAILABLE_MODELS } from "../lib/llm/index.js";
import { prisma } from "../lib/prisma.js";

const llm: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);

  // GET /llm/models — lista modelos disponíveis
  fastify.get("/llm/models", async (_request, reply) => {
    return reply.send({ models: AVAILABLE_MODELS });
  });

  // GET /llm/status — SSE com disponibilidade de cada provider em tempo real
  fastify.get("/llm/status", async (_request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (data: object) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // checa todos os providers em paralelo — allSettled para não travar se um falhar
    const check = async () => {
      const results = await Promise.allSettled(
        AVAILABLE_MODELS.map(async (m) => {
          const adapter = createAdapter(m.id);
          const available = await adapter.isAvailable();
          return { id: m.id, provider: m.provider, available };
        })
      );

      const models = results.map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : {
              id: AVAILABLE_MODELS[i].id,
              provider: AVAILABLE_MODELS[i].provider,
              available: false,
            }
      );

      send({ type: "status", models, checkedAt: Date.now() });
    };

    // envia imediatamente e depois a cada 30s
    await check();
    const interval = setInterval(check, 30_000);

    reply.raw.on("close", () => clearInterval(interval));
  });

  // PATCH /users/config — atualiza modelo padrão do usuário
  fastify.patch("/users/config", async (request, reply) => {
    const { defaultModel } = request.body as { defaultModel: string };

    const valid = AVAILABLE_MODELS.map((m) => m.id);
    if (!valid.includes(defaultModel as (typeof valid)[number])) {
      return reply.status(400).send({ error: "Modelo inválido" });
    }

    const userId = request.session.get("userId")!;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { config: { defaultModel } },
      select: { config: true },
    });

    return reply.send({ config: user.config });
  });
};

export default llm;