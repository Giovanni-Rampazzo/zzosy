/**
 * psdReader — leitura PURA de PSDs.
 *
 * Recebe bytes do PSD, devolve PsdDocument tipado. ZERO rendering, ZERO
 * compositing. Apenas tradução do shape do ag-psd pra modelo Adobe-fiel do
 * ZZOSY (definido em types.ts).
 *
 * Princípios:
 *  - Determinístico: mesmo input ⇒ mesmo output
 *  - Sem efeitos colaterais: não muta layer.canvas, não baka nada
 *  - Falha explícita: features não cobertas viram warning no readResult, não
 *    fallback silencioso
 *  - Adobe-fiel: estruturas espelham o modelo do PS (clipping chain, masks,
 *    effects, blend modes) sem aproximação
 *
 * Esse módulo é a ÚNICA fronteira com ag-psd no novo pipeline. Quando ag-psd
 * tiver bug ou limitação, é aqui que documentamos + decidimos workaround.
 */
import { readPsd, initializeCanvas, type Psd, type Layer as AgPsdLayer } from "ag-psd"

// CRITICO (browser): sem initializeCanvas, ag-psd nao rasteriza layers —
// l.canvas fica null em IMAGE/SmartObject/Shape, toCampaign skipa com
// "empty-canvas" → assets sumindo silencioso (Rectangle 1-4, PA, PONTA
// VERDE, Vector Smart Objects). O PsdImporter legacy chamava isso (linha
// 1326); o pipeline novo esqueceu. Rodamos no module load — idempotente
// (ag-psd ignora chamadas subsequentes).
//
// SSR (node sem document) eh skipado; initializeCanvas eh client-only.
if (typeof document !== "undefined" && typeof initializeCanvas === "function") {
  // ag-psd v18: signature mudou. Apenas createCanvas eh obrigatorio; demais
  // (createCanvasFromData, createImageData) usam defaults DOM corretos.
  initializeCanvas((w: number, h: number) => {
    const c = document.createElement("canvas")
    c.width = w; c.height = h
    return c
  })
}
import { normalizePsdFontToGoogle, extractFontWeight } from "../google-fonts"
import type {
  PsdDocument,
  PsdLayer,
  PsdTextLayer,
  PsdImageLayer,
  PsdShapeLayer,
  PsdSmartObjectLayer,
  PsdGroupLayer,
  PsdAdjustmentLayer,
  PsdLayerEffects,
  PsdShadowEffect,
  PsdGlowEffect,
  PsdStrokeEffect,
  PsdColorOverlayEffect,
  PsdGradientOverlayEffect,
  PsdBlendMode,
  PsdMaskData,
  PsdTransform2D,
  PsdBBox,
  PsdImageData,
  PsdMetadata,
  PsdColorMode,
  PsdCharStyle,
  PsdParagraphStyle,
  PsdTextStyleRun,
  PsdGradient,
} from "./types"
import { IDENTITY_TRANSFORM } from "./types"

// ────────────────────────────────────────────────────────────────────
// API publica
// ────────────────────────────────────────────────────────────────────

export interface ReadResult {
  document: PsdDocument
  /** Warnings nao-fatais durante a leitura (features ignoradas, etc). */
  warnings: ReadWarning[]
}

export interface ReadWarning {
  kind: "ignored-adjustment" | "ignored-smart-filter" | "unknown-blend-mode" | "unknown-effect" | "decode-failed" | "out-of-scope"
  layerName: string
  message: string
  /** Detalhes raw pra debug. */
  raw?: Record<string, unknown>
}

export interface ReadOptions {
  /**
   * Se true, le e decodifica todos os canvas de layers (rasters + masks).
   * Default true. Use false pra inspect rapido de estrutura.
   */
  includeImageData?: boolean
  /**
   * Se true, le o composite final do PSD (psd.canvas). Default true.
   * Pra previews/thumbnails.
   */
  includeComposite?: boolean
  /**
   * Hook pra logar warnings em tempo real (alem do array retornado).
   */
  onWarning?: (w: ReadWarning) => void
}

/**
 * Le um PSD a partir de bytes e devolve PsdDocument + warnings.
 *
 * @example
 *   const buf = await file.arrayBuffer()
 *   const { document, warnings } = readPsdDocument(buf)
 *   warnings.forEach(w => console.warn(`[psd-reader] ${w.kind}: ${w.layerName}`))
 */
export function readPsdDocument(
  bytes: ArrayBuffer | Uint8Array,
  options: ReadOptions = {},
): ReadResult {
  const { includeImageData = true, includeComposite = true, onWarning } = options
  const warnings: ReadWarning[] = []
  const warn = (w: ReadWarning) => {
    warnings.push(w)
    onWarning?.(w)
  }

  const raw: Psd = readPsd(bytes as ArrayBuffer, {
    skipLayerImageData: !includeImageData,
    skipCompositeImageData: !includeComposite,
    skipThumbnail: true,
  })

  // Index linkedFiles por id pra resolver Smart Objects embedded.
  const linkedFilesById = new Map<string, any>()
  for (const lf of (raw.linkedFiles ?? [])) {
    if (lf?.id) linkedFilesById.set(lf.id, lf)
  }

  const document: PsdDocument = {
    width: raw.width ?? 0,
    height: raw.height ?? 0,
    dpi: raw.imageResources?.resolutionInfo?.horizontalResolution ?? 72,
    bitDepth: (raw.bitsPerChannel as 8 | 16 | 32) ?? 8,
    colorMode: mapColorMode(raw.colorMode, warn),
    composite: includeComposite ? canvasToImageData(raw.canvas) : null,
    layers: (raw.children ?? []).map((l, i) => readLayer(l, [], i, warn, linkedFilesById)),
    metadata: buildMetadata(raw),
  }

  return { document, warnings }
}

// ────────────────────────────────────────────────────────────────────
// Layer parsing — discriminated union
// ────────────────────────────────────────────────────────────────────

function readLayer(
  l: AgPsdLayer,
  parentPath: string[],
  index: number,
  warn: (w: ReadWarning) => void,
  linkedFiles: Map<string, any>,
): PsdLayer {
  // Folder: ag-psd entrega children[] no Layer
  if (Array.isArray(l.children) && l.children.length > 0) {
    return readGroup(l, parentPath, warn, linkedFiles)
  }
  // Adjustment Layer — fora de escopo, marca como warning + ignora visualmente
  if ((l as any).adjustment) {
    warn({
      kind: "ignored-adjustment",
      layerName: l.name ?? "<unnamed>",
      message: `Adjustment Layer '${(l as any).adjustment?.type ?? "unknown"}' ignorado. Aplique manualmente antes de salvar o PSD.`,
      raw: (l as any).adjustment,
    })
    return readAdjustment(l, parentPath)
  }
  // Text Layer
  if (l.text) {
    return readText(l, parentPath, warn)
  }
  // Smart Object Layer (placedLayer)
  if ((l as any).placedLayer) {
    return readSmartObject(l, parentPath, warn, linkedFiles)
  }
  // Shape Layer: tem vectorMask + vectorFill/vectorStroke
  if ((l as any).vectorMask?.paths?.length && ((l as any).vectorFill || (l as any).vectorStroke)) {
    return readShape(l, parentPath, warn)
  }
  return readImage(l, parentPath, warn)
}

// ── Group ────────────────────────────────────────────────────────────

function readGroup(l: AgPsdLayer, parentPath: string[], warn: (w: ReadWarning) => void, linkedFiles: Map<string, any>): PsdGroupLayer {
  const name = l.name ?? "<unnamed>"
  const childPath = [...parentPath, name]
  return {
    ...readCommon(l, parentPath),
    type: "group",
    children: (l.children ?? []).map((c, i) => readLayer(c, childPath, i, warn, linkedFiles)),
    passThrough: l.blendMode === "pass through",
  }
}

// ── Text ─────────────────────────────────────────────────────────────

function readText(l: AgPsdLayer, parentPath: string[], warn: (w: ReadWarning) => void): PsdTextLayer {
  const td = l.text!
  const rawText = (td.text ?? "").split("\r\n").join("\n").split("\r").join("\n")

  // Text transform (textScale do Free Transform). PSD guarda fontSize em
  // espaco PRE-transform: ex. designer escreve fonte 100pt, escala o frame
  // pra 18% via Free Transform → ag-psd entrega s.fontSize=100 mas o visual
  // eh 18pt. Sem aplicar textScale aqui, os textos sairiam ENORMES no editor
  // (caso "Seguro Viagem" relatado no PsdImporter legacy:206-211).
  //
  // td.transform eh matrix 6-num: [xx, xy, yx, yy, tx, ty]
  //   sx = hypot(xx, xy) — escala horizontal
  //   sy = hypot(yx, yy) — escala vertical
  // Usamos a media geometrica pra fontSize/leading (sao scalars).
  const tform: number[] | undefined = (td as any).transform
  let textScale = 1
  if (Array.isArray(tform) && tform.length >= 4) {
    const sx = Math.hypot(tform[0] ?? 1, tform[1] ?? 0)
    const sy = Math.hypot(tform[2] ?? 0, tform[3] ?? 1)
    const avg = (sx + sy) / 2
    if (Number.isFinite(avg) && avg > 0) textScale = avg
  }

  // mapCharStyle aplica textScale: fontSize × scale, leading × scale.
  // Tracking eh independent (em 1/1000 em) — nao escala.
  const defStyle: PsdCharStyle = mapCharStyle(td.style ?? {}, warn, l.name ?? "", textScale)
  const styleRuns: PsdTextStyleRun[] = (td.styleRuns ?? []).map((run: any) => ({
    start: 0, // calculado abaixo cumulativamente
    length: run.length ?? 0,
    style: mapCharStylePartial(run.style ?? {}, textScale),
  }))
  // Preenche `start` cumulativo
  let cursor = 0
  for (const r of styleRuns) { r.start = cursor; cursor += r.length }

  const paragraph: PsdParagraphStyle = {
    align: mapAlign(td.paragraphStyle?.justification),
    firstLineIndent: td.paragraphStyle?.firstLineIndent,
    spaceBefore: td.paragraphStyle?.spaceBefore,
    spaceAfter: td.paragraphStyle?.spaceAfter,
  }

  // transform fica como identity no modelo canonical — fontSize/leading
  // ja foram escalados acima. O transform raw nao eh mais necessario.
  const transform: PsdTransform2D = IDENTITY_TRANSFORM

  return {
    ...readCommon(l, parentPath),
    type: "text",
    text: rawText,
    styleRuns,
    defaultStyle: defStyle,
    paragraph,
    transform,
  }
}

// ── Image (raster) ───────────────────────────────────────────────────

function readImage(l: AgPsdLayer, parentPath: string[], warn: (w: ReadWarning) => void): PsdImageLayer {
  const imageData = canvasToImageData(l.canvas)
  return {
    ...readCommon(l, parentPath),
    type: "image",
    // Layers sem canvas decodificado viram empty image — pixelsIncludeEffects
    // continua true por convencao; renderer trata null/empty como warning.
    imageData: imageData ?? { data: "", width: 0, height: 0, format: "dataUrl" },
    pixelsIncludeEffects: true,
  }
}

// ── Smart Object ─────────────────────────────────────────────────────

function readSmartObject(
  l: AgPsdLayer,
  parentPath: string[],
  warn: (w: ReadWarning) => void,
  linkedFiles: Map<string, any>,
): PsdSmartObjectLayer {
  const placed = (l as any).placedLayer
  const xfm = placed?.transform
  const transform: PsdTransform2D = Array.isArray(xfm) && xfm.length === 8
    ? { corners: xfm as PsdTransform2D["corners"] }
    : IDENTITY_TRANSFORM

  // F12.9: resolve conteudo embedded via linkedFiles.id == placedLayer.id
  const content = resolveSmartObjectContent(placed, linkedFiles, warn, l.name ?? "")

  return {
    ...readCommon(l, parentPath),
    type: "smartObject",
    content,
    transform,
    composite: canvasToImageData(l.canvas),
    isWrapper: false, // postProcess.detectWrapperSmartObjects ajusta depois
  }
}

/**
 * Extrai o conteudo embedded de um Smart Object via lookup no linkedFiles
 * do PSD. PSDs profissionais quase sempre tem o asset embedded — apenas
 * Linked Smart Objects (raros) referenciam arquivo externo via path.
 */
function resolveSmartObjectContent(
  placed: any,
  linkedFiles: Map<string, any>,
  warn: (w: ReadWarning) => void,
  layerName: string,
): import("./types").PsdSmartObjectContent {
  if (!placed?.id) return { kind: "unknown" }
  const lf = linkedFiles.get(placed.id)
  if (!lf) {
    // PSD pode ter Smart Object referenciando linked externo (path no disco)
    // que nao foi embedded. Fica como "linked" + filePath placeholder.
    return { kind: "linked", filePath: placed.placed ?? "<unknown-link>" }
  }
  const bytes: Uint8Array | undefined = lf.data
  if (!bytes || bytes.length === 0) {
    warn({
      kind: "decode-failed",
      layerName,
      message: `Smart Object linked file '${lf.name ?? "?"}' presente mas SEM bytes. ag-psd nao expoe data — ignorando conteudo.`,
    })
    return { kind: "linked", filePath: lf.name ?? "<no-data>" }
  }
  // Detecta formato pelo nome ou pelo magic-bytes
  const format = detectSmartObjectFormat(lf.name ?? "", lf.type, bytes)
  return { kind: "embedded", format, bytes }
}

type EmbeddedFormat = "psb" | "psd" | "png" | "jpg" | "ai" | "pdf" | "unknown"
function detectSmartObjectFormat(
  name: string,
  type: string | undefined,
  bytes: Uint8Array,
): EmbeddedFormat {
  // Magic bytes primeiro (mais confiavel)
  if (bytes.length >= 4) {
    // PSD/PSB: "8BPS" (0x38425053)
    if (bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53) {
      // PSB tem version 2 no byte 4-5 (big-endian), PSD tem version 1
      const version = (bytes[4] << 8) | bytes[5]
      return version === 2 ? "psb" : "psd"
    }
    // PNG: 0x89504E47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "png"
    // JPEG: FFD8FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "jpg"
    // PDF: "%PDF"
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf"
  }
  // Fallback: extensao
  const lower = name.toLowerCase()
  if (lower.endsWith(".psb")) return "psb"
  if (lower.endsWith(".psd")) return "psd"
  if (lower.endsWith(".png")) return "png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg"
  if (lower.endsWith(".ai")) return "ai"
  if (lower.endsWith(".pdf")) return "pdf"
  // ag-psd `type` field se confiavel
  if (type === "pdfFile") return "pdf"
  if (type === "rasterImage") return "png" // chute conservador
  return "unknown"
}

// ── Shape ────────────────────────────────────────────────────────────

function readShape(l: AgPsdLayer, parentPath: string[], _warn: (w: ReadWarning) => void): PsdShapeLayer {
  const vm = (l as any).vectorMask
  const path = vm?.paths ? vectorMaskToBezierSvg(vm) : ""
  const pathBbox = computePathBbox(vm) ?? readCommon(l, parentPath).bbox

  // Vector fill: ag-psd expoe via layer.vectorFill { color | gradient | pattern }
  const vf = (l as any).vectorFill
  const fill = readVectorFill(vf)

  // Vector stroke: width/color/style/cap/join + lineAlignment
  const vs = (l as any).vectorStroke
  const stroke = readVectorStroke(vs)

  return {
    ...readCommon(l, parentPath),
    type: "shape",
    path,
    pathBbox,
    fill,
    stroke,
    fillRule: vm?.evenOdd === true ? "evenodd" : "nonzero",
  }
}

/**
 * Converte vectorMask.paths em string SVG path d="..." com curvas Bezier
 * cubicas reais. Cada knot tem 3 pontos:
 *   - cpL (control point in, antes do anchor)
 *   - anchor (ponto da curva)
 *   - cpR (control point out, depois do anchor)
 *
 * Bezier cubic entre knot K(i) → K(i+1) usa K(i).cpR + K(i+1).cpL + K(i+1).anchor.
 * Path fechado: ultima curva volta pro anchor[0] usando K(N).cpR + K(0).cpL.
 */
function vectorMaskToBezierSvg(vm: any): string {
  if (!vm?.paths) return ""
  const parts: string[] = []
  for (const p of vm.paths) {
    const d = bezierPathToSvg(p)
    if (d) parts.push(d)
  }
  return parts.join(" ")
}

interface BezierPt { cpL: { x: number; y: number }; anchor: { x: number; y: number }; cpR: { x: number; y: number } }

function bezierPathToSvg(path: any): string {
  const knots = path?.knots
  if (!Array.isArray(knots) || knots.length === 0) return ""
  const pts: BezierPt[] = []
  for (const k of knots) {
    const p = k?.points
    if (!Array.isArray(p) || p.length < 6) continue
    pts.push({
      cpL: { x: p[0], y: p[1] },
      anchor: { x: p[2], y: p[3] },
      cpR: { x: p[4], y: p[5] },
    })
  }
  if (pts.length === 0) return ""
  let d = `M ${pts[0].anchor.x.toFixed(2)} ${pts[0].anchor.y.toFixed(2)}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    d += ` C ${prev.cpR.x.toFixed(2)} ${prev.cpR.y.toFixed(2)}, ${cur.cpL.x.toFixed(2)} ${cur.cpL.y.toFixed(2)}, ${cur.anchor.x.toFixed(2)} ${cur.anchor.y.toFixed(2)}`
  }
  if (!path.open) {
    const last = pts[pts.length - 1]
    const first = pts[0]
    d += ` C ${last.cpR.x.toFixed(2)} ${last.cpR.y.toFixed(2)}, ${first.cpL.x.toFixed(2)} ${first.cpL.y.toFixed(2)}, ${first.anchor.x.toFixed(2)} ${first.anchor.y.toFixed(2)}`
    d += " Z"
  }
  return d
}

function computePathBbox(vm: any): import("./types").PsdBBox | null {
  if (!vm?.paths) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of vm.paths) {
    for (const k of (p.knots ?? [])) {
      const pts = k?.points
      if (Array.isArray(pts) && pts.length >= 4) {
        const ax = pts[2], ay = pts[3]
        if (ax < minX) minX = ax
        if (ay < minY) minY = ay
        if (ax > maxX) maxX = ax
        if (ay > maxY) maxY = ay
      }
    }
  }
  if (!isFinite(minX)) return null
  return { left: minX, top: minY, right: maxX, bottom: maxY }
}

function readVectorFill(vf: any): import("./types").PsdFill | null {
  if (!vf) return null
  // ag-psd expoe `{ type: "color" | "gradient" | "pattern", color?, gradient?, pattern? }`
  if (vf.type === "color" && vf.color) {
    return { kind: "solid", color: rgbToHex(vf.color) }
  }
  if (vf.type === "gradient" && vf.gradient) {
    // Reusa parser de gradient (mesma estrutura)
    const g = vf.gradient
    const kindMap: Record<string, import("./types").PsdGradient["kind"]> = {
      linear: "linear", radial: "radial", angle: "angle",
      reflected: "reflected", diamond: "diamond",
    }
    const stops = Array.isArray(g.stops) ? g.stops.map((s: any) => ({
      position: typeof s.location === "number" ? s.location : 0,
      color: rgbToHex(s.color),
      opacity: typeof s.opacity === "number" ? s.opacity : 1,
    })) : []
    return { kind: "gradient", gradient: { kind: kindMap[g.type] ?? "linear", stops } }
  }
  if (vf.type === "pattern") {
    // Pattern requer canvas pra rasterizar — Fase 5. Por ora retorna null.
    return null
  }
  // Fallback: solid black se layer reporta fill mas estrutura nao bate.
  return { kind: "solid", color: "#000000" }
}

function readVectorStroke(vs: any): import("./types").PsdStroke | null {
  if (!vs) return null
  if (vs.strokeEnabled === false) return null
  const width = typeof vs.lineWidth === "number" ? vs.lineWidth : 1
  const color = vs.color ? rgbToHex(vs.color) : "#000000"
  const positionMap: Record<string, "inside" | "center" | "outside"> = {
    "strokeStyleAlignInside": "inside",
    "strokeStyleAlignCenter": "center",
    "strokeStyleAlignOutside": "outside",
  }
  const capMap: Record<string, "butt" | "round" | "square"> = {
    "strokeStyleButtCap": "butt",
    "strokeStyleRoundCap": "round",
    "strokeStyleSquareCap": "square",
  }
  const joinMap: Record<string, "miter" | "round" | "bevel"> = {
    "strokeStyleMiterJoin": "miter",
    "strokeStyleRoundJoin": "round",
    "strokeStyleBevelJoin": "bevel",
  }
  return {
    width,
    color,
    position: positionMap[vs.lineAlignment] ?? "outside",
    cap: capMap[vs.lineCapType] ?? "butt",
    join: joinMap[vs.lineJoinType] ?? "miter",
    dash: Array.isArray(vs.lineDashSet) ? vs.lineDashSet : undefined,
  }
}

// ── Adjustment (out of scope — apenas stub pra TS) ───────────────────

function readAdjustment(l: AgPsdLayer, parentPath: string[]): PsdAdjustmentLayer {
  return {
    ...readCommon(l, parentPath),
    type: "adjustment",
    adjustment: { kind: "unknown", raw: ((l as any).adjustment ?? {}) as Record<string, unknown> },
  }
}

// ────────────────────────────────────────────────────────────────────
// Common fields shared por todos os layer types
// ────────────────────────────────────────────────────────────────────

function readCommon(l: AgPsdLayer, parentPath: string[]) {
  const left = l.left ?? 0
  const top = l.top ?? 0
  const right = l.right ?? left
  const bottom = l.bottom ?? top
  const bbox: PsdBBox = { left, top, right, bottom }
  return {
    id: String(l.id ?? `${parentPath.join("/")}/${l.name ?? "unnamed"}/${left}-${top}`),
    name: l.name ?? "<unnamed>",
    bbox,
    visible: l.hidden !== true,
    opacity: typeof l.opacity === "number" ? Math.max(0, Math.min(1, l.opacity)) : 1,
    blendMode: mapBlendMode(l.blendMode),
    mask: readMask(l),
    effects: readEffects(l),
    locked: (l as any).transparencyProtected === true,
    groupPath: parentPath,
    clipping: l.clipping === true,
  }
}

// ────────────────────────────────────────────────────────────────────
// Mask
// ────────────────────────────────────────────────────────────────────

function readMask(l: AgPsdLayer): PsdMaskData | null {
  // Raster mask
  if (l.mask?.canvas) {
    const imageData = canvasToImageData(l.mask.canvas)
    if (!imageData) return null // mask sem canvas decodificado e tratada como ausente
    return {
      kind: "raster",
      imageData,
      bbox: {
        left: l.mask.left ?? 0,
        top: l.mask.top ?? 0,
        right: l.mask.right ?? (l.mask.left ?? 0),
        bottom: l.mask.bottom ?? (l.mask.top ?? 0),
      },
      defaultColor: (l.mask.defaultColor as 0 | 255) ?? 255,
      disabled: l.mask.disabled === true,
      invert: false, // ag-psd nao expoe direto, default false
    }
  }
  // Vector mask
  const vm = (l as any).vectorMask
  if (vm?.paths?.length) {
    return {
      kind: "vector",
      path: vectorMaskToSvgPath(vm),
      bbox: {
        left: l.left ?? 0, top: l.top ?? 0,
        right: l.right ?? (l.left ?? 0), bottom: l.bottom ?? (l.top ?? 0),
      },
      disabled: vm.disabled === true,
      invert: vm.invert === true,
    }
  }
  // Clipping mask marker — referencia ao layer base eh resolvida em fase pos
  // (collectClippingChains) que recebe documento inteiro pra encontrar baseLayerId.
  if (l.clipping === true) {
    return { kind: "clipping", baseLayerId: "" } // baseLayerId preenchido depois
  }
  return null
}

/**
 * Concatena paths SVG do vectorMask num único atributo d="..." com curvas
 * Bezier cubicas corretas (Fase 4). Wrapper que delega pro converter abaixo.
 */
function vectorMaskToSvgPath(vm: any): string {
  return vectorMaskToBezierSvg(vm)
}

// ────────────────────────────────────────────────────────────────────
// Effects (layer styles)
// ────────────────────────────────────────────────────────────────────

function readEffects(l: AgPsdLayer): PsdLayerEffects {
  const fx = (l.effects ?? {}) as any
  const out: PsdLayerEffects = {}
  if (fx.dropShadow?.[0]) out.dropShadow = readShadow(fx.dropShadow[0])
  if (fx.innerShadow?.[0]) out.innerShadow = readShadow(fx.innerShadow[0])
  if (fx.outerGlow?.[0]) out.outerGlow = readGlow(fx.outerGlow[0], "outer")
  if (fx.innerGlow?.[0]) out.innerGlow = readGlow(fx.innerGlow[0], "inner")
  if (fx.stroke?.[0]) out.stroke = readStrokeEffect(fx.stroke[0])
  if (fx.solidFill?.[0]) out.colorOverlay = readColorOverlay(fx.solidFill[0])
  if (fx.gradientOverlay?.[0]) out.gradientOverlay = readGradientOverlay(fx.gradientOverlay[0])
  // F12.13 Fase 5: satin + bevel + patternOverlay
  if (fx.satin?.[0]) out.satin = readSatin(fx.satin[0])
  if (fx.bevel?.[0]) out.bevel = readBevel(fx.bevel[0])
  // patternOverlay: pattern bytes precisam decodificacao (Fase 5 + Fase 4)
  return out
}

function readShadow(s: any): PsdShadowEffect {
  return {
    enabled: s.enabled !== false,
    color: parseHexColor(s.color, "#000000"),
    opacity: typeof s.opacity === "number" ? s.opacity : 0.75,
    angle: typeof s.angle === "number" ? s.angle : 120,
    distance: typeof s.distance === "number" ? s.distance : 5,
    blur: typeof s.size === "number" ? s.size : 5,
    spread: typeof s.choke === "number" ? s.choke : 0,
    blendMode: mapBlendMode(s.blendMode ?? "multiply"),
  }
}

function readGlow(g: any, _kind: "outer" | "inner"): PsdGlowEffect {
  return {
    enabled: g.enabled !== false,
    color: parseHexColor(g.color, "#ffffff"),
    opacity: typeof g.opacity === "number" ? g.opacity : 0.75,
    blur: typeof g.size === "number" ? g.size : 5,
    spread: typeof g.choke === "number" ? g.choke : 0,
    blendMode: mapBlendMode(g.blendMode ?? "screen"),
    source: g.source ?? undefined,
  }
}

function readStrokeEffect(s: any): PsdStrokeEffect {
  return {
    enabled: s.enabled !== false,
    width: typeof s.size === "number" ? s.size : 1,
    position: s.position ?? "outside",
    fill: { kind: "solid", color: parseHexColor(s.color, "#000000") },
    blendMode: mapBlendMode(s.blendMode ?? "normal"),
    opacity: typeof s.opacity === "number" ? s.opacity : 1,
  }
}

function readColorOverlay(c: any): PsdColorOverlayEffect {
  return {
    enabled: c.enabled !== false,
    color: parseHexColor(c.color, "#000000"),
    opacity: typeof c.opacity === "number" ? c.opacity : 1,
    blendMode: mapBlendMode(c.blendMode ?? "normal"),
  }
}

function readGradientOverlay(g: any): PsdGradientOverlayEffect {
  return {
    enabled: g.enabled !== false,
    gradient: parseGradient(g.gradient),
    opacity: typeof g.opacity === "number" ? g.opacity : 1,
    blendMode: mapBlendMode(g.blendMode ?? "normal"),
    angle: typeof g.angle === "number" ? g.angle : 90,
    scale: typeof g.scale === "number" ? g.scale : 1,
    reverse: g.reverse === true,
  }
}

function readSatin(s: any): import("./types").PsdSatinEffect {
  return {
    enabled: s.enabled !== false,
    color: parseHexColor(s.color, "#000000"),
    opacity: typeof s.opacity === "number" ? s.opacity : 0.5,
    angle: typeof s.angle === "number" ? s.angle : 19,
    distance: typeof s.distance === "number" ? s.distance : 11,
    size: typeof s.size === "number" ? s.size : 14,
    blendMode: mapBlendMode(s.blendMode ?? "multiply"),
    invert: s.invert === true,
  }
}

function readBevel(b: any): import("./types").PsdBevelEffect {
  const styleMap: Record<string, "innerBevel" | "outerBevel" | "emboss" | "pillowEmboss" | "strokeEmboss"> = {
    "innerBevel": "innerBevel",
    "outerBevel": "outerBevel",
    "emboss": "emboss",
    "pillowEmboss": "pillowEmboss",
    "strokeEmboss": "strokeEmboss",
  }
  const techniqueMap: Record<string, "smooth" | "chiselHard" | "chiselSoft"> = {
    "softMatte": "smooth",
    "chiselHard": "chiselHard",
    "chiselSoft": "chiselSoft",
  }
  return {
    enabled: b.enabled !== false,
    style: styleMap[b.style] ?? "innerBevel",
    technique: techniqueMap[b.technique] ?? "smooth",
    depth: typeof b.depth === "number" ? b.depth : 100,
    direction: b.direction === "down" ? "down" : "up",
    size: typeof b.size === "number" ? b.size : 5,
    soften: typeof b.soften === "number" ? b.soften : 0,
    highlightColor: parseHexColor(b.highlightColor, "#ffffff"),
    highlightBlendMode: mapBlendMode(b.highlightBlendMode ?? "screen"),
    highlightOpacity: typeof b.highlightOpacity === "number" ? b.highlightOpacity : 0.75,
    shadowColor: parseHexColor(b.shadowColor, "#000000"),
    shadowBlendMode: mapBlendMode(b.shadowBlendMode ?? "multiply"),
    shadowOpacity: typeof b.shadowOpacity === "number" ? b.shadowOpacity : 0.75,
  }
}

function parseGradient(g: any): PsdGradient {
  if (!g) return { kind: "linear", stops: [] }
  const stops = Array.isArray(g.stops) ? g.stops.map((s: any) => ({
    position: typeof s.location === "number" ? s.location : 0,
    color: parseHexColor(s.color, "#000000"),
    opacity: typeof s.opacity === "number" ? s.opacity : 1,
  })) : []
  const kindMap: Record<string, PsdGradient["kind"]> = {
    linear: "linear",
    radial: "radial",
    angle: "angle",
    reflected: "reflected",
    diamond: "diamond",
  }
  return {
    kind: kindMap[g.type] ?? "linear",
    stops,
    smoothness: typeof g.smoothness === "number" ? g.smoothness : 1,
  }
}

// ────────────────────────────────────────────────────────────────────
// Mapeamento de enums PSD → tipos ZZOSY
// ────────────────────────────────────────────────────────────────────

function mapColorMode(m: any, warn: (w: ReadWarning) => void): PsdColorMode {
  // ag-psd entrega Number; mapeamos:
  // 0=bitmap, 1=grayscale, 2=indexed, 3=rgb, 4=cmyk, 7=multichannel, 8=duotone, 9=lab
  switch (m) {
    case 0: return "bitmap"
    case 1: return "grayscale"
    case 2: return "indexed"
    case 3: return "rgb"
    case 4: return "cmyk"
    case 7: return "multichannel"
    case 8: return "duotone"
    case 9: return "lab"
    default:
      warn({ kind: "out-of-scope", layerName: "<document>", message: `Color mode ${m} desconhecido. Tratando como rgb.` })
      return "rgb"
  }
}

/**
 * Mapeia ag-psd blendMode (string) pro enum ZZOSY. Cobre TODOS os 27 modes
 * oficiais Adobe + passThrough (folder-exclusive) + 'norm' alias.
 *
 * Fonte: Adobe Photoshop SDK — Blend Mode Strings.
 */
function mapBlendMode(s: string | undefined): PsdBlendMode {
  if (!s) return "normal"
  const m: Record<string, PsdBlendMode> = {
    "normal": "normal", "norm": "normal", "pass through": "passThrough", "pass": "passThrough",
    "dissolve": "dissolve", "diss": "dissolve",
    "darken": "darken", "dark": "darken",
    "multiply": "multiply", "mul ": "multiply", "mul": "multiply",
    "color burn": "colorBurn", "cbrn": "colorBurn", "idiv": "colorBurn",
    "linear burn": "linearBurn", "lbrn": "linearBurn",
    "darker color": "darkerColor", "dkcl": "darkerColor",
    "lighten": "lighten", "lite": "lighten",
    "screen": "screen", "scrn": "screen",
    "color dodge": "colorDodge", "cdod": "colorDodge", "div ": "colorDodge", "div": "colorDodge",
    "linear dodge": "linearDodge", "lddg": "linearDodge",
    "lighter color": "lighterColor", "lgcl": "lighterColor",
    "overlay": "overlay", "over": "overlay",
    "soft light": "softLight", "sLit": "softLight",
    "hard light": "hardLight", "hLit": "hardLight",
    "vivid light": "vividLight", "vLit": "vividLight",
    "linear light": "linearLight", "lLit": "linearLight",
    "pin light": "pinLight", "pLit": "pinLight",
    "hard mix": "hardMix", "hMix": "hardMix",
    "difference": "difference", "diff": "difference",
    "exclusion": "exclusion", "smud": "exclusion",
    "subtract": "subtract", "fsub": "subtract",
    "divide": "divide", "fdiv": "divide",
    "hue": "hue",
    "saturation": "saturation", "sat ": "saturation", "sat": "saturation",
    "color": "color", "colr": "color",
    "luminosity": "luminosity", "lum ": "luminosity", "lum": "luminosity",
  }
  const key = s.toLowerCase()
  if (m[key]) return m[key]
  if (m[s]) return m[s]
  // Unknown blend mode — fallback normal mas reporta
  return "normal"
}

function mapAlign(a: any): "left" | "center" | "right" | "justify" {
  if (a === "center") return "center"
  if (a === "right") return "right"
  if (a === "justify" || a === "justifyAll" || a === "justifyCenter" || a === "justifyLeft" || a === "justifyRight") return "justify"
  return "left"
}

/**
 * Mapeia ag-psd char style pro modelo ZZOSY. CRITICO: normaliza o nome
 * PostScript pra family CSS limpo (sem sufixo de weight/italic/variable font).
 *
 * PSD entrega "Exo2Roman_444.000wght_0ital" — modelo armazena
 * fontFamily="Exo 2" + fontWeight=400 + fontStyle="italic". UI/renderer
 * leem o modelo limpo, nao precisam re-parsear.
 */
function mapCharStyle(s: any, _warn: (w: ReadWarning) => void, _layerName: string, textScale: number = 1): PsdCharStyle {
  const rawName = s.font?.name ?? "Arial"
  const normalizedFamily = normalizePsdFontToGoogle(rawName) ?? rawName
  // Auto-leading: SO trata como auto se ag-psd marcou autoLeading=true
  // OU se nao tem leading definido. NAO usar a heuristica "leading==fontSize"
  // pra inferir auto — designs profissionais (caso Sicredi) tem leading tight
  // explicito que coincide com fontSize, e essa heuristica os transformava em
  // 1.2x default → titulo com gap entre linhas que nao existe no PSD.
  const rawSize = typeof s.fontSize === "number" ? s.fontSize : 48
  const rawLeading = typeof s.leading === "number" ? s.leading : undefined
  const isAutoLeading = s.autoLeading === true || rawLeading === undefined
  return {
    fontFamily: normalizedFamily,
    fontWeight: extractFontWeight(rawName) || (s.fauxBold ? 700 : 400),
    fontStyle: detectItalic(rawName, !!s.fauxItalic) ? "italic" : "normal",
    fontSize: rawSize * textScale,
    color: s.fillColor ? rgbToHex(s.fillColor) : "#000000",
    tracking: typeof s.tracking === "number" ? s.tracking : 0,
    leading: isAutoLeading ? undefined : (rawLeading! * textScale),
    underline: s.underline === true,
    strikethrough: s.strikethrough === true,
    fauxBold: s.fauxBold === true,
    fauxItalic: s.fauxItalic === true,
  }
}

function mapCharStylePartial(s: any, textScale: number = 1): Partial<PsdCharStyle> {
  const out: Partial<PsdCharStyle> = {}
  if (s.font?.name) {
    const rawName = s.font.name
    out.fontFamily = normalizePsdFontToGoogle(rawName) ?? rawName
    out.fontWeight = extractFontWeight(rawName) || (s.fauxBold ? 700 : 400)
    out.fontStyle = detectItalic(rawName, !!s.fauxItalic) ? "italic" : "normal"
  }
  // Aplicar textScale em fontSize/leading do run (mesma logica que defaultStyle)
  if (typeof s.fontSize === "number") out.fontSize = s.fontSize * textScale
  if (s.fillColor) out.color = rgbToHex(s.fillColor)
  if (typeof s.tracking === "number") out.tracking = s.tracking
  if (typeof s.leading === "number") out.leading = s.leading * textScale
  if (s.underline) out.underline = true
  if (s.strikethrough) out.strikethrough = true
  if (s.fauxBold) out.fauxBold = true
  if (s.fauxItalic) out.fauxItalic = true
  return out
}

function detectItalic(name: string, faux: boolean): boolean {
  if (faux) return true
  return /italic|oblique|kursiv|cursiv/i.test(name)
}

// ────────────────────────────────────────────────────────────────────
// Utilitários
// ────────────────────────────────────────────────────────────────────

function rgbToHex(c: any): string {
  if (!c) return "#000000"
  // ag-psd entrega { r, g, b } 0-255
  const r = clamp255(c.r ?? 0)
  const g = clamp255(c.g ?? 0)
  const b = clamp255(c.b ?? 0)
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")
}

function parseHexColor(c: any, fallback: string): string {
  if (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase()
  return rgbToHex(c) || fallback
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function buildMetadata(_psd: Psd): PsdMetadata {
  return {
    createdAt: undefined,
    modifiedAt: undefined,
    iccProfile: undefined,
    xmp: undefined,
  }
}

/**
 * Converte HTMLCanvasElement (browser) ou ImageData (server) pro tipo
 * PsdImageData. Em browser usa toDataURL "image/png" (base64). Em node
 * essa funcao retorna null por enquanto (Fase 1 e browser-first).
 */
function canvasToImageData(c: any): PsdImageData | null {
  if (!c) return null
  // Browser HTMLCanvasElement
  if (typeof c.toDataURL === "function") {
    try {
      const dataUrl = c.toDataURL("image/png")
      return {
        data: dataUrl,
        width: c.width ?? 0,
        height: c.height ?? 0,
        format: "dataUrl",
      }
    } catch { return null }
  }
  return null
}

// ────────────────────────────────────────────────────────────────────
// Pos-processamento: resolve clipping chains
// ────────────────────────────────────────────────────────────────────

/**
 * Apos readPsdDocument(), passa-se pelo documento resolvendo clipping
 * markers — `mask.kind === "clipping"` recebe o `baseLayerId` correto
 * baseado na ordem dos siblings.
 *
 * NOTA: chamado externamente (psdToCampaign.ts) pra manter readPsdDocument
 * puro. Operacao mutates `mask.baseLayerId` em place.
 */
export function resolveClippingChains(doc: PsdDocument): void {
  function walk(layers: PsdLayer[]) {
    let lastNonClipping: PsdLayer | null = null
    for (const l of layers) {
      if (l.type === "group") {
        walk(l.children)
        // Folder pode servir de base pra clipping de siblings
        if (!l.clipping) lastNonClipping = l
        continue
      }
      // Adjustment + hidden nao servem como base nem participam da chain
      if (l.type === "adjustment") continue
      // Layers clipping=true precisam saber qual eh o base
      if (l.clipping && l.mask?.kind === "clipping" && lastNonClipping) {
        l.mask.baseLayerId = lastNonClipping.id
      }
      // Updates lastNonClipping para proxima iteracao se nao for clipping
      if (!l.clipping) lastNonClipping = l
    }
  }
  walk(doc.layers)
}
