/**
 * Regra default ZZOSY pro width de Textbox: no maximo 30% mais largo que o
 * conteudo, e nunca alem da borda direita do artboard.
 *
 * Why: user reportou (2026-05-28) que textboxes estouravam muito a largura —
 * boxes carregadas com width do PSD bbox, ou apos auto-fit, ficavam bem mais
 * largas que o texto real. Tambem nao ha caso de uso pra textbox ultrapassar
 * a borda do canvas (peca). Resultado: handles longe, area clicavel inchada,
 * preview com box flutuando.
 *
 * Aplicado em: load inicial (addAssetToCanvas) + auto-fit em text:changed.
 * NAO aplicado em scaling manual do user (object:modified) — drag eh intent
 * explicito.
 */

interface ClampOpts {
  /** Quanto maior que o conteudo o textbox pode ser. 1.30 = +30%. */
  maxOverflowRatio?: number
  /** Padding adicionado ao minimo (longest line + padding) pra cursor caber. */
  padding?: number
}

/**
 * Calcula o width ideal pro textbox seguindo a regra. Retorna null se o width
 * atual ja esta dentro do limite (sem necessidade de mudar).
 *
 * `tb` precisa ter passado por `initDimensions` antes — `_textLines` e
 * `getLineWidth` sao internos do Fabric pos-medicao.
 */
export function computeTextboxMaxWidth(
  tb: any,
  artboardW: number,
  opts: ClampOpts = {},
): number | null {
  const maxOverflowRatio = opts.maxOverflowRatio ?? 1.30
  const padding = opts.padding ?? 4
  const lineCount = tb?._textLines?.length ?? 0
  if (lineCount === 0) return null

  let longestLineW = 0
  for (let i = 0; i < lineCount; i++) {
    const lw = typeof tb.getLineWidth === "function" ? tb.getLineWidth(i) : 0
    if (lw > longestLineW) longestLineW = lw
  }
  if (longestLineW <= 0) return null

  const sX = Math.max(0.0001, tb.scaleX ?? 1)
  const left = tb.left ?? 0
  const maxByRatio = longestLineW * maxOverflowRatio
  // Distancia ate a borda direita do artboard, em coordenadas do textbox
  // (dividido pelo scale porque tb.width eh pre-scale).
  const maxByCanvas = Math.max(0, (artboardW - left) / sX)
  // Minimo absoluto: longest line + padding. Abaixo disso a linha mais longa
  // wrappa indesejadamente.
  const minWidth = longestLineW + padding
  const targetMax = Math.max(minWidth, Math.min(maxByRatio, maxByCanvas))
  const currentW = tb.width ?? 0
  // Tolerancia 0.5px pra evitar set() em diffs subpixel insignificantes.
  if (currentW > targetMax + 0.5) return Math.ceil(targetMax)
  return null
}

/**
 * Aplica o clamp e re-roda initDimensions/setCoords se mudou.
 * Retorna true se aplicou.
 */
export function clampTextboxWidth(
  tb: any,
  artboardW: number,
  opts?: ClampOpts,
): boolean {
  const target = computeTextboxMaxWidth(tb, artboardW, opts)
  if (target === null) return false
  tb.set("width", target)
  if (typeof tb.initDimensions === "function") tb.initDimensions()
  if (typeof tb.setCoords === "function") tb.setCoords()
  return true
}
