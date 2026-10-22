import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const templates = [
  {
    name: "Briefing executivo",
    description: "Transforma conversas em um resumo direto para decisao, com contexto, riscos e proximos passos.",
    instructions: [
      "Crie um briefing executivo claro, objetivo e acionavel.",
      "",
      "Estruture o documento com:",
      "- resumo em ate 5 bullets;",
      "- contexto essencial;",
      "- decisoes e alinhamentos;",
      "- riscos, bloqueios e dependencias;",
      "- proximos passos com responsaveis e prazos quando forem mencionados.",
      "",
      "Corte repeticoes, conversas laterais e detalhes que nao ajudem uma pessoa ocupada a entender o que precisa decidir ou acompanhar.",
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
    name: "Artigo estruturado",
    description: "Converte a transcricao em um artigo ou post longo com tese, secoes e conclusao forte.",
    instructions: [
      "Transforme o conteudo em um artigo bem estruturado em portugues brasileiro.",
      "",
      "Inclua uma abertura com gancho, uma tese central, secoes com argumentos claros, exemplos extraidos da transcricao e uma conclusao util.",
      "Preserve as ideias do audio, mas reescreva com fluidez editorial. Nao invente dados, fontes ou exemplos que nao estejam no material.",
    ].join("\n"),
    formality: "neutral",
    detailLevel: "detailed",
    useTitle: true,
    useHeadings: true,
    useSubheadings: true,
    preferLists: true,
    preferTables: true,
    includeAudioCitations: true,
    transcriptionMode: "MEETING",
    isDefault: false,
  },
  {
    name: "Guia passo a passo",
    description: "Gera um tutorial pratico, organizado em etapas, pre-requisitos, alertas e checklist final.",
    instructions: [
      "Crie um guia pratico e facil de executar a partir da transcricao.",
      "",
      "Organize em objetivo, pre-requisitos, passo a passo, cuidados importantes, erros comuns e checklist final.",
      "Quando uma etapa depender de contexto ou ordem especifica mencionada no audio, deixe isso claro.",
      "Use linguagem direta e operacional.",
    ].join("\n"),
    formality: "neutral",
    detailLevel: "detailed",
    useTitle: true,
    useHeadings: true,
    useSubheadings: true,
    preferLists: true,
    preferTables: false,
    includeAudioCitations: true,
    transcriptionMode: "CLASS",
    isDefault: false,
  },
  {
    name: "Plano de acao",
    description: "Extrai tarefas, prioridades, donos, prazos, riscos e criterios de sucesso.",
    instructions: [
      "Converta a transcricao em um plano de acao executavel.",
      "",
      "Inclua uma visao geral curta, uma tabela de tarefas, prioridades, responsaveis, prazos, dependencias e status sugerido.",
      "Separe tambem riscos, perguntas em aberto e decisoes que precisam ser tomadas.",
      "Se algum responsavel ou prazo nao foi dito, marque como 'nao definido' em vez de inventar.",
    ].join("\n"),
    formality: "neutral",
    detailLevel: "balanced",
    useTitle: true,
    useHeadings: true,
    useSubheadings: true,
    preferLists: true,
    preferTables: true,
    includeAudioCitations: true,
    transcriptionMode: "MEETING",
    isDefault: false,
  },
  {
    name: "Material de estudo",
    description: "Cria notas de aula, conceitos-chave, exemplos, perguntas de revisao e flashcards.",
    instructions: [
      "Transforme a transcricao em um material de estudo completo e didatico.",
      "",
      "Organize conceitos principais, definicoes, exemplos, duvidas importantes, resumo da aula e pontos para revisar.",
      "Inclua ao final perguntas de revisao e flashcards em formato pergunta/resposta.",
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
    name: "Mapa de ideias",
    description: "Uma opcao mais criativa para encontrar oportunidades, temas recorrentes e conexoes inesperadas.",
    instructions: [
      "Crie um mapa de ideias a partir da transcricao.",
      "",
      "Identifique temas recorrentes, tensoes, oportunidades, perguntas boas, hipoteses e possiveis caminhos de exploracao.",
      "Agrupe as ideias por clusters e indique quais parecem mais promissoras, quais precisam de validacao e quais sao apenas especulativas.",
      "Nao transforme especulacao em fato.",
    ].join("\n"),
    formality: "neutral",
    detailLevel: "balanced",
    useTitle: true,
    useHeadings: true,
    useSubheadings: true,
    preferLists: true,
    preferTables: true,
    includeAudioCitations: true,
    transcriptionMode: "MEETING",
    isDefault: false,
  },
  {
    name: "Roteiro multiformato",
    description: "Gera ideias de conteudo reutilizaveis para video, carrossel, newsletter e post curto.",
    instructions: [
      "Transforme a transcricao em um pacote de conteudo multiformato.",
      "",
      "Crie: um roteiro curto para video, uma estrutura de carrossel, uma newsletter resumida, 5 ideias de posts curtos e uma lista de titulos possiveis.",
      "Mantenha cada formato fiel ao que foi dito, com linguagem clara e boa cadencia editorial.",
      "Sinalize trechos que precisariam de dados adicionais antes de publicar.",
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
    ["Reuniao", "Briefing executivo"],
    [String.fromCharCode(82, 101, 117, 110, 105, 227, 111), "Briefing executivo"],
    ["Aula", "Material de estudo"],
    ["Entrevista", "Briefing executivo"],
    ["Ata de reuniao", "Briefing executivo"],
    ["Notas de aula", "Material de estudo"],
    ["Resumo de entrevista", "Briefing executivo"],
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
    await tx.recordingSession.updateMany({
      where: { promptId: { not: null } },
      data: { promptId: null },
    });
    await tx.document.updateMany({
      where: { promptId: { not: null } },
      data: { promptId: null },
    });
    await tx.prompt.deleteMany({});

    for (const template of templates) {
      await tx.prompt.create({
        data: {
          ...template,
          isPublic: true,
          ownerId: owner?.id ?? null,
        },
      });
    }

    await tx.prompt.updateMany({
      where: { name: { not: "Briefing executivo" }, isDefault: true },
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
