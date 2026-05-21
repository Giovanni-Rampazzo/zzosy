/**
 * toCampaign — mapeia PsdDocument → modelo do ZZOSY (assets + layers).
 *
 * Esse modulo eh PURO TypeScript. Recebe `PsdDocument` (do psdReader),
 * devolve estruturas que vao virar:
 *   - CampaignAsset[]  → tabela do DB
 *   - KvLayer[]        → JSON em KeyVision.layers
 *   - Blob[]           → uploads PNG/JPG (imageIndex referenciado em assets)
 *
 * NENHUMA renderizacao acontece aqui. Effects sao passados como DADOS pro
 * editor renderizar via Fabric.Shadow / Fabric.Filter. Mask idem.
 *
 * Diferenca chave do importer antigo:
 *   - Effects NAO sao baked no canvas. Asset metadata.effects e a fonte unica.
 *   - Editor consulta metadata.effects + aplica via Fabric. SEM dobramento.
 */
import type {
  PsdDocument,
  PsdLayer,
  PsdTextLayer,
  PsdImageLayer,
  PsdSmartObjectLayer,
  PsdGroupLayer,
  PsdShapeLayer,
  PsdFill,
  PsdStroke,
  PsdLayerEffects,
  PsdMaskData,
  PsdImageData,
  PsdBBox,
  PsdBlendMode,
} from "./types"
import { blendModeToCanvas } from "./blendModes"

// ────────────────────────────────────────────────────────────────────
// Output shapes (compativel com modelo do editor)
// ────────────────────────────────────────────────────────────────────

export interface CampaignBuild {
  /** Assets que vao pro endpoint POST /api/campaigns/[id]/import-psd. */
  assets: BuiltAsset[]
  /** Layers do KV (JSON em KeyVision.layers). */
  kvLayers: BuiltLayer[]
  /** Blobs de imagem (PNG bytes) pra upload. imageIndex em BuiltAsset referencia. */
  imageBlobs: Blob[]
  /** Dimensoes do canvas. */
  width: number
  height: number
  /** Background color derivada (composite background do PSD). */
  bgColor: string
  /**
   * Familias de fontes referenciadas em text layers, normalizadas (sem
   * sufixos de variable font). UI checa via document.fonts.check pra
   * alertar fontes faltando.
   */
  requiredFonts: string[]
  /** Warnings nao-fatais propagados pra UI. */
  warnings: BuildWarning[]
}

export interface BuiltAsset {
  /** Slot temp — back end gera o id real. */
  tempId: string
  label: string
  type: "TEXT" | "IMAGE" | "SHAPE"
  /** TEXT: array de spans. SHAPE: path data. IMAGE: null. */
  content: TextSpan[] | null
  /** IMAGE: index em imageBlobs. TEXT/SHAPE: undefined. */
  imageIndex?: number
  /** SHAPE: dados vetoriais (path SVG + fill + stroke). */
  shape?: BuiltShape
  /** Override compatibilidade com modelo atual do editor. */
  lastOverride?: Record<string, unknown>
  /**
   * Effects do PSD como dados vivos. Editor aplica via Fabric.Shadow / filtros.
   * NAO baked em pixels. Esse e o coracao da fidelidade Adobe sem doubling.
   */
  effects?: PsdLayerEffects
  /**
   * Pixels incluem effects? Quando true (Smart Object com effects aplicados
   * pelo PS no render), editor NAO adiciona Fabric.Shadow extra. Quando false
   * (layer raster cru), editor APLICA effects via Fabric. Default false.
   */
  pixelsIncludeEffects: boolean
  /**
   * Mask como dado (raster/vector/clipping). Editor cria fabric clipPath.
   * null = sem mask.
   */
  mask: PsdMaskData | null
  /** Hidden flag preservado pra round-trip. Default visible. */
  hidden?: boolean
  /** Locked transparencyProtected do PS. */
  locked?: boolean
}

export interface BuiltLayer {
  assetId: string // sera resolvido depois (tempId → id real)
  posX: number
  posY: number
  width: number
  height: number
  scaleX: number
  scaleY: number
  rotation: number
  zIndex: number
  opacity: number
  blendMode: string
  groupPath: string[]
  /** Effects overrides per-layer (raro — quase sempre vem do asset). */
  effectsOverride?: PsdLayerEffects
}

export interface BuiltShape {
  /** SVG path d="..." em coords absolutas do canvas. */
  path: string
  /** Bbox do path (pra positioning no Fabric). */
  pathBbox: PsdBBox
  /** Fill (solid color por agora; gradient/pattern em Fase 5). null = no fill. */
  fill: PsdFill | null
  /** Stroke (width + color + cap + join). null = no stroke. */
  stroke: PsdStroke | null
  /** Even-odd vs non-zero pra polygons complexos. */
  fillRule: "nonzero" | "evenodd"
}

export interface TextSpan {
  text: string
  style: {
    color: string
    fontSize: number
    fontWeight: number
    fontStyle: "normal" | "italic"
    fontFamily: string
    tracking?: number
    underline?: boolean
    strikethrough?: boolean
  }
}

export interface BuildWarning {
  kind: "empty-canvas" | "out-of-scope" | "fallback-applied"
  layerName: string
  message: string
}

// ────────────────────────────────────────────────────────────────────
// API principal
// ────────────────────────────────────────────────────────────────────

/**
 * Constroi CampaignBuild a partir de PsdDocument. Funcao PURA — nao faz
 * fetch, nao manipula DOM, nao posta em API. Caller decide o que fazer
 * com o resultado (postar, salvar local, etc).
 */
export function buildCampaignFromPsd(doc: PsdDocument): CampaignBuild {
  const ctx: BuildContext = {
    assets: [],
    layers: [],
    blobs: [],
    warnings: [],
    fonts: new Set<string>(),
    nextTempId: 0,
    zIndex: 0,
  }

  walkLayers(doc.layers, [], ctx)

  return {
    assets: ctx.assets,
    kvLayers: ctx.layers,
    imageBlobs: ctx.blobs,
    width: doc.width,
    height: doc.height,
    bgColor: deriveBgColor(doc),
    requiredFonts: Array.from(ctx.fonts).sort(),
    warnings: ctx.warnings,
  }
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

interface BuildContext {
  assets: BuiltAsset[]
  layers: BuiltLayer[]
  blobs: Blob[]
  warnings: BuildWarning[]
  fonts: Set<string>
  nextTempId: number
  zIndex: number
}

function nextTempId(ctx: BuildContext): string {
  return `tmp_${ctx.nextTempId++}`
}

function walkLayers(layers: PsdLayer[], parentPath: string[], ctx: BuildContext) {
  for (const l of layers) {
    if (!l.visible) continue // hidden no PS = nao importa

    switch (l.type) {
      case "group": {
        // Folders nao viram asset. Children sao processados com path extendido.
        const childPath = [...parentPath, l.name]
        walkLayers(l.children, childPath, ctx)
        break
      }
      case "text": {
        emitTextLayer(l, parentPath, ctx)
        break
      }
      case "image": {
        emitImageLayer(l, parentPath, ctx)
        break
      }
      case "smartObject": {
        emitSmartObjectLayer(l, parentPath, ctx)
        break
      }
      case "shape": {
        emitShapeLayer(l, parentPath, ctx)
        break
      }
      case "adjustment": {
        // Out of scope — ja warned no reader. Aqui so skip.
        break
      }
    }
  }
}

// ── TEXT ─────────────────────────────────────────────────────────────

function emitTextLayer(l: PsdTextLayer, parentPath: string[], ctx: BuildContext) {
  const tempId = nextTempId(ctx)
  const spans: TextSpan[] = buildTextSpans(l)
  // Acumula fontes pra UI fazer check de availability + missing-fonts modal.
  ctx.fonts.add(l.defaultStyle.fontFamily)
  for (const run of l.styleRuns) {
    if (run.style.fontFamily) ctx.fonts.add(run.style.fontFamily)
  }

  // lastOverride: snapshot do estilo "default" pra render rapido + per-char
  // styles indexados por linha (compativel com o que o editor consome hoje).
  const lastOverride: Record<string, unknown> = {
    width: l.bbox.right - l.bbox.left,
    height: l.bbox.bottom - l.bbox.top,
    fontFamily: l.defaultStyle.fontFamily,
    fontSize: Math.round(l.defaultStyle.fontSize),
    fontWeight: l.defaultStyle.fontWeight,
    fontStyle: l.defaultStyle.fontStyle,
    fill: l.defaultStyle.color,
    charSpacing: l.defaultStyle.tracking,
    lineHeight: l.defaultStyle.leading
      ? l.defaultStyle.leading / l.defaultStyle.fontSize
      : 1.0,
    leadingPt: l.defaultStyle.leading ?? Math.round(l.defaultStyle.fontSize * 1.2),
    textAlign: l.paragraph.align,
    styles: buildLineIndexedStyles(l),
  }

  ctx.assets.push({
    tempId,
    label: l.name,
    type: "TEXT",
    content: spans,
    lastOverride,
    effects: hasEffects(l.effects) ? l.effects : undefined,
    pixelsIncludeEffects: false, // text effects sempre live via Fabric
    mask: l.mask,
    hidden: !l.visible || undefined,
    locked: l.locked || undefined,
  })

  ctx.layers.push(layerFromLayer(tempId, l, ctx, parentPath))
}

/** Constroi spans alinhados aos styleRuns do PsdTextLayer. */
function buildTextSpans(l: PsdTextLayer): TextSpan[] {
  if (l.styleRuns.length === 0) {
    return [{ text: l.text, style: spanStyleFromCharStyle(l.defaultStyle) }]
  }
  const spans: TextSpan[] = []
  for (const run of l.styleRuns) {
    const segment = l.text.substring(run.start, run.start + run.length)
    if (!segment) continue
    const style = { ...l.defaultStyle, ...run.style }
    spans.push({ text: segment, style: spanStyleFromCharStyle(style) })
  }
  // Se runs nao cobriram todo o texto, completa com defaultStyle.
  const covered = spans.reduce((acc, s) => acc + s.text.length, 0)
  if (covered < l.text.length) {
    spans.push({
      text: l.text.substring(covered),
      style: spanStyleFromCharStyle(l.defaultStyle),
    })
  }
  return spans
}

function spanStyleFromCharStyle(s: PsdTextLayer["defaultStyle"]): TextSpan["style"] {
  return {
    color: s.color,
    fontSize: Math.round(s.fontSize),
    fontWeight: s.fontWeight,
    fontStyle: s.fontStyle,
    fontFamily: s.fontFamily,
    tracking: s.tracking,
    underline: s.underline,
    strikethrough: s.strikethrough,
  }
}

/**
 * Constroi estrutura de styles per-LINE per-CHAR (formato esperado pelo
 * Fabric.Textbox.styles). lineIdx → charInLine → CharStyle.
 *
 * NOTA: indexado por LINHA (audit 25839ad). Antes empilhavamos tudo em
 * styles[0] com charIdx GLOBAL, e Fabric dropava silenciosamente chars
 * de linha 1+. Aqui ja construimos no formato correto.
 */
function buildLineIndexedStyles(l: PsdTextLayer): Record<number, Record<number, Record<string, unknown>>> {
  const result: Record<number, Record<number, Record<string, unknown>>> = {}
  let lineIdx = 0
  let charInLine = 0
  let globalIdx = 0
  for (const ch of l.text) {
    if (ch === "\n") {
      lineIdx++
      charInLine = 0
      globalIdx++
      continue
    }
    const style = styleAt(l, globalIdx)
    if (!styleEquals(style, l.defaultStyle)) {
      if (!result[lineIdx]) result[lineIdx] = {}
      result[lineIdx][charInLine] = {
        fill: style.color,
        fontSize: Math.round(style.fontSize),
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        ...(typeof style.tracking === "number" ? { charSpacing: style.tracking } : {}),
      }
    }
    charInLine++
    globalIdx++
  }
  return result
}

function styleAt(l: PsdTextLayer, idx: number): PsdTextLayer["defaultStyle"] {
  for (const run of l.styleRuns) {
    if (idx >= run.start && idx < run.start + run.length) {
      return { ...l.defaultStyle, ...run.style }
    }
  }
  return l.defaultStyle
}

function styleEquals(a: PsdTextLayer["defaultStyle"], b: PsdTextLayer["defaultStyle"]): boolean {
  return (
    a.fontFamily === b.fontFamily
    && a.fontSize === b.fontSize
    && a.fontWeight === b.fontWeight
    && a.fontStyle === b.fontStyle
    && a.color === b.color
    && a.tracking === b.tracking
  )
}

// ── IMAGE ────────────────────────────────────────────────────────────

function emitImageLayer(l: PsdImageLayer, parentPath: string[], ctx: BuildContext) {
  if (!l.imageData?.data) {
    ctx.warnings.push({
      kind: "empty-canvas",
      layerName: l.name,
      message: "Layer image sem canvas decodificado pelo ag-psd. Layer ignorado.",
    })
    return
  }
  const blob = imageDataToBlob(l.imageData)
  if (!blob) {
    ctx.warnings.push({
      kind: "empty-canvas",
      layerName: l.name,
      message: "Falha ao converter imageData em Blob.",
    })
    return
  }
  const imageIndex = ctx.blobs.length
  ctx.blobs.push(blob)
  const tempId = nextTempId(ctx)
  ctx.assets.push({
    tempId,
    label: l.name,
    type: "IMAGE",
    content: null,
    imageIndex,
    effects: hasEffects(l.effects) ? l.effects : undefined,
    pixelsIncludeEffects: l.pixelsIncludeEffects,
    mask: l.mask,
    hidden: !l.visible || undefined,
    locked: l.locked || undefined,
  })
  ctx.layers.push(layerFromLayer(tempId, l, ctx, parentPath))
}

// ── SHAPE (Fase 4) ───────────────────────────────────────────────────

function emitShapeLayer(l: PsdShapeLayer, parentPath: string[], ctx: BuildContext) {
  // Shape SEMPRE eh vetorial. Se nao tem path (sem vectorMask), nao tem
  // como renderizar — skip com warning.
  if (!l.path) {
    ctx.warnings.push({
      kind: "empty-canvas",
      layerName: l.name,
      message: "Shape layer sem path vetorial. Layer ignorado.",
    })
    return
  }
  const tempId = nextTempId(ctx)
  ctx.assets.push({
    tempId,
    label: l.name,
    type: "SHAPE",
    content: null,
    shape: {
      path: l.path,
      pathBbox: l.pathBbox,
      fill: l.fill,
      stroke: l.stroke,
      fillRule: l.fillRule,
    },
    effects: hasEffects(l.effects) ? l.effects : undefined,
    pixelsIncludeEffects: false, // shapes vetoriais: effects sempre live
    mask: l.mask,
    hidden: !l.visible || undefined,
    locked: l.locked || undefined,
  })
  ctx.layers.push(layerFromLayer(tempId, l, ctx, parentPath))
}

// ── SMART OBJECT ─────────────────────────────────────────────────────

function emitSmartObjectLayer(l: PsdSmartObjectLayer, parentPath: string[], ctx: BuildContext) {
  // Fase 2: Smart Objects detectados como "wrapper" (PA do Sicredi etc) tem
  // conteudo que duplica outras layers acima. Por padrao importamos como
  // HIDDEN — user re-mostra manual se for o conteudo principal. Sem isso
  // o canvas do SO desenha em cima das layers editaveis, criando duplicacao.
  if (l.isWrapper) {
    ctx.warnings.push({
      kind: "fallback-applied",
      layerName: l.name,
      message: "Smart Object 'wrapper' (cobre canvas + layers acima duplicam) — importado como hidden. Re-mostrar manual no editor se for o conteudo principal.",
    })
  }
  if (!l.composite?.data) {
    ctx.warnings.push({
      kind: "empty-canvas",
      layerName: l.name,
      message: "Smart Object sem canvas decodificado. Provavel linked file ausente. Layer ignorado.",
    })
    return
  }
  const blob = imageDataToBlob(l.composite)
  if (!blob) {
    ctx.warnings.push({
      kind: "empty-canvas",
      layerName: l.name,
      message: "Falha ao converter Smart Object composite em Blob.",
    })
    return
  }
  const imageIndex = ctx.blobs.length
  ctx.blobs.push(blob)
  const tempId = nextTempId(ctx)
  ctx.assets.push({
    tempId,
    label: l.name,
    type: "IMAGE",
    content: null,
    imageIndex,
    effects: hasEffects(l.effects) ? l.effects : undefined,
    // Smart Object composite SEMPRE vem com effects aplicados pelo PS (ag-psd
    // rasteriza o nested PSB ja com layer styles do SO + filtros). Editor
    // NAO deve adicionar Fabric.Shadow extra — evita doubling.
    pixelsIncludeEffects: true,
    mask: l.mask,
    // isWrapper → hidden default (user re-mostra se quiser).
    hidden: l.isWrapper ? true : (!l.visible || undefined),
    locked: l.locked || undefined,
  })
  ctx.layers.push(layerFromLayer(tempId, l, ctx, parentPath))
}

// ── Layer position ──────────────────────────────────────────────────

function layerFromLayer(
  assetTempId: string,
  l: PsdLayer,
  ctx: BuildContext,
  parentPath: string[],
): BuiltLayer {
  ctx.zIndex++
  return {
    assetId: assetTempId,
    posX: l.bbox.left,
    posY: l.bbox.top,
    width: bboxWidth(l.bbox),
    height: bboxHeight(l.bbox),
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    zIndex: ctx.zIndex,
    opacity: l.opacity,
    blendMode: blendModeToCss(l.blendMode),
    groupPath: parentPath,
  }
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function bboxWidth(b: PsdBBox): number { return Math.max(b.right - b.left, 1) }
function bboxHeight(b: PsdBBox): number { return Math.max(b.bottom - b.top, 1) }

function hasEffects(fx: PsdLayerEffects): boolean {
  return Object.keys(fx).length > 0
}

function deriveBgColor(doc: PsdDocument): string {
  // Busca primeiro "Color Fill" no doc, ou recorre ao primeiro raster que
  // cubra o canvas inteiro. Fallback branco.
  function searchBgColor(layers: PsdLayer[]): string | null {
    for (const l of layers) {
      if (l.type === "group") {
        const r = searchBgColor(l.children); if (r) return r
        continue
      }
      const w = bboxWidth(l.bbox)
      const h = bboxHeight(l.bbox)
      const coversCanvas = w >= doc.width * 0.95 && h >= doc.height * 0.95
      if (coversCanvas && l.type === "image" && /color\s*fill|background/i.test(l.name)) {
        // Tenta amostrar pixel central do canvas (so se tiver dados raw — Fase 2)
        return null // por ora, deixa o composite/Fabric resolver
      }
    }
    return null
  }
  return searchBgColor(doc.layers) ?? "#ffffff"
}

/** Wrapper pra blendModeToCanvas em blendModes.ts (Fase 5). */
function blendModeToCss(mode: PsdBlendMode): string {
  return blendModeToCanvas(mode)
}

/**
 * Converte PsdImageData (data URL ou raw RGBA) em Blob PNG.
 * Em ambiente browser usa fetch(dataUrl).blob(). Em node, decoda manualmente.
 */
function imageDataToBlob(img: PsdImageData): Blob | null {
  try {
    if (img.format === "dataUrl" && typeof img.data === "string") {
      // Browser: fetch + blob sync via XHR? Mais simples decodificar base64
      // direto. dataUrl tipo "data:image/png;base64,..."
      const m = /^data:([^;]+);base64,(.+)$/.exec(img.data)
      if (!m) return null
      const mime = m[1]
      const base64 = m[2]
      // atob existe em browser; em node precisa Buffer
      const binary = typeof atob === "function"
        ? atob(base64)
        : Buffer.from(base64, "base64").toString("binary")
      const len = binary.length
      const u8 = new Uint8Array(len)
      for (let i = 0; i < len; i++) u8[i] = binary.charCodeAt(i)
      return typeof Blob !== "undefined" ? new Blob([u8], { type: mime }) : null
    }
    return null
  } catch {
    return null
  }
}
