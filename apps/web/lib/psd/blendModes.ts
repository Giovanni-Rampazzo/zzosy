/**
 * blendModes — mapeamento Adobe-fiel dos 27 blend modes PSD pro canvas spec.
 *
 * Categorias:
 *  - NATIVE: globalCompositeOperation suporta diretamente, formula identica
 *  - APPROX: globalCompositeOperation tem mode similar mas formula DIVERGE
 *  - CUSTOM: nenhum suporte canvas, precisa pixel shader em offscreen canvas
 *
 * Pra modes APPROX/CUSTOM marcamos um warning no console e usamos o mais
 * proximo. Implementacao real via shader vem como work futuro.
 */
import type { PsdBlendMode } from "./types"

export interface BlendModeMapping {
  /** Modo equivalente em canvas spec (ou closest fallback). */
  canvas: GlobalCompositeOperation
  /** Categoria pra UI/logs. */
  fidelity: "native" | "approx" | "custom"
  /** Descricao da diferenca quando approx/custom. */
  note?: string
}

/**
 * Mapeamento completo. Roda em UMA funcao — fonte unica da verdade.
 *
 * Native (15): formula PSD = canvas. Pode-se confiar.
 * Approx (8): closest canvas mode, diferenca visivel em casos extremos.
 * Custom (4): nenhum canvas equivalente, precisa shader. Por ora cai num
 *             mode aproximado + warning.
 */
const TABLE: Record<PsdBlendMode, BlendModeMapping> = {
  // ── NATIVE ──
  normal:        { canvas: "source-over",  fidelity: "native" },
  multiply:      { canvas: "multiply",     fidelity: "native" },
  screen:        { canvas: "screen",       fidelity: "native" },
  overlay:       { canvas: "overlay",      fidelity: "native" },
  darken:        { canvas: "darken",       fidelity: "native" },
  lighten:       { canvas: "lighten",      fidelity: "native" },
  colorDodge:    { canvas: "color-dodge",  fidelity: "native" },
  colorBurn:     { canvas: "color-burn",   fidelity: "native" },
  hardLight:     { canvas: "hard-light",   fidelity: "native" },
  softLight:     { canvas: "soft-light",   fidelity: "native" },
  difference:    { canvas: "difference",   fidelity: "native" },
  exclusion:     { canvas: "exclusion",    fidelity: "native" },
  hue:           { canvas: "hue",          fidelity: "native" },
  saturation:    { canvas: "saturation",   fidelity: "native" },
  color:         { canvas: "color",        fidelity: "native" },
  luminosity:    { canvas: "luminosity",   fidelity: "native" },

  // Linear Dodge (Add) = lighter no canvas (additive). Adobe spec confirma.
  linearDodge:   { canvas: "lighter",      fidelity: "native" },

  // ── APPROX ──
  // Linear Burn = S + D - 1 (clamp). Canvas nao tem additive negativo.
  // Multiply eh o mais escuro disponivel mas formula difere.
  linearBurn:    { canvas: "multiply",     fidelity: "approx",
                   note: "Adobe linearBurn = S+D-1; usando multiply (formula diferente)" },

  // Darker Color compara LUMINANCIA, nao canais. canvas darken compara
  // por canal — diferenca visivel em colors complementares.
  darkerColor:   { canvas: "darken",       fidelity: "approx",
                   note: "Adobe darkerColor compara luminancia; canvas compara por canal" },

  lighterColor:  { canvas: "lighten",      fidelity: "approx",
                   note: "Adobe lighterColor compara luminancia; canvas compara por canal" },

  // Subtract = D - S. canvas difference faz |D - S|. Diferenca: subtract
  // pode dar valor negativo (clamp 0); difference sempre positivo.
  subtract:      { canvas: "difference",   fidelity: "approx",
                   note: "Adobe subtract = D-S clamped; difference = |D-S|" },

  // Divide = D / S. Sem equivalente canvas. screen eh aditivo, nao divisao.
  divide:        { canvas: "screen",       fidelity: "approx",
                   note: "Adobe divide = D/S; sem equivalente canvas" },

  // Vivid Light: combo colorBurn + colorDodge baseado em S<0.5 ou S>0.5.
  // overlay eh similar (soft contrast), mas formula divide.
  vividLight:    { canvas: "overlay",      fidelity: "approx",
                   note: "Adobe vividLight = colorBurn/colorDodge baseado em S" },

  linearLight:   { canvas: "overlay",      fidelity: "approx",
                   note: "Adobe linearLight = linearBurn/linearDodge baseado em S" },

  pinLight:      { canvas: "overlay",      fidelity: "approx",
                   note: "Adobe pinLight = darken/lighten baseado em S" },

  // ── CUSTOM (nenhum canvas equivalente proximo) ──
  // Hard Mix: threshold extremo, formula S+D >= 1 ? 1 : 0
  hardMix:       { canvas: "overlay",      fidelity: "custom",
                   note: "Adobe hardMix = threshold S+D>=1 ? 1 : 0; sem equivalente canvas" },

  // Dissolve: random pixel display. Estatistico, nao algoritmo de cor.
  dissolve:      { canvas: "source-over",  fidelity: "custom",
                   note: "Adobe dissolve = random dither; sem equivalente canvas" },

  // Pass Through: folder-only, ignora isolamento. canvas nao tem grupo.
  // Tratamos como source-over no nivel do layer.
  passThrough:   { canvas: "source-over",  fidelity: "custom",
                   note: "Adobe passThrough so existe em folders" },
}

/**
 * Resolve PsdBlendMode → GlobalCompositeOperation pro Fabric/Canvas.
 * Loga warning na PRIMEIRA vez que mode approx/custom eh usado.
 */
const warnedModes = new Set<PsdBlendMode>()

export function blendModeToCanvas(mode: PsdBlendMode): GlobalCompositeOperation {
  const entry = TABLE[mode] ?? TABLE.normal
  if (entry.fidelity !== "native" && !warnedModes.has(mode)) {
    warnedModes.add(mode)
    console.warn(`[psd-blend] '${mode}' (${entry.fidelity}) → canvas '${entry.canvas}'. ${entry.note ?? ""}`)
  }
  return entry.canvas
}

/** Util pra UI mostrar quais modes sao fieis vs aproximados. */
export function getBlendModeFidelity(mode: PsdBlendMode): "native" | "approx" | "custom" {
  return TABLE[mode]?.fidelity ?? "native"
}

/** Reset warning state (util pra testes). */
export function resetBlendWarnings(): void {
  warnedModes.clear()
}
