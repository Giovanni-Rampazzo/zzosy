import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Endpoint pra client-side logs aparecerem no terminal do servidor.
// Uso: await fetch('/api/debug/client-log', { method: 'POST', body: JSON.stringify({ tag, data }) })
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const tag = body.tag || "CLIENT"
    const data = body.data
    // eslint-disable-next-line no-console
    console.log(`\n🔵 [${tag}]`, typeof data === "string" ? data : JSON.stringify(data, null, 2), "\n")
  } catch (e) {
    console.log("[client-log] parse fail:", e)
  }
  return NextResponse.json({ ok: true })
}
