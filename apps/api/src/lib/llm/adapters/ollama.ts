// src/lib/llm/adapters/ollama.ts
import { config } from "@/config";
import type { LLMAdapter, LLMMessage, LLMCompleteOptions } from "../types.js";

const OLLAMA_MODEL_IDS: Record<string, string> = {
  "ollama/qwen3.8b": "qwen3:8b",
  "ollama/qwen3.4b": "qwen3:4b-q4_K_M",
};

export class OllamaAdapter implements LLMAdapter {
  private baseUrl: string;

  constructor(readonly modelId: string) {
    this.baseUrl = config.OLLAMA_URL;
  }

  private get resolvedModel(): string {
    return OLLAMA_MODEL_IDS[this.modelId] ?? "qwen3:8b";
  }

  async complete(messages: LLMMessage[], opts: LLMCompleteOptions = {}): Promise<string> {
    console.log()
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.resolvedModel,
        messages,
        stream: false,
        think: false,
        options: {
          temperature: opts.temperature ?? 0.2,
          num_predict: opts.maxTokens ?? 4096,
        },
      }),
      signal: AbortSignal.timeout(900_000),
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = (await res.json()) as { message: { content: string } };
    return data.message.content;
  }

  async *stream(messages: LLMMessage[], opts: LLMCompleteOptions = {}): AsyncIterable<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.resolvedModel,
        messages,
        stream: true,
        think: false,
        options: {
          temperature: opts.temperature ?? 0.2,
          num_predict: opts.maxTokens ?? 4096,
        },
      }),
      signal: AbortSignal.timeout(900_000),
    });

    if (!res.ok) throw new Error(`Ollama stream error: ${res.status}`);
    if (!res.body) throw new Error("Ollama: response body is null");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          if (json.message?.content) yield json.message.content;
        } catch {
          // linha incompleta, ignorar
        }
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}