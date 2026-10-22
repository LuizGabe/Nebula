import { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from '@/hooks/requireAuth';
import { prisma } from '@/lib/prisma';
import { DETAIL_LEVEL_VALUES, FORMALITY_VALUES, TRANSCRIPTION_MODE_VALUES,
  usableTemplateWhere, templateResponse, effectiveDefaultTemplate } from '@/lib/prompts';

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

const templateSelect = {
  id: true,
  platformKey: true,
  deletedAt: true,
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
  fastify.addHook('preHandler', requireAuth);

  // Reads never initialize, repair templates or change account preferences.
  fastify.get('/prompts', async (request) => {
    const ownerId = request.session.get('userId')!;
    const [list, user] = await Promise.all([
      prisma.prompt.findMany({ where: usableTemplateWhere(ownerId), orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: templateSelect }),
      prisma.user.findUnique({ where: { id: ownerId }, select: { defaultPromptId: true } }),
    ]);
    const defaultPromptId = effectiveDefaultTemplate(list, user?.defaultPromptId)?.id ?? null;
    return { prompts: list.map(item => templateResponse(item, ownerId, defaultPromptId)), defaultPromptId };
  });

  fastify.put('/prompts/default', async (request, reply) => {
    const ownerId = request.session.get('userId')!;
    const parsed = z.object({ promptId: z.string().min(1).nullable() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Template inválido' });
    if (parsed.data.promptId && !await prisma.prompt.findFirst({ where: { id: parsed.data.promptId, ...usableTemplateWhere(ownerId) }, select: { id: true } })) {
      return reply.status(404).send({ error: 'Template indisponível' });
    }
    await prisma.user.update({ where: { id: ownerId }, data: { defaultPromptId: parsed.data.promptId } });
    return { defaultPromptId: parsed.data.promptId };
  });

  fastify.post('/prompts', async (request, reply) => {
    const ownerId = request.session.get('userId')!;
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Confira os campos e seus limites: nome 80, descrição 500 e instruções 8000 caracteres.' });
    const { isDefault, ...data } = parsed.data;
    try {
      const prompt = await prisma.$transaction(async tx => {
        const created = await tx.prompt.create({ data: { ...data, description: data.description?.trim() || null, ownerId, isPublic: data.isPublic ?? false }, select: templateSelect });
        if (isDefault) await tx.user.update({ where: { id: ownerId }, data: { defaultPromptId: created.id } });
        return created;
      });
      return reply.status(201).send({ prompt: templateResponse(prompt, ownerId, isDefault ? prompt.id : null) });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return reply.status(409).send({ error: 'Este nome já está em uso. Escolha outro nome para o template.' });
      throw error;
    }
  });

  fastify.post<{ Params: { id: string } }>('/prompts/:id/duplicate', async (request, reply) => {
    const ownerId = request.session.get('userId')!;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Template inválido' });
    const original = await prisma.prompt.findFirst({ where: { id: params.data.id, ...usableTemplateWhere(ownerId) }, select: templateSelect });
    if (!original) return reply.status(404).send({ error: 'Template indisponível' });
    const baseName = templateResponse(original, ownerId).name ?? original.name;
    const { id: _id, owner: _owner, ownerId: _ownerId, platformKey: _key, deletedAt: _deleted, createdAt: _created, updatedAt: _updated, isDefault: _default, ...content } = original;
    const prompt = await prisma.prompt.create({ data: { ...content, name: `${baseName.slice(0, 55)} (cópia ${randomUUID().slice(0, 8)})`, ownerId, isPublic: false }, select: templateSelect });
    return reply.status(201).send({ prompt: templateResponse(prompt, ownerId) });
  });

  fastify.put<{ Params: { id: string } }>('/prompts/:id', async (request, reply) => {
    const ownerId = request.session.get('userId')!;
    const params = paramsSchema.safeParse(request.params);
    const parsed = updateBody.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.status(400).send({ error: 'Dados inválidos. Confira os limites dos campos.' });
    const existing = await prisma.prompt.findFirst({ where: { id: params.data.id, ownerId, platformKey: null, deletedAt: null }, select: { id: true } });
    if (!existing) return reply.status(404).send({ error: 'Template próprio não encontrado ou somente leitura' });
    const { isDefault, ...data } = parsed.data;
    try {
      const prompt = await prisma.$transaction(async tx => {
        const updated = await tx.prompt.update({ where: { id: existing.id }, data, select: templateSelect });
        if (isDefault === true) await tx.user.update({ where: { id: ownerId }, data: { defaultPromptId: existing.id } });
        if (isDefault === false) await tx.user.updateMany({ where: { id: ownerId, defaultPromptId: existing.id }, data: { defaultPromptId: null } });
        return updated;
      });
      return { prompt: templateResponse(prompt, ownerId, isDefault ? prompt.id : null) };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return reply.status(409).send({ error: 'Este nome já está em uso. Escolha outro nome para o template.' });
      throw error;
    }
  });

  fastify.delete<{ Params: { id: string } }>('/prompts/:id', async (request, reply) => {
    const ownerId = request.session.get('userId')!;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Template inválido' });
    const existing = await prisma.prompt.findFirst({ where: { id: params.data.id, ownerId, platformKey: null, deletedAt: null }, select: { id: true } });
    if (!existing) return reply.status(404).send({ error: 'Template próprio não encontrado ou somente leitura' });
    // Retain the record, IDs and all document/session references for history.
    await prisma.prompt.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    return reply.status(204).send();
  });
};
export default prompts;
