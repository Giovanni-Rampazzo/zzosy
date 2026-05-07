// Sanitizacao basica de SVG pra prevenir XSS em ambiente multi-tenant.
// Remove <script>, <foreignObject>, atributos on*, e javascript: URIs.
// NAO substitui DOMPurify pra producao critica, mas eh suficiente pro nosso caso.

export function sanitizeSvgBuffer(buf: Buffer): Buffer {
  let svg = buf.toString("utf-8")
  svg = svg.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
  svg = svg.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, "")
  svg = svg.replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
  svg = svg.replace(/\son\w+\s*=\s*'[^']*'/gi, "")
  svg = svg.replace(/javascript:/gi, "")
  return Buffer.from(svg, "utf-8")
}

/**
 * Aplica sanitizacao SE a extensao for svg. Caso contrario retorna buffer original.
 * Use em rotas que processam upload de imagem.
 */
export function maybeSanitizeImage(buf: Buffer, ext: string): Buffer {
  if (ext.toLowerCase() === "svg") return sanitizeSvgBuffer(buf)
  return buf
}
