import { NextRequest, NextResponse } from "next/server"
import { appendFile } from "fs/promises"

const DUMP_FILE = "/tmp/zzosy-client-log.txt"

// Endpoint pra logs do client aparecerem no terminal do servidor E em arquivo.
// Uso: fetch("/api/debug/client-log", { method: "POST", body: JSON.stringify({tag, data}) })
// GATED: so funciona em dev (NODE_ENV !== "production"). Em prod retorna 404
// pra nao expor endpoint de debug montado (audit L4).
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  try {
    const body = await req.json().catch(() => ({}))
    const tag = body?.tag ?? "CLIENT"
    const data = body?.data
    const dataStr = typeof data === "object" ? JSON.stringify(data) : String(data)
    const line = `[${new Date().toISOString()}] [${tag}] ${dataStr}`
    console.log(`\n🔵 [${tag}]`, dataStr, "\n")
    appendFile(DUMP_FILE, line + "\n").catch(() => {})
  } catch {}
  return NextResponse.json({ ok: true })
}
