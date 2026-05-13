// src/lib/llm/types.ts
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCompleteOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LLMAdapter {
  readonly modelId: string;
  complete(messages: LLMMessage[], opts?: LLMCompleteOptions): Promise<string>;
  stream(messages: LLMMessage[], opts?: LLMCompleteOptions): AsyncIterable<string>;
  isAvailable(): Promise<boolean>;
}