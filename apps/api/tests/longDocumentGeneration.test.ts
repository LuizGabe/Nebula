import assert from 'node:assert/strict';
import { generateDocument, splitTranscript } from '../src/lib/documentGeneration';
import type { LLMAdapter, LLMMessage } from '../src/lib/llm';

const template = { name: 'Resumo', instructions: 'Preserve os fatos relevantes e exemplos.' };
const calls: LLMMessage[][] = [];
const adapter: LLMAdapter = {
  modelId: 'groq/openai/gpt-oss-20b',
  async complete(messages) {
    calls.push(messages);
    const reference = messages[1].content.match(/\[audio:[^\]]+\]/)?.[0] ?? '';
    return reference + ' ' + (messages[1].content.match(/FATO_\d+/g) ?? []).join(' ');
  },
  async *stream(messages) { calls.push(messages); yield '# Documento\n'; yield messages[1].content; },
  async isAvailable() { return true; },
};

const transcript = Array.from({ length: 420 }, (_, i) => `[audio:00:${String(i % 60).padStart(2, '0')}] FATO_${i} ${'Informacao relevante sobre o conteudo. '.repeat(3)}`).join('\n');
const result = await generateDocument({ adapter, template, session: {}, transcript, maxRequestBytes: 8000 });
assert.ok(calls.length > 2, 'Long transcripts must be reduced before the final request');
for (const messages of calls) {
  assert.ok(messages.reduce((total, message) => total + Buffer.byteLength(message.content, 'utf8'), 0) <= 8000);
}
for (let i = 0; i < 420; i++) assert.ok(result.includes(`FATO_${i}`), `Fact ${i} was dropped`);

calls.length = 0;
await generateDocument({ adapter, template, session: {}, transcript: '[audio:00:00] Um fato curto.' });
assert.equal(calls.length, 1, 'Short transcripts should be sent directly');

const chunks = splitTranscript('[audio:00:00] ' + 'ação importante '.repeat(100), 256);
assert.ok(chunks.length > 1);
assert.ok(chunks.every(chunk => Buffer.byteLength(chunk, 'utf8') <= 256));
assert.ok(chunks.every(chunk => chunk.startsWith('[audio:00:00]')));
assert.equal(chunks.reduce((sum, chunk) => sum + (chunk.match(/ação/g) ?? []).length, 0), 100);

await assert.rejects(generateDocument({
  adapter: { ...adapter, complete: async () => '' }, template, session: {}, transcript,
}), /notas vazias/);
await assert.rejects(generateDocument({
  adapter: { ...adapter, async *stream() {} }, template, session: {}, transcript: 'Fato',
}), /documento vazio/);
await assert.rejects(generateDocument({ adapter, template, session: { sessionContext: 'x'.repeat(15000) }, transcript }), /contexto/);

let attempts = 0;
const citationResult = await generateDocument({
  adapter: { ...adapter, async *stream() { yield ++attempts === 1 ? 'Documento sem referencias' : 'Fato [audio:00:00]'; } },
  template, session: {}, transcript: '[audio:00:00] Fato.',
});
assert.equal(attempts, 2);
assert.match(citationResult, /\[audio:00:00\]/);
await assert.rejects(generateDocument({
  adapter: { ...adapter, async *stream() { yield 'Fato [audio:99:99]'; } },
  template, session: {}, transcript: '[audio:00:00] Fato.',
}), /referencias validas/);
console.log('Long document generation tests passed');
