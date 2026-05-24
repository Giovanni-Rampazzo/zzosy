import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"

/**
 * Download proxy — resolve problema de Chrome bloqueando <a>.click() programatico
 * fora de user gesture direto. Em vez de baixar client-side via blob URL, o
 * client faz POST do blob aqui e GET via window.location.href — browser
 * SEMPRE baixa quando response tem Content-Disposition: attachment.
 *
 * Flow:
 *  1. Client POST blob (multipart) com ?filename=X → server cacheia em memoria
 *     com UUID, retorna { id }
 *  2. Client navigates window.location.href = /api/download-proxy/{id}
 *     → server stream do blob com Content-Disposition
 *
 * Cache: in-memory Map. TTL 60s — blob auto-removido apos download ou timeout.
 * Aceitavel pra arquivos < 100MB (limit do Next route).
 */

type CacheEntry = {
  buffer: Buffer
  filename: string
  mime: string
  expiresAt: number
}

// Module-level Map — persiste enquanto o server roda. Em prod com multi-instancia
// precisaria Redis, mas pra dev/single-instance OK.
const CACHE: Map<string, CacheEntry> = (globalThis as any).__downloadProxyCache ?? new Map()
;(globalThis as any).__downloadProxyCache = CACHE

const TTL_MS = 60 * 1000

function purgeExpired() {
  const now = Date.now()
  for (const [id, entry] of CACHE.entries()) {
    if (entry.expiresAt < now) CACHE.delete(id)
  }
}

export async function POST(req: NextRequest) {
  purgeExpired()
  const form = await req.formData()
  const file = form.get("file") as File | null
  if (!file) return NextResponse.json({ error: "missing file" }, { status: 400 })
  const filename = (form.get("filename") as string) || "download.bin"
  const buf = Buffer.from(await file.arrayBuffer())
  const id = randomUUID()
  CACHE.set(id, {
    buffer: buf,
    filename,
    mime: file.type || "application/octet-stream",
    expiresAt: Date.now() + TTL_MS,
  })
  return NextResponse.json({ id, url: `/api/download-proxy?id=${id}` })
}

export async function GET(req: NextRequest) {
  purgeExpired()
  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 })
  const entry = CACHE.get(id)
  if (!entry) return NextResponse.json({ error: "not found or expired" }, { status: 404 })
  // Apos servir, remove do cache (single-use)
  CACHE.delete(id)
  return new NextResponse(entry.buffer as any, {
    status: 200,
    headers: {
      "Content-Type": entry.mime,
      "Content-Disposition": `attachment; filename="${entry.filename.replace(/"/g, '')}"`,
      "Content-Length": String(entry.buffer.length),
      "Cache-Control": "no-store",
    },
  })
}
