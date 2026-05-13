// src/lib/llm/index.ts
import { LLMAdapter } from "./types.js";
import { GroqAdapter } from "./adapters/groq.js";
import { OllamaAdapter } from "./adapters/ollama.js";

export const DEFAULT_MODEL = "groq/compound-mini";

export const AVAILABLE_MODELS = [
  { id: "groq/compound-mini", label: "Groq Compound Mini", provider: "groq" },
  { id: "groq/compound", label: "Groq Compound", provider: "groq" },
  { id: "ollama/qwen3.8b", label: "Qwen 3.8B (local)", provider: "ollama" },
  { id: "ollama/qwen3.4b", label: "Qwen 3.4B (local)", provider: "ollama" },
] as const;

export type ModelId = typeof AVAILABLE_MODELS[number]["id"];

export function createAdapter(modelId: string): LLMAdapter {
  if (modelId.startsWith("groq/")) return new GroqAdapter(modelId);
  if (modelId.startsWith("ollama/")) return new OllamaAdapter(modelId);
  throw new Error(`Modelo desconhecido: ${modelId}`);
}

export type { LLMAdapter, LLMMessage } from "./types.js";