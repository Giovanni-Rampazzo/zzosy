/**
 * psdHelpers — utilidades compartilhadas entre os 2 caminhos de export PSD
 * (legacy `lib/exportPiece.ts` e V2 `lib/psd/writer.ts`).
 *
 * Centralizar evita o anti-padrao "fix em 1 spot, esquece o outro" que causou
 * varios bugs reportados como pontuais (perdia per-char color em um caminho,
 * crash de UnitsValue no outro, etc).
 */

// ────────────────────────────────────────────────────────────────────
// ag-psd UnitsValue
// ────────────────────────────────────────────────────────────────────

/**
 * Wrap numero como ag-psd UnitsValue `{value, units}`. Obrigatorio em campos
 * tipo distance/size/choke de effects, lineWidth de vectorStroke, e
 * keyOrigin* de vectorOrigination — passar numero cru gera o erro
 * "Invalid value: N (key: ...) (should have value and units)".
 */
export const psdPx = (n: number) => ({ value: n, units: "Pixels" as const })

/**
 * Extrai numero de um valor que pode vir como UnitsValue object ou number cru
 * (PSDs antigos do PS). Usado no reader.
 */
export function unwrapPsdUnits(v: any): number {
  if (v == null) return 0
  if (typeof v === "number") return v
  if (typeof v === "object" && typeof v.value === "number") return v.value
  return 0
}

// ────────────────────────────────────────────────────────────────────
// Color parsing
// ────────────────────────────────────────────────────────────────────

/**
 * Hex/rgba/rgb → ag-psd `{r, g, b}` 0-255.
 * Tolerante: aceita "#RRGGBB", "#RRGGBBAA", "rgb(...)", "rgba(...)".
 * Alpha eh IGNORADO — use `extractAlphaFromColor` separadamente.
 */
export function hexToAgPsdRgb(c: string): { r: number; g: number; b: number } {
  if (typeof c !== "string") return { r: 0, g: 0, b: 0 }
  const s = c.trim()
  const hex6 = /^#?([0-9a-fA-F]{6})$/.exec(s)
  if (hex6) {
    const n = parseInt(hex6[1], 16)
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
  }
  const hex8 = /^#?([0-9a-fA-F]{6})[0-9a-fA-F]{2}$/.exec(s)
  if (hex8) {
    const n = parseInt(hex8[1], 16)
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s)
  if (rgba) {
    return { r: parseInt(rgba[1], 10), g: parseInt(rgba[2], 10), b: parseInt(rgba[3], 10) }
  }
  return { r: 0, g: 0, b: 0 }
}

/**
 * Extrai alpha 0-1 de string de cor. "#RRGGBBAA" usa o ultimo byte,
 * "rgba(...)" usa o 4o componente. Default 1 (opaco).
 */
export function extractAlphaFromColor(c: string): number {
  if (typeof c !== "string") return 1
  const s = c.trim()
  const hex8 = /^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})$/.exec(s)
  if (hex8) return Math.round((parseInt(hex8[1], 16) / 255) * 1000) / 1000
  const rgba = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/i.exec(s)
  if (rgba) return Math.max(0, Math.min(1, parseFloat(rgba[1])))
  return 1
}

// ────────────────────────────────────────────────────────────────────
// Opacity / Blend mode mapping (Fabric canvas → PSD)
// ────────────────────────────────────────────────────────────────────

/**
 * Converte Fabric/canvas globalCompositeOperation → PSD blendMode string
 * (formato ag-psd: lowercase com espacos, ex. "color burn").
 * Retorna undefined quando "source-over" (default → omite no PSD).
 */
export function fabricBlendToPsd(bm: string | undefined): string | undefined {
  if (!bm || bm === "source-over") return undefined
  const m: Record<string, string> = {
    "multiply": "multiply",
    "screen": "screen",
    "overlay": "overlay",
    "darken": "darken",
    "lighten": "lighten",
    "color-dodge": "color dodge",
    "color-burn": "color burn",
    "hard-light": "hard light",
    "soft-light": "soft light",
    "difference": "difference",
    "exclusion": "exclusion",
    "hue": "hue",
    "saturation": "saturation",
    "color": "color",
    "luminosity": "luminosity",
    "lighter": "linear dodge",
  }
  return m[bm] ?? undefined
}

/**
 * Normaliza qualquer blend mode (canvas hifen, PSD camelCase, ag-psd com
 * espaco) → ag-psd string format ("linear dodge", "color burn", etc).
 *
 * Resolve bug confirmado 2026-05-22: effects.dropShadow.blendMode vinha
 * como "linearDodge" (camelCase do PsdBlendMode importado) e era passado
 * raw pro ag-psd writer que falhava com "Invalid value for enum: 'linearDodge'".
 *
 * Cobre TODOS os 27 blend modes oficiais do PS + fallback default.
 */
export function normalizeBlendModeForAgPsd(bm: string | undefined, fallback: string = "normal"): string {
  if (!bm) return fallback
  // Se ja tem espacos (formato ag-psd), retorna direto.
  if (bm.includes(" ")) return bm
  // PSD camelCase → ag-psd com espaco
  const psdCamel: Record<string, string> = {
    normal: "normal", dissolve: "dissolve", passThrough: "pass through",
    darken: "darken", multiply: "multiply",
    colorBurn: "color burn", linearBurn: "linear burn", darkerColor: "darker color",
    lighten: "lighten", screen: "screen",
    colorDodge: "color dodge", linearDodge: "linear dodge", lighterColor: "lighter color",
    overlay: "overlay", softLight: "soft light", hardLight: "hard light",
    vividLight: "vivid light", linearLight: "linear light", pinLight: "pin light", hardMix: "hard mix",
    difference: "difference", exclusion: "exclusion", subtract: "subtract", divide: "divide",
    hue: "hue", saturation: "saturation", color: "color", luminosity: "luminosity",
  }
  if (psdCamel[bm]) return psdCamel[bm]
  // Canvas com hifen
  const canvasHifen = fabricBlendToPsd(bm)
  if (canvasHifen) return canvasHifen
  return fallback
}

/**
 * Converte Fabric opacity (0-1) → ag-psd opacity byte (0-255).
 * Retorna undefined quando opaco (1.0) — ag-psd default.
 */
export function fabricOpacityToPsd(opacity: number | undefined): number | undefined {
  if (typeof opacity !== "number" || opacity >= 1) return undefined
  return Math.max(0, Math.min(255, Math.round(opacity * 255)))
}
