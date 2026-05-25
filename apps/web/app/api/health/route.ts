/**
 * Health check publico — UptimeRobot/BetterStack/healthchecks.io ping aqui.
 * NAO precisa auth — eh pra monitoring externo.
 *
 * Retorna 200 com body JSON + status 503 se algum check critico falhar.
 *
 * Checks:
 *  - DB: SELECT 1 (timeout 2s)
 *  - Storage: adapter name (sem ping real — evita IO desnecessario)
 *  - Env: validado no boot via instrumentation.ts
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getStorage } from "@/lib/storage"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface CheckResult {
  ok: boolean
  detail?: string
  ms?: number
}

async function checkDb(): Promise<CheckResult> {
  const t0 = Date.now()
  try {
    // SELECT 1 simples — MySQL aceita via $queryRaw
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, rej) => setTimeout(() => rej(new Error("db timeout 2s")), 2000)),
    ])
    return { ok: true, ms: Date.now() - t0 }
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? "db error", ms: Date.now() - t0 }
  }
}

function checkStorage(): CheckResult {
  try {
    const s = getStorage()
    return { ok: true, detail: s.name }
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? "storage init failed" }
  }
}

export async function GET() {
  const [db, storage] = await Promise.all([checkDb(), Promise.resolve(checkStorage())])
  const ok = db.ok && storage.ok
  const body = {
    status: ok ? "healthy" : "unhealthy",
    ts: new Date().toISOString(),
    nodeEnv: env.NODE_ENV,
    checks: { db, storage },
  }
  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  })
}
