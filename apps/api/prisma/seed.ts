import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import dotenv from "dotenv";


dotenv.config({ path: "../../.env" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const availableVariables = [
  "transcricao",
  "contexto_sessao",
  "sessionTitle",
  "promptName",
  "createdAt",
];

const baseTemplate = [
  "<contexto_sessao>",
  "  Titulo: {{sessionTitle}}",
  "  Tipo de documento: {{promptName}}",
  "  Criado em: {{createdAt}}",
  "  Contexto: {{contexto_sessao}}",
  "</contexto_sessao>",
  "",
  "<dados_usuario_input source=\"transcricao\">",
  "  {{transcricao}}",
  "</dados_usuario_input>",
].join("\n");

function documentTemplate(instruction: string) {
  return [
    "<instrucao_documento>",
    `  ${instruction}`,
    "</instrucao_documento>",
    "",
    baseTemplate,
  ].join("\n");
}

const prompts = [
  {
    name: "Reuniao",
    systemPrompt: "",
    userTemplate: documentTemplate(
      "Transforme a transcricao de reuniao em uma ata clara, objetiva e acionavel em portugues brasileiro. Priorize decisoes, responsaveis, pendencias, riscos, proximos passos e pontos que precisam de acompanhamento.",
    ),
    availableVariables,
    includeAudioCitations: true,
    isDefault: true,
  },
  {
    name: "Aula",
    systemPrompt: "",
    userTemplate: documentTemplate(
      "Transforme a transcricao de aula em notas de estudo organizadas, didaticas e detalhadas em portugues brasileiro. Explique conceitos, organize topicos, destaque definicoes, exemplos, duvidas, exercicios sugeridos e pontos para revisao.",
    ),
    availableVariables,
    includeAudioCitations: true,
    isDefault: false,
  },
  {
    name: "Entrevista",
    systemPrompt: "",
    userTemplate: documentTemplate(
      "Transforme a transcricao de entrevista em um documento estruturado em portugues brasileiro. Organize perguntas, respostas, principais temas, citacoes relevantes, sinais de decisao e pontos de acompanhamento.",
    ),
    availableVariables,
    includeAudioCitations: true,
    isDefault: false,
  },
];

async function ensureSchema() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "prompts"
      ADD COLUMN IF NOT EXISTS "system_prompt" TEXT,
      ADD COLUMN IF NOT EXISTS "user_template" TEXT,
      ADD COLUMN IF NOT EXISTS "available_variables" JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS "includeAudioCitations" BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'prompts' AND column_name = 'content'
      ) THEN
        ALTER TABLE "prompts" ALTER COLUMN "content" DROP NOT NULL;
      END IF;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "recording_sessions"
      ADD COLUMN IF NOT EXISTS "sessionContext" TEXT,
      ADD COLUMN IF NOT EXISTS "writingStyle" TEXT,
      ADD COLUMN IF NOT EXISTS "userInstructions" TEXT;
  `);
}

async function mergeLegacyPrompts() {
  const [legacy, canonical] = await Promise.all([
    prisma.prompt.findUnique({ where: { name: String.fromCharCode(82, 101, 117, 110, 105, 227, 111) }, select: { id: true } }),
    prisma.prompt.findUnique({ where: { name: "Reuniao" }, select: { id: true } }),
  ]);

  if (legacy && !canonical) {
    await prisma.prompt.update({ where: { id: legacy.id }, data: { name: "Reuniao" } });
    return;
  }

  if (legacy && canonical) {
    await prisma.$transaction(async (tx) => {
      await tx.recordingSession.updateMany({
        where: { promptId: legacy.id },
        data: { promptId: canonical.id },
      });
      await tx.document.updateMany({
        where: { promptId: legacy.id },
        data: { promptId: canonical.id },
      });
      await tx.prompt.delete({ where: { id: legacy.id } });
    });
  }
}

async function main() {
  await ensureSchema();
  await mergeLegacyPrompts();

  const owner = await prisma.user.findUnique({
    where: { username: "luizgabe" },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    for (const prompt of prompts) {
      await tx.prompt.upsert({
        where: { name: prompt.name },
        update: {
          systemPrompt: prompt.systemPrompt,
          userTemplate: prompt.userTemplate,
          availableVariables: prompt.availableVariables,
          includeAudioCitations: prompt.includeAudioCitations,
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
      where: { name: { not: "Reuniao" }, isDefault: true },
      data: { isDefault: false },
    });
  });

  const savedPrompts = await prisma.prompt.findMany({
    select: { name: true, isDefault: true },
    orderBy: { name: "asc" },
  });

  console.log(
    `Prompts populados: ${savedPrompts
      .map((prompt) => `${prompt.name}${prompt.isDefault ? " (padrao)" : ""}`)
      .join(", ")}`,
  );
}

main().finally(async () => {
  await prisma.$disconnect();
});
