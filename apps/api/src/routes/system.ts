import { FastifyPluginAsync } from "fastify";

import { requireAuth } from "@/hooks/requireAuth";
import { getSystemStatus } from "@/lib/system/status";

const system: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);

  fastify.get("/system/status", async (_request, reply) => {
    const status = await getSystemStatus();
    return reply.send(status);
  });
};

export default system;
