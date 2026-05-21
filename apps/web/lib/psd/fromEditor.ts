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
  /**
   * Background layers (schema BG-7 do editor): solid/gradient/image.
   * Quando presente, eh rasterizado pra um canvas e adicionado como
   * PsdImageLayer "Background" no fundo (zIndex=-Infinity).
   * Skip se for so um bg solid #ffffff puro (default, nao precisa exportar).
   */
  bgLayers?: BgLayer[]
}

export type BgLayer =
  | { kind: "solid"; color: string; opacity?: number; blendMode?: string }
  | { kind: "gradient"; gradientType?: "linear" | "radial"; angle?: number; stops: { offset: number; color: string }[]; opacity?: number; blendMode?: string }
  | { kind: "image"; imageDataUrl: string; fit?: "cover" | "contain" | "fill" | "tile"; opacity?: number; blendMode?: string }

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
  const { width, height, dpi = 72, layers, assets, bgLayers } = input
  const assetById = new Map<string, EditorAsset>()
  for (const a of assets) assetById.set(a.id, a)

  // Editor armazena zIndex top-first ou index-based; PSD quer bottom→top.
  // Ordena ascending por zIndex (mesma convencao que buildPieceCanvas).
  const sorted = [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

  const psdLayers: PsdLayer[] = []
  // Background layer (BG-7 schema): rasteriza bgLayers num canvas e adiciona
  // como image layer "Background" no fundo. Skip se for so um solid branco
  // (default, nao precisa virar layer dedicada).
  const bg = bgLayers && bgLayers.length > 0 ? buildBackgroundLayer(bgLayers, width, height) : null
  if (bg) psdLayers.push(bg)

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

function buildBackgroundLayer(bgLayers: BgLayer[], width: number, height: number): PsdImageLayer | null {
  // Skip white-solid default (sem opacity/blendMode custom).
  if (bgLayers.length === 1) {
    const b = bgLayers[0]
    if (b.kind === "solid" && (b.color === "#ffffff" || b.color === "#FFFFFF")
        && (b.opacity == null || b.opacity === 1)
        && (b.blendMode == null || b.blendMode === "source-over")) {
      return null
    }
  }
  // BG fica como pseudo-dataUrl com schema custom — renderBackgroundToDataUrl
  // roda em prepareImageDataAsync (browser). Server-side, fica como
  // placeholder vazio que sera resolvido depois.
  const placeholderUrl = `__zzosy-bg:${encodeURIComponent(JSON.stringify({ bgLayers, width, height }))}`
  const bbox = { left: 0, top: 0, right: width, bottom: height }
  return {
    type: "image",
    id: "__bg__",
    name: "Background",
    bbox,
    visible: true,
    opacity: 1,
    blendMode: "normal",
    mask: null,
    effects: {},
    locked: true,
    groupPath: [],
    clipping: false,
    imageData: {
      data: placeholderUrl,
      width,
      height,
      format: "dataUrl",
    },
    pixelsIncludeEffects: true,
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
  // styleRuns: combina spans (do asset) + per-char map (overrides.styles da peca).
  // Per-char map tem prioridade pra overlaps (overrides explicitos).
  const styleRuns = mergeStyleRuns(
    buildStyleRunsFromSpans(spans, def),
    buildStyleRunsFromCharMap(text, overrides.styles),
  )

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

/**
 * Converte o Fabric per-char styles map { lineIdx: { charIdx: style } } pro
 * formato PsdTextStyleRun[] do modelo canonical.
 *
 * Anatomia do Fabric map:
 *  - chave externa = indice da linha visual (split por \n)
 *  - chave interna = indice do char DENTRO da linha (sem contar o \n)
 *  - valor = { fill, fontSize, fontWeight, fontFamily, ... }
 *
 * Algoritmo:
 *  1. Walk char-by-char no texto raw, mantendo (lineIdx, colIdx, absIdx)
 *  2. Pra cada char, busca styles[lineIdx]?.[colIdx]
 *  3. Agrupa consecutivos com mesmo style em UM run
 *  4. Converte chaves Fabric → chaves PsdCharStyle (fill→color, etc)
 *
 * Chars sem entrada no map herdam de defaultStyle (sem run explicito).
 */
function buildStyleRunsFromCharMap(text: string, styles: any): { start: number; length: number; style: any }[] {
  if (!styles || typeof styles !== "object") return []
  const out: { start: number; length: number; style: any }[] = []
  let lineIdx = 0
  let colIdx = 0
  let runStart = -1
  let runKey: string | null = null
  let runStyle: any = null

  function flush(endAbs: number) {
    if (runStart < 0 || !runStyle) return
    out.push({ start: runStart, length: endAbs - runStart, style: runStyle })
    runStart = -1
    runKey = null
    runStyle = null
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "\n") {
      flush(i)
      lineIdx++
      colIdx = 0
      continue
    }
    const raw = styles[lineIdx]?.[colIdx]
    const norm = raw ? normalizeFabricStyle(raw) : null
    const key = norm ? JSON.stringify(norm) : ""
    if (key !== runKey) {
      flush(i)
      if (norm) {
        runStart = i
        runKey = key
        runStyle = norm
      }
    }
    colIdx++
  }
  flush(text.length)
  return out
}

function normalizeFabricStyle(s: any): any {
  if (!s || typeof s !== "object") return null
  const out: any = {}
  if (s.fill) out.color = s.fill
  if (s.fontFamily) out.fontFamily = s.fontFamily
  if (s.fontSize != null) out.fontSize = s.fontSize
  if (s.fontWeight != null) out.fontWeight = normalizeFontWeight(s.fontWeight)
  if (s.fontStyle === "italic") out.fontStyle = "italic"
  if (s.underline) out.underline = true
  if (s.linethrough || s.strikethrough) out.strikethrough = true
  if (s.charSpacing != null) out.tracking = s.charSpacing
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Merge dois sets de runs (spans + per-char map). Per-char map tem prioridade
 * pra overlaps porque vem de overrides explicitos da peca.
 */
function mergeStyleRuns(
  fromSpans: { start: number; length: number; style: any }[],
  fromCharMap: { start: number; length: number; style: any }[],
): { start: number; length: number; style: any }[] {
  if (fromCharMap.length === 0) return fromSpans
  if (fromSpans.length === 0) return fromCharMap
  // Per-char map sobrescreve regioes overlap; chars fora dele herdam dos spans.
  // Implementacao simples: mark intervals ocupados por char map, depois
  // adiciona spans nao overlap.
  const merged = [...fromCharMap]
  for (const run of fromSpans) {
    const overlaps = fromCharMap.some(c =>
      c.start < run.start + run.length && c.start + c.length > run.start
    )
    if (!overlaps) merged.push(run)
  }
  merged.sort((a, b) => a.start - b.start)
  return merged
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
