// BG SCHEMA UNIFICADO (CORE 3/5 — 2026-05-28)
//
// bgLayers eh FONTE CANONICA. bgColor/bgOpacity legacy sao DERIVADOS no
// save (back-compat com renderers antigos que ainda leem o root field),
// e NUNCA lidos diretamente como fonte de verdade.
//
// Antes: 8+ sites espalhados liam ora bgColor, ora bgLayers, sem ordem
// fixa. Sweep do bug 2026-05-28: panel mostrava rosa (bgColor legacy)
// canvas pintava verde (bgLayers atual). Drift sistemico.

export interface BgLayerData {
  kind: "solid" | "gradient" | "image"
  color?: string
  colorBrandIdx?: number
  opacity?: number
  hidden?: boolean
  locked?: boolean
  // gradient
  stops?: Array<{ offset: number; color: string }>
  gradientType?: "linear" | "radial"
  angle?: number
  // image
  imageDataUrl?: string
  fit?: "cover" | "contain" | "fill" | "tile"
  // blend
  blendMode?: string
}

const DEFAULT_BG: BgLayerData = { kind: "solid", color: "#ffffff", opacity: 1 }

/**
 * Le BG canonico de qualquer source (piece.data, step, kv.data).
 * Sempre retorna array com pelo menos 1 layer.
 *
 * Ordem de fallback:
 *   1. source.bgLayers (array novo schema)
 *   2. source.bgColor legacy → solid de 1 layer
 *   3. {#ffffff, opacity:1}
 */
export function bgFromAny(source: any): BgLayerData[] {
  if (!source) return [{ ...DEFAULT_BG }]
  if (Array.isArray(source.bgLayers) && source.bgLayers.length > 0) {
    return source.bgLayers.map(migrateBgLayerJson)
  }
  const color = typeof source.bgColor === "string" ? source.bgColor : "#ffffff"
  const opacity = typeof source.bgOpacity === "number" ? source.bgOpacity : 1
  return [{ kind: "solid", color, opacity }]
}

/**
 * Deriva bgColor + bgOpacity legacy de bgLayers[0]. Util pra persistir
 * compat com schema antigo. Para SOLID retorna a cor direta; para gradient
 * pega 1o stop; para image retorna branco.
 */
export function bgLegacyFields(layers: BgLayerData[] | null | undefined): { bgColor: string; bgOpacity: number } {
  if (!Array.isArray(layers) || layers.length === 0) {
    return { bgColor: "#ffffff", bgOpacity: 1 }
  }
  return {
    bgColor: bgLayerLegacyColor(layers[0]),
    bgOpacity: typeof layers[0].opacity === "number" ? layers[0].opacity : 1,
  }
}

export function bgLayerLegacyColor(l: BgLayerData | null | undefined): string {
  if (!l) return "#ffffff"
  if (l.kind === "solid" && typeof l.color === "string") return l.color
  if (l.kind === "gradient" && Array.isArray(l.stops) && l.stops[0]?.color) return l.stops[0].color
  return "#ffffff"
}

/**
 * Migra entry suja (vinda do banco/legacy) pra BgLayerData consistente.
 */
export function migrateBgLayerJson(raw: any): BgLayerData {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BG }
  const kind = raw.kind === "gradient" || raw.kind === "image" ? raw.kind : "solid"
  const out: BgLayerData = {
    kind,
    opacity: typeof raw.opacity === "number" ? raw.opacity : 1,
  }
  if (raw.hidden === true) out.hidden = true
  if (raw.locked === true) out.locked = true
  if (typeof raw.colorBrandIdx === "number") out.colorBrandIdx = raw.colorBrandIdx
  if (typeof raw.blendMode === "string") out.blendMode = raw.blendMode
  if (kind === "solid") {
    out.color = typeof raw.color === "string" ? raw.color : "#ffffff"
  } else if (kind === "gradient") {
    out.gradientType = raw.gradientType === "radial" ? "radial" : "linear"
    out.angle = typeof raw.angle === "number" ? raw.angle : 0
    out.stops = Array.isArray(raw.stops) && raw.stops.length > 0
      ? raw.stops.map((s: any) => ({
          offset: typeof s.offset === "number" ? s.offset : 0,
          color: typeof s.color === "string" ? s.color : "#ffffff",
        }))
      : [{ offset: 0, color: "#ffffff" }, { offset: 1, color: "#000000" }]
  } else if (kind === "image") {
    out.imageDataUrl = typeof raw.imageDataUrl === "string" ? raw.imageDataUrl : ""
    out.fit = raw.fit === "contain" || raw.fit === "fill" || raw.fit === "tile" ? raw.fit : "cover"
  }
  return out
}

/**
 * Empacota bgLayers PARA persistencia no banco junto dos campos legacy
 * derivados. Use no save:
 *   const { bgColor, bgOpacity, bgLayers } = packBgForSave(bgLayersRef.current)
 *   db.piece.update({ data: { ...other, bgColor, bgOpacity, bgLayers } })
 */
export function packBgForSave(layers: BgLayerData[]): { bgColor: string; bgOpacity: number; bgLayers: BgLayerData[] } {
  const legacy = bgLegacyFields(layers)
  return { ...legacy, bgLayers: layers }
}
