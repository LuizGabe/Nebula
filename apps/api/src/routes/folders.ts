import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "@/hooks/requireAuth";
import { prisma } from "@/lib/prisma";
import { FOLDER_COLORS, normalizeFolderColor } from '@/lib/folderColors';

const folderBody = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.enum(FOLDER_COLORS).optional(),
  parentId: z.string().nullable().optional(),
});

const deleteFolderBody = z.object({
  sessionAction: z.enum(["moveToRoot", "delete"]).default("moveToRoot"),
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
        color: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { sessions: true, children: true } },
      },
    });

    return reply.send({ folders: list.map(folder => ({ ...folder, color: normalizeFolderColor(folder.color) })) });
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
        color: parsed.data.color ?? 'neutral',
        parentId: parent?.id ?? null,
      },
    });

    return reply.status(201).send({ folder: { ...folder, color: normalizeFolderColor(folder.color) } });
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
        ...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
        ...(parsed.data.parentId !== undefined ? { parentId: parent?.id ?? null } : {}),
      },
    });

    return reply.send({ folder: { ...folder, color: normalizeFolderColor(folder.color) } });
  });

  fastify.delete<{ Params: { id: string } }>("/folders/:id", async (request, reply) => {
    const ownerId = request.session.get("userId")!;
    const parsed = deleteFolderBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Dados invalidos" });
    }

    const folder = await prisma.folder.findFirst({
      where: { id: request.params.id, ownerId },
      select: { id: true },
    });
    if (!folder) return reply.status(404).send({ error: "Pasta nao encontrada" });

    const allFolders = await prisma.folder.findMany({
      where: { ownerId },
      select: { id: true, parentId: true },
    });
    const folderIds = new Set([folder.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of allFolders) {
        if (item.parentId && folderIds.has(item.parentId) && !folderIds.has(item.id)) {
          folderIds.add(item.id);
          changed = true;
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      if (parsed.data.sessionAction === "delete") {
        await tx.recordingSession.updateMany({
          where: { ownerId, folderId: { in: [...folderIds] } },
          data: { isDeleted: true },
        });
      } else {
        await tx.recordingSession.updateMany({
          where: { ownerId, folderId: { in: [...folderIds] } },
          data: { folderId: null },
        });
      }

      await tx.folder.delete({ where: { id: folder.id } });
    });

    return reply.status(204).send();
  });
};

export default folders;
