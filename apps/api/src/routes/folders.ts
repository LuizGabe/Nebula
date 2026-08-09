import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "@/hooks/requireAuth";
import { prisma } from "@/lib/prisma";

const folderBody = z.object({
  name: z.string().min(1).max(80),
  parentId: z.string().nullable().optional(),
});

async function ensureParent(ownerId: string, parentId?: string | null) {
  if (!parentId) return null;
  return prisma.folder.findFirst({
    where: { id: parentId, ownerId },
    select: { id: true },
  });
}

const folders: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireAuth);

  fastify.get("/folders", async (request, reply) => {
    const ownerId = request.session.get("userId")!;
    const list = await prisma.folder.findMany({
      where: { ownerId },
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { sessions: true, children: true } },
      },
    });

    return reply.send({ folders: list });
  });

  fastify.post("/folders", async (request, reply) => {
    const ownerId = request.session.get("userId")!;
    const parsed = folderBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Dados invalidos" });
    }

    const parent = await ensureParent(ownerId, parsed.data.parentId);
    if (parsed.data.parentId && !parent) {
      return reply.status(404).send({ error: "Pasta pai nao encontrada" });
    }

    const folder = await prisma.folder.create({
      data: {
        ownerId,
        name: parsed.data.name.trim(),
        parentId: parent?.id ?? null,
      },
    });

    return reply.status(201).send({ folder });
  });

  fastify.put<{ Params: { id: string } }>("/folders/:id", async (request, reply) => {
    const ownerId = request.session.get("userId")!;
    const parsed = folderBody.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Dados invalidos" });
    }

    const current = await prisma.folder.findFirst({
      where: { id: request.params.id, ownerId },
      select: { id: true },
    });
    if (!current) return reply.status(404).send({ error: "Pasta nao encontrada" });

    if (parsed.data.parentId === request.params.id) {
      return reply.status(400).send({ error: "Uma pasta nao pode ser pai dela mesma" });
    }

    const parent = await ensureParent(ownerId, parsed.data.parentId);
    if (parsed.data.parentId && !parent) {
      return reply.status(404).send({ error: "Pasta pai nao encontrada" });
    }

    const folder = await prisma.folder.update({
      where: { id: current.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.parentId !== undefined ? { parentId: parent?.id ?? null } : {}),
      },
    });

    return reply.send({ folder });
  });

  fastify.delete<{ Params: { id: string } }>("/folders/:id", async (request, reply) => {
    const ownerId = request.session.get("userId")!;
    const folder = await prisma.folder.findFirst({
      where: { id: request.params.id, ownerId },
      select: { id: true },
    });
    if (!folder) return reply.status(404).send({ error: "Pasta nao encontrada" });

    await prisma.folder.delete({ where: { id: folder.id } });
    return reply.status(204).send();
  });
};

export default folders;
