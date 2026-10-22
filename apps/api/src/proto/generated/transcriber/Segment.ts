// Original file: src/proto/transcriber.proto

import type { Word as _transcriber_Word, Word__Output as _transcriber_Word__Output } from '../transcriber/Word';
import type { Long } from '@grpc/proto-loader';

export interface Segment {
  'text'?: (string);
  'start_ms'?: (number | string | Long);
  'end_ms'?: (number | string | Long);
  'words'?: (_transcriber_Word)[];
  'speaker_id'?: (string);
}

export interface Segment__Output {
  'text': (string);
  'start_ms': (string);
  'end_ms': (string);
  'words': (_transcriber_Word__Output)[];
  'speaker_id': (string);
}
