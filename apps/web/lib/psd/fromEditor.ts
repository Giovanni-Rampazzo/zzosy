/**
 * fromEditor.ts — Editor ZZOSY → PsdDocument
 *
 * Converte o estado salvo do editor (`piece.data.layers[]` + `assets[]`) num
 * `PsdDocument` puro que pode ser passado pro `writer.ts` pra produzir bytes
 * PSD com a arquitetura nova.
 *
 * Esta eh a peca que fecha o circuito: ZZOSY editor → modelo PSD → bytes PSD,
 * espelhando o pipeline inverso (bytes → reader → toCampaign).
 *
 * SCOPE INICIAL (Fase 7):
 *  - TEXT, IMAGE, SHAPE assets → respectivos PsdLayer
 *  - Smart Object preservado (assetSmartObject ref → PsdSmartObjectLayer com
 *    `content.kind="embedded"` apenas se o caller fornecer os bytes; senao
 *    cai pra layer image com placeholder)
 *  - Effects basicos (dropShadow, stroke) — mapeamento 1:1
 *  - Opacity/blendMode/visible/rotation
 *
 * FORA DE SCOPE (futuras fases):
 *  - Adjustment layers (PSDs gerados pelo editor nao tem)
 *  - Group/folder hierarquia (editor eh flat por design)
 *  - Mascaras avancadas (clipping/vector) — editor nao gera essas hoje
 *  - Gradient/pattern fills (Fase 8)
 *
 * USO:
 *   const doc = buildPsdDocumentFromEditor({ pieceData, assets, width, height, dpi })
 *   await prepareImageDataAsync(doc)  // se houver IMAGE com dataUrl
 *   const { bytes } = writePsdDocument(doc)
 */

import type {
  PsdDocument,
  PsdLayer,
  PsdTextLayer,
  PsdImageLayer,
  PsdShapeLayer,
  PsdSmartObjectLayer,
  PsdBBox,
  PsdBlendMode,
  PsdLayerEffects,
  PsdTransform2D,
  PsdImageData,
  PsdMaskData,
} from "./types"
import { IDENTITY_TRANSFORM } from "./types"

// ────────────────────────────────────────────────────────────────────
// Input shape
// ────────────────────────────────────────────────────────────────────

export interface EditorBuildInput {
  /** Dimensoes do canvas final. */
  width: number
  height: number
  /** DPI da peca (default 72). */
  dpi?: number
  /** Layers do editor (piece.data.layers[]). */
  layers: EditorLayer[]
  /** Assets referenciados. */
  assets: EditorAsset[]
}

export interface EditorLayer {
  assetId: string
  posX: number
  posY: number
  scaleX?: number
  scaleY?: number
  rotation?: number // graus
  width?: number
  height?: number
  zIndex?: number
  hidden?: boolean
  opacity?: number // 0-1
  blendMode?: string // canvas globalCompositeOperation OR psd mode name
  effects?: EditorEffects | null
  overrides?: Record<string, any>
}

export interface EditorEffects {
  dropShadow?: { color?: string; offsetX?: number; offsetY?: number; blur?: number; opacity?: number } | null
  outerGlow?: { color?: string; blur?: number; opacity?: number } | null
  stroke?: { color?: string; width?: number } | null
  colorOverlay?: { color?: string; opacity?: number } | null
}

export interface EditorAsset {
  id: string
  type: string // TEXT | IMAGE | SHAPE | SMART_OBJECT
  label: string
  value?: string | null
  imageUrl?: string | null
  content?: any
  smartObject?: {
    guid: string
    width: number | null
    height: number | null
    /** Bytes opcional — se fornecido, vira embedded; senao linked filePath. */
    bytes?: Uint8Array
    filePath?: string
    format?: "psb" | "psd" | "png" | "jpg" | "pdf" | "ai" | "unknown"
  } | null
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

export function buildPsdDocumentFromEditor(input: EditorBuildInput): PsdDocument {
  const { width, height, dpi = 72, layers, assets } = input
  const assetById = new Map<string, EditorAsset>()
  for (const a of assets) assetById.set(a.id, a)

  // Editor armazena zIndex top-first ou index-based; PSD quer bottom→top.
  // Ordena ascending por zIndex (mesma convencao que buildPieceCanvas).
  const sorted = [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

  const psdLayers: PsdLayer[] = []
  for (const l of sorted) {
    const asset = assetById.get(l.assetId)
    if (!asset) continue
    const built = buildLayer(l, asset)
    if (built) psdLayers.push(built)
  }

  return {
    width,
    height,
    dpi,
    bitDepth: 8,
    colorMode: "rgb",
    composite: null,
    layers: psdLayers,
    metadata: {
      createdAt: new Date().toISOString(),
    },
  }
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

function buildLayer(l: EditorLayer, asset: EditorAsset): PsdLayer | null {
  const t = asset.type?.toUpperCase()
  switch (t) {
    case "TEXT":
      return buildTextLayer(l, asset)
    case "IMAGE":
      return buildImageLayer(l, asset)
    case "SHAPE":
      return buildShapeLayer(l, asset)
    case "SMART_OBJECT":
      return buildSmartObjectLayer(l, asset)
    default:
      // Fallback: trata como IMAGE se tiver imageUrl, senao ignora.
      if (asset.imageUrl) return buildImageLayer(l, asset)
      return null
  }
}

function buildTextLayer(l: EditorLayer, asset: EditorAsset): PsdTextLayer {
  const overrides = l.overrides ?? {}
  const spans: any[] = parseContent(asset.content)
  const def = spans[0]?.style ?? {}
  const rawText = spans.length ? spans.map(s => s.text).join("") : (asset.value ?? asset.label ?? "")
  const text: string = (typeof overrides.text === "string" && overrides.text.length > 0)
    ? overrides.text
    : rawText

  const fontFamily = overrides.fontFamily ?? def.fontFamily ?? "Arial"
  const fontSize = overrides.fontSize ?? def.fontSize ?? 48
  const fontWeight = normalizeFontWeight(overrides.fontWeight ?? def.fontWeight ?? 400)
  const color = overrides.fill ?? def.color ?? "#000000"
  const align = (overrides.textAlign ?? "left") as "left" | "center" | "right" | "justify"
  const tracking = overrides.charSpacing ?? 0
  const leadingPt = overrides.leadingPt
  const leading = typeof leadingPt === "number" ? leadingPt : undefined

  const bbox = computeBBox(l)
  // styleRuns: se spans tem mais de um, materializa.
  const styleRuns = buildStyleRunsFromSpans(spans, def)
    // override.styles tem prioridade (per-char map salvo na peca)
    .concat(buildStyleRunsFromStylesMap(overrides.styles))

  return {
    type: "text",
    id: l.assetId,
    name: asset.label || "Text",
    bbox,
    visible: !l.hidden,
    opacity: clamp01(l.opacity ?? 1),
    blendMode: mapBlendMode(l.blendMode),
    mask: null,
    effects: buildEffects(l.effects),
    locked: false,
    groupPath: [],
    clipping: false,
    text,
    defaultStyle: {
      fontFamily,
      fontWeight,
      fontStyle: "normal",
      fontSize,
      color,
      tracking,
      leading,
    },
    styleRuns,
    paragraph: { align },
    transform: rotationToTransform(bbox, l.rotation ?? 0),
  }
}

function buildImageLayer(l: EditorLayer, asset: EditorAsset): PsdImageLayer {
  const bbox = computeBBox(l)
  const imageData: PsdImageData = {
    data: asset.imageUrl ?? "",
    width: Math.max(1, Math.round(bbox.right - bbox.left)),
    height: Math.max(1, Math.round(bbox.bottom - bbox.top)),
    format: "dataUrl",
  }
  return {
    type: "image",
    id: l.assetId,
    name: asset.label || "Image",
    bbox,
    visible: !l.hidden,
    opacity: clamp01(l.opacity ?? 1),
    blendMode: mapBlendMode(l.blendMode),
    mask: null,
    effects: buildEffects(l.effects),
    locked: false,
    groupPath: [],
    clipping: false,
    imageData,
    pixelsIncludeEffects: false,
  }
}

function buildShapeLayer(l: EditorLayer, asset: EditorAsset): PsdShapeLayer {
  const bbox = computeBBox(l)
  // SHAPE asset content = JSON { path, pathBbox, fill, stroke, fillRule }
  const content = parseShapeContent(asset.content)
  return {
    type: "shape",
    id: l.assetId,
    name: asset.label || "Shape",
    bbox,
    visible: !l.hidden,
    opacity: clamp01(l.opacity ?? 1),
    blendMode: mapBlendMode(l.blendMode),
    mask: null,
    effects: buildEffects(l.effects),
    locked: false,
    groupPath: [],
    clipping: false,
    path: content.path,
    pathBbox: content.pathBbox ?? bbox,
    fill: content.fill ?? { kind: "solid", color: "#000000" },
    stroke: content.stroke ?? null,
    fillRule: content.fillRule ?? "nonzero",
  }
}

function buildSmartObjectLayer(l: EditorLayer, asset: EditorAsset): PsdSmartObjectLayer {
  const bbox = computeBBox(l)
  const so = asset.smartObject
  let content: PsdSmartObjectLayer["content"]
  if (so?.bytes && so.bytes.length > 0) {
    content = { kind: "embedded", format: so.format ?? "unknown", bytes: so.bytes }
  } else if (so?.filePath) {
    content = { kind: "linked", filePath: so.filePath }
  } else {
    content = { kind: "unknown" }
  }
  return {
    type: "smartObject",
    id: so?.guid ?? l.assetId,
    name: asset.label || "Smart Object",
    bbox,
    visible: !l.hidden,
    opacity: clamp01(l.opacity ?? 1),
    blendMode: mapBlendMode(l.blendMode),
    mask: null,
    effects: buildEffects(l.effects),
    locked: false,
    groupPath: [],
    clipping: false,
    content,
    transform: rotationToTransform(bbox, l.rotation ?? 0),
    composite: null,
    isWrapper: false,
  }
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function computeBBox(l: EditorLayer): PsdBBox {
  const sx = l.scaleX ?? 1
  const sy = l.scaleY ?? 1
  const w = (l.width ?? 100) * sx
  const h = (l.height ?? l.width ?? 100) * sy
  return {
    left: l.posX,
    top: l.posY,
    right: l.posX + w,
    bottom: l.posY + h,
  }
}

function rotationToTransform(bbox: PsdBBox, rotationDeg: number): PsdTransform2D {
  if (Math.abs(rotationDeg) < 0.01) return IDENTITY_TRANSFORM
  const cx = (bbox.left + bbox.right) / 2
  const cy = (bbox.top + bbox.bottom) / 2
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  function rot(px: number, py: number): [number, number] {
    const dx = px - cx, dy = py - cy
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
  }
  const [tlX, tlY] = rot(bbox.left, bbox.top)
  const [trX, trY] = rot(bbox.right, bbox.top)
  const [brX, brY] = rot(bbox.right, bbox.bottom)
  const [blX, blY] = rot(bbox.left, bbox.bottom)
  return { corners: [tlX, tlY, trX, trY, brX, brY, blX, blY] }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(0, Math.min(1, n))
}

function normalizeFontWeight(w: any): number {
  if (typeof w === "number") return Math.max(100, Math.min(900, Math.round(w / 100) * 100))
  if (typeof w === "string") {
    const lower = w.toLowerCase()
    if (lower === "bold") return 700
    if (lower === "normal") return 400
    const n = parseInt(lower, 10)
    if (Number.isFinite(n)) return Math.max(100, Math.min(900, Math.round(n / 100) * 100))
  }
  return 400
}

function parseContent(raw: any): any[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

function parseShapeContent(raw: any): {
  path: string
  pathBbox?: PsdBBox
  fill?: PsdShapeLayer["fill"]
  stroke?: PsdShapeLayer["stroke"]
  fillRule?: "nonzero" | "evenodd"
} {
  if (!raw) return { path: "" }
  let parsed: any = raw
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw) } catch { return { path: "" } }
  }
  return {
    path: parsed.path ?? "",
    pathBbox: parsed.pathBbox,
    fill: parsed.fill,
    stroke: parsed.stroke,
    fillRule: parsed.fillRule,
  }
}

function buildStyleRunsFromSpans(spans: any[], def: any): { start: number; length: number; style: any }[] {
  if (!Array.isArray(spans) || spans.length < 2) return []
  const out: { start: number; length: number; style: any }[] = []
  const defKey = JSON.stringify(def ?? {})
  let cursor = 0
  for (const s of spans) {
    const text: string = s.text ?? ""
    const sKey = JSON.stringify(s.style ?? {})
    if (sKey !== defKey && text.length > 0) {
      out.push({
        start: cursor,
        length: text.length,
        style: {
          fontFamily: s.style?.fontFamily,
          fontWeight: normalizeFontWeight(s.style?.fontWeight),
          fontSize: s.style?.fontSize,
          color: s.style?.color,
        },
      })
    }
    cursor += text.length
  }
  return out
}

function buildStyleRunsFromStylesMap(styles: any): { start: number; length: number; style: any }[] {
  // overrides.styles eh um Fabric per-char map { lineIdx: { charIdx: style } }.
  // Conversao linear-cursor exige conhecer o texto — pra Fase 7 deixamos
  // como TODO e privilegiamos spans (que ja vem normalizados do importer).
  if (!styles) return []
  return []
}

function buildEffects(e: EditorEffects | null | undefined): PsdLayerEffects {
  const out: PsdLayerEffects = {}
  if (!e) return out
  if (e.dropShadow) {
    const d = e.dropShadow
    const offsetX = d.offsetX ?? 0
    const offsetY = d.offsetY ?? 0
    const distance = Math.hypot(offsetX, offsetY)
    const angle = (Math.atan2(offsetY, offsetX) * 180) / Math.PI
    out.dropShadow = {
      enabled: true,
      color: d.color ?? "#000000",
      opacity: clamp01(d.opacity ?? 0.5),
      angle,
      distance,
      blur: d.blur ?? 5,
      spread: 0,
      blendMode: "multiply",
    }
  }
  if (e.outerGlow) {
    const g = e.outerGlow
    out.outerGlow = {
      enabled: true,
      color: g.color ?? "#ffffff",
      opacity: clamp01(g.opacity ?? 0.6),
      blur: g.blur ?? 10,
      spread: 0,
      blendMode: "screen",
    }
  }
  if (e.stroke) {
    out.stroke = {
      enabled: true,
      width: e.stroke.width ?? 1,
      position: "outside",
      fill: { kind: "solid", color: e.stroke.color ?? "#000000" },
      blendMode: "normal",
      opacity: 1,
    }
  }
  if (e.colorOverlay) {
    out.colorOverlay = {
      enabled: true,
      color: e.colorOverlay.color ?? "#000000",
      opacity: clamp01(e.colorOverlay.opacity ?? 1),
      blendMode: "normal",
    }
  }
  return out
}

const BLEND_MODE_ALIASES: Record<string, PsdBlendMode> = {
  "source-over": "normal",
  "normal": "normal",
  "multiply": "multiply",
  "screen": "screen",
  "overlay": "overlay",
  "darken": "darken",
  "lighten": "lighten",
  "color-dodge": "colorDodge",
  "colorDodge": "colorDodge",
  "color-burn": "colorBurn",
  "colorBurn": "colorBurn",
  "hard-light": "hardLight",
  "hardLight": "hardLight",
  "soft-light": "softLight",
  "softLight": "softLight",
  "difference": "difference",
  "exclusion": "exclusion",
  "hue": "hue",
  "saturation": "saturation",
  "color": "color",
  "luminosity": "luminosity",
}

function mapBlendMode(mode: string | undefined): PsdBlendMode {
  if (!mode) return "normal"
  return BLEND_MODE_ALIASES[mode] ?? "normal"
}
