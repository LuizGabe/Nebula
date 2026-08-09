import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "@/hooks/requireAuth";
import { prisma } from "@/lib/prisma";
import { ensureDefaultPrompts } from "@/lib/prompts";

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  content: z.string().trim().min(1),
  isDefault: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

const updateBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  content: z.string().trim().min(1).optional(),
  isDefault: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

const paramsSchema = z.object({
  id: z.string().min(1),
});

function visiblePromptWhere(ownerId: string) {
  return { OR: [{ isPublic: true }, { ownerId }] };
}

const prompts: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);

  fastify.get("/prompts", async (request) => {
    const ownerId = request.session.get("userId")!;
    await ensureDefaultPrompts();

    const prompts = await prisma.prompt.findMany({
      where: visiblePromptWhere(ownerId),
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: { owner: { select: { id: true, username: true } } },
    });

    return { prompts };
  });

  fastify.post("/prompts", async (request, reply) => {
    const ownerId = request.session.get("userId")!;
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const prompt = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.prompt.updateMany({
          where: { isDefault: true, ...visiblePromptWhere(ownerId) },
          data: { isDefault: false },
        });
      }

      return tx.prompt.create({
        data: {
          name: parsed.data.name,
          content: parsed.data.content,
          isDefault: parsed.data.isDefault ?? false,
          isPublic: parsed.data.isPublic ?? false,
          ownerId,
        },
        include: { owner: { select: { id: true, username: true } } },
      });
    });

    return reply.status(201).send({ prompt });
  });

  fastify.put<{ Params: { id: string } }>("/prompts/:id", async (request, reply) => {
    const ownerId = request.session.get("userId")!;
    const params = paramsSchema.safeParse(request.params);
    const parsed = updateBody.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.status(400).send({ error: "Dados invalidos" });
    }

    const existing = await prisma.prompt.findUnique({ where: { id: params.data.id } });
    if (!existing) return reply.status(404).send({ error: "Prompt nao encontrado" });
    if (existing.ownerId && existing.ownerId !== ownerId) {
      return reply.status(403).send({ error: "Voce nao pode editar este prompt" });
    }

    const prompt = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.prompt.updateMany({
          where: {
            isDefault: true,
            id: { not: params.data.id },
            ...visiblePromptWhere(ownerId),
          },
          data: { isDefault: false },
        });
      }

      return tx.prompt.update({
        where: { id: params.data.id },
        data: parsed.data,
        include: { owner: { select: { id: true, username: true } } },
      });
    });

    return reply.send({ prompt });
  });

  fastify.delete<{ Params: { id: string } }>("/prompts/:id", async (request, reply) => {
    const ownerId = request.session.get("userId")!;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Prompt invalido" });
    }

    const [existing, total] = await Promise.all([
      prisma.prompt.findUnique({ where: { id: params.data.id } }),
      prisma.prompt.count({ where: visiblePromptWhere(ownerId) }),
    ]);

    if (!existing) return reply.status(404).send({ error: "Prompt nao encontrado" });
    if (existing.ownerId && existing.ownerId !== ownerId) {
      return reply.status(403).send({ error: "Voce nao pode remover este prompt" });
    }
    if (total <= 1) {
      return reply.status(400).send({ error: "Mantenha pelo menos um prompt cadastrado" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.prompt.delete({ where: { id: params.data.id } });

      if (existing.isDefault) {
        const nextDefault = await tx.prompt.findFirst({
          where: visiblePromptWhere(ownerId),
          orderBy: { createdAt: "asc" },
        });
        if (nextDefault) {
          await tx.prompt.update({
            where: { id: nextDefault.id },
            data: { isDefault: true },
          });
        }
      }
    });

    return reply.status(204).send();
  });
};

export default prompts;
