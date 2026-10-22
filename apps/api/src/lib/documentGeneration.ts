import type { LLMAdapter, LLMMessage } from '@/lib/llm';
import {
  buildDocumentGenerationMessages, buildDocumentFromNotesMessages, buildTranscriptReductionMessages,
  buildDocumentCitationRetryMessages,
  type DocumentTemplateLike, type DocumentGenerationSessionLike,
} from '@/lib/prompts';

function messageSize(messages: LLMMessage[]) {
  return messages.reduce((size, message) => size + Buffer.byteLength(message.content, 'utf8'), 0);
}

/** Split without dropping text; repeat an original audio reference on a split long line. */
export function splitTranscript(text: string, maxBytes: number): string[] {
  if (maxBytes < 128) throw new Error('As instrucoes e o contexto da sessao excedem o limite de entrada do modelo. Reduza esses campos.');
  const parts: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    let remainder = line;
    const citation = /^\[audio:[^\]]+\]/.exec(line)?.[0] ?? '';
    while (Buffer.byteLength(remainder, 'utf8') > maxBytes) {
      if (current) { parts.push(current); current = ''; }
      let end = Math.min(remainder.length, maxBytes);
      while (Buffer.byteLength(remainder.slice(0, end), 'utf8') > maxBytes) end--;
      const space = remainder.lastIndexOf(' ', end);
      if (space > end / 2) end = space;
      parts.push(remainder.slice(0, end));
      remainder = (citation ? `${citation} ` : '') + remainder.slice(end).trimStart();
    }
    const candidate = current ? `${current}\n${remainder}` : remainder;
    if (current && Buffer.byteLength(candidate, 'utf8') > maxBytes) {
      parts.push(current);
      current = remainder;
    } else current = candidate;
  }
  if (current) parts.push(current);
  return parts;
}

export async function generateDocument(input: {
  adapter: LLMAdapter;
  template: DocumentTemplateLike;
  session: DocumentGenerationSessionLike;
  transcript: string;
  onProgress?: (message: string) => Promise<void>;
  maxRequestBytes?: number;
}): Promise<string> {
  const limit = input.maxRequestBytes ?? (input.adapter.modelId.startsWith('groq/') ? 9_000 : 24_000);
  const original = { template: input.template, session: input.session, transcript: '' };
  const overhead = Math.max(
    messageSize(buildDocumentGenerationMessages(original)),
    messageSize(buildDocumentFromNotesMessages(original)),
    messageSize(buildDocumentCitationRetryMessages(buildDocumentFromNotesMessages(original))),
    messageSize(buildTranscriptReductionMessages({ ...original, targetChars: 1800 })),
  );
  const budget = limit - overhead - 128;
  if (budget < 1024) throw new Error('As instrucoes e o contexto da sessao sao muito longos para o modelo. Reduza esses campos antes de gerar o documento.');
  let evidence = input.transcript;
  let reduced = false;
  const summarize = async (part: string, targetChars: number, depth = 0): Promise<string> => {
    try {
      const note = (await input.adapter.complete(buildTranscriptReductionMessages({
        ...original, transcript: part, targetChars,
      }), { temperature: 0.1, maxTokens: 3072 })).trim();
      if (!note) throw new Error('O modelo retornou notas vazias ao analisar a transcricao. Tente novamente.');
      return note;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (depth >= 6 || Buffer.byteLength(part, 'utf8') < 2048 || !/limite da resposta|Request too large|context_length_exceeded/i.test(message)) throw error;
      const smaller = splitTranscript(part, Math.floor(Buffer.byteLength(part, 'utf8') / 2));
      const notes: string[] = [];
      for (const piece of smaller) notes.push(await summarize(piece, Math.max(300, Math.floor(targetChars / smaller.length)), depth + 1));
      return notes.join('\n\n');
    }
  };
  for (let level = 0; Buffer.byteLength(evidence, 'utf8') > budget; level++) {
    if (level >= 8) throw new Error('Nao foi possivel compactar a transcricao com seguranca para este modelo.');
    const parts = splitTranscript(evidence, budget);
    const targetChars = Math.min(1800, Math.max(300, Math.floor(budget / parts.length * 0.7)));
    const notes: string[] = [];
    for (let index = 0; index < parts.length; index++) {
      await input.onProgress?.(`Analisando trecho ${index + 1} de ${parts.length}${level ? ' (consolidacao)' : ''}`);
      notes.push(await summarize(parts[index], targetChars));
    }
    const compacted = notes.join('\n\n');
    if (Buffer.byteLength(compacted, 'utf8') >= Buffer.byteLength(evidence, 'utf8')) {
      throw new Error('O modelo nao conseguiu reduzir a transcricao. Tente um template mais conciso.');
    }
    evidence = compacted;
    reduced = true;
  }
  await input.onProgress?.('Gerando documento final');
  const messages = (reduced ? buildDocumentFromNotesMessages : buildDocumentGenerationMessages)({ ...original, transcript: evidence });
  const includeCitations = input.session.includeAudioCitationsOverride ?? input.template.includeAudioCitations ?? true;
  const sourceReferences = new Set(input.transcript.match(/\[audio:\d{2,}:\d{2}(?::\d{2})?\]/g) ?? []);
  for (let attempt = 0; attempt < 2; attempt++) {
    let content = '';
    for await (const token of input.adapter.stream(attempt ? buildDocumentCitationRetryMessages(messages) : messages, { temperature: 0.3, maxTokens: 3072 })) content += token;
    if (!content.trim()) throw new Error('O modelo retornou um documento vazio. Tente novamente.');
    const references = content.match(/\[audio:\d{2,}:\d{2}(?::\d{2})?\]/g) ?? [];
    const invalidReferences = references.some(reference => !sourceReferences.has(reference));
    if ((!includeCitations || !sourceReferences.size || references.length > 0) && !invalidReferences) return content.trim();
    await input.onProgress?.('Conferindo referencias ao audio');
  }
  throw new Error('O modelo nao preservou referencias validas ao audio. Tente gerar o documento novamente.');
}
