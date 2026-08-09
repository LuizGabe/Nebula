// src/config/index.ts
import { z } from "zod";
import { config as loadConfig } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");

if (process.env.NODE_ENV !== "production") {
  const envPath = resolve(__dirname, "../../../../.env");
  
  loadConfig({ path: envPath });
  console.log(`📂 Tentando carregar .env de: ${envPath}`);
}

const envSchema = z.object({
  // PostgreSQL
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatório"),

  // gRPC Worker
  GRPC_WORKER_HOST: z.string().default("localhost:50051"),

  // Redis
  REDIS_URL: z.string().min(1, "REDIS_URL é obrigatório"),

  // MinIO
  MINIO_PUBLIC_ENDPOINT: z.string().min(1),
  MINIO_INTERNAL_ENDPOINT: z.string().default("http://minio:9000"),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().default("transcriber"),

  // Sessão
  PORT: z.coerce.number().int().default(3333),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  REGISTRATION_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET precisa ter no mínimo 32 caracteres"),
  SESSION_SALT: z.string().length(16, "SESSION_SALT precisa ter exatamente 16 caracteres"),
  LOG_LEVEL: z.string().default("info"),

  // LLM
  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY é obrigatório"),
  OLLAMA_URL: z.string().default("http://localhost:11434"),
  DEFAULT_MODEL: z.string().default("groq/compound-mini"),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Variáveis de ambiente inválidas:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const config = parsed.data;

// ── Tipagem explícita para User.config ──────────────
export interface UserConfig {
  defaultModel?: string;
}
