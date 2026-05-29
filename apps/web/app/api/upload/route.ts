/**
 * POST /api/upload — upload generico de imagem/fonte, retorna URL pro storage.
 *
 * Antes (ate 2026-05-29): convertia bytes em data URL base64 inline. Issues:
 *   - DB bloating: brandLogoUrl ate 7MB de base64 em LongText (request payloads
 *     inflavam, listings ficavam lentas).
 *   - DoS: sem cap de tamanho, sem rate limit.
 *   - Sem MIME whitelist real (so sniffing de extensao).
 *
 * Agora: storage.put() (Railway Volume / local / R2 futuro). URL retornado
 * eh /uploads/{key} OR https://cdn/{key} dependendo do driver. Persistente.
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { apiErrors } from "@/lib/apiError"
import { getStorage } from "@/lib/storage"
import { rateLimit, identifierFromRequest } from "@/lib/rateLimit"
import { randomUUID } from "crypto"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Cap absoluto de upload via essa rota generica. PSDs grandes usam
// /api/campaigns/[id]/import-psd (cap maior, dedicado).
const MAX_BYTES = 20 * 1024 * 1024 // 20MB

// MIME whitelist — uploads genericos sao logo de marca, asset solto, fonte
// custom. Sem PSD/PDF (rotas dedicadas) nem executaveis.
const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  // Browsers as vezes mandam application/octet-stream — autodetectado via extensao abaixo
])

function mimeFromExt(name: string): string | null {
  const n = name.toLowerCase()
  if (n.endsWith(".ttf")) return "font/ttf"
  if (n.endsWith(".otf")) return "font/otf"
  if (n.endsWith(".woff2")) return "font/woff2"
  if (n.endsWith(".woff")) return "font/woff"
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg"
  if (n.endsWith(".png")) return "image/png"
  if (n.endsWith(".webp")) return "image/webp"
  if (n.endsWith(".gif")) return "image/gif"
  if (n.endsWith(".svg")) return "image/svg+xml"
  return null
}

function extForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg"
    case "image/png": return "png"
    case "image/webp": return "webp"
    case "image/gif": return "gif"
    case "image/svg+xml": return "svg"
    case "font/ttf": return "ttf"
    case "font/otf": return "otf"
    case "font/woff": return "woff"
    case "font/woff2": return "woff2"
    default: return "bin"
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const userId = (session.user as any).id
  const tenantId = (session.user as any).tenantId
  if (!tenantId) return apiErrors.unauthorized()

  // Rate limit ANTES do parsing pra evitar gasto de banda em flood.
  const rl = await rateLimit.upload.check(identifierFromRequest(req, userId))
  if (!rl.ok) return apiErrors.tooManyRequests(rl.retryAfter)

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })

  // Size cap (file.size eh confiavel — Next ja parseou).
  if (file.size > MAX_BYTES) {
    return NextResponse.json({
      error: `Arquivo excede ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB (recebido ${(file.size / 1024 / 1024).toFixed(1)}MB)`,
    }, { status: 413 })
  }

  // Resolve MIME: prefere extensao (mais confiavel), fallback pra file.type.
  const browserMime = file.type || ""
  const extMime = mimeFromExt(file.name || "")
  const mime = extMime ?? (ALLOWED_MIMES.has(browserMime) ? browserMime : null)
  if (!mime) {
    return NextResponse.json({
      error: `Tipo de arquivo nao suportado: "${browserMime}" / "${file.name}". Permitidos: PNG/JPG/WEBP/GIF/SVG/fonts.`,
    }, { status: 415 })
  }
  if (!ALLOWED_MIMES.has(mime)) {
    return NextResponse.json({ error: `MIME nao permitido: ${mime}` }, { status: 415 })
  }

  // Key: namespace por tenant pra isolation no listing/cleanup futuro.
  // {tenantId}/uploads/{uuid}.{ext} eh estavel e nao colidiivel (UUID v4).
  const ext = extForMime(mime)
  const key = `tenants/${tenantId}/uploads/${randomUUID()}.${ext}`
  const bytes = Buffer.from(await file.arrayBuffer())

  try {
    const storage = getStorage()
    const result = await storage.put(key, bytes, mime)
    return NextResponse.json({ url: result.url, key: result.key, size: result.size })
  } catch (e: any) {
    console.error("[/api/upload] storage.put falhou:", e)
    return NextResponse.json({ error: "Falha no storage" }, { status: 500 })
  }
}
