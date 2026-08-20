import { FastifyPluginAsync } from 'fastify';
import { createTranscriberClient, startTranscriptionStream } from '@/lib/grpc-client';
import { prisma } from '@/lib/prisma';
import { requireAuthWs } from '@/hooks/requireAuth';

const ws: FastifyPluginAsync = async (fastify) => {
  fastify.get('/ws/transcribe', { websocket: true }, (connection, req) => {
    const userId = requireAuthWs(req);
    if (!userId) {
      fastify.log.warn('WebSocket rejected: unauthorized');
      connection.close(1008, 'Unauthorized');
      return;
    }
    fastify.log.info(`WebSocket connected for user ${userId}`);

    let sessionId: string | null = null;
    let grpcStream: ReturnType<typeof startTranscriptionStream> | null = null;
    let isFirstMessage = true;
    let sessionMode: 'MEETING' | 'CLASS' = 'MEETING';
    let sessionLanguage = 'pt';
    let metaSent = false;
    let startTime: number | null = null;
    let accumulatedMs = 0;

    const finishGrpc = () => {
      if (grpcStream && sessionId) {
        fastify.log.info(`Sending end_of_stream to gRPC for session ${sessionId}`);
        try {
          grpcStream.write({
            session_id: sessionId,
            timestamp_ms: Date.now(),
            pcm_data: Buffer.alloc(0),
            end_of_stream: true,
          });
          grpcStream.end();
        } catch (err) {
          fastify.log.error(err, 'Error ending gRPC stream');
        }
        grpcStream = null;
      }
    };

    const updateSessionStatus = async (status: 'IN_PROGRESS' | 'ENDED') => {
      if (sessionId) {
        try {
          await prisma.recordingSession.update({
            where: { id: sessionId },
            data: { status },
          });
          fastify.log.info(`Session ${sessionId} status updated to ${status}`);
        } catch (err) {
          fastify.log.error(err, `Failed to update session status`);
        }
      }
    };

    const onClose = async () => {
      fastify.log.info(`WebSocket closed for session ${sessionId || 'unknown'}`);
      if (sessionId) {
        finishGrpc();
        await updateSessionStatus('ENDED');
      }
    };

    connection.on('close', onClose);
    connection.on('error', (err) => {
      fastify.log.error(err, 'WebSocket error');
    });

    connection.on('message', async (message) => {
      try {
        if (isFirstMessage) {
          const raw = message.toString();
          fastify.log.info(`First message: ${raw}`);
          let data: any;
          try {
            data = JSON.parse(raw);
          } catch {
            fastify.log.warn('Invalid first message: not JSON');
            connection.close(1003, 'Invalid first message');
            return;
          }

          const { sessionId: sid, language = 'pt' } = data;
          if (!sid) {
            fastify.log.warn('Missing sessionId');
            connection.close(1003, 'Missing sessionId');
            return;
          }

          const session = await prisma.recordingSession.findFirst({
            where: { id: sid, ownerId: userId },
            include: { prompt: { select: { transcriptionMode: true } } },
          });
          if (!session) {
            fastify.log.warn(`Session ${sid} not found for user ${userId}`);
            connection.close(1003, 'Session not found');
            return;
          }

          sessionId = sid;
          sessionMode = (session.transcriptionModeOverride ?? session.prompt?.transcriptionMode ?? 'MEETING') as 'MEETING' | 'CLASS';
          sessionLanguage = language;

          await updateSessionStatus('IN_PROGRESS');

          const client = createTranscriberClient();
          fastify.log.info(`Creating gRPC stream for session ${sessionId}`);
          grpcStream = startTranscriptionStream(
            client,
            (data) => {
              fastify.log.debug(`gRPC data (ignored): ${JSON.stringify(data)}`);
            },
            () => {
              fastify.log.info(`gRPC stream ended for session ${sessionId}`);
            },
            (err) => {
              fastify.log.error(err, `gRPC stream error for session ${sessionId}`);
              connection.close(1011, 'gRPC error');
            }
          );

          // ENVIA CHUNK INICIAL COM SILÊNCIO E META
          const silence = Buffer.alloc(2048); // 1024 frames de silêncio
          const firstChunk = {
            session_id: sessionId,
            timestamp_ms: 0,
            pcm_data: silence,
            end_of_stream: false,
            meta: {
              mode: sessionMode,
              language_hint: language,
            },
          };
          try {
            grpcStream.write(firstChunk);
            metaSent = true;
            fastify.log.info(`✅ Sent initial chunk with meta for session ${sessionId}`);
          } catch (err) {
            fastify.log.error(err, 'Failed to send initial chunk');
            connection.close(1011, 'gRPC write error');
            return;
          }

          isFirstMessage = false;
          fastify.log.info(`WebSocket initialized for session ${sessionId}`);
          return;
        }

        if (!sessionId || !grpcStream) {
          fastify.log.warn('Received message before session init');
          connection.close(1003, 'Not initialized');
          return;
        }

        if (!Buffer.isBuffer(message)) {
          try {
            const json = JSON.parse(message.toString());
            if (json.end === true) {
              fastify.log.info(`Client requested end for session ${sessionId}`);
              finishGrpc();
              await updateSessionStatus('ENDED');
              connection.close(1000, 'End requested');
              return;
            }
          } catch {
            // ignorar
          }
          return;
        }

        if (message.length === 0) {
          fastify.log.warn('Empty chunk, ignoring');
          return;
        }

        const now = Date.now();
        if (startTime === null) {
          startTime = now;
          accumulatedMs = 0;
        } else {
          const samples = message.length / 2;
          const ms = (samples / 16000) * 1000;
          accumulatedMs += ms;
        }

        const timestampToSend = Math.round(accumulatedMs);

        const chunk: any = {
          session_id: sessionId,
          pcm_data: message,
          timestamp_ms: timestampToSend,
          end_of_stream: false,
        };

        // Se meta não foi enviado (caso o chunk inicial tenha falhado), enviar agora
        if (!metaSent) {
          chunk.meta = {
            mode: sessionMode,
            language_hint: sessionLanguage,
          };
          metaSent = true;
          fastify.log.info(`Sending meta with first audio chunk for session ${sessionId}`);
        }

        fastify.log.debug(`Sending chunk: timestamp=${timestampToSend}, size=${message.length}`);
        grpcStream.write(chunk);

      } catch (err) {
        fastify.log.error(err, 'Error processing WebSocket message');
        connection.close(1011, 'Internal error');
      }
    });
  });
};

export default ws;
