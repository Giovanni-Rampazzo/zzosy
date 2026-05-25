/**
 * Env vars validadas via zod. Falha early se config invalida — em vez de
 * erro criptico em runtime ("undefined is not a function" porque DATABASE_URL
 * eh undefined).
 *
 * Uso:
 *   import { env } from "@/lib/env"
 *   const db = env.DATABASE_URL  // typed string, garantido nao-vazio
 *
 * Refresh: import "@/lib/env" no top-level de qualquer entry point garante
 * validation no boot. Em Next.js, layout.tsx ou middleware sao bons candidatos.
 *
 * Quando STORAGE_DRIVER=s3, exige S3_BUCKET/S3_ACCESS_KEY/S3_SECRET tambem
 * (validation condicional). Sem isso, swap acidental pra s3 sem creds geraria
 * erros so quando o primeiro upload tentasse rodar.
 */
import { z } from "zod"

const schema = z.object({
  // ── Core ──
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  NEXTAUTH_SECRET: z.string().min(16, "NEXTAUTH_SECRET must be at least 16 chars (use openssl rand -base64 32)"),
  NEXTAUTH_URL: z.string().url("NEXTAUTH_URL must be a valid URL").optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // ── Storage ──
  STORAGE_DRIVER: z.enum(["local", "s3", "r2", "bunny"]).default("local"),
  // S3-compatible (R2/Bunny tambem) — required quando STORAGE_DRIVER != local
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_URL_BASE: z.string().url().optional(),

  // ── Stripe (billing) ──
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),     // price_xxx do plano Pro
  STRIPE_PRICE_AGENCY: z.string().optional(),  // price_xxx do plano Agency
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // ── Sentry (error tracking) ──
  SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),

  // ── Email (Resend) ──
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),  // ex: "ZZOSY <noreply@zzosy.com>" — formato livre

  // ── Rate limiting (Upstash Redis) ──
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // ── Logs ──
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),

  // ── Migrate guard ──
  MIGRATE_SECRET: z.string().optional(),
}).superRefine((data, ctx) => {
  // Condicional: storage S3-compatible exige creds.
  if (data.STORAGE_DRIVER === "s3" || data.STORAGE_DRIVER === "r2" || data.STORAGE_DRIVER === "bunny") {
    const required = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const
    for (const k of required) {
      if (!data[k]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [k],
          message: `${k} required when STORAGE_DRIVER=${data.STORAGE_DRIVER}`,
        })
      }
    }
  }
  // Producao exige NEXTAUTH_URL (sem URL, OAuth callbacks quebram).
  if (data.NODE_ENV === "production" && !data.NEXTAUTH_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["NEXTAUTH_URL"],
      message: "NEXTAUTH_URL required in production",
    })
  }
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

function parseEnv(): Env {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const lines = parsed.error.errors.map(e => `  - ${e.path.join(".")}: ${e.message}`).join("\n")
    // CRITICAL erro de boot — log explicito + throw. Sem isso, o erro vira
    // 500 cripticos nos endpoints.
    const msg = `Invalid environment configuration:\n${lines}`
    console.error("[env]", msg)
    throw new Error(msg)
  }
  return parsed.data
}

/**
 * Env validado (lazy singleton). Importar onde precisar:
 *   import { env } from "@/lib/env"
 *   env.DATABASE_URL  // typed + validated
 *
 * Em dev: throw na primeira import com env invalida — corrige no .env e
 * reinicia. Em prod: app NAO sobe se env invalida — pod crash fast.
 */
export const env: Env = new Proxy({} as Env, {
  get(_, prop) {
    if (!cached) cached = parseEnv()
    return cached[prop as keyof Env]
  },
})

/**
 * Test helper — substitui env runtime. NAO usar em codigo de producao.
 */
export function __setEnvForTesting(override: Partial<Env> | null) {
  cached = override ? { ...(cached ?? parseEnv()), ...override } : null
}
