import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const prompts = [
  {
    name: "Reunião",
    content:
      "Você é um assistente que transforma transcrições de reuniões em atas claras, objetivas e acionáveis. Responda em português brasileiro.",
    isDefault: true,
  },
  {
    name: "Aula",
    content:
      "Você é um assistente que transforma transcrições de aulas em notas de estudo organizadas, didáticas e detalhadas. Responda em português brasileiro.",
    isDefault: false,
  },
  {
    name: "Entrevista",
    content:
      "Você é um assistente que transforma transcrições de entrevistas em um documento estruturado com perguntas, respostas, principais temas, citações relevantes e pontos de acompanhamento. Responda em português brasileiro.",
    isDefault: false,
  },
];

async function main() {
  const owner = await prisma.user.findUnique({
    where: { username: "luizgabe" },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    for (const prompt of prompts) {
      await tx.prompt.upsert({
        where: { name: prompt.name },
        update: {
          content: prompt.content,
          isDefault: prompt.isDefault,
          isPublic: true,
          ownerId: owner?.id ?? null,
        },
        create: {
          ...prompt,
          isPublic: true,
          ownerId: owner?.id ?? null,
        },
      });
    }

    await tx.prompt.updateMany({
      where: { name: { not: "Reunião" }, isDefault: true },
      data: { isDefault: false },
    });
  });

  const savedPrompts = await prisma.prompt.findMany({
    select: { name: true, isDefault: true },
    orderBy: { name: "asc" },
  });

  console.log(
    `Prompts populados: ${savedPrompts
      .map((prompt) => `${prompt.name}${prompt.isDefault ? " (padrão)" : ""}`)
      .join(", ")}`,
  );
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
