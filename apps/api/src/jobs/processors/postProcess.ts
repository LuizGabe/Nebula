import { Job } from "bullmq";

import { prisma } from "@/lib/prisma";
import { createAdapter, DEFAULT_MODEL } from "@/lib/llm";
import type { PostProcessJobData } from "../queues";
import type { UserConfig } from "@/config";
import { buildSystemPrompt, ensurePromptSchema, renderPromptTemplate } from "@/lib/prompts";
import { formatAudioTag } from "@/lib/audioTimestamps";

import { createEventPublisher } from "@/events/publisher";
import * as payloads from "@/events/payloads";

export async function postProcessHandler(job: Job<PostProcessJobData>) {
  const { sessionId, triggeredBy } = job.data;
  const validTriggers = new Set(["session_end", "user_reprocess", "batch_transcription_done"]);

  const log = (msg: string) => {
    const line = `[post-process] ${msg}`;
    console.log(line);
    job.log(line);
  };

  if (!validTriggers.has(triggeredBy)) {
    console.warn(`[post-process] Ignorando job com trigger desconhecido: ${triggeredBy}`);
    return { skipped: true, reason: "invalid_trigger" };
  }

  const publisher = createEventPublisher();

  log(`inicio | sessao=${sessionId} trigger=${triggeredBy}`);

  await ensurePromptSchema();

  const session = await prisma.recordingSession.findUnique({
    where: { id: sessionId },
    include: { owner: { select: { config: true } }, prompt: true },
  });

  if (!session) throw new Error(`Sessao ${sessionId} nao encontrada`);

  const blocks = await prisma.transcript.findMany({
    where: { sessionId },
    orderBy: { chunkIndex: "asc" },
  });

  if (blocks.length === 0) {
    log("abortado - nenhum TranscriptBlock encontrado");
    await publisher.emit(sessionId, "DOCUMENT_SKIPPED", payloads.documentSkipped("no_transcripts"));
    return { skipped: true, reason: "no_transcripts" };
  }

  if (triggeredBy === "batch_transcription_done" && session.status !== "ENDED") {
    await prisma.recordingSession.update({
      where: { id: sessionId },
      data: {
        status: "ENDED",
        endedAt: session.endedAt ?? new Date(),
      },
    });

    await prisma.audioMedia.updateMany({
      where: { sessionId, source: "UPLOAD", status: "PROCESSING" },
      data: { status: "TRANSCRIBED" },
    });
  }

  log(`${blocks.length} bloco(s) carregados`);
  await job.updateProgress(10);

  const latest = await prisma.document.findFirst({
    where: { sessionId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  if (triggeredBy === "session_end" && latest) {
    log(`pulado - documento v${latest.version} ja existe`);
    await publisher.emit(sessionId, "DOCUMENT_SKIPPED", payloads.documentSkipped("already_exists"));
    return { skipped: true, reason: "already_exists" };
  }

  const nextVersion = triggeredBy === "user_reprocess"
    ? (latest?.version ?? 0) + 1
    : 1;

  const context = blocks
    .map((b) => {
      return `${formatAudioTag(b.timestampStart)} ${b.text}`;
    })
    .join("\n\n");

  const prompt = session.prompt;
  if (!prompt) {
    const reason = "Sessao sem prompt associado para gerar o documento";
    await publisher.emit(sessionId, "DOCUMENT_FAILED", payloads.documentFailed(reason, nextVersion));
    throw new Error(reason);
  }

  const userTemplate = prompt.userTemplate?.trim() ?? "";
  if (!userTemplate) {
    const reason = `Prompt ${prompt.name} esta incompleto: userTemplate e obrigatorio`;
    await publisher.emit(sessionId, "DOCUMENT_FAILED", payloads.documentFailed(reason, nextVersion));
    throw new Error(reason);
  }

  let userPrompt = "";
  try {
    userPrompt = renderPromptTemplate(userTemplate, {
      transcricao: context,
      contexto_sessao: session.sessionContext ?? "",
      sessionTitle: session.title ?? "",
      promptName: prompt.name,
      createdAt: session.createdAt.toISOString(),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await publisher.emit(sessionId, "DOCUMENT_FAILED", payloads.documentFailed(reason, nextVersion));
    throw err;
  }

  await job.updateProgress(20);

  const userConfig = (session.owner.config ?? {}) as UserConfig;
  const modelId = userConfig.defaultModel ?? DEFAULT_MODEL;
  const systemPrompt = buildSystemPrompt(prompt.includeAudioCitations);

  log(`usando modelo=${modelId} | prompt=${prompt.name} | contexto=${context.length} chars`);

  log(`gerando documento v${nextVersion}...`);
  await job.updateProgress(30);
  await publisher.emit(sessionId, "DOCUMENT_GENERATING", payloads.documentGenerating(triggeredBy, nextVersion));

  const adapter = createAdapter(modelId);
  let content = "";
  let tokenCount = 0;
  const timeInitial = Date.now();

  try {
    for await (const token of adapter.stream(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3 },
    )) {
      content += token;
      tokenCount++;

      if (tokenCount % 50 === 0) {
        await job.updateProgress(Math.min(30 + Math.floor(tokenCount / 10), 79));
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log(`erro no LLM: ${reason}`);
    await publisher.emit(sessionId, "DOCUMENT_FAILED", payloads.documentFailed(reason, nextVersion));

    if (reason.includes("Request too large")) {
      await publisher.emit(sessionId, "DOCUMENT_SKIPPED", payloads.documentSkipped("too_large"));
      return { skipped: true, reason: "too_large" };
    }

    throw err;
  }

  const timeSec = ((Date.now() - timeInitial) / 1000).toFixed(1);

  log(`stream concluido | ~${tokenCount} tokens | ${content.length} chars | tempo: ${timeSec}s`);
  await job.updateProgress(80);

  await prisma.document.create({
    data: {
      sessionId,
      type: prompt.name,
      promptId: prompt.id,
      content,
      version: nextVersion,
      modelUsed: modelId,
    },
  });

  await job.updateProgress(100);
  log(`documento v${nextVersion} salvo com sucesso`);

  await publisher.emit(
    sessionId,
    "DOCUMENT_READY",
    payloads.documentReady(nextVersion, content.length, tokenCount, modelId),
  );

  return { version: nextVersion, chars: content.length, tokens: tokenCount, modelId };
}
