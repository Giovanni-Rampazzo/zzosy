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
import type { LayerMask } from "@/lib/maskTypes"

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
  /**
   * Smart Object linked files (bytes embedded originais — PSB/PSD/PNG/JPG/AI/PDF).
   * linkedIndex em BuiltAsset referencia. Persistidos em SmartObjectFile pra
   * round-trip ZZOSY → Photoshop sem rasterizar nem perder vetor.
   */
  linkedBlobs: Blob[]
  /** Metadata paralela a linkedBlobs (mesmo index). */
  linkedMeta: LinkedFileMeta[]
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

export interface LinkedFileMeta {
  /** GUID estavel — derivado do layer.id do PSD. Round-trip via writer.ensureGuid. */
  guid: string
  /** MIME — endpoint usa pra escolher extensao no disco. */
  mime: string
  /** Nome original do linkedFile no PSD (pra UX de debug). */
  originalName: string
  sizeBytes: number
  width?: number
  height?: number
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
  /**
   * Smart Object: index em linkedBlobs do CampaignBuild. Endpoint cria
   * SmartObjectFile + relaciona CampaignAsset.smartObjectId. Round-trip
   * preserva bytes originais (PSB/AI/PDF) — sem rasterizar.
   */
  linkedIndex?: number
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
   * null = sem mask. Shape compativel com applyMaskToFabricObject — convertida
   * de PsdMaskData (canonical, key=kind) pra LayerMask (legado, key=type).
   */
  mask: LayerMask | null
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
    /**
     * Baseline shift em PONTOS PSD (positive = char SUBE, negative = DESCE).
     * Editor mapeia pra Fabric textbox.styles[line][col].deltaY com SINAL
     * INVERTIDO (Fabric deltaY positive = desce). Sem sinal invertido, char
     * elevado no PSD apareceria rebaixado no editor.
     */
    baselineShift?: number
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
    linkedBlobs: [],
    linkedMeta: [],
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
    linkedBlobs: ctx.linkedBlobs,
    linkedMeta: ctx.linkedMeta,
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
  linkedBlobs: Blob[]
  linkedMeta: LinkedFileMeta[]
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
  // Width permanece bbox.width — editor decide o que fazer baseado em __psdShapeType:
  //   point → desabilita wrap (width fica como visual hint apenas)
  //   box   → wrap normal dentro do boxBounds (preferindo boxBounds.width quando disponivel)
  // Effective default font size: alguns PSDs (caso Sicredi) tem defaultStyle
  // SEM fontSize quando styleRuns cobrem todo o texto. Reader cai em fallback
  // 48px → leadingPt/lineHeight calculados sobre 48 ficavam errados pra
  // texto cujos chars usam 40/62. Usa o MAIOR fontSize dos runs como basis
  // pra leading calc — match o comportamento de Photoshop (line height = max
  // char leading da linha) o mais proximo possivel em Fabric (que so tem
  // lineHeight global per textbox).
  const runFontSizes = l.styleRuns
    .map(r => r.style.fontSize)
    .filter((n): n is number => typeof n === "number" && n > 0)
  const maxRunFontSize = runFontSizes.length > 0 ? Math.max(...runFontSizes) : 0
  const effectiveBasisFontSize = maxRunFontSize > 0 ? maxRunFontSize : l.defaultStyle.fontSize
  const lastOverride: Record<string, unknown> = {
    width: l.bbox.right - l.bbox.left,
    height: l.bbox.bottom - l.bbox.top,
    fontFamily: l.defaultStyle.fontFamily,
    fontSize: Math.round(effectiveBasisFontSize),
    fontWeight: l.defaultStyle.fontWeight,
    fontStyle: l.defaultStyle.fontStyle,
    fill: l.defaultStyle.color,
    charSpacing: l.defaultStyle.tracking,
    lineHeight: l.defaultStyle.leading
      ? l.defaultStyle.leading / effectiveBasisFontSize
      : 1.0,
    // Auto leading default 0.9x (padrao ZZOSY tight). Antes era 1.2x Adobe.
    leadingPt: l.defaultStyle.leading ?? Math.round(effectiveBasisFontSize * 0.9),
    textAlign: l.paragraph.align,
    styles: buildLineIndexedStyles(l),
    // Round-trip: preserva shape type pra writer recriar Point/Box text correto.
    // Editor le pra decidir wrap behavior (point=sem wrap, box=wrappa em boxBounds).
    __psdShapeType: l.shapeType ?? "point",
    ...(l.boxBounds ? { __psdBoxBounds: l.boxBounds } : {}),
    // PSD paragraph spaceAfter (pontos) — gap entre paragrafos no PSD.
    // Fabric NAO suporta nativamente; patch em fabricCharSpacingPatch.ts
    // intercepta getHeightOfLine pra adicionar spaceAfter apos linhas que
    // terminam em \n no texto raw. Sem isso, paragrafos no editor colam.
    ...(typeof l.paragraph.spaceAfter === "number" && l.paragraph.spaceAfter > 0
        ? { __psdParagraphSpaceAfter: l.paragraph.spaceAfter } : {}),
  }

  ctx.assets.push({
    tempId,
    label: l.name,
    type: "TEXT",
    content: spans,
    lastOverride,
    effects: hasEffects(l.effects) ? l.effects : undefined,
    pixelsIncludeEffects: false, // text effects sempre live via Fabric
    mask: convertMask(l.mask),
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
    ...(typeof s.baselineShift === "number" && s.baselineShift !== 0
        ? { baselineShift: s.baselineShift } : {}),
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
        // PSD baselineShift (positive=up) → Fabric deltaY (positive=down).
        // Negative sign mantem visual identico ao Photoshop.
        ...(typeof style.baselineShift === "number" && style.baselineShift !== 0
            ? { deltaY: -style.baselineShift } : {}),
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
    mask: convertMask(l.mask),
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
    mask: convertMask(l.mask),
    hidden: !l.visible || undefined,
    locked: l.locked || undefined,
  })
  // CRITICO: pra SHAPE, layer.posX/Y/width/height DEVE ser do pathBbox
  // (path puro, sem padding de stroke), NAO do l.bbox (que ja inclui
  // stroke). Caso contrario o Fabric.Path no editor seria criado com
  // left=128 (com stroke) mas o path interno do Fabric tem bbox 902×902
  // (sem stroke) → ficaria 11px deslocado a cada cycle save/load, e
  // dimensoes drift. Usa pathBbox como fonte da verdade — eh o que a
  // Path do Fabric realmente representa.
  ctx.layers.push(layerFromShapePath(tempId, l, ctx, parentPath))
}

function layerFromShapePath(
  assetTempId: string,
  l: PsdShapeLayer,
  ctx: BuildContext,
  parentPath: string[],
): BuiltLayer {
  ctx.zIndex++
  const pb = l.pathBbox
  return {
    assetId: assetTempId,
    posX: pb.left,
    posY: pb.top,
    width: Math.max(1, pb.right - pb.left),
    height: Math.max(1, pb.bottom - pb.top),
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    zIndex: ctx.zIndex,
    opacity: l.opacity,
    blendMode: blendModeToCss(l.blendMode),
    groupPath: parentPath,
  }
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

  // Preserva bytes embedded do SO (PSB/AI/PDF/PNG/JPG) num linkedFile separado.
  // Persistido em SmartObjectFile pelo endpoint via asset.linkedIndex. No
  // export, fromEditor carrega esses bytes e o writer recria placedLayer +
  // linkedFiles[] do PSD — round-trip ZZOSY → Photoshop sem rasterizar.
  let linkedIndex: number | undefined
  if (l.content.kind === "embedded") {
    const mime = mimeForSmartObjectFormat(l.content.format)
    const ext = extForSmartObjectFormat(l.content.format)
    const linkedBlob = new Blob([(l.content.bytes as any).buffer ?? l.content.bytes], { type: mime })
    linkedIndex = ctx.linkedBlobs.length
    ctx.linkedBlobs.push(linkedBlob)
    ctx.linkedMeta.push({
      guid: l.id, // writer.ensureGuid eh deterministico — round-trip estavel
      mime,
      originalName: `${l.name}.${ext}`,
      sizeBytes: l.content.bytes.byteLength,
      width: l.composite?.width,
      height: l.composite?.height,
    })
  } else if (l.content.kind === "linked") {
    ctx.warnings.push({
      kind: "fallback-applied",
      layerName: l.name,
      message: `Smart Object 'linked externo' (${l.content.filePath}) — sem bytes embedded. Round-trip nao preserva conteudo, so o composite raster.`,
    })
  }

  const tempId = nextTempId(ctx)
  ctx.assets.push({
    tempId,
    label: l.name,
    type: "IMAGE",
    content: null,
    imageIndex,
    linkedIndex,
    effects: hasEffects(l.effects) ? l.effects : undefined,
    // Smart Object composite vem com shadow/glow/stroke aplicados pelo PS no
    // nested render. PORÉM colorOverlay/gradientOverlay (Layer Styles na layer
    // wrapper do SO) NAO sao baked — sao aplicados no editor via BlendColor.tint
    // (KeyVisionEditor.applyFabricEffects com overlaysOnly:true).
    pixelsIncludeEffects: true,
    mask: convertMask(l.mask),
    // isWrapper → hidden default (user re-mostra se quiser).
    hidden: l.isWrapper ? true : (!l.visible || undefined),
    locked: l.locked || undefined,
  })
  ctx.layers.push(layerFromLayer(tempId, l, ctx, parentPath))
}

function mimeForSmartObjectFormat(fmt: "psb" | "psd" | "png" | "jpg" | "ai" | "pdf" | "unknown"): string {
  switch (fmt) {
    case "psb":
    case "psd": return "image/vnd.adobe.photoshop"
    case "png": return "image/png"
    case "jpg": return "image/jpeg"
    case "pdf": return "application/pdf"
    case "ai":  return "application/postscript"
    default:    return "application/octet-stream"
  }
}

function extForSmartObjectFormat(fmt: "psb" | "psd" | "png" | "jpg" | "ai" | "pdf" | "unknown"): string {
  return fmt === "unknown" ? "bin" : fmt
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

/**
 * Converte PsdMaskData (modelo canonical do reader) → LayerMask (shape que
 * applyMaskToFabricObject consome). Sem essa conversao, o editor NAO aplica
 * nenhuma mask importada via pipeline novo — chaves divergem (kind vs type,
 * disabled vs enabled, sem wrapper vector/raster).
 *
 * Sintoma reportado pelo usuario: "veja as mascaras, nao estao lendo direito"
 * — Rectangle 1-4 com vector mask vinham como rectangles cheios em vez do
 * shape mascarado.
 */
function convertMask(m: PsdMaskData | null): LayerMask | null {
  if (!m) return null
  if (m.kind === "raster") {
    if (m.imageData.format !== "dataUrl" || typeof m.imageData.data !== "string") {
      return null // sem dataUrl o raster nao tem como ser fabric.Image clipPath
    }
    const out: any = {
      type: "raster",
      enabled: !m.disabled,
      inverted: m.invert,
      raster: {
        dataUrl: m.imageData.data,
        posX: m.bbox.left,
        posY: m.bbox.top,
        width: m.bbox.right - m.bbox.left,
        height: m.bbox.bottom - m.bbox.top,
      },
    }
    // Propaga __fromClipping (set by resolveLayerClippingMask em clipping.ts)
    // pra export poder reescrever como clipping em vez de raster. Bug 2026-05-27:
    // sem isso, clipping→raster→raster (perde tipo), em vez de clipping→raster→clipping.
    if ((m as any).__fromClipping === true) out.__fromClipping = true
    return out
  }
  if (m.kind === "vector") {
    return {
      type: "vector",
      enabled: !m.disabled,
      inverted: m.invert,
      vector: {
        path: m.path,
        posX: m.bbox.left,
        posY: m.bbox.top,
        width: m.bbox.right - m.bbox.left,
        height: m.bbox.bottom - m.bbox.top,
      },
    }
  }
  if (m.kind === "clipping") {
    return {
      type: "clipping",
      enabled: true,
      clipping: true,
    }
  }
  return null
}

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
