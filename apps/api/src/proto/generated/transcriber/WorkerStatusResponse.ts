// Original file: src/proto/transcriber.proto

import type { Long } from '@grpc/proto-loader';

export interface WorkerStatusResponse {
  'model_ready'?: (boolean);
  'active_sessions'?: (number);
  'batch_queue_size'?: (number);
  'gpu_utilization'?: (number | string);
  'vram_used_bytes'?: (number | string | Long);
  'vram_total_bytes'?: (number | string | Long);
  'accepting_streams'?: (boolean);
  'engine'?: (string);
  'model'?: (string);
}

export interface WorkerStatusResponse__Output {
  'model_ready': (boolean);
  'active_sessions': (number);
  'batch_queue_size': (number);
  'gpu_utilization': (number);
  'vram_used_bytes': (string);
  'vram_total_bytes': (string);
  'accepting_streams': (boolean);
  'engine': (string);
  'model': (string);
}
