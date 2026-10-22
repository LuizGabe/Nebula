import type * as grpc from '@grpc/grpc-js';
import type { EnumTypeDefinition, MessageTypeDefinition } from '@grpc/proto-loader';

import type { AudioChunk as _transcriber_AudioChunk, AudioChunk__Output as _transcriber_AudioChunk__Output } from './transcriber/AudioChunk';
import type { BatchAck as _transcriber_BatchAck, BatchAck__Output as _transcriber_BatchAck__Output } from './transcriber/BatchAck';
import type { BatchRequest as _transcriber_BatchRequest, BatchRequest__Output as _transcriber_BatchRequest__Output } from './transcriber/BatchRequest';
import type { Segment as _transcriber_Segment, Segment__Output as _transcriber_Segment__Output } from './transcriber/Segment';
import type { SessionMeta as _transcriber_SessionMeta, SessionMeta__Output as _transcriber_SessionMeta__Output } from './transcriber/SessionMeta';
import type { TranscriberClient as _transcriber_TranscriberClient, TranscriberDefinition as _transcriber_TranscriberDefinition } from './transcriber/Transcriber';
import type { TranscriptResult as _transcriber_TranscriptResult, TranscriptResult__Output as _transcriber_TranscriptResult__Output } from './transcriber/TranscriptResult';
import type { Word as _transcriber_Word, Word__Output as _transcriber_Word__Output } from './transcriber/Word';
import type { WorkerStatusRequest as _transcriber_WorkerStatusRequest, WorkerStatusRequest__Output as _transcriber_WorkerStatusRequest__Output } from './transcriber/WorkerStatusRequest';
import type { WorkerStatusResponse as _transcriber_WorkerStatusResponse, WorkerStatusResponse__Output as _transcriber_WorkerStatusResponse__Output } from './transcriber/WorkerStatusResponse';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  transcriber: {
    AudioChunk: MessageTypeDefinition<_transcriber_AudioChunk, _transcriber_AudioChunk__Output>
    BatchAck: MessageTypeDefinition<_transcriber_BatchAck, _transcriber_BatchAck__Output>
    BatchRequest: MessageTypeDefinition<_transcriber_BatchRequest, _transcriber_BatchRequest__Output>
    ResultType: EnumTypeDefinition
    Segment: MessageTypeDefinition<_transcriber_Segment, _transcriber_Segment__Output>
    SessionMeta: MessageTypeDefinition<_transcriber_SessionMeta, _transcriber_SessionMeta__Output>
    Transcriber: SubtypeConstructor<typeof grpc.Client, _transcriber_TranscriberClient> & { service: _transcriber_TranscriberDefinition }
    TranscriptResult: MessageTypeDefinition<_transcriber_TranscriptResult, _transcriber_TranscriptResult__Output>
    Word: MessageTypeDefinition<_transcriber_Word, _transcriber_Word__Output>
    WorkerStatusRequest: MessageTypeDefinition<_transcriber_WorkerStatusRequest, _transcriber_WorkerStatusRequest__Output>
    WorkerStatusResponse: MessageTypeDefinition<_transcriber_WorkerStatusResponse, _transcriber_WorkerStatusResponse__Output>
  }
}
