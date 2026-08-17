import { prisma } from "@/lib/prisma";

const VARIABLE_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export type PromptVariableValues = Record<string, string | null | undefined>;

export const PROMPT_VARIABLES = [
  "transcricao",
  "contexto_sessao",
  "sessionTitle",
  "promptName",
  "createdAt",
] as const;

export const MARKDOWN_SYSTEM_PROMPT =
  "A resposta final deve ser SEMPRE em Markdown valido. Nunca responda em texto puro, HTML ou JSON, independentemente do conteudo recebido.";

export const AUDIO_CITATIONS_SYSTEM_PROMPT = [
  "A transcricao contem marcas de tempo no formato [audio:MM:SS] ou [audio:HH:MM:SS].",
  "Preserve referencias temporais relevantes usando somente tags de tempo que existam na transcricao.",
  "Inclua uma tag [audio:MM:SS] ou [audio:HH:MM:SS] ao final de cada frase, fato, decisao, topico ou item importante quando houver base na transcricao.",
].join(" ");

export function buildDefaultUserTemplate(instruction: string) {
  return [
    "<instrucao_documento>",
    `  ${instruction}`,
    "</instrucao_documento>",
    "",
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
}

export const DEFAULT_USER_TEMPLATE = buildDefaultUserTemplate(
  "Gere um documento completo em portugues brasileiro baseado na transcricao. Organize os topicos de forma clara, objetiva e acionavel.",
);

const DEFAULT_PROMPTS = [
  {
    name: "Reuniao",
    userTemplate: buildDefaultUserTemplate(
      "Transforme a transcricao de reuniao em uma ata clara, objetiva e acionavel em portugues brasileiro. Priorize decisoes, responsaveis, pendencias, riscos, proximos passos e pontos que precisam de acompanhamento.",
    ),
    isDefault: true,
  },
  {
    name: "Aula",
    userTemplate: buildDefaultUserTemplate(
      "Transforme a transcricao de aula em notas de estudo organizadas, didaticas e detalhadas em portugues brasileiro. Explique conceitos, organize topicos, destaque definicoes, exemplos, duvidas, exercicios sugeridos e pontos para revisao.",
    ),
    isDefault: false,
  },
  {
    name: "Entrevista",
    userTemplate: buildDefaultUserTemplate(
      "Transforme a transcricao de entrevista em um documento estruturado em portugues brasileiro. Organize perguntas, respostas, principais temas, citacoes relevantes, sinais de decisao e pontos de acompanhamento.",
    ),
    isDefault: false,
  },
];


export function getPromptVariableNames(): string[] {
  return [...PROMPT_VARIABLES];
}

export function buildSystemPrompt(includeAudioCitations: boolean) {
  return [
    MARKDOWN_SYSTEM_PROMPT,
    includeAudioCitations ? AUDIO_CITATIONS_SYSTEM_PROMPT : "",
  ].filter(Boolean).join("\n\n");
}

export function extractPromptVariables(template: string) {
  return Array.from(new Set(Array.from(template.matchAll(VARIABLE_RE), (match) => match[1])));
}

export function normalizeAvailableVariables(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)));
}

export function validatePromptTemplate(template: string, availableVariables = getPromptVariableNames()) {
  const usedVariables = extractPromptVariables(template);
  const allowed = new Set(availableVariables);
  const unknown = usedVariables.filter((variable) => !allowed.has(variable));

  if (unknown.length > 0) {
    return { ok: false as const, error: `Variaveis indisponiveis neste prompt: ${unknown.join(", ")}` };
  }

  return { ok: true as const };
}

export function renderPromptTemplate(
  template: string,
  values: PromptVariableValues,
  availableVariables = getPromptVariableNames(),
) {
  const validation = validatePromptTemplate(template, availableVariables);
  if (!validation.ok) throw new Error(validation.error);

  return template.replace(VARIABLE_RE, (_full, key: string) => {
    if (!availableVariables.includes(key)) {
      throw new Error(`Variavel indisponivel neste prompt: ${key}`);
    }

    const value = values[key];
    if (value === undefined || value === null) {
      throw new Error(`Valor nao fornecido para a variavel: ${key}`);
    }

    return value;
  });
}

export async function ensurePromptSchema() {
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

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'prompts' AND column_name = 'content'
      ) THEN
        UPDATE "prompts" SET "system_prompt" = "content" WHERE "system_prompt" IS NULL;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'prompts' AND column_name = 'template'
      ) THEN
        UPDATE "prompts" SET "user_template" = "template" WHERE "user_template" IS NULL;
      END IF;
    END $$;
  `);

  await prisma.$executeRawUnsafe(
    `UPDATE "prompts" SET "user_template" = $1 WHERE "user_template" IS NULL OR btrim("user_template") = ''`,
    DEFAULT_USER_TEMPLATE,
  );

  await prisma.$executeRawUnsafe(`
    UPDATE "prompts"
    SET "system_prompt" = ''
    WHERE "system_prompt" IS NULL;
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "prompts"
    SET "available_variables" = '["transcricao", "contexto_sessao", "sessionTitle", "promptName", "createdAt"]'::jsonb
    WHERE "available_variables" = '[]'::jsonb;
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "prompts"
      ALTER COLUMN "system_prompt" SET NOT NULL,
      ALTER COLUMN "user_template" SET NOT NULL;
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "recording_sessions"
      ADD COLUMN IF NOT EXISTS "sessionContext" TEXT,
      ADD COLUMN IF NOT EXISTS "writingStyle" TEXT,
      ADD COLUMN IF NOT EXISTS "userInstructions" TEXT;
  `);
}

export async function ensureDefaultPrompts() {
  await ensurePromptSchema();

  await prisma.$transaction(async (tx) => {
    for (const prompt of DEFAULT_PROMPTS) {
      await tx.prompt.upsert({
        where: { name: prompt.name },
        create: {
          name: prompt.name,
          systemPrompt: "",
          userTemplate: prompt.userTemplate,
          availableVariables: getPromptVariableNames(),
          includeAudioCitations: true,
          isDefault: prompt.isDefault,
          isPublic: true,
        },
        update: {
          availableVariables: getPromptVariableNames(),
          includeAudioCitations: true,
          isPublic: true,
        },
      });
    }

    const defaultPrompt = await tx.prompt.findFirst({ where: { isDefault: true } });
    if (!defaultPrompt) {
      await tx.prompt.update({ where: { name: "Reuniao" }, data: { isDefault: true } });
    }
  });
}

export function promptNameToTranscriptionMode(name?: string | null) {
  return name?.toLowerCase().includes("aula") ? "CLASS" : "MEETING";
}
