// src/lib/llm/adapters/groq.ts
import Groq from "groq-sdk";
import { config } from "@/config";
import type { LLMAdapter, LLMMessage, LLMCompleteOptions } from "../types";

const GROQ_MODEL_IDS: Record<string, string> = {
  "groq/compound": "compound-beta",
  "groq/compound-mini": "compound-beta-mini",
};

export class GroqAdapter implements LLMAdapter {
  private client: Groq;

  constructor(readonly modelId: string) {
    this.client = new Groq({ apiKey: config.GROQ_API_KEY });
  }

  private get resolvedModel(): string {
    return GROQ_MODEL_IDS[this.modelId] ?? "compound-beta-mini";
  }

  async complete(messages: LLMMessage[], opts: LLMCompleteOptions = {}): Promise<string> {
    return this.completeWithRetry(messages, opts);
  }

  private async completeWithRetry(
    messages: LLMMessage[],
    opts: LLMCompleteOptions,
    maxRetries = 3
  ): Promise<string> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await this.client.chat.completions.create({
          model: this.resolvedModel,
          messages,
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 4096,
        });
        return res.choices[0].message.content ?? "";
      } catch (err: unknown) {
        const isRateLimit =
          err instanceof Error && "status" in err && (err as { status: number }).status === 429;

        if (!isRateLimit || attempt === maxRetries - 1) throw err;

        // Extrai tempo de espera da mensagem de erro
        let wait = 20;
        const match = String(err).match(/try again in ([\d.]+)s/i);
        if (match) wait = parseFloat(match[1]) + 1;

        console.warn(`[groq] rate limit, aguardando ${wait.toFixed(1)}s… (tentativa ${attempt + 1})`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
    throw new Error("Groq: max retries exceeded");
  }

  async *stream(messages: LLMMessage[], opts: LLMCompleteOptions = {}): AsyncIterable<string> {
    const res = await this.client.chat.completions.create({
      model: this.resolvedModel,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
    });

    for await (const chunk of res) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(config.GROQ_API_KEY);
  }
}
