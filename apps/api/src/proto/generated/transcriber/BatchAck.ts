// Original file: src/proto/transcriber.proto


export interface BatchAck {
  'job_id'?: (string);
  'session_id'?: (string);
  'queue_position'?: (number);
}

export interface BatchAck__Output {
  'job_id': (string);
  'session_id': (string);
  'queue_position': (number);
}
