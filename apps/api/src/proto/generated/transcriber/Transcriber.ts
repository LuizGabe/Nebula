// Original file: src/proto/transcriber.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { AudioChunk as _transcriber_AudioChunk, AudioChunk__Output as _transcriber_AudioChunk__Output } from '../transcriber/AudioChunk';
import type { BatchAck as _transcriber_BatchAck, BatchAck__Output as _transcriber_BatchAck__Output } from '../transcriber/BatchAck';
import type { BatchRequest as _transcriber_BatchRequest, BatchRequest__Output as _transcriber_BatchRequest__Output } from '../transcriber/BatchRequest';
import type { TranscriptResult as _transcriber_TranscriptResult, TranscriptResult__Output as _transcriber_TranscriptResult__Output } from '../transcriber/TranscriptResult';
import type { WorkerStatusRequest as _transcriber_WorkerStatusRequest, WorkerStatusRequest__Output as _transcriber_WorkerStatusRequest__Output } from '../transcriber/WorkerStatusRequest';
import type { WorkerStatusResponse as _transcriber_WorkerStatusResponse, WorkerStatusResponse__Output as _transcriber_WorkerStatusResponse__Output } from '../transcriber/WorkerStatusResponse';

export interface TranscriberClient extends grpc.Client {
  GetWorkerStatus(argument: _transcriber_WorkerStatusRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_transcriber_WorkerStatusResponse__Output>): grpc.ClientUnaryCall;
  GetWorkerStatus(argument: _transcriber_WorkerStatusRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_transcriber_WorkerStatusResponse__Output>): grpc.ClientUnaryCall;
  GetWorkerStatus(argument: _transcriber_WorkerStatusRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_transcriber_WorkerStatusResponse__Output>): grpc.ClientUnaryCall;
  GetWorkerStatus(argument: _transcriber_WorkerStatusRequest, callback: grpc.requestCallback<_transcriber_WorkerStatusResponse__Output>): grpc.ClientUnaryCall;
  getWorkerStatus(argument: _transcriber_WorkerStatusRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_transcriber_WorkerStatusResponse__Output>): grpc.ClientUnaryCall;
  getWorkerStatus(argument: _transcriber_WorkerStatusRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_transcriber_WorkerStatusResponse__Output>): grpc.ClientUnaryCall;
  getWorkerStatus(argument: _transcriber_WorkerStatusRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_transcriber_WorkerStatusResponse__Output>): grpc.ClientUnaryCall;
  getWorkerStatus(argument: _transcriber_WorkerStatusRequest, callback: grpc.requestCallback<_transcriber_WorkerStatusResponse__Output>): grpc.ClientUnaryCall;

  SubmitBatch(argument: _transcriber_BatchRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_transcriber_BatchAck__Output>): grpc.ClientUnaryCall;
  SubmitBatch(argument: _transcriber_BatchRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_transcriber_BatchAck__Output>): grpc.ClientUnaryCall;
  SubmitBatch(argument: _transcriber_BatchRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_transcriber_BatchAck__Output>): grpc.ClientUnaryCall;
  SubmitBatch(argument: _transcriber_BatchRequest, callback: grpc.requestCallback<_transcriber_BatchAck__Output>): grpc.ClientUnaryCall;
  submitBatch(argument: _transcriber_BatchRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_transcriber_BatchAck__Output>): grpc.ClientUnaryCall;
  submitBatch(argument: _transcriber_BatchRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_transcriber_BatchAck__Output>): grpc.ClientUnaryCall;
  submitBatch(argument: _transcriber_BatchRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_transcriber_BatchAck__Output>): grpc.ClientUnaryCall;
  submitBatch(argument: _transcriber_BatchRequest, callback: grpc.requestCallback<_transcriber_BatchAck__Output>): grpc.ClientUnaryCall;

  TranscribeStream(metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientDuplexStream<_transcriber_AudioChunk, _transcriber_TranscriptResult__Output>;
  TranscribeStream(options?: grpc.CallOptions): grpc.ClientDuplexStream<_transcriber_AudioChunk, _transcriber_TranscriptResult__Output>;
  transcribeStream(metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientDuplexStream<_transcriber_AudioChunk, _transcriber_TranscriptResult__Output>;
  transcribeStream(options?: grpc.CallOptions): grpc.ClientDuplexStream<_transcriber_AudioChunk, _transcriber_TranscriptResult__Output>;

}

export interface TranscriberHandlers extends grpc.UntypedServiceImplementation {
  GetWorkerStatus: grpc.handleUnaryCall<_transcriber_WorkerStatusRequest__Output, _transcriber_WorkerStatusResponse>;

  SubmitBatch: grpc.handleUnaryCall<_transcriber_BatchRequest__Output, _transcriber_BatchAck>;

  TranscribeStream: grpc.handleBidiStreamingCall<_transcriber_AudioChunk__Output, _transcriber_TranscriptResult>;

}

export interface TranscriberDefinition extends grpc.ServiceDefinition {
  GetWorkerStatus: MethodDefinition<_transcriber_WorkerStatusRequest, _transcriber_WorkerStatusResponse, _transcriber_WorkerStatusRequest__Output, _transcriber_WorkerStatusResponse__Output>
  SubmitBatch: MethodDefinition<_transcriber_BatchRequest, _transcriber_BatchAck, _transcriber_BatchRequest__Output, _transcriber_BatchAck__Output>
  TranscribeStream: MethodDefinition<_transcriber_AudioChunk, _transcriber_TranscriptResult, _transcriber_AudioChunk__Output, _transcriber_TranscriptResult__Output>
}
