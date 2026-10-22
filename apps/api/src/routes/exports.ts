import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/hooks/requireAuth';
import { ExportService } from '@/lib/ExportService';
const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const querySchema = z.object({ format: z.enum(['srt','vtt','pdf','docx','json','md','txt']) });
const exportRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth);
  app.get('/sessions/:id/export', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params); const query = querySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.status(400).send({ error: 'Formato ou sessão inválidos' });
    const session = await prisma.recordingSession.findFirst({ where: { id: params.data.id, ownerId: request.session.get('userId')!, isDeleted: false } });
    if (!session) return reply.status(404).send({ error: 'Sessão não encontrada' });
    const blocks = await prisma.transcript.findMany({ where: { sessionId: session.id }, orderBy: [{ timestampStart: 'asc' }, { chunkIndex: 'asc' }] });
    if (!blocks.length) return reply.status(409).send({ error: 'Nenhuma transcrição disponível para exportar' });
    const result = await ExportService.compile({ title: session.title || 'Transcrição', blocks, speakerNames: (session.speakerNames ?? {}) as Record<string,string> }, query.data.format);
    return reply.header('Content-Type',result.mimeType).header('Content-Disposition',`attachment; filename="transcricao.${result.extension}"`).header('Cache-Control','private, no-store').send(result.data);
  });
};
export default exportRoutes;
