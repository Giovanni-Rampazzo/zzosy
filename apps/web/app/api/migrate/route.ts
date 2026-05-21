import { NextResponse } from "next/server"
import { execSync } from "child_process"

// Endpoint admin que roda `prisma db push --accept-data-loss`. Auditoria P1.8:
// - Removido fallback hardcoded "zzosy-migrate-2026" (era publico no codigo).
// - Exige MIGRATE_SECRET no env; sem ele, 500 (config error) em vez de aceitar
//   qualquer secret. Em prod, falta da env eh bloqueio total.
// - Pra rodar local, define MIGRATE_SECRET=algumacoisa no .env e passa no header.
export async function POST(req: Request) {
  const expected = process.env.MIGRATE_SECRET
  if (!expected || typeof expected !== "string" || expected.length < 12) {
    return NextResponse.json({ error: "MIGRATE_SECRET nao configurada (>=12 chars)" }, { status: 500 })
  }
  const secret = req.headers.get("x-migrate-secret")
  if (secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const output = execSync("npx prisma db push --accept-data-loss", {
      cwd: process.cwd(),
      env: process.env,
      timeout: 30000,
    }).toString()
    return NextResponse.json({ ok: true, output })
  } catch (e: any) {
    // Nao retorna e.message (pode vazar stack/connection string).
    console.error("[migrate] failed:", e?.message ?? e)
    return NextResponse.json({ error: "Migration failed" }, { status: 500 })
  }
}
