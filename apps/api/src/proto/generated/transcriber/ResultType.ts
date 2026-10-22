// Original file: src/proto/transcriber.proto

export const ResultType = {
  RESULT_TYPE_UNSPECIFIED: 'RESULT_TYPE_UNSPECIFIED',
  PARTIAL: 'PARTIAL',
  FINAL: 'FINAL',
} as const;

export type ResultType =
  | 'RESULT_TYPE_UNSPECIFIED'
  | 0
  | 'PARTIAL'
  | 1
  | 'FINAL'
  | 2

export type ResultType__Output = typeof ResultType[keyof typeof ResultType]
