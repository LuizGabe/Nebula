// src/lib/llm/adapters/groq.ts
import Groq from "groq-sdk";
import { config } from "@/config";
import type { LLMAdapter, LLMMessage, LLMCompleteOptions } from "../types";

const GROQ_MODEL_IDS: Record<string, string> = {
  // Retain saved profile ids after the Compound systems were retired.
  "groq/compound": "openai/gpt-oss-120b",
  "groq/compound-mini": "openai/gpt-oss-20b",
  "groq/openai/gpt-oss-20b": "openai/gpt-oss-20b",
  "groq/openai/gpt-oss-120b": "openai/gpt-oss-120b",
};

export class GroqAdapter implements LLMAdapter {
  private client: Groq;

  constructor(readonly modelId: string) {
    this.client = new Groq({ apiKey: config.GROQ_API_KEY, maxRetries: 0 });
  }

  private get resolvedModel(): string {
    return GROQ_MODEL_IDS[this.modelId] ?? "openai/gpt-oss-20b";
  }

  async complete(messages: LLMMessage[], opts: LLMCompleteOptions = {}): Promise<string> {
    const res = await this.requestWithRetry(() => this.client.chat.completions.create({
      model: this.resolvedModel, messages, temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 4096, reasoning_effort: 'low',
    }));
    if (res.choices[0]?.finish_reason === 'length') {
      throw new Error('O modelo atingiu o limite da resposta antes de concluir. Use um template mais conciso ou tente outro modelo.');
    }
    return res.choices[0]?.message.content ?? '';
  }

  private async requestWithRetry<T>(request: () => Promise<T>, maxRetries = 4): Promise<T> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await request();
      } catch (err: unknown) {
        const isRateLimit =
          err instanceof Error && "status" in err && (err as { status: number }).status === 429;

        if (!isRateLimit || attempt === maxRetries - 1) throw err;

        // Extrai tempo de espera da mensagem de erro
        let wait = 20;
        const headers = (err as { headers?: Headers }).headers;
        const retryAfter = headers?.get?.('retry-after');
        if (retryAfter && Number.isFinite(Number(retryAfter))) wait = Number(retryAfter);
        const match = String(err).match(/try again in ([\d.]+)s/i);
        if (!retryAfter && match) wait = parseFloat(match[1]);
        wait = Math.min(60, Math.max(1, wait + 1));

        console.warn(`[groq] rate limit, aguardando ${wait.toFixed(1)}s… (tentativa ${attempt + 1})`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
    throw new Error("Groq: max retries exceeded");
  }

  async *stream(messages: LLMMessage[], opts: LLMCompleteOptions = {}): AsyncIterable<string> {
    const res = await this.requestWithRetry(() => this.client.chat.completions.create({
      model: this.resolvedModel,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
      reasoning_effort: 'low',
    }));

    for await (const chunk of res) {
      if (chunk.choices[0]?.finish_reason === 'length') {
        throw new Error('O modelo atingiu o limite da resposta antes de concluir o documento. Use um template mais conciso ou tente outro modelo.');
      }
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(config.GROQ_API_KEY);
  }
}
