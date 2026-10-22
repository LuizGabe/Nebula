import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/hooks/requireAuth';

const paramsSchema = z.object({ id: z.string().min(1).max(128), mediaId: z.string().min(1).max(256) });
const mediaRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth);
  app.get('/sessions/:id/audio-media/:mediaId/peaks', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Dados inválidos' });
    const media = await prisma.audioMedia.findFirst({
      where: { id: params.data.mediaId, sessionId: params.data.id, session: { ownerId: request.session.get('userId')!, isDeleted: false } },
      select: { peaks: true, durationMs: true },
    });
    if (!media) return reply.status(404).send({ error: 'Áudio não encontrado' });
    return reply.send({ peaks: media.peaks, durationMs: media.durationMs });
  });
};
export default mediaRoutes;
