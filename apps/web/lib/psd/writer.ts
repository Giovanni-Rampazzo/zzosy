/**
 * psdWriter — escrita PURA de PsdDocument → bytes PSD.
 *
 * Inverso do psdReader. Recebe PsdDocument (modelo TypeScript do ZZOSY),
 * converte pro shape do ag-psd, chama writePsd, devolve ArrayBuffer.
 *
 * Roda em browser ou Node (depende de ag-psd canvas init pra layer rasters).
 *
 * Diferenca chave da abordagem antiga (exportPiece.exportPSDBlob):
 *  - Esse writer trabalha sobre PsdDocument (modelo ZZOSY puro), NAO sobre
 *    o estado do editor. Garantia: import → write produz PSD com mesma
 *    estrutura (round-trip).
 *  - Para export PARTINDO do editor, primeiro converter editor state →
 *    PsdDocument (futuro: lib/psd/fromEditor.ts), depois chamar este writer.
 */
import { writePsd } from "ag-psd"
import { psdPx } from "./psdHelpers"
import type {
  PsdDocument,
  PsdLayer,
  PsdTextLayer,
  PsdImageLayer,
  PsdShapeLayer,
  PsdSmartObjectLayer,
  PsdGroupLayer,
  PsdLayerEffects,
  PsdShadowEffect,
  PsdGlowEffect,
  PsdStrokeEffect,
  PsdColorOverlayEffect,
  PsdGradientOverlayEffect,
  PsdSatinEffect,
  PsdBevelEffect,
  PsdMaskData,
  PsdImageData,
  PsdBlendMode,
} from "./types"

export interface WriteResult {
  /** Bytes do PSD pronto pra download/upload. */
  bytes: ArrayBuffer
  /** Warnings durante a escrita (features fora de escopo, etc). */
  warnings: WriteWarning[]
}

export interface WriteWarning {
  kind: "feature-skipped" | "imagedata-missing" | "format-fallback"
  layerName: string
  message: string
}

export interface WriteOptions {
  /** Generate composite thumbnail no PSD? Custa CPU mas PS prefere ter. */
  generateThumbnail?: boolean
  /**
   * invalidateTextLayers — sinaliza pro PS re-renderizar texto na abertura.
   * Sempre true em export de ZZOSY pois o texto pode ter mudado styles
   * que o PS precisa redesenhar com a fonte real.
   */
  invalidateTextLayers?: boolean
}

/**
 * Converte PsdDocument em bytes PSD usando ag-psd.
 */
export function writePsdDocument(doc: PsdDocument, opts: WriteOptions = {}): WriteResult {
  const warnings: WriteWarning[] = []
  const warn = (w: WriteWarning) => warnings.push(w)
  // Smart Objects (embedded ou linked) populam linkedFiles[] no top-level do PSD.
  // Cada SO no documento referencia uma entry via placedLayer.id. Sem isso, o
  // re-import perde os bytes/filePath.
  const linkedFiles: any[] = []

  const psd: any = {
    width: doc.width,
    height: doc.height,
    children: doc.layers.map(l => layerToAgPsd(l, warn, linkedFiles)).filter(Boolean),
    ...(linkedFiles.length > 0 ? { linkedFiles } : {}),
    imageResources: {
      resolutionInfo: {
        horizontalResolution: doc.dpi,
        horizontalResolutionUnit: "PPI" as const,
        widthUnit: "Inches" as const,
        verticalResolution: doc.dpi,
        verticalResolutionUnit: "PPI" as const,
        heightUnit: "Inches" as const,
      },
    },
    colorMode: colorModeToAgPsd(doc.colorMode),
    bitsPerChannel: doc.bitDepth,
  }

  // Composite final — Photoshop usa pra preview ao abrir o arquivo
  if (doc.composite && doc.composite.format === "dataUrl") {
    // ag-psd quer canvas/imageData. Em browser, podemos converter dataUrl
    // em HTMLCanvasElement. Em node, defer ate ter um canvas adapter.
    // Por ora, sem composite (PS regenera ao abrir + invalidateTextLayers).
  }

  const bytes = writePsd(psd, {
    generateThumbnail: opts.generateThumbnail ?? false,
    invalidateTextLayers: opts.invalidateTextLayers ?? true,
  })

  return { bytes, warnings }
}

// ────────────────────────────────────────────────────────────────────
// Layer conversion: PsdLayer → ag-psd Layer
// ────────────────────────────────────────────────────────────────────

function layerToAgPsd(l: PsdLayer, warn: (w: WriteWarning) => void, linkedFiles: any[]): any | null {
  const common = {
    name: l.name,
    hidden: !l.visible,
    opacity: l.opacity,
    blendMode: blendModeToAgPsd(l.blendMode),
    left: l.bbox.left,
    top: l.bbox.top,
    right: l.bbox.right,
    bottom: l.bbox.bottom,
    transparencyProtected: l.locked,
    clipping: l.clipping,
    ...(l.mask ? maskToAgPsd(l.mask, warn, l.name) : {}),
    ...(hasEffects(l.effects) ? { effects: effectsToAgPsd(l.effects) } : {}),
  }

  switch (l.type) {
    case "group":
      return { ...common, children: l.children.map(c => layerToAgPsd(c, warn, linkedFiles)).filter(Boolean) }
    case "text":
      return { ...common, ...textToAgPsd(l) }
    case "image":
      return { ...common, ...imageToAgPsd(l, warn) }
    case "smartObject":
      return { ...common, ...smartObjectToAgPsd(l, warn, linkedFiles) }
    case "shape":
      return { ...common, ...shapeToAgPsd(l, warn) }
    case "adjustment":
      // Adjustment layers fora de escopo — emite layer vazio com warning
      warn({
        kind: "feature-skipped",
        layerName: l.name,
        message: "Adjustment Layer ignorada no export (fora de escopo). Aplique manualmente no PS depois.",
      })
      return null
  }
}

// ── TEXT ─────────────────────────────────────────────────────────────

function textToAgPsd(l: PsdTextLayer): any {
  // ag-psd Layer.text shape:
  //   { text: string, style: CharStyle (default), styleRuns: [{ length, style }],
  //     paragraphStyle: { justification, ... }, transform: matrix }
  //
  // nameSource ('lnsr' tag): PS usa pra auto-renomear layers ao editar texto.
  //  - 'srct' = "source" = nome vem do conteudo → PS atualiza ao editar
  //  - 'lyr ' = "layer"  = manual              → PS NAO mexe
  // Default 'srct' = comportamento Adobe esperado. Preserva valor do import
  // quando definido (ex: PSD original com nome manual).
  return {
    nameSource: l.nameSource ?? "srct",
    text: {
      text: l.text,
      style: charStyleToAgPsd(l.defaultStyle),
      styleRuns: l.styleRuns.map(r => ({
        length: r.length,
        style: charStyleToAgPsd({ ...l.defaultStyle, ...r.style }),
      })),
      paragraphStyle: {
        justification: l.paragraph.align === "left" ? "left"
          : l.paragraph.align === "center" ? "center"
          : l.paragraph.align === "right" ? "right"
          : "justify",
        firstLineIndent: l.paragraph.firstLineIndent,
        spaceBefore: l.paragraph.spaceBefore,
        spaceAfter: l.paragraph.spaceAfter,
      },
    },
  }
}

function charStyleToAgPsd(s: PsdTextLayer["defaultStyle"]): any {
  return {
    font: { name: s.fontFamily },
    fontSize: s.fontSize,
    fillColor: hexToRgb(s.color),
    tracking: s.tracking,
    leading: s.leading,
    underline: s.underline,
    strikethrough: s.strikethrough,
    fauxBold: s.fauxBold,
    fauxItalic: s.fauxItalic,
  }
}

// ── IMAGE ────────────────────────────────────────────────────────────

function imageToAgPsd(l: PsdImageLayer, warn: (w: WriteWarning) => void): any {
  // ag-psd quer canvas. Em browser podemos decodificar dataUrl pra HTMLCanvas.
  // Em node sem canvas adapter, deixamos canvas vazio + warning.
  const canvas = imageDataToCanvas(l.imageData, warn, l.name)
  return canvas ? { canvas } : {}
}

// ── SMART OBJECT ─────────────────────────────────────────────────────

function smartObjectToAgPsd(l: PsdSmartObjectLayer, warn: (w: WriteWarning) => void, linkedFiles: any[]): any {
  // Smart Object preserva conteudo via linkedFiles[] no top-level do PSD.
  // Cada SO referencia uma entry pelo placedLayer.id (GUID). Reader resolve
  // via linkedFiles.get(placed.id).
  const canvas = l.composite ? imageDataToCanvas(l.composite, warn, l.name) : null
  // ag-psd writePsd exige GUID format pro placedLayer.id.
  const placedId = ensureGuid(l.id)
  const placedW = canvas?.width ?? Math.max(1, Math.round(l.bbox.right - l.bbox.left))
  const placedH = canvas?.height ?? Math.max(1, Math.round(l.bbox.bottom - l.bbox.top))

  // Popula linkedFiles[]:
  //  - embedded: emite entry com data=bytes preservando o conteudo original
  //    (PSB/PDF/JPG/PNG/AI). Reader.ts:339 le esses bytes de volta.
  //  - linked: emite entry SEM data (so name=filePath). PS aceita como
  //    referencia externa nao-embedada. Reader.ts:335 retorna {kind: linked,
  //    filePath: lf.name}.
  //  - unknown: nenhuma entry — placedLayer fica orfa, reader retorna
  //    {kind: unknown} no re-import.
  if (l.content.kind === "embedded") {
    linkedFiles.push({
      id: placedId,
      name: `${l.name}.${l.content.format === "unknown" ? "psb" : l.content.format}`,
      data: l.content.bytes,
    })
  } else if (l.content.kind === "linked") {
    linkedFiles.push({
      id: placedId,
      name: l.content.filePath,
      // Sem data: PS trata como linked externo (nao embedded).
    })
  }

  const placedLayer = {
    id: placedId,
    type: contentKindToPlacedType(l.content),
    transform: l.transform.corners,
    width: placedW,
    height: placedH,
  }
  return {
    ...(canvas ? { canvas } : {}),
    placedLayer,
  }
}

/**
 * Garante GUID v4 format (8-4-4-4-12 hex). Se input ja eh GUID, retorna.
 * Senao deriva GUID DETERMINISTICO de input via hash simples — mesmo
 * input ⇒ mesmo GUID, garantindo round-trip estavel.
 */
function ensureGuid(input: string): string {
  const guidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (guidRe.test(input)) return input
  // Hash deterministico: cdb (cyrb53-like) → 12 bytes hex
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const lo = ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).padStart(16, "0").slice(0, 16)
  const hi = ((h2 >>> 0).toString(16) + (h1 >>> 0).toString(16)).padStart(16, "0").slice(0, 16)
  const full = (lo + hi).padEnd(32, "0").slice(0, 32)
  return `${full.slice(0,8)}-${full.slice(8,12)}-4${full.slice(13,16)}-8${full.slice(17,20)}-${full.slice(20,32)}`
}

function contentKindToPlacedType(content: PsdSmartObjectLayer["content"]): "unknown" | "vector" | "raster" | "image stack" {
  // ag-psd accepted types: 'unknown' | 'vector' | 'raster' | 'image stack'
  if (content.kind === "embedded") {
    // PDF/AI sao vetoriais; PSB/PSD/PNG/JPG sao raster
    if (content.format === "pdf" || content.format === "ai") return "vector"
    return "raster"
  }
  return "unknown"
}

// ── SHAPE ────────────────────────────────────────────────────────────

function shapeToAgPsd(l: PsdShapeLayer, warn: (w: WriteWarning) => void): any {
  // Shape ideal seria emitir vectorMask + vectorFill + vectorStroke.
  // ag-psd suporta isso mas a estrutura de knots/paths eh complexa de
  // reconstruir SEMPRE corretamente do SVG path string. Por ora, emite
  // vectorMask basico (rasterizado pelo PS na abertura).
  if (!l.path) {
    warn({
      kind: "feature-skipped",
      layerName: l.name,
      message: "Shape sem path data — ag-psd nao consegue exportar shape vazio.",
    })
    return {}
  }
  const out: any = {}
  if (l.fill?.kind === "solid") {
    out.vectorFill = { type: "color", color: hexToRgb(l.fill.color) }
  }
  // VECTOR STROKE NATIVO — quando reader marcou `isNativeVectorStroke=true`
  // (PSD original tinha Shape Layer com stroke vetorial), preserva como
  // vectorStroke nativo do PS (editavel via Properties Panel). Caso
  // contrario stroke cai em effects.stroke (Layer Style), pra evitar dupla
  // emissao.
  if (l.stroke && l.stroke.isNativeVectorStroke) {
    const hasFill = !!out.vectorFill
    out.vectorStroke = {
      strokeEnabled: true,
      fillEnabled: hasFill,
      lineWidth: { value: l.stroke.width, units: "Pixels" as const },
      lineDashOffset: { value: 0, units: "Pixels" as const },
      lineCapType: l.stroke.cap === "round" ? "round" as const
        : l.stroke.cap === "square" ? "square" as const
        : "butt" as const,
      lineJoinType: l.stroke.join === "round" ? "round" as const
        : l.stroke.join === "bevel" ? "bevel" as const
        : "miter" as const,
      lineAlignment: l.stroke.position as "inside" | "center" | "outside",
      miterLimit: 100,
      strokeAdjust: false,
      scaleLock: false,
      blendMode: "normal" as const,
      opacity: 1,
      content: { type: "color" as const, color: hexToRgb(l.stroke.color) },
      resolution: 72,
    }
  }
  if (!out.vectorFill && !out.vectorStroke) {
    warn({
      kind: "format-fallback",
      layerName: l.name,
      message: "Shape exportado sem vectorFill/vectorStroke original (round-trip parcial). Reabra no PS pra editar paths.",
    })
  }
  return out
}

// ────────────────────────────────────────────────────────────────────
// Mask conversion
// ────────────────────────────────────────────────────────────────────

function maskToAgPsd(mask: PsdMaskData, warn: (w: WriteWarning) => void, layerName: string): any {
  if (mask.kind === "raster") {
    const canvas = imageDataToCanvas(mask.imageData, warn, layerName)
    if (!canvas) return {}
    return {
      mask: {
        canvas,
        left: mask.bbox.left,
        top: mask.bbox.top,
        right: mask.bbox.right,
        bottom: mask.bbox.bottom,
        defaultColor: mask.defaultColor,
        disabled: mask.disabled,
        positionRelativeToLayer: false,
      },
    }
  }
  if (mask.kind === "vector") {
    // ag-psd quer vectorMask.paths[] com knots — converter SVG path string
    // de volta pra knots e' complexo. Por ora deixa raster fallback ou
    // omite (PS regenera defaults).
    warn({
      kind: "format-fallback",
      layerName,
      message: "Vector mask exportada como raster (round-trip parcial). Path original preservado em metadata se houver.",
    })
    return {}
  }
  // clipping mask placeholder — sinalizada via layer.clipping=true (ja em common)
  return {}
}

// ────────────────────────────────────────────────────────────────────
// Effects conversion
// ────────────────────────────────────────────────────────────────────

function effectsToAgPsd(fx: PsdLayerEffects): any {
  // ag-psd shape — alguns campos sao ARRAY (LayerEffect___[]), outros sao
  // SINGLE objeto. Confirmar na agpsd psd.d.ts antes de adicionar effect novo.
  //   ARRAYS:  dropShadow, innerShadow, solidFill, stroke, gradientOverlay
  //   SINGLES: outerGlow, innerGlow, bevel, satin, patternOverlay
  // Emitir como o tipo errado faz ag-psd writePsd OUTPUTAR o effect VAZIO ({})
  // (sem campos). Bug pre-existente: outerGlow/innerGlow embrulhados em array
  // sumiam silenciosamente.
  const out: any = {}
  if (fx.dropShadow) out.dropShadow = [shadowToAgPsd(fx.dropShadow)]
  if (fx.innerShadow) out.innerShadow = [shadowToAgPsd(fx.innerShadow)]
  if (fx.outerGlow) out.outerGlow = glowToAgPsd(fx.outerGlow, "outer")
  if (fx.innerGlow) out.innerGlow = glowToAgPsd(fx.innerGlow, "inner")
  if (fx.stroke) out.stroke = [strokeEffectToAgPsd(fx.stroke)]
  if (fx.colorOverlay) out.solidFill = [colorOverlayToAgPsd(fx.colorOverlay)]
  if (fx.gradientOverlay) out.gradientOverlay = [gradientOverlayToAgPsd(fx.gradientOverlay)]
  if (fx.satin) out.satin = satinToAgPsd(fx.satin)
  if (fx.bevel) out.bevel = bevelToAgPsd(fx.bevel)
  // patternOverlay omitido — preserva pattern bytes precisa mapeio dedicado
  // (mesmo escopo do shape.fill.kind="pattern"). Fase 5+.
  return out
}

// ag-psd UnitsValue helper centralizado em lib/psd/psdHelpers.psdPx.
// Alias local mantido pra reduzir churn nas chamadas existentes neste arquivo.
const px = psdPx

function shadowToAgPsd(s: PsdShadowEffect): any {
  return {
    enabled: s.enabled,
    color: hexToRgb(s.color),
    opacity: s.opacity,
    angle: s.angle,
    distance: px(s.distance),
    size: px(s.blur),
    choke: px(s.spread * 100), // choke vem como units (PercentageUnits, mas ag-psd aceita Pixels)
    blendMode: blendModeToAgPsd(s.blendMode),
  }
}

function glowToAgPsd(g: PsdGlowEffect, kind: "outer" | "inner"): any {
  return {
    enabled: g.enabled,
    color: hexToRgb(g.color),
    opacity: g.opacity,
    size: px(g.blur),
    choke: px(g.spread * 100),
    blendMode: blendModeToAgPsd(g.blendMode),
    ...(kind === "outer" && g.source ? { source: g.source } : {}),
  }
}

function strokeEffectToAgPsd(s: PsdStrokeEffect): any {
  return {
    enabled: s.enabled,
    size: px(s.width),
    position: s.position,
    color: s.fill.kind === "solid" ? hexToRgb(s.fill.color) : hexToRgb("#000000"),
    blendMode: blendModeToAgPsd(s.blendMode),
    opacity: s.opacity,
  }
}

function colorOverlayToAgPsd(c: PsdColorOverlayEffect): any {
  return {
    enabled: c.enabled,
    color: hexToRgb(c.color),
    opacity: c.opacity,
    blendMode: blendModeToAgPsd(c.blendMode),
  }
}

function gradientOverlayToAgPsd(g: PsdGradientOverlayEffect): any {
  // ag-psd LayerEffectGradientOverlay shape: type='linear/radial/angle/...',
  // gradient.colorStops/opacityStops em formato Adobe (location 0-1, midpoint 50).
  return {
    enabled: g.enabled,
    opacity: g.opacity,
    blendMode: blendModeToAgPsd(g.blendMode),
    type: g.gradient.kind,
    angle: g.angle,
    scale: g.scale,
    reverse: g.reverse,
    align: true,
    gradient: {
      name: "Custom",
      type: "solid" as const,
      smoothness: 4096,
      colorStops: g.gradient.stops.map(s => ({
        color: hexToRgb(s.color),
        location: s.position,
        midpoint: 50,
      })),
      opacityStops: g.gradient.stops.map(s => ({
        opacity: s.opacity * 100,
        location: s.position,
        midpoint: 50,
      })),
    },
  }
}

function satinToAgPsd(s: PsdSatinEffect): any {
  return {
    enabled: s.enabled,
    color: hexToRgb(s.color),
    opacity: s.opacity,
    angle: s.angle,
    distance: psdPx(s.distance),
    size: psdPx(s.size),
    invert: s.invert,
    blendMode: blendModeToAgPsd(s.blendMode),
  }
}

// Mapeia enum ZZOSY camelCase → ag-psd BevelStyle string-com-espacos.
function bevelStyleToAgPsd(s: PsdBevelEffect["style"]): "inner bevel" | "outer bevel" | "emboss" | "pillow emboss" | "stroke emboss" {
  switch (s) {
    case "innerBevel":   return "inner bevel"
    case "outerBevel":   return "outer bevel"
    case "emboss":       return "emboss"
    case "pillowEmboss": return "pillow emboss"
    case "strokeEmboss": return "stroke emboss"
  }
}
function bevelTechniqueToAgPsd(t: PsdBevelEffect["technique"]): "smooth" | "chisel hard" | "chisel soft" {
  switch (t) {
    case "smooth":     return "smooth"
    case "chiselHard": return "chisel hard"
    case "chiselSoft": return "chisel soft"
  }
}

function bevelToAgPsd(b: PsdBevelEffect): any {
  return {
    enabled: b.enabled,
    style: bevelStyleToAgPsd(b.style),
    technique: bevelTechniqueToAgPsd(b.technique),
    direction: b.direction,
    size: psdPx(b.size),
    soften: psdPx(b.soften),
    strength: b.depth,
    highlightColor: hexToRgb(b.highlightColor),
    highlightBlendMode: blendModeToAgPsd(b.highlightBlendMode),
    highlightOpacity: b.highlightOpacity,
    shadowColor: hexToRgb(b.shadowColor),
    shadowBlendMode: blendModeToAgPsd(b.shadowBlendMode),
    shadowOpacity: b.shadowOpacity,
    angle: typeof b.angle === "number" ? b.angle : 120,
    altitude: typeof b.altitude === "number" ? b.altitude : 30,
    useGlobalLight: false,
  }
}

// ────────────────────────────────────────────────────────────────────
// Mapeamento de enums ZZOSY → ag-psd
// ────────────────────────────────────────────────────────────────────

function colorModeToAgPsd(m: PsdDocument["colorMode"]): number {
  switch (m) {
    case "bitmap":       return 0
    case "grayscale":    return 1
    case "indexed":      return 2
    case "rgb":          return 3
    case "cmyk":         return 4
    case "multichannel": return 7
    case "duotone":      return 8
    case "lab":          return 9
  }
}

/** Inverso de mapBlendMode em reader.ts. ag-psd aceita lowercase com espacos. */
function blendModeToAgPsd(mode: PsdBlendMode): any {
  const m: Record<PsdBlendMode, string> = {
    normal: "normal", dissolve: "dissolve",
    darken: "darken", multiply: "multiply",
    colorBurn: "color burn", linearBurn: "linear burn", darkerColor: "darker color",
    lighten: "lighten", screen: "screen",
    colorDodge: "color dodge", linearDodge: "linear dodge", lighterColor: "lighter color",
    overlay: "overlay", softLight: "soft light", hardLight: "hard light",
    vividLight: "vivid light", linearLight: "linear light", pinLight: "pin light", hardMix: "hard mix",
    difference: "difference", exclusion: "exclusion", subtract: "subtract", divide: "divide",
    hue: "hue", saturation: "saturation", color: "color", luminosity: "luminosity",
    passThrough: "pass through",
  }
  return m[mode] ?? "normal"
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function hasEffects(fx: PsdLayerEffects): boolean {
  return Object.keys(fx).length > 0
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

/**
 * Decoda PsdImageData dataUrl em HTMLCanvasElement pra ag-psd.
 * Retorna null em ambiente sem document (Node sem canvas adapter).
 */
function imageDataToCanvas(img: PsdImageData, warn: (w: WriteWarning) => void, layerName: string): HTMLCanvasElement | null {
  // Caso 1: prepareImageDataAsync ja rodou — img.data eh HTMLCanvasElement
  if ((img as any).format === "canvas" && (img as any).data && typeof (img as any).data.getContext === "function") {
    return (img as any).data as HTMLCanvasElement
  }
  // Caso 2: dataUrl mas ainda nao foi preparado
  if (img.format === "dataUrl" && typeof img.data === "string") {
    warn({
      kind: "imagedata-missing",
      layerName,
      message: "Image data dataUrl precisa de prepareImageDataAsync() antes de writePsdDocument.",
    })
    return null
  }
  // Caso 3: nao temos ambiente browser
  if (typeof document === "undefined") return null
  warn({
    kind: "imagedata-missing",
    layerName,
    message: "Image data em formato nao reconhecido — sem canvas pra emitir.",
  })
  return null
}

/**
 * Pre-decoda todas as imagens do documento em HTMLCanvasElement de forma
 * async. Substitui os PsdImageData.data (dataUrl string) por
 * HTMLCanvasElement direto (mutates document).
 *
 * Use ANTES de writePsdDocument quando o doc tem imageData em formato
 * dataUrl. Apos prepareImageDataAsync, writePsdDocument acessa os canvases
 * diretamente.
 */
/**
 * Rasteriza bgLayers (schema BG-7 do editor) num HTMLCanvasElement.
 * Espelha a logica de lib/exportPiece.renderBgLayersOntoCanvas mas
 * isolada aqui pra nao criar dependencia cruzada entre lib/psd e
 * lib/exportPiece.
 */
async function rasterizeBgLayersToCanvas(bgLayers: any[], width: number, height: number): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null
  const c = document.createElement("canvas")
  c.width = width
  c.height = height
  const ctx = c.getContext("2d")
  if (!ctx) return null
  for (const layer of bgLayers) {
    ctx.save()
    ctx.globalAlpha = typeof layer.opacity === "number" ? layer.opacity : 1
    ctx.globalCompositeOperation = (layer.blendMode ?? "source-over") as GlobalCompositeOperation
    try {
      if (layer.kind === "solid") {
        ctx.fillStyle = layer.color ?? "#ffffff"
        ctx.fillRect(0, 0, width, height)
      } else if (layer.kind === "gradient") {
        const angle = typeof layer.angle === "number" ? layer.angle : 90
        const rad = (angle * Math.PI) / 180
        const cx = width / 2, cy = height / 2
        const r = Math.max(width, height) / 2
        const grad = layer.gradientType === "radial"
          ? ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(width, height) / 2)
          : ctx.createLinearGradient(cx - Math.cos(rad) * r, cy - Math.sin(rad) * r, cx + Math.cos(rad) * r, cy + Math.sin(rad) * r)
        for (const s of (layer.stops ?? [])) {
          if (typeof s?.offset === "number" && typeof s?.color === "string") grad.addColorStop(s.offset, s.color)
        }
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, width, height)
      } else if (layer.kind === "image" && typeof layer.imageDataUrl === "string" && layer.imageDataUrl) {
        const img = await new Promise<HTMLImageElement | null>((resolve) => {
          const i = new Image()
          i.crossOrigin = "anonymous"
          i.onload = () => resolve(i)
          i.onerror = () => resolve(null)
          i.src = layer.imageDataUrl
        })
        if (img) {
          if (layer.fit === "tile") {
            const pat = ctx.createPattern(img, "repeat")
            if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, width, height) }
          } else if (layer.fit === "fill") {
            ctx.drawImage(img, 0, 0, width, height)
          } else {
            const iw = img.naturalWidth || img.width || 1
            const ih = img.naturalHeight || img.height || 1
            const s = layer.fit === "contain" ? Math.min(width / iw, height / ih) : Math.max(width / iw, height / ih)
            const dw = iw * s, dh = ih * s
            ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh)
          }
        }
      }
    } finally {
      ctx.restore()
    }
  }
  return c
}

export async function prepareImageDataAsync(doc: PsdDocument): Promise<void> {
  if (typeof document === "undefined") return
  const decodes: Promise<void>[] = []

  async function decodeOne(imgData: PsdImageData): Promise<void> {
    if (imgData.format !== "dataUrl" || typeof imgData.data !== "string") return
    const url = imgData.data as string
    // BG-7 placeholder: __zzosy-bg:<encoded JSON> — rasteriza bgLayers
    // diretamente num canvas (sem precisar de Image load). Usado pra
    // background gradient/solid/image saido do editor via fromEditor.
    if (url.startsWith("__zzosy-bg:")) {
      try {
        const payload = JSON.parse(decodeURIComponent(url.slice("__zzosy-bg:".length)))
        const c = await rasterizeBgLayersToCanvas(payload.bgLayers, payload.width, payload.height)
        if (c) {
          ;(imgData as any).data = c as any
          ;(imgData as any).format = "canvas"
        }
      } catch (e) { console.warn("[psd-writer] bg placeholder falhou:", e) }
      return
    }
    return new Promise((resolve) => {
      const el = new Image()
      el.onload = () => {
        const c = document.createElement("canvas")
        c.width = el.naturalWidth || imgData.width
        c.height = el.naturalHeight || imgData.height
        const ctx = c.getContext("2d")
        if (ctx) ctx.drawImage(el, 0, 0)
        ;(imgData as any).data = c as any
        ;(imgData as any).format = "canvas"
        resolve()
      }
      el.onerror = () => resolve()
      el.src = url
    })
  }

  function walk(layers: PsdLayer[]) {
    for (const l of layers) {
      if (l.type === "image") decodes.push(decodeOne(l.imageData))
      if (l.type === "smartObject" && l.composite) decodes.push(decodeOne(l.composite))
      if (l.mask?.kind === "raster") decodes.push(decodeOne(l.mask.imageData))
      if (l.type === "group") walk(l.children)
    }
  }
  walk(doc.layers)

  await Promise.all(decodes)
}
