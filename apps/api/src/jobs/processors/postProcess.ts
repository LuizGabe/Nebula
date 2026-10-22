import { Job } from "bullmq";

import { prisma } from "@/lib/prisma";
import { createAdapter, DEFAULT_MODEL } from "@/lib/llm";
import type { PostProcessJobData } from "../queues";
import { postProcessQueue } from '../queues';
import type { UserConfig } from "@/config";
import { canUseTemplate, ensureDocumentTemplateSchema } from "@/lib/prompts";
import { generateDocument } from "@/lib/documentGeneration";
import { formatAudioTag } from "@/lib/audioTimestamps";
import { generateInsights } from '@/lib/insights';

import { createEventPublisher } from "@/events/publisher";
import * as payloads from "@/events/payloads";

export async function postProcessHandler(job: Job<PostProcessJobData>) {
  const { sessionId, triggeredBy } = job.data;
  const validTriggers = new Set(["session_end", "user_reprocess", "batch_transcription_done", "insights_only"]);

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

  await ensureDocumentTemplateSchema();

  const session = await prisma.recordingSession.findUnique({
    where: { id: sessionId },
    include: { owner: { select: { config: true } }, prompt: true },
  });

  if (!session || session.isDeleted) return { skipped: true, reason: 'session_deleted' };

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
  if (triggeredBy === 'insights_only') {
    const userConfig = (session.owner.config ?? {}) as UserConfig;
    const insights = await generateInsights(createAdapter(userConfig.defaultModel ?? DEFAULT_MODEL), blocks);
    await prisma.$transaction(async tx => {
      const current = await tx.transcript.findMany({ where: { sessionId }, select: { id: true, revision: true } });
      if (current.length !== blocks.length || current.some(b => blocks.find(old => old.id === b.id)?.revision !== b.revision)) throw new Error('A transcrição mudou durante a geração. Gere os insights novamente.');
      await tx.recordingSession.updateMany({ where: { id: sessionId, isDeleted: false }, data: { insights } });
    }, { isolationLevel: 'Serializable' });
    return { insights: true };
  }
  await job.updateProgress(10);

  const latest = await prisma.document.findFirst({
    where: { sessionId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  if (triggeredBy !== "user_reprocess" && latest) {
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
  if (!prompt || !canUseTemplate(prompt, session.ownerId)) {
    const reason = "Template indisponível. Selecione outro template para futuras gerações.";
    await publisher.emit(sessionId, "DOCUMENT_FAILED", payloads.documentFailed(reason, nextVersion));
    throw new Error(reason);
  }

  const instructions = prompt.instructions?.trim() ?? "";
  if (!instructions) {
    const reason = `Template ${prompt.name} esta incompleto: instructions e obrigatorio`;
    await publisher.emit(sessionId, "DOCUMENT_FAILED", payloads.documentFailed(reason, nextVersion));
    throw new Error(reason);
  }

  await job.updateProgress(20);

  const userConfig = (session.owner.config ?? {}) as UserConfig;
  const modelId = userConfig.defaultModel ?? DEFAULT_MODEL;

  log(`usando modelo=${modelId} | template=${prompt.name} | contexto=${context.length} chars`);

  log(`gerando documento v${nextVersion}...`);
  await job.updateProgress(30);
  await publisher.emit(sessionId, "DOCUMENT_GENERATING", payloads.documentGenerating(triggeredBy, nextVersion));

  const adapter = createAdapter(modelId);
  let content = "";
  const timeInitial = Date.now();

  try {
    content = await generateDocument({
      adapter, template: prompt, session, transcript: context,
      onProgress: async (message) => {
        log(message);
        await publisher.emit(sessionId, 'DOCUMENT_GENERATING', { ...payloads.documentGenerating(triggeredBy, nextVersion), message });
      },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log(`erro no LLM: ${reason}`);
    await publisher.emit(sessionId, "DOCUMENT_FAILED", payloads.documentFailed(reason, nextVersion));

    throw err;
  }

  const timeSec = ((Date.now() - timeInitial) / 1000).toFixed(1);

  log(`documento concluido | ${content.length} chars | tempo: ${timeSec}s`);
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
  if (!session.insights) {
    await postProcessQueue.add('generate-insights', { sessionId, triggeredBy: 'insights_only' }, { jobId: `insights-${sessionId}` });
  }
  log(`documento v${nextVersion} salvo com sucesso`);

  await publisher.emit(
    sessionId,
    "DOCUMENT_READY",
    payloads.documentReady(nextVersion, content.length, Math.ceil(content.length / 4), modelId),
  );

  return { version: nextVersion, chars: content.length, modelId };
}
