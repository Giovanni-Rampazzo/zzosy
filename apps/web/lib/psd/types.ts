/**
 * Tipos PUROS do modelo PSD do ZZOSY.
 *
 * Princípios (ver docs/PSD_REFACTOR_PLAN.md):
 *  - Zero referências a Canvas/DOM/Fabric/React
 *  - Discriminated unions por tipo de layer
 *  - Effects/masks como dados, NUNCA baked em pixels
 *  - Roda tanto no browser quanto em Node (server-side futuro)
 *
 * Esses tipos sao a INTERFACE entre `psdReader.ts` (le PSD) e
 * `psdToCampaign.ts` (mapeia pra modelo ZZOSY) + `psdRenderer.ts`
 * (preview/thumbnail). Editor (KeyVisionEditor) consome o modelo ZZOSY,
 * nao esse — esse e estritamente PSD-shape.
 */

// ────────────────────────────────────────────────────────────────────
// Documento raiz
// ────────────────────────────────────────────────────────────────────

export interface PsdDocument {
  width: number
  height: number
  /** Resolução em DPI (default 72). PSDs gráficos podem ter 150/300 pra print. */
  dpi: number
  /** Profundidade: 8 (default), 16, ou 32 bits per channel. */
  bitDepth: 8 | 16 | 32
  /** RGB (default), CMYK, Grayscale, etc. */
  colorMode: PsdColorMode
  /**
   * Composite final renderizado pelo PS (psd.canvas em ag-psd). Bytes do
   * raster pra preview/thumbnail. NAO usado em rendering de layers — esse e
   * o "screenshot" da composicao toda.
   */
  composite: PsdImageData | null
  /** Layers root, ordem ag-psd: index 0 = bottom no painel do PS. */
  layers: PsdLayer[]
  /** Metadata extra: timestamp, autor, profile ICC, etc. */
  metadata: PsdMetadata
}

export type PsdColorMode = "rgb" | "cmyk" | "grayscale" | "indexed" | "lab" | "multichannel" | "duotone" | "bitmap"

export interface PsdMetadata {
  createdAt?: string
  modifiedAt?: string
  /** Profile ICC raw bytes (preservado pra round-trip). */
  iccProfile?: Uint8Array
  /** XMP metadata raw (autor/copyright). */
  xmp?: string
}

// ────────────────────────────────────────────────────────────────────
// Layer (discriminated union)
// ────────────────────────────────────────────────────────────────────

export type PsdLayer =
  | PsdTextLayer
  | PsdImageLayer
  | PsdShapeLayer
  | PsdSmartObjectLayer
  | PsdAdjustmentLayer
  | PsdGroupLayer

interface PsdLayerCommon {
  /** ID estavel (cuid no nosso lado, ou layer.id do PSD). */
  id: string
  /** Nome no painel do PS. */
  name: string
  /** Bbox final na coord absoluta do canvas. */
  bbox: PsdBBox
  /** Visivel no PS (eye icon). */
  visible: boolean
  /** Opacity 0-1. */
  opacity: number
  /** Blend mode (mapping completo abaixo). */
  blendMode: PsdBlendMode
  /** Mask aplicada (raster, vector, ou clipping). null = sem mask. */
  mask: PsdMaskData | null
  /** Effects (layer styles): drop shadow, glow, stroke, etc. */
  effects: PsdLayerEffects
  /** Locked (cadeado no PS). */
  locked: boolean
  /** Path hierarquico de ancestrais (top → direct parent). Sem o proprio nome. */
  groupPath: string[]
  /**
   * Indicador de clipping mask. Se true, este layer recorta o layer
   * IMEDIATAMENTE ABAIXO na ordem do PSD (clipBase). Photoshop encadeia
   * varias clipping em sequencia sobre a mesma base.
   *
   * NOTA: no novo modelo, ao inves de espalhar `clipping=true` por layers
   * individuais, agrupamos em `PsdClippingChain`. Esse field fica aqui pra
   * round-trip + facil migracao do importer antigo.
   */
  clipping: boolean
}

// ── TEXT ─────────────────────────────────────────────────────────────

export interface PsdTextLayer extends PsdLayerCommon {
  type: "text"
  /** Texto raw com \n para line breaks. */
  text: string
  /** Runs de estilo: cada run cobre N caracteres consecutivos. */
  styleRuns: PsdTextStyleRun[]
  /** Estilo default herdado quando run nao especifica. */
  defaultStyle: PsdCharStyle
  /** Estilo de paragrafo (alinhamento, leading). */
  paragraph: PsdParagraphStyle
  /**
   * Transform Adobe-style (scale + rotation + skew). PSDs com transformacao
   * de texto via Free Transform. Default = identity.
   */
  transform: PsdTransform2D
  /**
   * Tag 'lnsr' do PSD — controla se o PS auto-renomeia o layer quando user
   * edita o texto:
   *   'srct' (source) — nome vem do conteudo → PS atualiza ao editar
   *   'lyr '          — nome manual           → PS NAO mexe mais
   * Undefined no import = manter default no export ('srct').
   * Round-trip: PSD importado com 'lyr ' eh re-exportado como 'lyr '.
   */
  nameSource?: string
}

export interface PsdTextStyleRun {
  /** Posicao inicial do run no texto raw (inclusivo). */
  start: number
  /** Quantidade de caracteres cobertos por este run. */
  length: number
  /** Override de estilo. Campos undefined herdam de defaultStyle. */
  style: Partial<PsdCharStyle>
}

export interface PsdCharStyle {
  /** Family name normalizado (sem sufixos de variable font). */
  fontFamily: string
  /** Peso CSS: 100-900. */
  fontWeight: number
  /** "normal" ou "italic". */
  fontStyle: "normal" | "italic"
  /** Tamanho em pontos PSD (pre-transform). */
  fontSize: number
  /** Cor hex #RRGGBB. */
  color: string
  /** Tracking em 1/1000 em (igual Fabric charSpacing). */
  tracking: number
  /**
   * Leading em pontos PSD (Adobe-style — leading absoluto).
   * undefined = auto-leading (1.2x fontSize).
   */
  leading?: number
  /** Underline + strikethrough flags. */
  underline?: boolean
  strikethrough?: boolean
  /** PSD "fauxBold" + "fauxItalic" — usados quando fonte nao tem o weight/style real. */
  fauxBold?: boolean
  fauxItalic?: boolean
}

export interface PsdParagraphStyle {
  align: "left" | "center" | "right" | "justify"
  /** Indentação primeira linha (pontos). */
  firstLineIndent?: number
  /** Espaço antes/depois do paragrafo (pontos). */
  spaceBefore?: number
  spaceAfter?: number
}

// ── IMAGE ────────────────────────────────────────────────────────────

export interface PsdImageLayer extends PsdLayerCommon {
  type: "image"
  /** Bytes do raster do layer (canvas decoded por ag-psd). */
  imageData: PsdImageData
  /**
   * Indica se o canvas entregue ja contem effects/style aplicados pelo PS
   * (caso comum quando ag-psd nao re-renderiza). Editor decide se usa direto
   * ou re-aplica effects.
   */
  pixelsIncludeEffects: boolean
}

// ── SHAPE ────────────────────────────────────────────────────────────

export interface PsdShapeLayer extends PsdLayerCommon {
  type: "shape"
  /** Path SVG do shape (d="..."). Coords no espaco absoluto do canvas. */
  path: string
  /** Bbox do path (pode ser menor que layer.bbox quando ha effects). */
  pathBbox: PsdBBox
  /** Fill (solid/gradient/pattern). null = no fill. */
  fill: PsdFill | null
  /** Stroke (border). null = no stroke. */
  stroke: PsdStroke | null
  /** Even-odd vs non-zero pra polygons complexos. */
  fillRule: "nonzero" | "evenodd"
}

export type PsdFill =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; gradient: PsdGradient }
  | { kind: "pattern"; pattern: PsdPattern }

export interface PsdStroke {
  width: number
  color: string
  /** Position relativa ao path. */
  position: "inside" | "center" | "outside"
  /** Cap das linhas. */
  cap: "butt" | "round" | "square"
  /** Join nos vertices. */
  join: "miter" | "round" | "bevel"
  /** Dash pattern (array de gaps + fills em pontos). */
  dash?: number[]
  /**
   * Flag round-trip: stroke veio do PSD original como `vectorStroke`
   * (Shape Layer nativo do PS), nao como Layer Style. Re-export deve
   * preservar a forma vetorial nativa (editavel via Properties Panel
   * no PS) em vez de cair em effects.stroke[]. Default false = stroke
   * foi gerado/editado no ZZOSY, vai como effects.stroke.
   */
  isNativeVectorStroke?: boolean
}

// ── SMART OBJECT ─────────────────────────────────────────────────────

export interface PsdSmartObjectLayer extends PsdLayerCommon {
  type: "smartObject"
  /**
   * Conteudo bruto do Smart Object — bytes do arquivo embedded (.psb, .psd,
   * .jpg, .png, .ai, etc). NULL quando linked externamente (file path
   * referenciado, nao embedded). PSDs profissionais quase sempre usam embedded.
   */
  content: PsdSmartObjectContent
  /** Transform 2D aplicada ao container (PSD 8-corner matrix). */
  transform: PsdTransform2D
  /**
   * Composite raster que ag-psd ja renderizou (preview do conteudo embedded
   * com transform aplicada). Usado pra preview rapido sem decodificar o nested.
   */
  composite: PsdImageData | null
  /**
   * Quando true, o Smart Object foi detectado como "wrapper" (contem o design
   * completo embedded + outros layers superiores duplicam parcialmente o
   * conteudo). Heuristica em psdReader. Editor decide visibilidade default.
   */
  isWrapper: boolean
}

export type PsdSmartObjectContent =
  | { kind: "embedded"; format: "psb" | "psd" | "png" | "jpg" | "ai" | "pdf" | "unknown"; bytes: Uint8Array }
  | { kind: "linked"; filePath: string; checksum?: string }
  | { kind: "unknown" }

// ── ADJUSTMENT ───────────────────────────────────────────────────────

export interface PsdAdjustmentLayer extends PsdLayerCommon {
  type: "adjustment"
  /** Subtipo. */
  adjustment: PsdAdjustmentData
}

export type PsdAdjustmentData =
  | { kind: "levels"; channels: { input: [number, number, number]; output: [number, number] }[] }
  | { kind: "curves"; curves: { input: number; output: number }[][] }
  | { kind: "brightnessContrast"; brightness: number; contrast: number }
  | { kind: "hueSaturation"; hue: number; saturation: number; lightness: number; colorize: boolean }
  | { kind: "colorBalance"; shadows: [number, number, number]; midtones: [number, number, number]; highlights: [number, number, number] }
  | { kind: "invert" }
  | { kind: "blackAndWhite"; channels: { red: number; yellow: number; green: number; cyan: number; blue: number; magenta: number } }
  | { kind: "photoFilter"; color: string; density: number }
  | { kind: "gradientMap"; gradient: PsdGradient }
  | { kind: "selectiveColor"; channels: Record<string, [number, number, number, number]> }
  | { kind: "unknown"; raw: Record<string, unknown> }

// ── GROUP (folder) ──────────────────────────────────────────────────

export interface PsdGroupLayer extends PsdLayerCommon {
  type: "group"
  /** Children do folder, mesma ordem do PSD (bottom→top). */
  children: PsdLayer[]
  /**
   * Folder pass-through (sem composite isolado) vs normal blend.
   * Pass-through: blendModes dos children aplicam direto no parent.
   * Normal blend: folder vira "group" composite que aplica seu proprio blendMode.
   */
  passThrough: boolean
}

// ────────────────────────────────────────────────────────────────────
// Mask
// ────────────────────────────────────────────────────────────────────

export type PsdMaskData =
  | PsdRasterMask
  | PsdVectorMask
  | PsdClippingMaskMarker

export interface PsdRasterMask {
  kind: "raster"
  /** Bytes grayscale (1 channel) do PSD. */
  imageData: PsdImageData
  /** Bbox absoluto da mask (ag-psd posRel ja resolvido). */
  bbox: PsdBBox
  /** Default fill fora do bbox: 0 = transparente, 255 = opaco. */
  defaultColor: 0 | 255
  /** Mask desabilitada (mas presente no PSD, preservada pra round-trip). */
  disabled: boolean
  /** Mask invertida. */
  invert: boolean
}

export interface PsdVectorMask {
  kind: "vector"
  /** Path SVG do vector mask. */
  path: string
  /** Bbox do path. */
  bbox: PsdBBox
  disabled: boolean
  invert: boolean
}

export interface PsdClippingMaskMarker {
  kind: "clipping"
  /** ID do layer base (clipBase) que este layer recorta. */
  baseLayerId: string
}

// ────────────────────────────────────────────────────────────────────
// Effects (layer styles)
// ────────────────────────────────────────────────────────────────────

export interface PsdLayerEffects {
  dropShadow?: PsdShadowEffect
  innerShadow?: PsdShadowEffect
  outerGlow?: PsdGlowEffect
  innerGlow?: PsdGlowEffect
  stroke?: PsdStrokeEffect
  colorOverlay?: PsdColorOverlayEffect
  gradientOverlay?: PsdGradientOverlayEffect
  patternOverlay?: PsdPatternOverlayEffect
  satin?: PsdSatinEffect
  bevel?: PsdBevelEffect
}

export interface PsdShadowEffect {
  enabled: boolean
  color: string
  opacity: number // 0-1
  angle: number // graus, 0 = direita, 90 = baixo
  distance: number // pontos
  blur: number // pontos
  spread: number // 0-1 (choke pra shadows internas)
  blendMode: PsdBlendMode
}

export interface PsdGlowEffect {
  enabled: boolean
  color: string
  opacity: number
  blur: number
  spread: number
  blendMode: PsdBlendMode
  /** Outer glow tem source (center/edge). Inner glow ignorado. */
  source?: "center" | "edge"
}

export interface PsdStrokeEffect {
  enabled: boolean
  width: number
  position: "inside" | "center" | "outside"
  fill: PsdFill // stroke pode ter gradient/pattern, nao so cor
  blendMode: PsdBlendMode
  opacity: number
}

export interface PsdColorOverlayEffect {
  enabled: boolean
  color: string
  opacity: number
  blendMode: PsdBlendMode
}

export interface PsdGradientOverlayEffect {
  enabled: boolean
  gradient: PsdGradient
  opacity: number
  blendMode: PsdBlendMode
  angle: number
  scale: number
  reverse: boolean
}

export interface PsdPatternOverlayEffect {
  enabled: boolean
  pattern: PsdPattern
  opacity: number
  blendMode: PsdBlendMode
  scale: number
}

export interface PsdSatinEffect {
  enabled: boolean
  color: string
  opacity: number
  angle: number
  distance: number
  size: number
  blendMode: PsdBlendMode
  invert: boolean
}

export interface PsdBevelEffect {
  enabled: boolean
  style: "innerBevel" | "outerBevel" | "emboss" | "pillowEmboss" | "strokeEmboss"
  technique: "smooth" | "chiselHard" | "chiselSoft"
  depth: number
  direction: "up" | "down"
  size: number
  soften: number
  /** Light + shadow components. */
  highlightColor: string
  highlightBlendMode: PsdBlendMode
  highlightOpacity: number
  shadowColor: string
  shadowBlendMode: PsdBlendMode
  shadowOpacity: number
  /** Light source direction (PS slider). 0-360. Default 120. */
  angle?: number
  /** Light source altitude. 0-90 (degrees). Default 30. */
  altitude?: number
}

// ────────────────────────────────────────────────────────────────────
// Blend modes (PS oficial — 27 + normal)
// ────────────────────────────────────────────────────────────────────

export type PsdBlendMode =
  | "normal"
  | "dissolve"
  | "darken" | "multiply" | "colorBurn" | "linearBurn" | "darkerColor"
  | "lighten" | "screen" | "colorDodge" | "linearDodge" | "lighterColor"
  | "overlay" | "softLight" | "hardLight" | "vividLight" | "linearLight" | "pinLight" | "hardMix"
  | "difference" | "exclusion" | "subtract" | "divide"
  | "hue" | "saturation" | "color" | "luminosity"
  | "passThrough" // exclusivo de folders

// ────────────────────────────────────────────────────────────────────
// Gradient + Pattern
// ────────────────────────────────────────────────────────────────────

export interface PsdGradient {
  kind: "linear" | "radial" | "angle" | "reflected" | "diamond"
  /** Stops com posicao 0-1 + cor hex + opacity 0-1. */
  stops: { position: number; color: string; opacity: number }[]
  /** Smoothness 0-1. */
  smoothness?: number
}

export interface PsdPattern {
  /** Bytes do pattern (raster). */
  imageData: PsdImageData
  /** Tiles per canvas. */
  scale: number
  /** Origem do tile dentro do canvas. */
  origin: { x: number; y: number }
}

// ────────────────────────────────────────────────────────────────────
// Primitivas
// ────────────────────────────────────────────────────────────────────

export interface PsdBBox {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Transform 2D Adobe-style: 4 corners (8 numbers).
 * Matrix mais geral que CSS transform — captura skew/perspectiva.
 */
export interface PsdTransform2D {
  /** 8 numbers: [tlX,tlY, trX,trY, brX,brY, blX,blY] */
  corners: [number, number, number, number, number, number, number, number]
}

/** Identity transform pra layers sem placedLayer. */
export const IDENTITY_TRANSFORM: PsdTransform2D = {
  corners: [0, 0, 0, 0, 0, 0, 0, 0],
}

/**
 * Bytes do raster + metadata. Generico pra qualquer canvas:
 *  - browser: HTMLCanvasElement.toDataURL ou ImageBitmap
 *  - node: Buffer (PNG bytes)
 *  - serializacao: data URL "data:image/png;base64,..."
 */
export interface PsdImageData {
  /** Bytes RGBA8 (ou base64 dataUrl pra serializacao). */
  data: Uint8ClampedArray | string
  /** Dimensoes em pixels. */
  width: number
  height: number
  /** Indica formato dos `data`: "raw" = RGBA bytes, "dataUrl" = base64 string. */
  format: "raw" | "dataUrl"
}

// ────────────────────────────────────────────────────────────────────
// Clipping chain (estrutura derivada)
// ────────────────────────────────────────────────────────────────────

/**
 * Em vez de espalhar `clipping=true` por layers individuais, depois do
 * reader corre, derivamos clipping chains:
 *
 *   PsdClippingChain {
 *     base: PsdLayer (Layer 1 — silhueta no Sicredi)
 *     clipped: [BA, IMAGENS]  // layers clipping=true acima do base, na ordem
 *   }
 *
 * Renderer renderiza a chain como UMA unidade: cria offscreen canvas
 * com base, desenha clipped por cima respeitando blend modes, aplica
 * a silhueta do base como mask, blit no canvas final.
 */
export interface PsdClippingChain {
  base: PsdLayer
  clipped: PsdLayer[]
}
