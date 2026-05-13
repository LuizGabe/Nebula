/// <reference types="vite/client" />
import { z } from 'zod'

const envSchema = z.object({
  VITE_API_BASE_URL: z.string().url(),
})

console.log("Loaded config: ", import.meta.env)

export const config = envSchema.parse(import.meta.env)