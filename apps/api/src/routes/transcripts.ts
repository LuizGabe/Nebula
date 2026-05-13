import { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../hooks/requireAuth.js";

const transcripts: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);

  // lista versões do documento de uma sessão
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/transcripts",
    async (request, reply) => {
      const ownerId = request.session.get("userId")!;

      const session = await prisma.recordingSession.findFirst({
        where: { id: request.params.id, ownerId },
      });
      if (!session) return reply.status(404).send({ error: "Não encontrada" });

      const transcripts = await prisma.transcript.findMany({
        where:   { sessionId: session.id },
        orderBy: { chunkIndex: "asc" },
        select:  {
          id: true, 
          chunkIndex: true,
          text: true, 
          timestampStart: true, 
          timestampEnd: true
        },
      });

      return reply.send({ transcripts });
    }
  );

  // TODO: Adicionar uma edição manual da transcrição, para corrigir erros de ASR

};

export default transcripts;