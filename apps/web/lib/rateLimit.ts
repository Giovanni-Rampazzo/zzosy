/**
 * Rate limiting via @upstash/ratelimit (sliding window).
 *
 * Backends:
 *  - Production: Upstash Redis (REST) — `UPSTASH_REDIS_REST_URL` +
 *    `UPSTASH_REDIS_REST_TOKEN` no env.
 *  - Sem env (dev/staging sem Upstash): in-memory fallback no-op safe —
 *    NUNCA bloqueia, so loga warning na primeira chamada. Permite rodar dev
 *    sem configurar Upstash.
 *
 * Uso:
 *   import { rateLimit, identifierFromRequest } from "@/lib/rateLimit"
 *   const id = identifierFromRequest(req, session?.user?.id)
 *   const { ok, retryAfter } = await rateLimit.auth.check(id)
 *   if (!ok) return apiErrors.tooManyRequests(retryAfter)
 *
 * Buckets:
 *   - auth      → 10 req / 60s   (login, signup)
 *   - upload    → 20 req / 60s   (POST de arquivos)
 *   - mutation  → 60 req / 60s   (POST/PUT/DELETE genericos)
 *   - default   → 120 req / 60s  (catch-all)
 *
 * Cap por chave: prefere `userId` quando disponivel, fallback pro IP (extraido
 * de `x-forwarded-for` ou `x-real-ip`). Em prod atras de proxy/CDN, garantir
 * que esses headers chegam confiavelmente.
 */
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import type { NextRequest } from "next/server"

export interface CheckResult {
  ok: boolean
  remaining: number
  limit: number
  reset: number  // epoch seconds
  retryAfter: number  // seconds
}

interface Bucket {
  check(identifier: string): Promise<CheckResult>
}

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
const enabled = !!(REDIS_URL && REDIS_TOKEN)

let warned = false
function warnNoOp() {
  if (!warned) {
    console.warn(
      "[rateLimit] UPSTASH_REDIS_REST_URL/TOKEN nao setados — rate limiting DESABILITADO (no-op). " +
      "Em producao: setar essas envs. Em dev: pode ignorar."
    )
    warned = true
  }
}

const noOpBucket: Bucket = {
  async check(_id: string): Promise<CheckResult> {
    warnNoOp()
    return { ok: true, remaining: Number.MAX_SAFE_INTEGER, limit: Number.MAX_SAFE_INTEGER, reset: 0, retryAfter: 0 }
  },
}

function buildBucket(prefix: string, max: number, windowSeconds: number): Bucket {
  if (!enabled) return noOpBucket
  const redis = new Redis({ url: REDIS_URL!, token: REDIS_TOKEN! })
  const rl = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(max, `${windowSeconds} s`),
    analytics: true,
    prefix: `zzosy:rl:${prefix}`,
  })
  return {
    async check(identifier: string): Promise<CheckResult> {
      const r = await rl.limit(identifier)
      const retryAfter = r.success ? 0 : Math.max(1, Math.ceil((r.reset - Date.now()) / 1000))
      return {
        ok: r.success,
        remaining: r.remaining,
        limit: r.limit,
        reset: Math.ceil(r.reset / 1000),
        retryAfter,
      }
    },
  }
}

export const rateLimit = {
  auth: buildBucket("auth", 10, 60),
  upload: buildBucket("upload", 20, 60),
  mutation: buildBucket("mutation", 60, 60),
  default: buildBucket("default", 120, 60),
}

/**
 * Extrai identifier estavel pra rate limit. Prioridade:
 *   1. userId (sessao autenticada) — burst protection por usuario
 *   2. IP (x-forwarded-for primeiro hop, fallback x-real-ip, fallback "unknown")
 *
 * Em prod atras de Cloudflare/Railway, garantir que esses headers chegam
 * (Railway passa por default; Cloudflare requer config "Restoring Original
 * Visitor IP").
 */
export function identifierFromRequest(req: NextRequest, userId?: string | null): string {
  if (userId) return `user:${userId}`
  const xff = req.headers.get("x-forwarded-for") ?? ""
  const ip = xff.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"
  return `ip:${ip}`
}

export const rateLimitEnabled = enabled
