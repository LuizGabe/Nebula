import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const templates = [
  {
    name: "Ata de reuniao",
    description: "Template para transformar reunioes em atas objetivas e acionaveis.",
    instructions: [
      "Crie uma ata clara e organizada.",
      "",
      "Priorize:",
      "- assuntos discutidos;",
      "- decisoes tomadas;",
      "- responsaveis;",
      "- proximos passos;",
      "- prazos mencionados.",
      "",
      "Evite repeticao e informacoes irrelevantes.",
    ].join("\n"),
    formality: "formal",
    detailLevel: "balanced",
    useTitle: true,
    useHeadings: true,
    useSubheadings: true,
    preferLists: true,
    preferTables: false,
    includeAudioCitations: true,
    transcriptionMode: "MEETING",
    isDefault: true,
  },
  {
    name: "Notas de aula",
    description: "Template para converter aulas em material de estudo estruturado.",
    instructions: [
      "Crie notas de estudo didaticas a partir da aula.",
      "",
      "Organize conceitos, definicoes, exemplos, duvidas relevantes e pontos para revisao.",
      "Quando houver exercicios, leituras ou tarefas sugeridas, destaque-os separadamente.",
    ].join("\n"),
    formality: "neutral",
    detailLevel: "detailed",
    useTitle: true,
    useHeadings: true,
    useSubheadings: true,
    preferLists: true,
    preferTables: true,
    includeAudioCitations: true,
    transcriptionMode: "CLASS",
    isDefault: false,
  },
  {
    name: "Resumo de entrevista",
    description: "Template para organizar entrevistas em temas, respostas e sinais importantes.",
    instructions: [
      "Crie um documento estruturado da entrevista.",
      "",
      "Organize os principais temas, perguntas e respostas quando forem identificaveis.",
      "Destaque citacoes relevantes, sinais de decisao e pontos de acompanhamento.",
    ].join("\n"),
    formality: "neutral",
    detailLevel: "balanced",
    useTitle: true,
    useHeadings: true,
    useSubheadings: true,
    preferLists: true,
    preferTables: false,
    includeAudioCitations: true,
    transcriptionMode: "MEETING",
    isDefault: false,
  },
];

async function ensureSchema() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "prompts"
      ADD COLUMN IF NOT EXISTS "description" TEXT,
      ADD COLUMN IF NOT EXISTS "instructions" TEXT,
      ADD COLUMN IF NOT EXISTS "formality" TEXT NOT NULL DEFAULT 'neutral',
      ADD COLUMN IF NOT EXISTS "detailLevel" TEXT NOT NULL DEFAULT 'balanced',
      ADD COLUMN IF NOT EXISTS "useTitle" BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "useHeadings" BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "useSubheadings" BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "preferLists" BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "preferTables" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "includeAudioCitations" BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "transcriptionMode" TEXT NOT NULL DEFAULT 'MEETING',
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "recording_sessions"
      ADD COLUMN IF NOT EXISTS "sessionContext" TEXT,
      ADD COLUMN IF NOT EXISTS "formalityOverride" TEXT,
      ADD COLUMN IF NOT EXISTS "detailLevelOverride" TEXT,
      ADD COLUMN IF NOT EXISTS "useTitleOverride" BOOLEAN,
      ADD COLUMN IF NOT EXISTS "useHeadingsOverride" BOOLEAN,
      ADD COLUMN IF NOT EXISTS "useSubheadingsOverride" BOOLEAN,
      ADD COLUMN IF NOT EXISTS "preferListsOverride" BOOLEAN,
      ADD COLUMN IF NOT EXISTS "preferTablesOverride" BOOLEAN,
      ADD COLUMN IF NOT EXISTS "includeAudioCitationsOverride" BOOLEAN,
      ADD COLUMN IF NOT EXISTS "instructionsOverride" TEXT,
      ADD COLUMN IF NOT EXISTS "transcriptionModeOverride" TEXT;
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'recording_sessions' AND column_name = 'userInstructions'
      ) THEN
        UPDATE "recording_sessions"
        SET "instructionsOverride" = "userInstructions"
        WHERE ("instructionsOverride" IS NULL OR btrim("instructionsOverride") = '')
          AND "userInstructions" IS NOT NULL
          AND btrim("userInstructions") <> '';
      END IF;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "recording_sessions"
      DROP COLUMN IF EXISTS "writingStyle",
      DROP COLUMN IF EXISTS "userInstructions";
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'prompts' AND column_name = 'user_template'
      ) THEN
        UPDATE "prompts"
        SET "instructions" = btrim(regexp_replace(
          regexp_replace(
            regexp_replace("user_template", '<dados_usuario_input[\\s\\S]*?</dados_usuario_input>', '', 'gi'),
            '\\{\\{\\s*(transcricao|contexto_sessao|sessionTitle|promptName|createdAt)\\s*\\}\\}',
            '',
            'gi'
          ),
          '</?[^>]+>',
          '',
          'g'
        ))
        WHERE "instructions" IS NULL OR btrim("instructions") = '';
      END IF;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "prompts"
    SET "instructions" = 'Gere um documento claro, organizado e util em portugues brasileiro com base na transcricao da sessao.'
    WHERE "instructions" IS NULL OR btrim("instructions") = '';
  `);

  await prisma.$executeRawUnsafe(`ALTER TABLE "prompts" ALTER COLUMN "instructions" SET NOT NULL;`);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "prompts"
      DROP COLUMN IF EXISTS "system_prompt",
      DROP COLUMN IF EXISTS "user_template",
      DROP COLUMN IF EXISTS "available_variables",
      DROP COLUMN IF EXISTS "content",
      DROP COLUMN IF EXISTS "template";
  `);
}

async function mergeLegacyTemplateNames() {
  const mappings = [
    ["Reuniao", "Ata de reuniao"],
    [String.fromCharCode(82, 101, 117, 110, 105, 227, 111), "Ata de reuniao"],
    ["Aula", "Notas de aula"],
    ["Entrevista", "Resumo de entrevista"],
  ] as const;

  for (const [legacyName, canonicalName] of mappings) {
    const [legacy, canonical] = await Promise.all([
      prisma.prompt.findUnique({ where: { name: legacyName }, select: { id: true } }),
      prisma.prompt.findUnique({ where: { name: canonicalName }, select: { id: true } }),
    ]);

    if (legacy && !canonical) {
      await prisma.prompt.update({ where: { id: legacy.id }, data: { name: canonicalName } });
    } else if (legacy && canonical && legacy.id !== canonical.id) {
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
}

async function main() {
  await ensureSchema();
  await mergeLegacyTemplateNames();

  const owner = await prisma.user.findUnique({
    where: { username: "luizgabe" },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    for (const template of templates) {
      await tx.prompt.upsert({
        where: { name: template.name },
        update: {
          ...template,
          isPublic: true,
          ownerId: owner?.id ?? null,
        },
        create: {
          ...template,
          isPublic: true,
          ownerId: owner?.id ?? null,
        },
      });
    }

    await tx.prompt.updateMany({
      where: { name: { not: "Ata de reuniao" }, isDefault: true },
      data: { isDefault: false },
    });
  });

  const savedTemplates = await prisma.prompt.findMany({
    select: { name: true, isDefault: true },
    orderBy: { name: "asc" },
  });

  console.log(
    `Templates populados: ${savedTemplates
      .map((template) => `${template.name}${template.isDefault ? " (padrao)" : ""}`)
      .join(", ")}`,
  );
}

main().finally(async () => {
  await prisma.$disconnect();
});
