// src/routes/transcription-stream.ts
import { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '@/hooks/requireAuth';
import Redis from 'ioredis';
import { config } from '@/config';
import { prisma } from '@/lib/prisma';
import { EventEmitter, on } from 'node:events';

const transcriptionStream: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/sessions/:id/transcription/stream', async (request, reply) => {
    const ownerId = request.session.get('userId')!;
    const { id } = request.params as { id: string };

    const session = await prisma.recordingSession.findFirst({
      where: { id, ownerId },
    });
    if (!session) {
      return reply.status(404).send({ error: 'Sessão não encontrada' });
    }

    const channel = `session:transcription:${id}`;
    const subscriber = new Redis(config.REDIS_URL);

    async function* eventStream() {
      await subscriber.subscribe(channel);
      const emitter = new EventEmitter();
      const onMessage = (chan: string, message: string) => {
        if (chan === channel) {
          emitter.emit('data', message);
        }
      };
      subscriber.on('message', onMessage);

      try {
        for await (const [message] of on(emitter, 'data')) {
          try {
            const parsed = JSON.parse(message);
            yield {
              id: Date.now().toString(),
              event: 'transcription',
              data: JSON.stringify(parsed),
            };
          } catch {
            // ignora mensagens inválidas
          }
        }
      } finally {
        subscriber.off('message', onMessage);
        await subscriber.unsubscribe(channel);
        subscriber.disconnect();
      }
    }

    return reply.sse(eventStream());
  });
};

export default transcriptionStream;