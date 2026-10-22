// Original file: src/proto/transcriber.proto


export interface BatchRequest {
  'session_id'?: (string);
  'storage_key'?: (string);
  'filename'?: (string);
  'mode'?: (string);
}

export interface BatchRequest__Output {
  'session_id': (string);
  'storage_key': (string);
  'filename': (string);
  'mode': (string);
}
