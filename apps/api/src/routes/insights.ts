import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/hooks/requireAuth';
import { postProcessQueue } from '@/jobs/queues';
import { insightsSchema } from '@/lib/insights';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const insightsRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth);
  for (const method of ['GET', 'POST'] as const) app.route({ method, url: '/sessions/:id/insights', handler: async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success || (method === 'POST' && !z.object({}).strict().safeParse(request.body ?? {}).success)) return reply.status(400).send({ error: 'Dados inválidos' });
    const session = await prisma.recordingSession.findFirst({ where: { id: params.data.id, ownerId: request.session.get('userId')!, isDeleted: false } });
    if (!session) return reply.status(404).send({ error: 'Sessão não encontrada' });
    const jobId = `insights-${session.id}`;
    const job = await postProcessQueue.getJob(jobId);
    if (method === 'GET') {
      const parsed = insightsSchema.safeParse(session.insights);
      return reply.send({ insights: parsed.success ? parsed.data : null, status: job ? await job.getState() : 'not_found', error: job?.failedReason || null });
    }
    if (!['ENDED', 'ERROR'].includes(session.status)) return reply.status(409).send({ error: 'Aguarde a transcrição terminar' });
    if (!await prisma.transcript.count({ where: { sessionId: session.id } })) return reply.status(409).send({ error: 'Nenhuma transcrição disponível' });
    if (job) {
      if (!['completed', 'failed'].includes(await job.getState())) return reply.status(409).send({ error: 'Insights em processamento' });
      await job.remove();
    }
    await postProcessQueue.add('generate-insights', { sessionId: session.id, triggeredBy: 'insights_only' }, { jobId });
    return reply.status(202).send({ jobId });
  } });
};
export default insightsRoutes;
