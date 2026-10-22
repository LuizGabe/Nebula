import { z } from 'zod';
import type { LLMAdapter } from '@/lib/llm';
import { buildInsightsMessages } from '@/lib/prompts';

export const insightsSchema = z.object({
  summary: z.array(z.string().min(1).max(2000)).max(10000),
  actionItems: z.array(z.object({
    text: z.string().min(1).max(2000), owner: z.string().max(200).nullable(),
    dueDate: z.string().max(200).nullable(), transcriptReferenceId: z.string().min(1),
  }).strict()).max(10000),
  tags: z.array(z.string().min(1).max(100)).max(2000),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed', 'unknown']),
}).strict();
export type Insights = z.infer<typeof insightsSchema>;
type Block = { id: string; text: string; timestampStart: number };
export function validateInsights(raw: string, blocks: Block[]) {
  const result = insightsSchema.parse(JSON.parse(raw.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '')));
  const ids = new Set(blocks.map(b => b.id));
  if (result.actionItems.some(a => !ids.has(a.transcriptReferenceId))) throw new Error('Insight com referência inexistente');
  return result;
}
export async function generateInsights(adapter: LLMAdapter, blocks: Block[]): Promise<Insights> {
  // Bound each request independently; no silent truncation of long recordings.
  const batches: Block[][] = [];
  let current: Block[] = []; let size = 0;
  for (const block of blocks) {
    for (let offset = 0; offset < block.text.length; offset += 12000) {
      const part = { ...block, text: block.text.slice(offset, offset + 12000) };
      if (current.length && size + part.text.length > 16000) { batches.push(current); current = []; size = 0 }
      current.push(part); size += part.text.length;
    }
  }
  if (current.length) batches.push(current);
  const results: Insights[] = [];
  for (const batch of batches) {
    const raw = await adapter.complete(buildInsightsMessages(batch), { temperature: 0, maxTokens: 5000 });
    results.push(validateInsights(raw, batch));
  }
  const sentiments = [...new Set(results.map(r => r.sentiment))];
  return {
    summary: results.flatMap(r => r.summary),
    actionItems: results.flatMap(r => r.actionItems),
    tags: [...new Set(results.flatMap(r => r.tags))],
    sentiment: sentiments.length === 1 ? sentiments[0] : sentiments.length ? 'mixed' : 'unknown',
  };
}
