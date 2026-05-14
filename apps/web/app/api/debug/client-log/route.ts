import { NextRequest, NextResponse } from "next/server"

// Endpoint pra logs do client aparecerem no terminal do servidor.
// Uso: fetch("/api/debug/client-log", { method: "POST", body: JSON.stringify({tag, data}) })
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const tag = body?.tag ?? "CLIENT"
    const data = body?.data
    console.log(`\n🔵 [${tag}]`, typeof data === "object" ? JSON.stringify(data, null, 2) : data, "\n")
  } catch {}
  return NextResponse.json({ ok: true })
}
