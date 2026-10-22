import { Queue, QueueEvents } from "bullmq";
import { redisConnection } from "@/lib/redis";

export const postProcessQueue = new Queue("post-processing", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 50  },
  },
});

export const postProcessEvents = new QueueEvents("post-processing", {
  connection: redisConnection
});

export type PostProcessJobData = {
  sessionId: string;
  triggeredBy: "session_end" | "user_reprocess" | "batch_transcription_done" | "insights_only";
};

export const transcriptionJobsQueue = new Queue("transcription-jobs", {
  connection: redisConnection,
});
