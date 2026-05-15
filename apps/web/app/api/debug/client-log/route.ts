import { NextRequest, NextResponse } from "next/server"
import { appendFile } from "fs/promises"

const DUMP_FILE = "/tmp/zzysy-client-log.txt"

// Endpoint pra logs do client aparecerem no terminal do servidor E em arquivo.
// Uso: fetch("/api/debug/client-log", { method: "POST", body: JSON.stringify({tag, data}) })
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const tag = body?.tag ?? "CLIENT"
    const data = body?.data
    const dataStr = typeof data === "object" ? JSON.stringify(data) : String(data)
    const line = `[${new Date().toISOString()}] [${tag}] ${dataStr}`
    console.log(`\n🔵 [${tag}]`, dataStr, "\n")
    // Append em arquivo pra Giovanni conseguir ler com tail
    appendFile(DUMP_FILE, line + "\n").catch(() => {})
  } catch {}
  return NextResponse.json({ ok: true })
}
