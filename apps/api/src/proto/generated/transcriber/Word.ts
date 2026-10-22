// Original file: src/proto/transcriber.proto

import type { Long } from '@grpc/proto-loader';

export interface Word {
  'text'?: (string);
  'start_ms'?: (number | string | Long);
  'end_ms'?: (number | string | Long);
  'confidence'?: (number | string);
  'speaker_id'?: (string);
}

export interface Word__Output {
  'text': (string);
  'start_ms': (string);
  'end_ms': (string);
  'confidence': (number);
  'speaker_id': (string);
}
