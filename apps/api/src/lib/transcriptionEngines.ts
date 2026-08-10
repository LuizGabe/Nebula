import * as grpc from "@grpc/grpc-js";

import { config } from "@/config";
import { createTranscriberClient } from "@/lib/grpc-client";

export type StreamingTranscriptionEngine = {
  id: string;
  name: string;
  provider: "worker" | "browser";
  active: boolean;
  acceptingStreams: boolean;
  message: string;
};

export type SelectedTranscriptionEngine = {
  mode: "worker" | "web_speech";
  label: string;
  activeWorkers: StreamingTranscriptionEngine[];
  browserFallback: StreamingTranscriptionEngine;
};

export async function getStreamingTranscriptionEngine(): Promise<SelectedTranscriptionEngine> {
  const workers = await getStreamingWorkers();
  const activeWorkers = workers.filter((worker) => worker.acceptingStreams);
  const browserFallback: StreamingTranscriptionEngine = {
    id: "web-speech",
    name: "Google Speech-to-Text",
    provider: "browser",
    active: true,
    acceptingStreams: true,
    message: "Web Speech API do navegador",
  };

  if (activeWorkers.length > 0) {
    return {
      mode: "worker",
      label: activeWorkers.map((worker) => worker.name).join(", "),
      activeWorkers,
      browserFallback,
    };
  }

  return {
    mode: "web_speech",
    label: browserFallback.name,
    activeWorkers,
    browserFallback,
  };
}

async function getStreamingWorkers(): Promise<StreamingTranscriptionEngine[]> {
  const parakeet = await getParakeetWorkerEngine();
  return [parakeet];
}

async function getParakeetWorkerEngine(): Promise<StreamingTranscriptionEngine> {
  if (config.GRPC_WORKER_HOST.includes("host.docker.internal")) {
    return {
      id: "parakeet_worker",
      name: "Parakeet worker",
      provider: "worker",
      active: false,
      acceptingStreams: false,
      message: "Worker externo/profile opcional",
    };
  }

  try {
    const status = await getParakeetStatus();
    const modelReady = Boolean(status.model_ready);
    const acceptingStreams = status.accepting_streams !== false && modelReady;

    return {
      id: "parakeet_worker",
      name: "Parakeet worker",
      provider: "worker",
      active: modelReady,
      acceptingStreams,
      message: acceptingStreams ? "Streaming ativo" : "Worker sem streaming disponivel",
    };
  } catch (error) {
    return {
      id: "parakeet_worker",
      name: "Parakeet worker",
      provider: "worker",
      active: false,
      acceptingStreams: false,
      message: error instanceof Error ? error.message.slice(0, 160) : "Worker indisponivel",
    };
  }
}

function getParakeetStatus(): Promise<Record<string, unknown> & { model_ready?: boolean; accepting_streams?: boolean }> {
  return new Promise((resolve, reject) => {
    const client = createTranscriberClient();
    const deadline = new Date(Date.now() + 1_500);
    client.GetWorkerStatus({}, { deadline }, (error: grpc.ServiceError | null, response: Record<string, unknown>) => {
      if (typeof client.close === "function") client.close();
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}
