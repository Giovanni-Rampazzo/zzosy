/**
 * Limites server-side pra payloads. Previne:
 *  - Clientes maliciosos salvando JSON gigante (DB bloat + OOM no parse)
 *  - Cartridge upload bomb (multipart com PSB de 5GB → OOM)
 *
 * Tunados pra uso REAL do ZZOSY (Sicredi-style campanhas):
 *  - lastOverride: ~5-20 chars per layer × 50 layers max ≈ 1MB com folga
 *  - tags: array de strings curtas, max 50 items × 50 chars = 2.5KB
 *  - meta: metadata livre, mas razoavel ≤ 100KB
 *  - content: TextSpan[] pra TEXT (poucos KB) OU shape SVG path (até 1MB)
 *  - notes: text livre user-facing, 10KB suficiente
 *  - cartridge: PSB grandes, mas 100MB e generoso
 */

const KB = 1024
const MB = 1024 * KB

export const SIZE_LIMITS = {
  /** Per-field caps em JSON body */
  tags: 5 * KB,
  meta: 100 * KB,
  content: 1 * MB,
  lastOverride: 1 * MB,
  notes: 10 * KB,
  name: 500,
  slotKey: 200,
  /** Cartridge upload */
  cartridgeFile: 100 * MB,
} as const

/**
 * Mede tamanho aproximado de qualquer valor JSON-serializavel.
 * Usa JSON.stringify pra strings; bytelength via TextEncoder pra precisao UTF8.
 */
export function approxByteSize(value: unknown): number {
  if (value == null) return 0
  if (typeof value === "string") return new TextEncoder().encode(value).length
  if (typeof value === "number" || typeof value === "boolean") return 16
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

/**
 * Valida que um campo nao excede o limite. Retorna mensagem de erro OR null.
 * Use no handler: `const err = checkSize("content", body.content); if (err) return NextResponse.json({error: err}, {status: 413})`
 */
export function checkSize(field: keyof typeof SIZE_LIMITS, value: unknown): string | null {
  const max = SIZE_LIMITS[field]
  const size = approxByteSize(value)
  if (size > max) {
    return `Campo "${field}" excede ${formatBytes(max)} (recebido ${formatBytes(size)})`
  }
  return null
}

/**
 * Valida multiplos campos de um body de uma vez. Retorna primeira falha OR null.
 */
export function checkBodySizes(body: any, fields: Array<keyof typeof SIZE_LIMITS>): string | null {
  for (const f of fields) {
    if (f in body || (body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, f))) {
      const err = checkSize(f, body[f])
      if (err) return err
    }
  }
  return null
}

function formatBytes(n: number): string {
  if (n < KB) return `${n}B`
  if (n < MB) return `${(n / KB).toFixed(1)}KB`
  return `${(n / MB).toFixed(1)}MB`
}

/**
 * MIME types aceitos pra upload de cartridge. ZIP (application/zip) ou
 * application/octet-stream (browsers as vezes nao sabem zip de .zzosy).
 * Defesa em camada — bomb attack guard (size) eh primaria; MIME secundario.
 */
export const CARTRIDGE_ALLOWED_MIME = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
  "", // alguns browsers/curl mandam vazio
])

export function isCartridgeMimeAllowed(mime: string | undefined | null): boolean {
  return CARTRIDGE_ALLOWED_MIME.has((mime ?? "").toLowerCase().split(";")[0].trim())
}

/**
 * Valida que imageUrl eh um path local seguro (/uploads/...) ou URL absoluta
 * http(s). Bloqueia javascript:, data:, vbscript: — defesa XSS indireto se
 * algum lugar usar imageUrl como href ou window.open.
 */
const SAFE_PATH = /^\/uploads\/[\w\-./]+$/
const SAFE_HTTP = /^https?:\/\/[\w\-.]+(:\d+)?(\/.*)?$/i
export function isImageUrlSafe(url: string | undefined | null): boolean {
  if (!url) return true // null/empty OK
  if (typeof url !== "string") return false
  if (url.length > 2000) return false // sane URL length
  return SAFE_PATH.test(url) || SAFE_HTTP.test(url)
}
