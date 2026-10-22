// Original file: src/proto/transcriber.proto

import type { Segment as _transcriber_Segment, Segment__Output as _transcriber_Segment__Output } from '../transcriber/Segment';
import type { ResultType as _transcriber_ResultType, ResultType__Output as _transcriber_ResultType__Output } from '../transcriber/ResultType';

export interface TranscriptResult {
  'session_id'?: (string);
  'text'?: (string);
  'segments'?: (_transcriber_Segment)[];
  'inference_ms'?: (number);
  'is_final'?: (boolean);
  'result_type'?: (_transcriber_ResultType);
}

export interface TranscriptResult__Output {
  'session_id': (string);
  'text': (string);
  'segments': (_transcriber_Segment__Output)[];
  'inference_ms': (number);
  'is_final': (boolean);
  'result_type': (_transcriber_ResultType__Output);
}
