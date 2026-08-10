import { FastifyPluginAsync } from "fastify";

import { requireAuth } from "@/hooks/requireAuth";
import { getSystemStatus } from "@/lib/system/status";
import { getStreamingTranscriptionEngine } from "@/lib/transcriptionEngines";

const system: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);

  fastify.get("/system/status", async (_request, reply) => {
    const status = await getSystemStatus();
    return reply.send(status);
  });

  fastify.get("/system/transcription-engine", async (_request, reply) => {
    const engine = await getStreamingTranscriptionEngine();
    return reply.send(engine);
  });
};

export default system;
