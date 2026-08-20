import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "@/hooks/requireAuth";
import { prisma } from "@/lib/prisma";
import {
  DETAIL_LEVEL_VALUES,
  FORMALITY_VALUES,
  TRANSCRIPTION_MODE_VALUES,
  ensureDefaultDocumentTemplates,
  ensureDocumentTemplateSchema,
} from "@/lib/prompts";

const templateFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  instructions: z.string().trim().min(1).max(8000),
  formality: z.enum(FORMALITY_VALUES).optional(),
  detailLevel: z.enum(DETAIL_LEVEL_VALUES).optional(),
  useTitle: z.boolean().optional(),
  useHeadings: z.boolean().optional(),
  useSubheadings: z.boolean().optional(),
  preferLists: z.boolean().optional(),
  preferTables: z.boolean().optional(),
  includeAudioCitations: z.boolean().optional(),
  transcriptionMode: z.enum(TRANSCRIPTION_MODE_VALUES).optional(),
  isDefault: z.boolean().optional(),
  isPublic: z.boolean().optional(),
};

const createBody = z.object(templateFields);
const updateBody = z.object({
  ...templateFields,
  name: templateFields.name.optional(),
  instructions: templateFields.instructions.optional(),
});

const paramsSchema = z.object({
  id: z.string().min(1),
});

function visibleTemplateWhere(ownerId: string) {
  return { OR: [{ isPublic: true }, { ownerId }] };
}

const templateSelect = {
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

const prompts: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);

  fastify.get("/prompts", async (request) => {
    const ownerId = request.session.get("userId")!;
    await ensureDefaultDocumentTemplates();

    const prompts = await prisma.prompt.findMany({
      where: visibleTemplateWhere(ownerId),
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: templateSelect,
    });

    return { prompts };
  });

  fastify.post("/prompts", async (request, reply) => {
    const ownerId = request.session.get("userId")!;
    await ensureDocumentTemplateSchema();

    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const prompt = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.prompt.updateMany({
          where: { isDefault: true, ...visibleTemplateWhere(ownerId) },
          data: { isDefault: false },
        });
      }

      return tx.prompt.create({
        data: {
          name: parsed.data.name,
          description: parsed.data.description?.trim() || null,
          instructions: parsed.data.instructions,
          formality: parsed.data.formality ?? "neutral",
          detailLevel: parsed.data.detailLevel ?? "balanced",
          useTitle: parsed.data.useTitle ?? true,
          useHeadings: parsed.data.useHeadings ?? true,
          useSubheadings: parsed.data.useSubheadings ?? true,
          preferLists: parsed.data.preferLists ?? true,
          preferTables: parsed.data.preferTables ?? false,
          includeAudioCitations: parsed.data.includeAudioCitations ?? true,
          transcriptionMode: parsed.data.transcriptionMode ?? "MEETING",
          isDefault: parsed.data.isDefault ?? false,
          isPublic: parsed.data.isPublic ?? false,
          ownerId,
        },
        select: templateSelect,
      });
    });

    return reply.status(201).send({ prompt });
  });

  fastify.put<{ Params: { id: string } }>("/prompts/:id", async (request, reply) => {
    const ownerId = request.session.get("userId")!;
    await ensureDocumentTemplateSchema();

    const params = paramsSchema.safeParse(request.params);
    const parsed = updateBody.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.status(400).send({ error: "Dados invalidos" });
    }

    const existing = await prisma.prompt.findUnique({ where: { id: params.data.id } });
    if (!existing) return reply.status(404).send({ error: "Template nao encontrado" });
    if (existing.ownerId && existing.ownerId !== ownerId) {
      return reply.status(403).send({ error: "Voce nao pode editar este template" });
    }

    const prompt = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.prompt.updateMany({
          where: {
            isDefault: true,
            id: { not: params.data.id },
            ...visibleTemplateWhere(ownerId),
          },
          data: { isDefault: false },
        });
      }

      return tx.prompt.update({
        where: { id: params.data.id },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description?.trim() || null } : {}),
          ...(parsed.data.instructions !== undefined ? { instructions: parsed.data.instructions } : {}),
          ...(parsed.data.formality !== undefined ? { formality: parsed.data.formality } : {}),
          ...(parsed.data.detailLevel !== undefined ? { detailLevel: parsed.data.detailLevel } : {}),
          ...(parsed.data.useTitle !== undefined ? { useTitle: parsed.data.useTitle } : {}),
          ...(parsed.data.useHeadings !== undefined ? { useHeadings: parsed.data.useHeadings } : {}),
          ...(parsed.data.useSubheadings !== undefined ? { useSubheadings: parsed.data.useSubheadings } : {}),
          ...(parsed.data.preferLists !== undefined ? { preferLists: parsed.data.preferLists } : {}),
          ...(parsed.data.preferTables !== undefined ? { preferTables: parsed.data.preferTables } : {}),
          ...(parsed.data.includeAudioCitations !== undefined ? { includeAudioCitations: parsed.data.includeAudioCitations } : {}),
          ...(parsed.data.transcriptionMode !== undefined ? { transcriptionMode: parsed.data.transcriptionMode } : {}),
          ...(parsed.data.isDefault !== undefined ? { isDefault: parsed.data.isDefault } : {}),
          ...(parsed.data.isPublic !== undefined ? { isPublic: parsed.data.isPublic } : {}),
        },
        select: templateSelect,
      });
    });

    return reply.send({ prompt });
  });

  fastify.delete<{ Params: { id: string } }>("/prompts/:id", async (request, reply) => {
    const ownerId = request.session.get("userId")!;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Template invalido" });
    }

    const [existing, total] = await Promise.all([
      prisma.prompt.findUnique({ where: { id: params.data.id } }),
      prisma.prompt.count({ where: visibleTemplateWhere(ownerId) }),
    ]);

    if (!existing) return reply.status(404).send({ error: "Template nao encontrado" });
    if (existing.ownerId && existing.ownerId !== ownerId) {
      return reply.status(403).send({ error: "Voce nao pode remover este template" });
    }
    if (total <= 1) {
      return reply.status(400).send({ error: "Mantenha pelo menos um template cadastrado" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.prompt.delete({ where: { id: params.data.id } });

      if (existing.isDefault) {
        const nextDefault = await tx.prompt.findFirst({
          where: visibleTemplateWhere(ownerId),
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
