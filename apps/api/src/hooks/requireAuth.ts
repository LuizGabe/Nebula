// src/hooks/requireAuth.ts
import { FastifyReply, FastifyRequest } from "fastify";

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const userId = request.session.get("userId");
  if (!userId) {
    return reply.status(401).send({ error: "Não autenticado" });
  }
}

// Versão para WebSocket (sem reply)
export function requireAuthWs(request: FastifyRequest): string | null {
  const userId = request.session.get("userId");
  return userId || null;
}