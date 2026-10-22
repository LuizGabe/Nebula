import { HeadBucketCommand } from "@aws-sdk/client-s3";

import { config } from "@/config";
import { AVAILABLE_MODELS, createAdapter } from "@/lib/llm";
import { prisma } from "@/lib/prisma";
import { redisConnection } from "@/lib/redis";
import { BUCKET, s3Internal } from "@/lib/storage";
import { postProcessQueue, transcriptionJobsQueue } from "@/jobs/queues";
import { createTranscriberClient } from "@/lib/grpc-client";
import { systemCircuitBreakers, type CircuitBreakerSnapshot } from "./circuitBreaker";

export type ServiceHealthStatus = "healthy" | "degraded" | "down" | "inactive";
export type OverallHealthStatus = "healthy" | "degraded" | "down";

export type QueueHealth = {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
};

export type ServiceHealth = {
  id: string;
  label: string;
  status: ServiceHealthStatus;
  latencyMs: number;
  checkedAt: string;
  message: string;
  breaker: CircuitBreakerSnapshot;
  details?: Record<string, unknown>;
};

export type SystemStatus = {
  status: OverallHealthStatus;
  checkedAt: string;
  uptimeSec: number;
  services: ServiceHealth[];
  connections: Array<{ from: string; to: string; label: string }>;
};

type CheckResult = {
  status: ServiceHealthStatus;
  message: string;
  details?: Record<string, unknown>;
};

const CHECK_TIMEOUT_MS = 2_500;

const serviceLabels: Record<string, string> = {
  api: "API",
  postgres: "PostgreSQL",
  redis: "Redis",
  minio: "MinIO",
  bullmq: "BullMQ",
  groq_worker: "Groq worker",
  parakeet_worker: "faster-whisper worker",
  llm: "LLM",
};

export async function getReadinessStatus() {
  const checkedAt = new Date().toISOString();
  const checks = await Promise.all([
    runLightCheck("postgres", checkPostgres),
    runLightCheck("redis", checkRedis),
    runLightCheck("minio", checkMinio),
  ]);

  const healthy = checks.every((check) => check.status === "healthy");
  return {
    status: healthy ? "healthy" : "degraded",
    checkedAt,
    uptimeSec: Math.round(process.uptime()),
    services: checks,
  };
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const checkedAt = new Date().toISOString();
  const services = await Promise.all([
    checkService("api", checkApi),
    checkService("postgres", checkPostgres),
    checkService("redis", checkRedis),
    checkService("minio", checkMinio),
    checkService("bullmq", checkBullmq),
    checkService("groq_worker", checkGroqWorker),
    checkService("parakeet_worker", checkParakeetWorker),
    checkService("llm", checkLlm),
  ]);

  return {
    status: summarize(services),
    checkedAt,
    uptimeSec: Math.round(process.uptime()),
    services,
    connections: [
      { from: "web", to: "api", label: "HTTP + SSE" },
      { from: "api", to: "postgres", label: "Prisma" },
      { from: "api", to: "redis", label: "Redis pub/sub" },
      { from: "api", to: "minio", label: "S3" },
      { from: "api", to: "bullmq", label: "Filas" },
      { from: "bullmq", to: "groq_worker", label: "transcription-jobs" },
      { from: "api", to: "parakeet_worker", label: "gRPC stream" },
      { from: "api", to: "llm", label: "documentos e perguntas" },
    ],
  };
}

async function checkService(id: string, check: () => Promise<CheckResult>): Promise<ServiceHealth> {
  systemCircuitBreakers.beforeCheck(id);
  const startedAt = Date.now();

  try {
    const result = await withTimeout(check(), CHECK_TIMEOUT_MS, `${serviceLabels[id]} timeout`);
    return {
      id,
      label: serviceLabels[id],
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      ...result,
      breaker: result.status === "healthy" || result.status === "inactive"
        ? systemCircuitBreakers.recordSuccess(id)
        : systemCircuitBreakers.recordFailure(id),
    };
  } catch (error) {
    return {
      id,
      label: serviceLabels[id],
      status: "down",
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      message: normalizeError(error),
      breaker: systemCircuitBreakers.recordFailure(id),
    };
  }
}

async function runLightCheck(id: string, check: () => Promise<CheckResult>) {
  const startedAt = Date.now();
  try {
    const result = await withTimeout(check(), 1_000, `${serviceLabels[id]} timeout`);
    return {
      id,
      label: serviceLabels[id],
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      ...result,
    };
  } catch (error) {
    return {
      id,
      label: serviceLabels[id],
      status: "down" as const,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      message: normalizeError(error),
    };
  }
}

async function checkApi(): Promise<CheckResult> {
  return {
    status: "healthy",
    message: "API respondendo",
    details: {
      nodeEnv: config.NODE_ENV,
      uptimeSec: Math.round(process.uptime()),
    },
  };
}

async function checkPostgres(): Promise<CheckResult> {
  await prisma.$queryRaw`SELECT 1`;
  return { status: "healthy", message: "Conexao com banco ativa" };
}

async function checkRedis(): Promise<CheckResult> {
  const pong = await redisConnection.ping();
  return { status: pong === "PONG" ? "healthy" : "degraded", message: `Redis respondeu ${pong}` };
}

async function checkMinio(): Promise<CheckResult> {
  await s3Internal.send(new HeadBucketCommand({ Bucket: BUCKET }));
  return { status: "healthy", message: `Bucket ${BUCKET} acessivel` };
}

async function checkBullmq(): Promise<CheckResult> {
  const [postProcessing, transcriptionJobs] = await Promise.all([
    getQueueHealth(postProcessQueue),
    getQueueHealth(transcriptionJobsQueue),
  ]);
  const failed = postProcessing.failed + transcriptionJobs.failed;

  return {
    status: failed > 0 ? "degraded" : "healthy",
    message: failed > 0 ? `${failed} jobs falharam recentemente` : "Filas acessiveis",
    details: {
      queues: {
        "post-processing": postProcessing,
        "transcription-jobs": transcriptionJobs,
      },
    },
  };
}

async function checkGroqWorker(): Promise<CheckResult> {
  const url = process.env.GROQ_WORKER_HEALTH_URL ?? "http://groq_worker:9091/metrics";
  const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
  if (!response.ok) {
    return { status: "down", message: `HTTP ${response.status} em ${url}` };
  }

  return { status: "healthy", message: "Metricas do Groq worker acessiveis", details: { url } };
}

async function checkParakeetWorker(): Promise<CheckResult> {
  if (config.GRPC_WORKER_HOST.includes("host.docker.internal")) {
    return {
      status: "inactive",
      message: "Worker faster-whisper externo/profile opcional",
      details: { host: config.GRPC_WORKER_HOST },
    };
  }

  const status = await getParakeetStatus();
  return {
    status: status.model_ready ? "healthy" : "degraded",
    message: status.model_ready ? "Worker gRPC pronto" : "Worker gRPC sem modelo pronto",
    details: status,
  };
}

async function checkLlm(): Promise<CheckResult> {
  const results = await Promise.allSettled(
    AVAILABLE_MODELS.map(async (model) => ({
      id: model.id,
      provider: model.provider,
      available: await createAdapter(model.id).isAvailable(),
    })),
  );

  const models = results.map((result, index) => (
    result.status === "fulfilled"
      ? result.value
      : { id: AVAILABLE_MODELS[index].id, provider: AVAILABLE_MODELS[index].provider, available: false }
  ));
  const available = models.filter((model) => model.available).length;

  return {
    status: available > 0 ? "healthy" : "down",
    message: `${available}/${models.length} modelos disponiveis`,
    details: { models },
  };
}

async function getQueueHealth(queue: typeof postProcessQueue): Promise<QueueHealth> {
  const counts = await queue.getJobCounts("waiting", "active", "completed", "failed");
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
  };
}

function getParakeetStatus(): Promise<Record<string, unknown> & { model_ready?: boolean }> {
  return new Promise((resolve, reject) => {
    const client = createTranscriberClient();
    const deadline = new Date(Date.now() + 1_500);
    client.GetWorkerStatus({}, { deadline }, (error, response) => {
      if (typeof client.close === "function") client.close();
      if (error) {
        reject(error);
        return;
      }
      resolve({ ...response });
    });
  });
}

function summarize(services: ServiceHealth[]): OverallHealthStatus {
  const critical = new Set(["api", "postgres", "redis", "minio", "bullmq"]);
  if (services.some((service) => critical.has(service.id) && service.status === "down")) return "down";
  if (services.some((service) => service.status === "down" || service.status === "degraded")) return "degraded";
  return "healthy";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizeError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 180);
  return String(error).slice(0, 180);
}
