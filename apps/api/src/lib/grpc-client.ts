// src/lib/grpc-client.ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { config } from '@/config';
import type { ProtoGrpcType } from '@/proto/generated/transcriber';

const PROTO_PATH = path.resolve(process.cwd(), 'src/proto/transcriber.proto');

// Carrega o proto
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as unknown as ProtoGrpcType;

// O pacote é 'transcriber' e o serviço é 'Transcriber'
const transcriberPackage = protoDescriptor.transcriber;
if (!transcriberPackage) {
  throw new Error('Pacote "transcriber" não encontrado no proto');
}
const TranscriberService = transcriberPackage.Transcriber;
if (!TranscriberService) {
  throw new Error('Serviço "Transcriber" não encontrado no pacote transcriber');
}

export interface AudioChunk {
  session_id: string;
  timestamp_ms: number;
  pcm_data: Buffer;
  end_of_stream: boolean;
  meta?: { mode: string; language_hint: string };
}

export function createTranscriberClient() {
  return new TranscriberService(
    config.GRPC_WORKER_HOST,
    grpc.credentials.createInsecure(),
  );
}

// Função auxiliar para iniciar um stream bidirecional
export function startTranscriptionStream(
  client: any,
  onData: (data: any) => void,
  onEnd: () => void,
  onError: (err: Error) => void,
) {
  const call = client.TranscribeStream();
  call.on('data', onData);
  call.on('end', onEnd);
  call.on('error', onError);
  return call;
}
