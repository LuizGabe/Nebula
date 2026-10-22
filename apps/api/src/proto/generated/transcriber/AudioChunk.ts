// Original file: src/proto/transcriber.proto

import type { SessionMeta as _transcriber_SessionMeta, SessionMeta__Output as _transcriber_SessionMeta__Output } from '../transcriber/SessionMeta';
import type { Long } from '@grpc/proto-loader';

export interface AudioChunk {
  'session_id'?: (string);
  'pcm_data'?: (Buffer | Uint8Array | string);
  'timestamp_ms'?: (number | string | Long);
  'meta'?: (_transcriber_SessionMeta | null);
  'end_of_stream'?: (boolean);
}

export interface AudioChunk__Output {
  'session_id': (string);
  'pcm_data': (Buffer);
  'timestamp_ms': (string);
  'meta': (_transcriber_SessionMeta__Output | null);
  'end_of_stream': (boolean);
}
