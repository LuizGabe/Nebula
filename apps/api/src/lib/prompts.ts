import { prisma } from "@/lib/prisma";

export const DEFAULT_USER_PROMPT =
  [
    "Gere um documento completo baseado na transcricao abaixo.",
    "",
    "A transcricao contem marcas de tempo no formato [audio:MM:SS] ou [audio:HH:MM:SS].",
    "Preserve essa referencia temporal no documento gerado.",
    "Inclua uma tag [audio:MM:SS] ou [audio:HH:MM:SS] ao final de cada frase relevante, fato, decisao, topico ou item importante.",
    "Use somente tags de tempo que existam na transcricao.",
    "",
    "TRANSCRICAO:",
    "{{context}}",
  ].join("\n");

const DEFAULT_PROMPTS = [
  {
    name: "Reuniao",
    content:
      "Voce e um assistente que transforma transcricoes de reunioes em atas claras, objetivas e acionaveis. Responda em portugues brasileiro.",
    isDefault: true,
    isPublic: true,
  },
  {
    name: "Aula",
    content:
      "Voce e um assistente que transforma transcricoes de aulas em notas de estudo organizadas, didaticas e detalhadas. Responda em portugues brasileiro.",
    isDefault: false,
    isPublic: true,
  },
  {
    name: "Entrevista",
    content:
      "Voce e um assistente que transforma transcricoes de entrevistas em um documento estruturado com perguntas, respostas, principais temas, citacoes relevantes e pontos de acompanhamento. Responda em portugues brasileiro.",
    isDefault: false,
    isPublic: true,
  },
];

export async function ensureDefaultPrompts() {
  const count = await prisma.prompt.count();
  if (count > 0) return;

  await prisma.prompt.createMany({
    data: DEFAULT_PROMPTS,
    skipDuplicates: true,
  });
}

export async function getDefaultPrompt(ownerId?: string) {
  await ensureDefaultPrompts();

  return prisma.prompt.findFirst({
    where: ownerId
      ? { OR: [{ isPublic: true }, { ownerId }] }
      : { isPublic: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export function promptNameToTranscriptionMode(name?: string | null) {
  return name?.toLowerCase().includes("aula") ? "CLASS" : "MEETING";
}
