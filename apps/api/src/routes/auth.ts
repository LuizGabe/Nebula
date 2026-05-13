// src/routes/auth.ts
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import argon2 from "argon2";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/hooks/requireAuth";
import { config } from "@/config";

const registerBody = z.object({
  username: z.string().min(3).max(32).trim(),
  password: z.string().min(8),
});

const loginBody = z.object({
  username: z.string().trim(),
  password: z.string(),
});

const auth: FastifyPluginAsync = async (fastify) => {
  fastify.post("/auth/register", async (request, reply) => {
    if (!config.REGISTRATION_ENABLED) {
      return reply.status(503).send({ error: "Registro de novos usuários está desabilitado" });
    }
    const parsed = registerBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { username, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return reply.status(409).send({ error: "Username já em uso" });
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const user = await prisma.user.create({
      data: { username, hashedPassword: passwordHash },
      select: { id: true, username: true, createdAt: true },
    });

    request.session.set("userId", user.id);
    request.session.set("username", user.username);

    return reply.status(201).send({ user });
  });

  fastify.post("/auth/login", async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body' });
    }

    const { username, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { username } });  

    // verifica mesmo se user não existe — evita timing attack
    const hash = user?.hashedPassword ?? "$argon2id$v=19$m=65536,t=3,p=4$ne2XEIflf2ulW4OfV0/Ddg$V+b/oXtlF5yBRSOTZ0oHjQhY2ymOSIXG/AXTnGiQx+k";
    const valid = await argon2.verify(hash, password);

    if (!user || !valid) {
      return reply.status(401).send({ error: "Credenciais inválidas" });
    }

    request.session.set("userId", user.id);
    request.session.set("username", user.username);

    return reply.status(200).send({
      user: { id: user.id, username: user.username, config: user.config },
    });
  });

  fastify.post(
    "/auth/logout",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      request.session.delete();
      return reply.status(204).send();
    }
  );

  fastify.get(
    "/auth/me",
    { preHandler: [requireAuth] },
    async (request, reply) => {

      const userId = request.session.get("userId");

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, config: true },
      });



      return reply.send({
        userId: request.session.get("userId"),
        username: request.session.get("username"),
        config: user?.config ?? {},
      });
    }
  );
};

export default auth;