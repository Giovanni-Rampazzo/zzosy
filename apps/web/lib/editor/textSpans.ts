// Helpers de TextSpan + textbox styles per-char — extraidos de
// KeyVisionEditor.tsx (2026-05-28). Puros (sem state externo).

import type { TextSpan, Asset } from "./types"

export function parseContent(raw: any): TextSpan[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

export function getSpans(asset: Asset): TextSpan[] {
  const c = parseContent(asset.content)
  if (c.length) return c
  const text = (asset.value?.trim()) || asset.label
  return [{ text, style: { color: "#111111", fontSize: 80, fontWeight: "normal", fontFamily: "Arial" } }]
}

// Le os styles per-caractere de um Textbox e gera TextSpan[] fragmentado
export function textboxToSpans(obj: any): TextSpan[] {
  const fullText: string = obj.text ?? ""
  const styles = obj.styles ?? {}
  const defaultStyle = {
    color: obj.fill ?? "#111111",
    fontSize: obj.fontSize ?? 80,
    fontWeight: obj.fontWeight ?? "normal",
    fontFamily: obj.fontFamily ?? "Arial",
  }

  if (!fullText) return [{ text: "", style: defaultStyle }]

  const lines = fullText.split("\n")
  const spans: TextSpan[] = []
  let buf = ""
  let bufStyle: any = null

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]
    const lineStyles = styles[lineNum] ?? {}
    for (let col = 0; col < line.length; col++) {
      const cs = lineStyles[col] ?? {}
      const charStyle = {
        color: cs.fill ?? defaultStyle.color,
        fontSize: cs.fontSize ?? defaultStyle.fontSize,
        fontWeight: cs.fontWeight ?? defaultStyle.fontWeight,
        fontFamily: cs.fontFamily ?? defaultStyle.fontFamily,
      }
      const key = JSON.stringify(charStyle)
      if (bufStyle === null || JSON.stringify(bufStyle) === key) {
        buf += line[col]
        if (bufStyle === null) bufStyle = charStyle
      } else {
        spans.push({ text: buf, style: bufStyle })
        buf = line[col]
        bufStyle = charStyle
      }
    }
    if (lineNum < lines.length - 1) {
      buf += "\n"
    }
  }
  if (buf) spans.push({ text: buf, style: bufStyle ?? defaultStyle })
  return spans
}

// Migra pieces antigas salvas com styles "flat" — { 0: { globalCharIdx: ... } } —
// pro novo schema indexado por LINHA — { lineIdx: { charInLine: ... } }.
// Bug corrigido em 25839ad: Fabric Textbox usa estrutura por linha; antes
// empilhavamos todos os chars em styles[0], entao Textbox dropava silenciosamente
// chars de linha 1+ (audit H10). Pieces salvas antes do commit ficaram com flat
// no banco e abriram quebradas. Esta funcao detecta + converte na hora do load.
export function migrateFlatStylesToLineIndexed(
  text: string | undefined | null,
  styles: any
): any {
  if (!styles || typeof styles !== "object") return styles
  const keys = Object.keys(styles)
  if (keys.length !== 1 || keys[0] !== "0") return styles
  if (!text || !text.includes("\n")) return styles
  const flat = styles["0"]
  if (!flat || typeof flat !== "object") return styles
  const lines = String(text).split("\n")
  const firstLineLen = lines[0].length
  const charKeys = Object.keys(flat).map(k => Number(k)).filter(Number.isFinite)
  const hasBeyondFirstLine = charKeys.some(k => k >= firstLineLen)
  if (!hasBeyondFirstLine) return styles
  const result: Record<number, Record<number, any>> = {}
  for (const k of charKeys) {
    let acc = 0
    for (let i = 0; i < lines.length; i++) {
      const lineLen = lines[i].length
      if (k < acc + lineLen) {
        if (!result[i]) result[i] = {}
        result[i][k - acc] = flat[k]
        break
      }
      acc += lineLen + 1
      if (i === lines.length - 1) {
        if (!result[i]) result[i] = {}
        result[i][Math.max(0, k - (acc - 1))] = flat[k]
      }
    }
  }
  return result
}

// Inverso: converte TextSpan[] em props para criar Textbox + styles per-char
export function spansToTextboxData(spans: TextSpan[]) {
  if (!spans.length) return { text: "", styles: {}, defaultStyle: {} }
  const fullText = spans.map(s => s.text).join("")
  const defaultStyle = spans[0].style ?? {}
  const styles: Record<number, Record<number, any>> = {}

  let charIdx = 0
  let lineNum = 0
  let col = 0
  for (const span of spans) {
    const sStyle = span.style ?? {}
    for (const ch of span.text) {
      if (ch === "\n") {
        lineNum++
        col = 0
        charIdx++
        continue
      }
      const styleKey = JSON.stringify(sStyle)
      const defaultKey = JSON.stringify(defaultStyle)
      if (styleKey !== defaultKey) {
        if (!styles[lineNum]) styles[lineNum] = {}
        styles[lineNum][col] = {
          fill: sStyle.color,
          fontSize: sStyle.fontSize,
          fontWeight: sStyle.fontWeight,
          fontFamily: sStyle.fontFamily,
        }
      }
      col++
      charIdx++
    }
  }
  return { text: fullText, styles, defaultStyle }
}

/**
 * FONTE UNICA DE VERDADE pra serializar overrides de TEXT layer.
 *
 * Antes esta logica vivia DUPLICADA em 6 sites diferentes (saveNow PECA,
 * saveNow MATRIZ, doSaveNow PECA, doSaveNow MATRIZ, step serialize, KV export).
 * Cada vez que adicionavamos uma prop nova (per-char styles, fillBrandIdx,
 * charSpacing, etc) atualizavamos 1-2 sites e esqueciamos o resto.
 *
 * Esta helper centraliza. Todos os save/export paths agora chamam aqui.
 * Adicionar prop nova = 1 lugar, propaga automaticamente.
 *
 * @param o objeto Fabric textbox/i-text
 * @param opts.preserveExplicitNewlinesOnly  Se true, so seta overrides.text
 *        quando o texto tem \n explicito (PECA save: caracteres vem do asset,
 *        apenas quebras locais via Enter persistem). Se false, sempre seta
 *        overrides.text (MATRIZ/KV export: texto live e fonte da verdade).
 */
export function serializeTextboxOverrides(
  o: any,
  opts: { preserveExplicitNewlinesOnly?: boolean } = {},
): Record<string, any> {
  const ov: Record<string, any> = {}
  const text = typeof o.text === "string" ? o.text : ""
  if (opts.preserveExplicitNewlinesOnly) {
    if (text.includes("\n")) ov.text = text
  } else {
    ov.text = text
    ov.content = text
  }
  if (o.fill !== undefined) ov.fill = o.fill
  if (typeof o.__fillBrandIdx === "number") ov.fillBrandIdx = o.__fillBrandIdx
  if (o.fontSize !== undefined) ov.fontSize = o.fontSize
  if (o.fontFamily !== undefined) ov.fontFamily = o.fontFamily
  if (o.fontWeight !== undefined) ov.fontWeight = o.fontWeight
  if (o.fontStyle && o.fontStyle !== "normal") ov.fontStyle = o.fontStyle
  if (o.charSpacing !== undefined) ov.charSpacing = o.charSpacing
  if (o.lineHeight !== undefined) ov.lineHeight = o.lineHeight
  if (o.textAlign !== undefined) ov.textAlign = o.textAlign
  if (o.leadingPt !== undefined && o.leadingPt !== null) ov.leadingPt = o.leadingPt
  if (o.styles && Object.keys(o.styles).length > 0) ov.styles = o.styles
  if (o.__dsLinked === false) ov.dsLinked = false
  // Width fixa: persiste flag indicando que o user (ou PSD box text) escolheu
  // uma largura especifica. Sem isso, ao re-abrir a peca, addAssetToCanvas
  // trata como point text e o auto-fit shrink colapsa o width pra natural
  // content width — perdendo o wrap escolhido. Bug grave reportado 2026-05-25.
  if (o.__userResizedWidth) ov.userResizedWidth = true
  if (typeof o.width === "number") ov.width = o.width
  return ov
}
