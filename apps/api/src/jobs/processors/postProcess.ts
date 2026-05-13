import { Job } from "bullmq";
import { readFileSync } from "fs";
import { resolve } from "path";

import { prisma } from "@/lib/prisma";
import { createAdapter, DEFAULT_MODEL } from "@/lib/llm";
import type { PostProcessJobData } from "../queues";
import { config, type UserConfig } from "@/config";


function loadPrompt(relative: string): string {
  try {
    return readFileSync(resolve(config.PROMPTS_DIR, relative), "utf-8");
  } catch {
    return "";
  }
}

// src/jobs/processors/postProcess.ts

export async function postProcessHandler(job: Job<PostProcessJobData>) {
  const { sessionId, triggeredBy } = job.data;

  // logger que escreve no console E salva no histórico do job no Redis
  const log = (msg: string) => {
    const line = `[post-process] ${msg}`;
    console.log(line);
    job.log(line);
  };

  log(`início | sessão=${sessionId} trigger=${triggeredBy}`);

  const session = await prisma.recordingSession.findUnique({
    where:   { id: sessionId },
    include: { owner: { select: { config: true } } },
  });

  if (!session) throw new Error(`Sessão ${sessionId} não encontrada`);

  const blocks = await prisma.transcriptBlock.findMany({
    where:   { sessionId },
    orderBy: { blockIndex: "asc" },
  });

  if (blocks.length === 0) {
    log("abortado — nenhum TranscriptBlock encontrado");
    return { skipped: true, reason: "no_transcripts" };
  }

  log(`${blocks.length} bloco(s) carregados`);
  await job.updateProgress(10);

  const context = blocks
    .map((b) => {
      const mins  = Math.floor(b.timestampStart / 60);
      const secs  = Math.floor(b.timestampStart % 60);
      const stamp = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
      return `[${stamp}] ${b.rawText}`;
    })
    .join("\n\n");

  const promptMode = session.mode === "MEETING" ? "meeting" : "class";
  const systemPrompt = loadPrompt(`document/${promptMode}_system.txt`) ||
    "Você é um assistente que gera atas e resumos detalhados. Responda em português brasileiro.";
  const userTemplate = loadPrompt("document/user.txt") ||
    "Gere um documento completo baseado na transcrição abaixo.\n\nTRANSCRIÇÃO:\n{{context}}";
  const userPrompt = userTemplate.replaceAll("{{context}}", context);

  await job.updateProgress(20);

  const userConfig = (session.owner.config ?? {}) as UserConfig;
  const modelId    = userConfig.defaultModel ?? DEFAULT_MODEL;

  log(`usando modelo=${modelId} | prompt=${promptMode} | contexto=${context.length} chars`);

  const latest = await prisma.document.findFirst({
    where:   { sessionId },
    orderBy: { version: "desc" },
    select:  { version: true },
  });

  if (triggeredBy === "session_end" && latest) {
    log(`pulado — documento v${latest.version} já existe`);
    return { skipped: true, reason: "already_exists" };
  }

  const nextVersion = triggeredBy === "user_reprocess"
    ? (latest?.version ?? 0) + 1
    : 1;

  log(`gerando documento v${nextVersion}…`);
  await job.updateProgress(30);

  const adapter = createAdapter(modelId);
  let content = "";
  let tokenCount = 0;
  const timeInitial = Date.now();

  try {
    for await (const token of adapter.stream(
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
      { temperature: 0.3 }
    )) {
      content += token;
      tokenCount++;

      // progresso proporcional entre 30% e 80% durante o stream
      if (tokenCount % 50 === 0) {
        await job.updateProgress(Math.min(30 + Math.floor(tokenCount / 10), 79));
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`erro no LLM: ${msg}`);
    throw err; // propaga para BullMQ tentar novamente (retry)
  }

  const timeFinal = Date.now();
  const timeSec   = ((timeFinal - timeInitial) / 1000).toFixed(1);

  log(`stream concluído | ~${tokenCount} tokens | ${content.length} chars | tempo: ${timeSec}s`);
  await job.updateProgress(80);

  await prisma.document.create({
    data: {
      sessionId,
      type:      session.mode === "MEETING" ? "MEETING_MINUTES" : "CLASS_NOTES",
      content,
      version:   nextVersion,
      modelUsed: modelId,
    },
  });

  await job.updateProgress(100);
  log(`documento v${nextVersion} salvo com sucesso`);

  return { version: nextVersion, chars: content.length, tokens: tokenCount, modelId };
}