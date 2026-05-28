// editorLog + clampTinyFontSize — extraidos de KeyVisionEditor.tsx
// (2026-05-28) pra reduzir o arquivo principal.

// Em produção, warnings de saude do editor (objetos orfaos, race conditions, etc)
// poluem o console sem valor pro user final. Em dev, sao essenciais pra diagnostico.
// editorLog encapsula isso — silenciamos em prod mas mantemos warnings reais
// (falhas de upload, erros de PATCH) via console.warn direto.
const isDev = process.env.NODE_ENV !== "production"

export function editorLog(...args: any[]) {
  if (isDev) console.warn(...args)
}

/**
 * Edge case PSD: overrides.fontSize box-level pode chegar quase-zero
 * (~0.158) quando o PSD tem leading mixed e o per-char styles carrega o
 * fontSize real. Sem clamping, Fabric Textbox cria com fontSize ~= 0,
 * shrink-to-content calcula expectedLines = altura / (fontSize * 1.2) =
 * milhares de linhas, condicao "lineCount === expectedLines" falha, e a
 * largura fica em 99999 (point-text default). Sintoma visivel: textbox
 * atravessa o canvas inteiro horizontalmente.
 *
 * Quando ov.fontSize < 1 e styles tem fontSizes per-char, retorna o MAX
 * dos per-char fontSizes. Senao retorna o valor original.
 */
export function clampTinyFontSize(fontSize: number | undefined, styles: any): number {
  if (typeof fontSize !== "number") return fontSize ?? 80
  if (fontSize >= 1) return fontSize
  if (!styles || typeof styles !== "object") return fontSize
  let maxFs = 0
  for (const lineKey of Object.keys(styles)) {
    const line = styles[lineKey]
    if (!line || typeof line !== "object") continue
    for (const colKey of Object.keys(line)) {
      const fs = line[colKey]?.fontSize
      if (typeof fs === "number" && fs > maxFs) maxFs = fs
    }
  }
  return maxFs > 0 ? maxFs : fontSize
}
