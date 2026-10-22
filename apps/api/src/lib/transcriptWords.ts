import { z } from 'zod';
export const wordSchema = z.object({
  text: z.string(), start_ms: z.number().int().nonnegative(), end_ms: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1).nullable().optional(), speaker_id: z.string().optional(),
}).refine(w => w.end_ms >= w.start_ms);
export const wordsSchema = z.array(wordSchema).max(100_000);
export type TranscriptWord = z.infer<typeof wordSchema>;
export function parseWords(value: unknown): TranscriptWord[] {
  const result = wordsSchema.safeParse(value);
  return result.success ? result.data : [];
}
