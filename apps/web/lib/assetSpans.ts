// SINGLE SOURCE per-char (CORE 1/5 — 2026-05-28)
//
// asset.content é a FONTE ÚNICA de per-char styles do texto. Spans codificam:
//   - text: string (raw caracteres, inclusive \n)
//   - style: { color, fontSize, fontWeight, fontFamily, ... }
//
// Spans consecutivos com mesmo style agrupam em 1 span. Per-char real (cada
// char com style diferente) gera 1 span por char (ou poucos, agrupando iguais).
//
// Este modulo eh o UNICO local que converte entre spans <-> FabricStyles map.
// Antes essa conversao vivia espalhada em 4+ sites com regras divergentes.

export interface TextSpan {
  text: string
  style: any
}

export type FabricStyles = Record<number, Record<number, any>>

export function spansToText(spans: TextSpan[] | null | undefined): string {
  if (!Array.isArray(spans)) return ""
  return spans.map(s => s?.text ?? "").join("")
}

// defaultStyle = span SENTINELA com text="" e style=defaultStyle.
// Se o primeiro span tem text vazio, ele eh o sentinela.
// Senao, fallback: primeiro span (compat legacy).
//
// Sentinela permite per-char no primeiro char SEM contaminar o default
// (bug "primeiro char verde vira defaultStyle do textbox"). Build sempre
// cria sentinela quando per-char ocorre no inicio.
export function spansDefaultStyle(spans: TextSpan[] | null | undefined): any {
  if (!Array.isArray(spans) || spans.length === 0) return {}
  // Sentinela: span[0] com text=""
  if (spans[0]?.text === "" && spans[0]?.style) return spans[0].style
  // Heuristica: style mais comum entre os spans (cobre mais chars). Sem
  // isso, asset com "G verde + IO preto" pegaria spans[0]=G_verde como
  // default → IO sem override herdaria verde no canvas.
  const counts = new Map<string, { style: any; count: number }>()
  for (const s of spans) {
    const text = s?.text ?? ""
    if (text.length === 0) continue
    const key = JSON.stringify(s.style ?? {})
    const entry = counts.get(key)
    if (entry) entry.count += text.length
    else counts.set(key, { style: s.style ?? {}, count: text.length })
  }
  let bestStyle: any = spans[0]?.style ?? {}
  let bestCount = -1
  for (const e of counts.values()) {
    if (e.count > bestCount) { bestCount = e.count; bestStyle = e.style }
  }
  return bestStyle
}

// Converte spans em FabricStyles map {lineIdx:{colIdx:{...}}}.
// Cada char ganha entry IF seu style difere do defaultStyle (1o span).
// Iguais ao default ficam sem entry (Fabric herda do textbox-level).
export function spansToPerCharStyles(spans: TextSpan[] | null | undefined): FabricStyles {
  if (!Array.isArray(spans) || spans.length === 0) return {}
  const def = spansDefaultStyle(spans)
  const defKey = JSON.stringify(def)
  const result: FabricStyles = {}
  let line = 0
  let col = 0
  for (const span of spans) {
    const text: string = span?.text ?? ""
    const style: any = span?.style ?? def
    const styleKey = JSON.stringify(style)
    const isDefault = styleKey === defKey
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === "\n") {
        line++
        col = 0
        continue
      }
      if (!isDefault) {
        if (!result[line]) result[line] = {}
        result[line][col] = { ...style }
      }
      col++
    }
  }
  return result
}

// Constroi spans canonicos a partir de texto + defaultStyle + per-char map.
// Spans consecutivos com mesmo style sao agrupados (otimiza tamanho serializado).
//
// SENTINELA: spans[0] eh SEMPRE um span vazio { text: "", style: defaultStyle }.
// Isso garante que spansDefaultStyle() pega sempre o default correto, sem
// herdar do primeiro char com per-char (bug "G verde virava defaultStyle").
export function buildSpansFromPerChar(
  text: string,
  defaultStyle: any,
  perCharStyles?: FabricStyles | null,
): TextSpan[] {
  const def = defaultStyle ?? {}
  // Sempre comeca com sentinela.
  const result: TextSpan[] = [{ text: "", style: def }]
  if (!text) return result
  const defKey = JSON.stringify(def)
  let buf = ""
  let bufStyle: any = def
  let bufKey = defKey
  let line = 0
  let col = 0
  const flushBuf = () => {
    if (buf.length > 0) {
      result.push({ text: buf, style: bufStyle })
      buf = ""
    }
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "\n") {
      // \n eh tratado como char "default" — append no buf atual.
      buf += ch
      line++
      col = 0
      continue
    }
    const charStyle = perCharStyles?.[line]?.[col]
    const effectiveStyle = charStyle ? { ...def, ...charStyle } : def
    const effectiveKey = JSON.stringify(effectiveStyle)
    if (effectiveKey === bufKey) {
      buf += ch
    } else {
      flushBuf()
      buf = ch
      bufStyle = effectiveStyle
      bufKey = effectiveKey
    }
    col++
  }
  flushBuf()
  return result
}

// Extrai per-char map COMPLETO de spans (sem skip do default). Util pra
// migrateStyles que precisa do map total pra fazer diff.
// Sentinela inicial (span[0] com text vazio) eh ignorado.
export function spansToFullPerChar(spans: TextSpan[] | null | undefined): FabricStyles {
  if (!Array.isArray(spans) || spans.length === 0) return {}
  const result: FabricStyles = {}
  let line = 0
  let col = 0
  for (let s = 0; s < spans.length; s++) {
    const span = spans[s]
    const text: string = span?.text ?? ""
    // Skip sentinela: span[0] text vazio = defaultStyle holder, nao per-char.
    if (text.length === 0) continue
    const style: any = span?.style ?? {}
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === "\n") {
        line++
        col = 0
        continue
      }
      if (!result[line]) result[line] = {}
      result[line][col] = { ...style }
      col++
    }
  }
  return result
}
