import { NextRequest, NextResponse } from "next/server"

// Stash em memoria — log enviado pelo browser durante o load do editor
declare global {
  // eslint-disable-next-line no-var
  var __load_debug: any[] | undefined
}
if (!global.__load_debug) global.__load_debug = []

export async function POST(req: NextRequest) {
  const body = await req.json()
  global.__load_debug!.push({ ts: new Date().toISOString(), ...body })
  if (global.__load_debug!.length > 200) global.__load_debug!.shift()
  return NextResponse.json({ ok: true })
}

export async function GET() {
  return NextResponse.json({ logs: global.__load_debug ?? [] })
}

export async function DELETE() {
  global.__load_debug = []
  return NextResponse.json({ ok: true })
}
