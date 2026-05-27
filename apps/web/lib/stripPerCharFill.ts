// Helper anti-falhas: limpa per-char fill REDUNDANTE (= igual ao layer fill).
//
// IMPORTANTE 2026-05-26 REVISTO: versao anterior strippava TODOS per-char
// quando overrides.fill setado. Quebrava feature legitima de "Olá branco +
// Mundo amarelo" (per-char com cor DIFERENTE do layer — intencional).
//
// Versao smart: so remove per-char fill QUANDO bate exatamente com o layer
// fill — preservando casos onde user pintou chars com cor diferente.
//
// Bug que ainda eh protegido contra: estado legado onde overrides.styles tem
// per-char fill IDENTICO a overrides.fill (redundante, ocupando bytes sem
// efeito visual). Strip aqui limpa.
//
// Per-char legitimo (diferente do layer) permanece — Fabric renderiza
// charFills > layer fill conforme regra ZZOSY 2.8.

export interface OverridesLike {
  fill?: string
  fillBrandIdx?: number | null
  styles?: Record<string, Record<string, any>> | null | undefined
  // Outros campos preservados intactos.
  [k: string]: any
}

function normHex(c: unknown): string {
  if (typeof c !== "string") return ""
  return c.trim().toLowerCase()
}

/**
 * Retorna copia das overrides com per-char fill/fillBrandIdx REDUNDANTES
 * removidos (= igual ao layer fill). Per-char DIFERENTES (= user editou chars
 * especificos com outra cor) sao PRESERVADOS.
 *
 * Se overrides.fill nao esta setado, retorna overrides como veio.
 *
 * Per-char redundante eh comum em estado LEGADO: PSD import setava per-char
 * pra cada char com cor do default, e quando user mudou layer fill no editor,
 * applyStyle "fill" strippa per-char do OBJ atual mas estado serializado
 * antigo ainda tem o residuo. Aqui limpa sem mexer no legitimo.
 */
export function stripPerCharFillWhenLayerSet<T extends OverridesLike>(overrides: T): T {
  if (!overrides) return overrides
  const layerFill = normHex(overrides.fill)
  const layerBrandIdx = typeof overrides.fillBrandIdx === "number" ? overrides.fillBrandIdx : null
  // Sem layer fill nem brandIdx: nada pra comparar — per-char eh a unica fonte.
  if (!layerFill && layerBrandIdx === null) return overrides
  if (!overrides.styles || typeof overrides.styles !== "object") return overrides

  // Detecta per-char fill REDUNDANTE (igual ao layer) — alvo do strip.
  // Per-char com cor diferente do layer fill = preservar (legitimo user-edit).
  let hasRedundant = false
  outer: for (const lineKey of Object.keys(overrides.styles)) {
    const line = overrides.styles[lineKey]
    if (!line || typeof line !== "object") continue
    for (const colKey of Object.keys(line)) {
      const cs = line[colKey]
      if (!cs || typeof cs !== "object") continue
      const charFill = normHex(cs.fill)
      const charBrandIdx = typeof cs.fillBrandIdx === "number" ? cs.fillBrandIdx : null
      // Redundante se: char fill bate com layer fill OU char brandIdx bate.
      if ((layerFill && charFill && charFill === layerFill) ||
          (layerBrandIdx !== null && charBrandIdx === layerBrandIdx)) {
        hasRedundant = true
        break outer
      }
    }
  }
  if (!hasRedundant) return overrides

  // Clone com strip seletivo.
  const newStyles: Record<string, Record<string, any>> = {}
  for (const lineKey of Object.keys(overrides.styles)) {
    const line = overrides.styles[lineKey]
    if (!line || typeof line !== "object") continue
    const newLine: Record<string, any> = {}
    for (const colKey of Object.keys(line)) {
      const cs = line[colKey]
      if (!cs || typeof cs !== "object") continue
      const charFill = normHex(cs.fill)
      const charBrandIdx = typeof cs.fillBrandIdx === "number" ? cs.fillBrandIdx : null
      const isRedundant = (layerFill && charFill && charFill === layerFill) ||
                          (layerBrandIdx !== null && charBrandIdx === layerBrandIdx)
      if (isRedundant) {
        // Strip apenas fill/fillBrandIdx; preserva fontSize/etc per-char.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { fill: _f, fillBrandIdx: _fb, ...rest } = cs as any
        if (Object.keys(rest).length > 0) newLine[colKey] = rest
      } else {
        // Per-char com cor DIFERENTE — preserva intacto (user editou chars).
        newLine[colKey] = cs
      }
    }
    if (Object.keys(newLine).length > 0) newStyles[lineKey] = newLine
  }

  return {
    ...overrides,
    styles: Object.keys(newStyles).length > 0 ? newStyles : undefined,
  }
}
