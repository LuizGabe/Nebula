import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "@/hooks/requireAuth";
import { prisma } from "@/lib/prisma";
import { ensureDefaultPrompts, ensurePromptSchema, getPromptVariableNames, validatePromptTemplate } from "@/lib/prompts";

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  userTemplate: z.string().trim().min(1),
  includeAudioCitations: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

const updateBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  userTemplate: z.string().trim().min(1).optional(),
  includeAudioCitations: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

const paramsSchema = z.object({
  id: z.string().min(1),
});

function visiblePromptWhere(ownerId: string) {
  return { OR: [{ isPublic: true }, { ownerId }] };
}

const promptSelect = {
  id: true,
  name: true,
  userTemplate: true,
  includeAudioCitations: true,
  isDefault: true,
  isPublic: true,
  createdAt: true,
  updatedAt: true,
  ownerId: true,
  owner: { select: { id: true, username: true } },
} as const;

const prompts: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);

  fastify.get("/prompts", async (request) => {
    const ownerId = request.session.get("userId")!;
    await ensureDefaultPrompts();

    const prompts = await prisma.prompt.findMany({
      where: visiblePromptWhere(ownerId),
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: promptSelect,
    });

    return { prompts };
  });

  fastify.post("/prompts", async (request, reply) => {
    const ownerId = request.session.get("userId")!;
    await ensurePromptSchema();

    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const templateValidation = validatePromptTemplate(parsed.data.userTemplate);
    if (!templateValidation.ok) {
      return reply.status(400).send({ error: templateValidation.error, message: templateValidation.error });
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
          systemPrompt: "",
          userTemplate: parsed.data.userTemplate,
          availableVariables: getPromptVariableNames(),
          includeAudioCitations: parsed.data.includeAudioCitations ?? true,
          isDefault: parsed.data.isDefault ?? false,
          isPublic: parsed.data.isPublic ?? false,
          ownerId,
        },
        select: promptSelect,
      });
    });

    return reply.status(201).send({ prompt });
  });

  fastify.put<{ Params: { id: string } }>("/prompts/:id", async (request, reply) => {
    const ownerId = request.session.get("userId")!;
    await ensurePromptSchema();

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

    const userTemplate = parsed.data.userTemplate ?? existing.userTemplate;
    if (!userTemplate?.trim()) {
      return reply.status(400).send({ error: "Template do prompt nao configurado", message: "Template do prompt nao configurado" });
    }
    const templateValidation = validatePromptTemplate(userTemplate);
    if (!templateValidation.ok) {
      return reply.status(400).send({ error: templateValidation.error, message: templateValidation.error });
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
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.userTemplate !== undefined ? { userTemplate: parsed.data.userTemplate } : {}),
          ...(parsed.data.includeAudioCitations !== undefined ? { includeAudioCitations: parsed.data.includeAudioCitations } : {}),
          ...(parsed.data.isDefault !== undefined ? { isDefault: parsed.data.isDefault } : {}),
          ...(parsed.data.isPublic !== undefined ? { isPublic: parsed.data.isPublic } : {}),
          availableVariables: getPromptVariableNames(),
        },
        select: promptSelect,
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
