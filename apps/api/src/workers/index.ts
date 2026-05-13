import { Worker } from "bullmq";
import { postProcessHandler } from "../jobs/processors/postProcess";
import { redisConnection } from "@/lib/redis";

export function startWorkers() {
  const postProcessWorker = new Worker(
    "post-processing",
    postProcessHandler,
    {
      connection: redisConnection,
      concurrency: 2,      // processa até 2 sessões ao mesmo tempo
      limiter: {
        max:      5,
        duration: 60_000,  // max 5 jobs por minuto (respeita rate limit do LLM)
      },
    }
  );

  postProcessWorker.on("completed", (job, result) => {
    if (result?.skipped) {
      console.log(`[bullmq] job ${job.id} pulado: ${result.reason}`);
    } else {
      console.log(`[bullmq] job ${job.id} concluído: documento v${result?.version}`);
    }
  });

  postProcessWorker.on("failed", (job, err) => {
    console.error(`[bullmq] job ${job?.id} falhou (tentativa ${job?.attemptsMade}):`, err.message);
  });

  postProcessWorker.on("progress", (job, progress) => {
    console.log(`[bullmq] job ${job.id} progresso: ${progress}%`);
  });

  return { postProcessWorker };
}