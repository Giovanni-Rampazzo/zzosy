"use client"
import React, { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { GeneratePiecesModal } from "./GeneratePiecesModal"
import { FontPicker, WeightPicker } from "./FontPicker"
import { ExportDialog } from "@/components/pieces/ExportDialog"
import { PsdImporter, type PsdImporterHandle } from "@/components/campaign/PsdImporter"
import { MaskPanel } from "./MaskPanel"
import { ColorSwatchPicker } from "./ColorSwatchPicker"
import { MaskThumb } from "./MaskThumb"
import { migrateStyles } from "@/lib/migrateStyles"
import { normalizeName } from "@/lib/normalize"
import { getClipboard, setClipboard } from "@/lib/editorClipboard"
import { applyMaskToFabricObject } from "@/lib/applyMaskToFabric"
import { buildShapePath, type ShapeKind } from "@/lib/shapePaths"
import { inpS, numInpS, secS, numFieldGrid, numFieldRight, numFieldUnit } from "@/lib/editorFieldStyles"
import { leadingPtToFabricLineHeight } from "@/lib/fabricLineHeight"
import { loadGoogleFont, loadCustomFontFamily, ensurePsdFontsReady, forceLoadFontFaces, GOOGLE_FONTS } from "@/lib/google-fonts"

// Em produção, warnings de saude do editor (objetos orfaos, race conditions, etc)
// poluem o console sem valor pro user final. Em dev, sao essenciais pra diagnostico.
// editorLog encapsula isso — silenciamos em prod mas mantemos warnings reais
// (falhas de upload, erros de PATCH) via console.warn direto.
const isDev = process.env.NODE_ENV !== "production"
function editorLog(...args: any[]) {
  if (isDev) console.warn(...args)
}

interface TextSpan {
  text: string
  style: { color?: string; fontSize?: number; fontWeight?: string; fontFamily?: string }
}
interface Asset {
  id: string; type: string; label: string; value: string | null
  imageUrl: string | null; content: any
  lastOverride?: any
  // Smart Object preservado do PSD original (round-trip ZZOSY ↔ Photoshop).
  // null/undefined = asset eh IMAGE comum (PNG/JPG/SVG).
  smartObject?: {
    id: string
    guid: string
    filePath: string
    mime: string
    originalName: string
    width: number | null
    height: number | null
  } | null
}
interface Layer {
  assetId: string; posX: number; posY: number
  scaleX: number; scaleY: number; rotation: number; zIndex: number; width: number; height?: number
  overrides?: any
}
interface BrandColor {
  hex: string
  name?: string | null
  role?: "principal" | "secundaria" | "apoio" | "neutra" | "primary" | "secondary"
}
interface CustomFontFile { url: string; weight: number; style: "normal" | "italic"; fileName: string }
interface Campaign {
  id: string; name: string
  client: {
    id: string; name: string
    brandFont?: string | null
    brandColors?: BrandColor[] | null
    customFontFiles?: CustomFontFile[] | null
  }
  assets: Asset[]
  keyVision: { bgColor: string; layers: Layer[] | null; width?: number; height?: number } | null
}

// BG vira layer real (igual Photoshop). Pode ter varias empilhadas; ordem
// no array = ordem visual (idx 0 = fundo, ultimo = mais em cima dos BGs,
// mas TODOS abaixo de qualquer asset).
type BgGradientStop = { offset: number; color: string }
// BlendMode usa nomes Canvas API (= valores aceitos em globalCompositeOperation).
// "source-over" eh o default ("Normal" no Photoshop).
type BgBlendMode =
  | "source-over" | "multiply" | "screen" | "overlay"
  | "darken" | "lighten" | "color-dodge" | "color-burn"
  | "hard-light" | "soft-light" | "difference" | "exclusion"
  | "hue" | "saturation" | "color" | "luminosity"
type BgLayerCommon = {
  opacity: number
  hidden?: boolean
  locked?: boolean
  blendMode?: BgBlendMode
  mask?: any // reusa schema do __maskData dos asset layers
  // Brand ref: indice em Client.brandColors. Quando setado, a cor solid
  // (kind="solid") eh ressincronizada automaticamente com brandColors[idx].hex
  // no load do canvas. Outros kinds ignoram esse campo.
  colorBrandIdx?: number
}
type BgImageFit = "cover" | "contain" | "fill" | "tile"
type BgLayerData =
  | (BgLayerCommon & { kind: "solid"; color: string })
  | (BgLayerCommon & { kind: "gradient"; gradientType: "linear" | "radial"; angle: number; stops: BgGradientStop[] })
  | (BgLayerCommon & { kind: "image"; imageDataUrl: string; fit: BgImageFit })

// Cor representativa do BG (usado pra alimentar espelhos legacy bgColor*Ref).
// Solid: cor direta. Gradient: 1o stop. Image: branco (sem cor representavel).
function bgLayerLegacyColor(l: BgLayerData | undefined): string {
  if (!l) return "#ffffff"
  if (l.kind === "solid") return l.color
  if (l.kind === "gradient") return l.stops[0]?.color ?? "#ffffff"
  return "#ffffff"
}

// Migra um item bruto de JSON pra BgLayerData tipado. Preserva o `kind` se
// presente (back-compat: pieces salvas com bgLayers gradient/image precisam
// re-hidratar com o tipo certo, nao forcar tudo pra solid).
function migrateBgLayerJson(l: any): BgLayerData {
  const opacity = typeof l?.opacity === "number" ? l.opacity : 1
  const hidden = l?.hidden === true ? true : undefined
  const locked = l?.locked === true ? true : undefined
  const colorBrandIdx = typeof l?.colorBrandIdx === "number" ? l.colorBrandIdx : undefined
  if (l?.kind === "gradient" && Array.isArray(l.stops) && l.stops.length >= 2) {
    return {
      kind: "gradient",
      gradientType: l.gradientType === "radial" ? "radial" : "linear",
      angle: typeof l.angle === "number" ? l.angle : 90,
      stops: l.stops.map((s: any) => ({ offset: Math.max(0, Math.min(1, s?.offset ?? 0)), color: typeof s?.color === "string" ? s.color : "#ffffff" })),
      opacity, hidden, locked,
    }
  }
  if (l?.kind === "image" && typeof l.imageDataUrl === "string" && l.imageDataUrl) {
    const fit: BgImageFit = (l.fit === "contain" || l.fit === "fill" || l.fit === "tile") ? l.fit : "cover"
    return { kind: "image", imageDataUrl: l.imageDataUrl, fit, opacity, hidden, locked }
  }
  // Solid (default + fallback de items sem kind)
  return { kind: "solid", color: typeof l?.color === "string" ? l.color : "#ffffff", opacity, hidden, locked, colorBrandIdx }
}

// Constroi o `fill` pro Fabric a partir dos dados do BG. Pra gradient,
// gera fabric.Gradient com coords calculadas pelo angulo + dimensoes do
// canvas (raio = max(w,h)/2 garante cobertura total em qualquer angulo).
// Convencao do angulo: 0deg = horizontal esquerda→direita; 90deg =
// vertical cima→baixo. Mesma convencao de editores graficos modernos.
// Robustez: stop.color pode chegar como objeto serializado ({r,g,b} ou
// similar) em pecas/matrizes legadas. Canvas addColorStop crasha com
// "could not be parsed as a color" — normaliza pra string CSS antes.
function safeColorString(v: any): string {
  if (typeof v === "string" && v) return v
  if (v && typeof v === "object") {
    const r = typeof v.r === "number" ? v.r : null
    const g = typeof v.g === "number" ? v.g : null
    const b = typeof v.b === "number" ? v.b : null
    if (r !== null && g !== null && b !== null) {
      const a = typeof v.a === "number" ? v.a : 1
      return `rgba(${r},${g},${b},${a})`
    }
  }
  return "#ffffff"
}

function buildBgFill(layer: BgLayerData, w: number, h: number, Gradient: any): any {
  if (layer.kind === "solid") return safeColorString(layer.color)
  if (layer.kind === "gradient") {
    const rad = (layer.angle * Math.PI) / 180
    const cx = w / 2, cy = h / 2
    if (layer.gradientType === "radial") {
      const r = Math.hypot(w, h) / 2
      return new Gradient({
        type: "radial",
        coords: { x1: cx, y1: cy, x2: cx, y2: cy, r1: 0, r2: r },
        colorStops: layer.stops.map(s => ({ offset: s.offset, color: safeColorString(s.color) })),
      })
    }
    const r = Math.max(w, h) / 2
    const dx = Math.cos(rad) * r
    const dy = Math.sin(rad) * r
    return new Gradient({
      type: "linear",
      coords: { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy },
      colorStops: layer.stops.map(s => ({ offset: s.offset, color: safeColorString(s.color) })),
    })
  }
  return "#ffffff"
}

// Sincroniza TODAS as props do BG layer no Rect Fabric: fill, opacity,
// visible, blendMode (globalCompositeOperation), mask (clipPath via
// applyMaskToFabricObject). Async pq fill pode envolver carregar imagem.
async function syncBgLayerToRect(rect: any, layer: BgLayerData, w: number, h: number, fabricMod: any): Promise<void> {
  await applyBgFillAsync(rect, layer, w, h, fabricMod)
  rect.set("opacity", layer.opacity)
  rect.set("visible", layer.hidden !== true)
  rect.set("globalCompositeOperation", layer.blendMode ?? "source-over")
  if (layer.mask) {
    const { Image: FabImage, Path } = fabricMod
    ;(rect as any).__maskData = layer.mask
    ;(rect as any).clipPath = null
    try { await applyMaskToFabricObject({ Image: FabImage, Path }, rect, layer.mask) }
    catch (e) { console.warn("[bg-mask] falha:", e) }
  } else {
    delete (rect as any).__maskData
    ;(rect as any).clipPath = null
  }
}

// Carrega um <img> a partir dum data URL ou URL publica. Usado pra preparar
// o source do Pattern (BG kind="image").
function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Falha ao carregar imagem"))
    img.src = src
  })
}

// Aplica o fill correto no Rect BG. Async porque image precisa carregar a
// imagem + pre-renderizar (cover/contain/fill) ou montar Pattern (tile).
async function applyBgFillAsync(rect: any, layer: BgLayerData, w: number, h: number, fabricMod: any): Promise<void> {
  if (layer.kind !== "image") {
    rect.set("fill", buildBgFill(layer, w, h, fabricMod.Gradient))
    return
  }
  const { Pattern } = fabricMod
  try {
    const img = await loadImageElement(layer.imageDataUrl)
    if (layer.fit === "tile") {
      rect.set("fill", new Pattern({ source: img, repeat: "repeat" }))
      return
    }
    // cover/contain/fill: pre-renderiza num canvas W×H com no-repeat
    const aux = document.createElement("canvas")
    aux.width = Math.max(1, Math.round(w))
    aux.height = Math.max(1, Math.round(h))
    const ctx = aux.getContext("2d")!
    ctx.clearRect(0, 0, aux.width, aux.height)
    if (layer.fit === "fill") {
      ctx.drawImage(img, 0, 0, aux.width, aux.height)
    } else {
      const iw = img.naturalWidth || img.width || 1
      const ih = img.naturalHeight || img.height || 1
      const s = layer.fit === "cover"
        ? Math.max(aux.width / iw, aux.height / ih)
        : Math.min(aux.width / iw, aux.height / ih)
      const dw = iw * s, dh = ih * s
      const dx = (aux.width - dw) / 2, dy = (aux.height - dh) / 2
      ctx.drawImage(img, dx, dy, dw, dh)
    }
    rect.set("fill", new Pattern({ source: aux, repeat: "no-repeat" }))
  } catch (e) {
    console.warn("[bg-image] falha ao aplicar imagem:", e)
    rect.set("fill", "#ffffff")
  }
}

const DEFAULT_W = 1920, DEFAULT_H = 1080
// LW = LARGURA DEFAULT do painel de Layers (esquerda). Pode ser redimensionada
// pelo user via drag handle na borda direita do painel — state layersPanelWidth.
// PW = LARGURA DEFAULT do painel Properties (direita). Tambem resizable — state
// propsPanelWidth, drag handle na borda esquerda. TH/BH = top/bottom bar.
const LW = 220, PW = 260, TH = 48, BH = 44
const LW_MIN = 180, LW_MAX = 500
const PW_MIN = 220, PW_MAX = 560
const LW_STORAGE_KEY = "zzosy.editor.layersPanelWidth"
const PW_STORAGE_KEY = "zzosy.editor.propsPanelWidth"
const _FONTS_LEGACY: string[] = [] // mantido como placeholder - lista de fontes agora vem de @/lib/fonts via FontPicker
const SWATCHES = ["#111111","#ffffff","#F5C400","#e63946","#457b9d","#2a9d8f","#264653","#f4a261","#8338ec","#ff006e","#06d6a0","#118ab2"]

function parseContent(raw: any): TextSpan[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

function getSpans(asset: Asset): TextSpan[] {
  const c = parseContent(asset.content)
  if (c.length) return c
  const text = (asset.value?.trim()) || asset.label
  return [{ text, style: { color: "#111111", fontSize: 80, fontWeight: "normal", fontFamily: "Arial" } }]
}

// Cor ag-psd → hex. ag-psd ora retorna 0..255, ora 0..1; normalizamos pelos
// dois.
function psdColorToHex(color: any): string {
  if (!color) return "#000000"
  const rr = color.r > 1 ? Math.round(color.r) : Math.round(color.r * 255)
  const gg = color.g > 1 ? Math.round(color.g) : Math.round(color.g * 255)
  const bb = color.b > 1 ? Math.round(color.b) : Math.round(color.b * 255)
  return "#" + [rr, gg, bb].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
}

// Amostra pixel central dum canvas raster; retorna null se transparente.
function sampleHexAt(c: HTMLCanvasElement, x: number, y: number): string | null {
  try {
    const ctx = c.getContext("2d")
    if (!ctx) return null
    const cx = Math.max(0, Math.min(c.width - 1, Math.floor(x)))
    const cy = Math.max(0, Math.min(c.height - 1, Math.floor(y)))
    const px = ctx.getImageData(cx, cy, 1, 1).data
    if (px[3] === 0) return null
    const h = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")
    return `#${h(px[0])}${h(px[1])}${h(px[2])}`
  } catch { return null }
}

// Detecta se um canvas raster eh uma cor solida uniforme. Amostra 9 pontos
// (cantos, meio dos lados, centro) — se todos batem com tolerancia 2 em
// cada canal, considera solido. Caso contrario tem desenho/textura/gradient
// rasterizado e deve virar BG kind="image" pra preservar.
function isCanvasUniform(c: HTMLCanvasElement): boolean {
  const ctx = c.getContext("2d")
  if (!ctx) return true
  const w = c.width, h = c.height
  if (w === 0 || h === 0) return true
  const xs = [0, Math.floor(w / 2), w - 1]
  const ys = [0, Math.floor(h / 2), h - 1]
  let ref: Uint8ClampedArray | null = null
  for (const y of ys) {
    for (const x of xs) {
      try {
        const px = ctx.getImageData(x, y, 1, 1).data
        if (!ref) { ref = px; continue }
        if (
          Math.abs(px[0] - ref[0]) > 2 ||
          Math.abs(px[1] - ref[1]) > 2 ||
          Math.abs(px[2] - ref[2]) > 2 ||
          Math.abs(px[3] - ref[3]) > 2
        ) return false
      } catch { return false }
    }
  }
  return true
}

// Tenta extrair um BG layer (BgLayerData) a partir dum layer PSD top-level.
// Suporta:
//  - Solid Color fill layer (vectorFill.type === 'color') → BG solid exato
//  - Gradient fill layer (vectorFill.type === 'solid' + colorStops) → BG gradient
//  - Layer raster cobrindo canvas → BG solid amostrado (pixel central)
// Retorna null se nao for um BG candidato.
function extractPsdBgLayer(layer: any, psdW: number, psdH: number): BgLayerData | null {
  if (!layer) return null
  const vf = layer.vectorFill
  if (vf?.type === "color" && vf.color) {
    return { kind: "solid", color: psdColorToHex(vf.color), opacity: 1 }
  }
  if (vf?.type === "solid" && Array.isArray(vf.colorStops) && vf.colorStops.length >= 2) {
    // ag-psd normaliza location pra 0..1 (apos divisao por interpolation)
    const stops: BgGradientStop[] = vf.colorStops.map((s: any) => ({
      offset: Math.max(0, Math.min(1, s.location ?? 0)),
      color: psdColorToHex(s.color),
    }))
    // ExtraGradientInfo: style + angle. Convencao PS: angle em graus, 0=cima.
    // Nossa convencao: 0=L→R, 90=cima→baixo. Conversao: nosso = (psd - 180) % 360
    const psStyle = vf.style ?? "linear"
    const gradientType: "linear" | "radial" = psStyle === "radial" ? "radial" : "linear"
    const psAngle = typeof vf.angle === "number" ? vf.angle : 0
    const angle = ((psAngle - 180) % 360 + 360) % 360
    return { kind: "gradient", gradientType, angle, stops, opacity: 1 }
  }
  if (layer.canvas) {
    const c = layer.canvas as HTMLCanvasElement
    // Se o raster eh uma cor solida uniforme, retorna como solid (mais leve
    // que image base64 inline). Se tem desenho/textura/etc, preserva como
    // BG kind="image" com dataURL — fit="cover" pra cobrir o canvas da peca
    // qualquer que seja a proporcao do PSD.
    if (isCanvasUniform(c)) {
      const color = sampleHexAt(c, c.width / 2, c.height / 2)
      if (color) return { kind: "solid", color, opacity: 1 }
    } else {
      try {
        const dataUrl = c.toDataURL("image/png")
        return { kind: "image", imageDataUrl: dataUrl, fit: "cover", opacity: 1 }
      } catch (e) {
        console.warn("[bg-import] toDataURL falhou, fallback solid:", e)
        const color = sampleHexAt(c, c.width / 2, c.height / 2)
        if (color) return { kind: "solid", color, opacity: 1 }
      }
    }
  }
  return null
}

// Extrai estilo de texto dum layer PSD pra um override do layer da peca.
//
// Cores/fontes/pesos: ag-psd guarda o estilo em DOIS lugares:
//  - td.style: "default" do layer (frequentemente VAZIO ou so com campos
//    parciais quando o designer usou Character panel pra estilizar)
//  - td.styleRuns[]: lista de runs (segmentos contiguos) com style proprio
//    cada. Quando o texto tem 1 cor so, ha 1 run cobrindo tudo. Quando tem
//    cores diferentes (ex: "Robo" rosa + "jento" verde), ha varios runs.
// Logica: pegamos defaults do 1o styleRun (fallback td.style). Se ha >1 run,
// distribuimos as cores per-char no texto do ASSET proporcionalmente ao texto
// do PSD (porque o texto do asset pode ter length diferente do PSD).
//
// `pieceScale` = scale do espaco do PSD pro espaco da peca. `pieceW/pieceH` ja
// vem escalados. `assetText` = texto que vai renderizar (do asset.content) —
// usado pra mapear styles per-char quando ha multiplos runs.
function psdTextLayerToOverride(
  layer: any, pieceScale: number, pieceW: number, pieceH: number, assetText: string,
): any | null {
  const td = layer?.text
  if (!td) return null
  const fallbackStyle = td.style ?? {}
  const runs: any[] = td.styleRuns ?? []
  const primary = runs[0]?.style ?? fallbackStyle

  const pickFontName = (s: any) => s?.font?.name ?? fallbackStyle?.font?.name ?? "Arial"
  const pickFontSize = (s: any) => s?.fontSize ?? fallbackStyle?.fontSize ?? 48
  const pickColor = (s: any) => {
    if (s?.fillColor) return psdColorToHex(s.fillColor)
    if (fallbackStyle?.fillColor) return psdColorToHex(fallbackStyle.fillColor)
    return "#000000"
  }
  const pickWeight = (s: any, fontName: string) =>
    (s?.fauxBold || fontName.toLowerCase().includes("bold")) ? "bold" : "normal"

  const defFontName = pickFontName(primary)
  const defFontSize = pickFontSize(primary)
  const defColor = pickColor(primary)
  const defWeight = pickWeight(primary, defFontName)

  // ag-psd retorna fontSize NO ESPACO DO TEXTO (antes da transform). A
  // transform 6-elem [a,b,c,d,e,f] aplica scale/rot/translate; pra fontSize
  // visual real, multiplica pela magnitude de [a,b] (~= [c,d]). Sem isso,
  // textos grandes saem com fontSize gigante (ex: 788 cru vs 189 visual).
  const tform: number[] | undefined = td.transform
  let textScale = 1
  if (tform && tform.length >= 4) {
    const sx = Math.hypot(tform[0] ?? 1, tform[1] ?? 0)
    const sy = Math.hypot(tform[2] ?? 0, tform[3] ?? 1)
    const avg = (sx + sy) / 2
    if (Number.isFinite(avg) && avg > 0) textScale = avg
  }
  // Compoem: textScale (PSD interno → PSD visual) * pieceScale (PSD visual → peca).
  const finalScale = textScale * pieceScale
  const sizeOf = (s: any) => Math.max(1, Math.round(pickFontSize(s) * finalScale))

  const ov: any = {
    width: pieceW,
    height: pieceH,
    fontFamily: defFontName,
    fontSize: sizeOf(primary),
    fontWeight: defWeight,
    fill: defColor,
    charSpacing: 0,
    lineHeight: 1.0, // Adobe-style auto leading, mesmo default de addAssetToCanvas
    textAlign: "left",
  }

  // Multi-run: mapeia proporcionalmente ao texto do asset. Texto do asset pode
  // ter qualquer length (≠ do PSD); convertemos a posicao de cada run em %
  // do texto do PSD e aplicamos no range correspondente no texto do asset.
  // Mantemos a estrutura linha-por-linha do Fabric (styles[lineIdx][colIdx]),
  // pulando \n na contagem de chars estilizaveis (newlines nao tem style).
  if (runs.length > 1 && assetText.length > 0) {
    const psdTextLen = runs.reduce((acc, r) => acc + (r.length ?? 0), 0)
    if (psdTextLen > 0) {
      // Lista chars do asset com posicao (line,col) pra cada char nao-\n.
      const cells: Array<{ line: number; col: number }> = []
      let line = 0, col = 0
      for (const ch of assetText) {
        if (ch === "\n") { line++; col = 0; continue }
        cells.push({ line, col })
        col++
      }
      const assetCharLen = cells.length
      if (assetCharLen > 0) {
        const styles: Record<number, Record<number, any>> = {}
        let psdCursor = 0
        for (const run of runs) {
          const rLen = run.length ?? 0
          if (rLen <= 0) continue
          const rStyle = run.style ?? {}
          const fontName = pickFontName(rStyle)
          const charStyle = {
            fill: pickColor(rStyle),
            fontSize: sizeOf(rStyle),
            fontFamily: fontName,
            fontWeight: pickWeight(rStyle, fontName),
          }
          // Range no asset proporcional ao range desse run no PSD
          const startIdx = Math.floor((psdCursor / psdTextLen) * assetCharLen)
          const endIdx = Math.floor(((psdCursor + rLen) / psdTextLen) * assetCharLen)
          for (let i = startIdx; i < endIdx && i < assetCharLen; i++) {
            const { line: ln, col: cl } = cells[i]
            if (!styles[ln]) styles[ln] = {}
            styles[ln][cl] = charStyle
          }
          psdCursor += rLen
        }
        if (Object.keys(styles).length > 0) ov.styles = styles
      }
    }
  }

  return ov
}


// Le os styles per-caractere de um Textbox e gera TextSpan[] fragmentado
function textboxToSpans(obj: any): TextSpan[] {
  const fullText: string = obj.text ?? ""
  const styles = obj.styles ?? {}
  const defaultStyle = {
    color: obj.fill ?? "#111111",
    fontSize: obj.fontSize ?? 80,
    fontWeight: obj.fontWeight ?? "normal",
    fontFamily: obj.fontFamily ?? "Arial",
  }

  if (!fullText) return [{ text: "", style: defaultStyle }]

  const lines = fullText.split("\n")
  const spans: TextSpan[] = []
  let buf = ""
  let bufStyle: any = null

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]
    const lineStyles = styles[lineNum] ?? {}
    for (let col = 0; col < line.length; col++) {
      const cs = lineStyles[col] ?? {}
      const charStyle = {
        color: cs.fill ?? defaultStyle.color,
        fontSize: cs.fontSize ?? defaultStyle.fontSize,
        fontWeight: cs.fontWeight ?? defaultStyle.fontWeight,
        fontFamily: cs.fontFamily ?? defaultStyle.fontFamily,
      }
      const key = JSON.stringify(charStyle)
      if (bufStyle === null || JSON.stringify(bufStyle) === key) {
        buf += line[col]
        if (bufStyle === null) bufStyle = charStyle
      } else {
        spans.push({ text: buf, style: bufStyle })
        buf = line[col]
        bufStyle = charStyle
      }
    }
    if (lineNum < lines.length - 1) {
      buf += "\n"
    }
  }
  if (buf) spans.push({ text: buf, style: bufStyle ?? defaultStyle })
  return spans
}

// Migra pieces antigas salvas com styles "flat" — { 0: { globalCharIdx: ... } } —
// pro novo schema indexado por LINHA — { lineIdx: { charInLine: ... } }.
// Bug corrigido em 25839ad: Fabric Textbox usa estrutura por linha; antes
// empilhavamos todos os chars em styles[0], entao Textbox dropava silenciosamente
// chars de linha 1+ (audit H10). Pieces salvas antes do commit ficaram com flat
// no banco e abriram quebradas. Esta funcao detecta + converte na hora do load.
function migrateFlatStylesToLineIndexed(
  text: string | undefined | null,
  styles: any
): any {
  if (!styles || typeof styles !== "object") return styles
  const keys = Object.keys(styles)
  // Heuristica: so 1 key "0" + texto tem \n + algum charIdx > tamanho da 1a linha.
  if (keys.length !== 1 || keys[0] !== "0") return styles
  if (!text || !text.includes("\n")) return styles
  const flat = styles["0"]
  if (!flat || typeof flat !== "object") return styles
  const lines = String(text).split("\n")
  const firstLineLen = lines[0].length
  const charKeys = Object.keys(flat).map(k => Number(k)).filter(Number.isFinite)
  const hasBeyondFirstLine = charKeys.some(k => k >= firstLineLen)
  if (!hasBeyondFirstLine) return styles // de fato so linha 0 — ja correto
  const result: Record<number, Record<number, any>> = {}
  for (const k of charKeys) {
    let acc = 0
    for (let i = 0; i < lines.length; i++) {
      const lineLen = lines[i].length
      if (k < acc + lineLen) {
        if (!result[i]) result[i] = {}
        result[i][k - acc] = flat[k]
        break
      }
      acc += lineLen + 1 // +1 pro \n
      if (i === lines.length - 1) {
        // overflow — joga no fim da ultima linha
        if (!result[i]) result[i] = {}
        result[i][Math.max(0, k - (acc - 1))] = flat[k]
      }
    }
  }
  return result
}

// Inverso: converte TextSpan[] em props para criar Textbox + styles per-char
function spansToTextboxData(spans: TextSpan[]) {
  if (!spans.length) return { text: "", styles: {}, defaultStyle: {} }
  const fullText = spans.map(s => s.text).join("")
  const defaultStyle = spans[0].style ?? {}
  const styles: Record<number, Record<number, any>> = {}

  let charIdx = 0
  let lineNum = 0
  let col = 0
  for (const span of spans) {
    const sStyle = span.style ?? {}
    for (const ch of span.text) {
      if (ch === "\n") {
        lineNum++
        col = 0
        charIdx++
        continue
      }
      const styleKey = JSON.stringify(sStyle)
      const defaultKey = JSON.stringify(defaultStyle)
      if (styleKey !== defaultKey) {
        if (!styles[lineNum]) styles[lineNum] = {}
        styles[lineNum][col] = {
          fill: sStyle.color,
          fontSize: sStyle.fontSize,
          fontWeight: sStyle.fontWeight,
          fontFamily: sStyle.fontFamily,
        }
      }
      col++
      charIdx++
    }
  }
  return { text: fullText, styles, defaultStyle }
}

/**
 * FONTE UNICA DE VERDADE pra serializar overrides de TEXT layer.
 *
 * Antes esta logica vivia DUPLICADA em 6 sites diferentes (saveNow PECA,
 * saveNow MATRIZ, doSaveNow PECA, doSaveNow MATRIZ, step serialize, KV export).
 * Cada vez que adicionavamos uma prop nova (per-char styles, fillBrandIdx,
 * charSpacing, etc) atualizavamos 1-2 sites e esqueciamos o resto — drift
 * por copy-paste. User reportou multiplas vezes "cores per-char somem no
 * export", "tamanho errado", "tracking perdido" — todos os sintomas do
 * mesmo bug estrutural.
 *
 * Esta helper centraliza. Todos os save/export paths agora chamam aqui.
 * Adicionar prop nova = 1 lugar, propaga automaticamente.
 *
 * @param o objeto Fabric textbox/i-text
 * @param opts.preserveExplicitNewlinesOnly  Se true, so seta overrides.text
 *        quando o texto tem \n explicito (PECA save: caracteres vem do asset,
 *        apenas quebras locais via Enter persistem). Se false, sempre seta
 *        overrides.text (MATRIZ/KV export: texto live e fonte da verdade).
 */
function serializeTextboxOverrides(
  o: any,
  opts: { preserveExplicitNewlinesOnly?: boolean } = {},
): Record<string, any> {
  const ov: Record<string, any> = {}
  const text = typeof o.text === "string" ? o.text : ""
  if (opts.preserveExplicitNewlinesOnly) {
    if (text.includes("\n")) ov.text = text
  } else {
    ov.text = text
    ov.content = text  // alias usado em alguns paths antigos do export
  }
  if (o.fill !== undefined) ov.fill = o.fill
  if (typeof o.__fillBrandIdx === "number") ov.fillBrandIdx = o.__fillBrandIdx
  if (o.fontSize !== undefined) ov.fontSize = o.fontSize
  if (o.fontFamily !== undefined) ov.fontFamily = o.fontFamily
  if (o.fontWeight !== undefined) ov.fontWeight = o.fontWeight
  if (o.fontStyle && o.fontStyle !== "normal") ov.fontStyle = o.fontStyle
  if (o.charSpacing !== undefined) ov.charSpacing = o.charSpacing
  if (o.lineHeight !== undefined) ov.lineHeight = o.lineHeight
  if (o.textAlign !== undefined) ov.textAlign = o.textAlign
  if (o.leadingPt !== undefined && o.leadingPt !== null) ov.leadingPt = o.leadingPt
  if (o.styles && Object.keys(o.styles).length > 0) ov.styles = o.styles
  if (o.__dsLinked === false) ov.dsLinked = false
  return ov
}

/**
 * Parser minimo de path SVG → formato interno do Fabric.Path
 *   `[ ["M", x, y], ["L", x, y], ["C", x1, y1, x2, y2, x, y], ["Z"] ]`
 *
 * Suporta apenas os comandos usados em lib/shapePaths.ts: M, L, C, Z (uppercase
 * absolutos). Pra geradores parametricos isso eh suficiente — paths importados
 * de PSD podem ter outros comandos mas esses NAO sao recomputados aqui (o
 * recompute so roda em shapes com __shapeKind setado, i.e., adicionadas via
 * "+ Forma" ou Live Shapes PSD).
 */
function parseSimpleSvgPathToFabric(d: string): any[] {
  const tokens = d.match(/[MLCZmlczMLCZ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []
  const out: any[] = []
  let i = 0
  while (i < tokens.length) {
    const cmd = tokens[i]
    if (cmd === "M" || cmd === "L") {
      out.push([cmd, Number(tokens[i + 1]), Number(tokens[i + 2])])
      i += 3
    } else if (cmd === "C") {
      out.push([
        cmd,
        Number(tokens[i + 1]), Number(tokens[i + 2]),
        Number(tokens[i + 3]), Number(tokens[i + 4]),
        Number(tokens[i + 5]), Number(tokens[i + 6]),
      ])
      i += 7
    } else if (cmd === "Z" || cmd === "z") {
      out.push(["Z"])
      i += 1
    } else {
      // Token nao reconhecido — pula pra evitar loop infinito
      i += 1
    }
  }
  return out
}

/**
 * Substitui o `d` (path SVG) de um Fabric.Path EXISTENTE in-place.
 * Reusa o objeto sem destrui-lo (preserva listeners, __assetId, selecao
 * ativa). Fabric v7: obj.path eh array de comandos; precisa parsear o
 * d string e atribuir. Depois marca dirty, recalcula bbox via
 * _calcDimensions e setCoords pra handles atualizarem.
 *
 * Usado por: setCornerRadius (slider de raio) e scaling hook (parametric
 * resize). Centralizado pra eliminar duplicacao + tratamento de erro.
 */
function applyShapePathInPlace(obj: any, newPathD: string): void {
  try {
    const parsed = parseSimpleSvgPathToFabric(newPathD)
    if (!parsed || !parsed.length) return
    obj.path = parsed
    // _calcDimensions atualiza obj.width/height/pathOffset a partir do path.
    // Sem isso, o bbox do Fabric ficaria nas dimensoes antigas → handles e
    // mask referem-se a bbox stale.
    if (typeof obj._calcDimensions === "function") obj._calcDimensions()
    obj.dirty = true
    if (obj.setCoords) obj.setCoords()
  } catch (e) {
    console.warn("[applyShapePathInPlace] falha:", e)
  }
}

/**
 * FONTE UNICA DE VERDADE pra serializar overrides de SHAPE (Fabric.Path).
 * Mesmo pattern do serializeTextboxOverrides — evita drift.
 */
function serializeShapeOverrides(o: any): Record<string, any> {
  const ov: Record<string, any> = {}
  if (typeof o.fill === "string") ov.fill = o.fill
  if (typeof o.stroke === "string") ov.stroke = o.stroke
  if (typeof o.strokeWidth === "number") ov.strokeWidth = o.strokeWidth
  // cornerRadius: usado pelo Properties Panel pra slider de raio (roundedRect).
  if (typeof o.__cornerRadius === "number") ov.cornerRadius = o.__cornerRadius
  // bboxW/bboxH: dimensoes EFFECTIVE (path internal * scale). Multiplicar pelo
  // scale eh CRITICO — sem isso o save captura bbox cru e o user perdia o
  // resize que fez na canvas (user reportou export 3x menor que editor).
  if (o.__shapeKind && o.__pathBbox) {
    const bb = o.__pathBbox
    const W = (bb.right ?? 0) - (bb.left ?? 0)
    const H = (bb.bottom ?? 0) - (bb.top ?? 0)
    const sX = typeof o.scaleX === "number" ? o.scaleX : 1
    const sY = typeof o.scaleY === "number" ? o.scaleY : 1
    if (W > 0 && H > 0) {
      ov.bboxW = W * sX
      ov.bboxH = H * sY
    }
  }
  return ov
}

/**
 * FONTE UNICA DE VERDADE pra propagar metadados PSD do Fabric obj pro
 * objeto `layer` JSON serializado. Era duplicado em 4 sites do save
 * (PIECE/MATRIX/2x step) — cada vez que um novo metadado PSD entrava
 * (effects → nameSource → ...), tinha que tocar os 4 ou criava drift.
 *
 * Mutates `layer` setando os fields se o Fabric obj tem o equivalente
 * __psdXxx. Convencao: defaults (opacity=1, blendMode=source-over) sao
 * OMITIDOS pra nao inflar o JSON do DB.
 *
 * NOTA: srvLog de "mask ausente" fica FORA do helper (so o site MATRIX
 * quer esse warning — outros saves convivem com mask ausente sem alarme).
 */
function applyPsdLayerMetadata(o: any, layer: any): void {
  // Visibilidade + lock (eye/cadeado do PS). Antes era propagado so em 2 dos
  // 4 sites — sweep agora garante consistencia em todos os saves.
  if (o.__hidden === true) layer.hidden = true
  if (o.__locked === true) layer.locked = true
  // Mask (raster/vector/clipping). Sem srvLog aqui — caller decide se loga.
  if ((o as any).__maskData) layer.mask = (o as any).__maskData
  // Opacity (0..1) + blendMode (canvas globalCompositeOperation). Defaults
  // (1 e "source-over") omitidos.
  if (typeof o.opacity === "number" && o.opacity < 1) layer.opacity = o.opacity
  if (typeof o.globalCompositeOperation === "string" && o.globalCompositeOperation && o.globalCompositeOperation !== "source-over") {
    layer.blendMode = o.globalCompositeOperation
  }
  // Layer effects (drop shadow / stroke / outer glow) — round-trip PSD.
  if ((o as any).__psdEffects && typeof (o as any).__psdEffects === "object") {
    layer.effects = (o as any).__psdEffects
  }
  // 'lnsr' (Layer Name Source) — controla se PS auto-renomeia text layer.
  if (typeof (o as any).__psdNameSource === "string") {
    layer.nameSource = (o as any).__psdNameSource
  }
  // groupPath: hierarquia de folders do PSD (raiz → pai). Round-trip.
  if (Array.isArray((o as any).__groupPath) && (o as any).__groupPath.length > 0) {
    layer.groupPath = (o as any).__groupPath
  }
  // Smart Object preservation: marca que este layer eh um SO originario do PSD.
  // No re-export, exportPiece detecta via asset.smartObject — mas a flag aqui
  // serve como fallback se a relacao asset→smartObject for perdida no DB.
  if ((o as any).__isSmartObject === true) {
    layer.isSmartObject = true
    if (typeof (o as any).__smartObjectGuid === "string") layer.smartObjectGuid = (o as any).__smartObjectGuid
  }
}

/**
 * Pre-compoe uma raster mask DENTRO de uma imagem fonte. Fabric v6 renderiza
 * Image clipPath como silhueta solida (fill=black) — ignora alpha do PNG da
 * mask. A unica forma de obter alpha-mask real eh aplicar a mascara no
 * BITMAP antes de criar a FabricImage.
 *
 * @param sourceImg HTMLImageElement com a imagem do asset (ja carregada)
 * @param maskRaster { dataUrl, posX, posY, width, height } — em canvas coords
 * @param assetPosX/Y posicao do asset no canvas (pra calcular offset relativo)
 * @param assetW/H dimensoes naturais do asset
 * @param inverted se true, inverte o alpha (mascara mostra o oposto)
 * @returns HTMLCanvasElement com o asset mascarado, ou null em caso de erro
 */
async function composeRasterMaskIntoImage(
  sourceImg: HTMLImageElement,
  maskRaster: { dataUrl: string; posX: number; posY: number; width: number; height: number },
  assetPosX: number,
  assetPosY: number,
  assetW: number,
  assetH: number,
  inverted: boolean,
  // Scale do layer no canvas (peca/matriz). Necessario pra converter coords:
  // - maskRaster.posX/Y/W/H estao em CANVAS-SPACE (escala da peca)
  // - assetPosX/Y estao em CANVAS-SPACE
  // - sourceImg (assetW x assetH) esta em IMAGE-NATURAL-SPACE (sem escala)
  // Pra desenhar a mask corretamente sobre a imagem natural, multiplicamos as
  // coords da mask por (1/scaleX, 1/scaleY) — converte canvas→natural.
  // Antes a mask era desenhada com coords da peca dentro de um canvas natural,
  // ficando minuscula no quadrante 0,0 (sintoma: alpha aparecia num pedaco do
  // layer e o resto sumia, peca importada de matriz quadrada pra Google wide
  // mostrava so 25% do conteudo).
  scaleX: number = 1,
  scaleY: number = 1,
): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null
  // Carrega a imagem da mask
  const maskImg = await new Promise<HTMLImageElement | null>((resolve) => {
    const im = new Image()
    im.crossOrigin = "anonymous"
    im.onload = () => resolve(im)
    im.onerror = () => resolve(null)
    im.src = maskRaster.dataUrl
  })
  if (!maskImg) return null

  // Cria canvas do tamanho da imagem do asset (IMAGE-NATURAL-SPACE).
  const canvas = document.createElement("canvas")
  canvas.width = assetW
  canvas.height = assetH
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  // Etapa 1: desenha a imagem do asset normal.
  ctx.drawImage(sourceImg, 0, 0, assetW, assetH)

  // Etapa 2: aplica a mascara usando globalCompositeOperation.
  // 'destination-in': keeps destination (asset) where mask is opaque, removes where mask is transparent.
  // 'destination-out' (inverted): removes destination where mask is opaque.
  ctx.globalCompositeOperation = inverted ? "destination-out" : "destination-in"
  // CONVERSAO canvas-space → image-natural-space:
  // ratio = 1/scale. Se scale==1 (matriz), ratio==1 e nada muda.
  // Se scale<1 (peca menor que matriz), ratio>1 e mask se expande pra cobrir
  // a area inteira da imagem natural — alinhada com o que renderiza no canvas.
  const ratioX = scaleX !== 0 ? 1 / scaleX : 1
  const ratioY = scaleY !== 0 ? 1 / scaleY : 1
  const maskOffsetX = (maskRaster.posX - assetPosX) * ratioX
  const maskOffsetY = (maskRaster.posY - assetPosY) * ratioY
  const maskW = maskRaster.width * ratioX
  const maskH = maskRaster.height * ratioY
  ctx.drawImage(maskImg, maskOffsetX, maskOffsetY, maskW, maskH)
  // Reset pra default (canvas pode ser reutilizado, mas geralmente nao — defensivo).
  ctx.globalCompositeOperation = "source-over"
  return canvas
}

/**
 * Cria 4 retangulos overlay que mascaram TUDO fora da peca dentro do
 * canvas visivel. A peca (cw x ch) renderiza centralizada no canvas;
 * os overlays cobrem a area cinza/escura ao redor.
 *
 * Em coords do mundo Fabric (zoom-independente):
 *   peca: (0,0) -> (cw, ch)
 *   canvas DOM em mundo: (-offsetX/z, -offsetY/z) -> ((fullW - offsetX)/z, (fullH - offsetY)/z)
 *
 * Os 4 overlays cobrem o complemento da peca dentro do canvas.
 *
 * Marca cada overlay com __isBleedOverlay = true e excludeFromExport=true.
 * Filtros em refreshLayers, save, undo, etc usam essa flag pra ignorar.
 *
 * Reutilizado em: init do canvas, applySnapshot (loadFromJSON limpa o
 * canvas), e applyZoom/resize (overlays redimensionam com zoom).
 */
function createBleedOverlays(fc: any, Rect: any, cw: number, ch: number, fullW: number, fullH: number, z: number) {
  const BLEED_FILL = "#1e1e1e" // mesmo background do wrapper do editor
  // Em coords do mundo Fabric. Canvas DOM tem largura fullW em px DOM,
  // mas com zoom z aplicado, o canvas "ve" fullW/z unidades de mundo.
  // Como a peca esta centralizada via viewportTransform offset, o "0,0" do
  // mundo esta em (offsetX, offsetY) no DOM. Em mundo, isso significa que
  // o canvas mostra de (-offsetX/z) a ((fullW - offsetX)/z) em X.
  const worldW = fullW / z
  const worldH = fullH / z
  const offsetX = (fullW - cw * z) / 2
  const offsetY = (fullH - ch * z) / 2
  const worldLeft = -offsetX / z   // ex.: -100 unidades de mundo se offset for 100 e zoom 1
  const worldTop = -offsetY / z
  const worldRight = worldLeft + worldW   // ex.: + worldW pra direita
  const worldBottom = worldTop + worldH

  const overlays = [
    // Top: do top do canvas ate o top da peca
    new Rect({ left: worldLeft, top: worldTop, width: worldW, height: -worldTop }),
    // Bottom: do bottom da peca ate o bottom do canvas
    new Rect({ left: worldLeft, top: ch, width: worldW, height: worldBottom - ch }),
    // Left: do left do canvas ate o left da peca, entre top e bottom da peca
    new Rect({ left: worldLeft, top: 0, width: -worldLeft, height: ch }),
    // Right: do right da peca ate o right do canvas
    new Rect({ left: cw, top: 0, width: worldRight - cw, height: ch }),
  ]
  for (const o of overlays) {
    o.set({
      fill: BLEED_FILL,
      selectable: false, evented: false, excludeFromExport: true,
      hoverCursor: "default",
    })
    ;(o as any).__isBleedOverlay = true
    fc.add(o)
  }
  // Garante z-stack: overlays no topo (acima de objetos de conteudo).
  for (const o of overlays) {
    try { (fc as any).bringObjectToFront ? (fc as any).bringObjectToFront(o) : fc.bringToFront(o) } catch {}
  }
  ;(fc as any).__bleedOverlays = overlays
  return overlays
}


export function KeyVisionEditor({ campaignId, pieceId, from, initialStepIndex, openGenerator }: { campaignId: string; pieceId?: string; from?: string; initialStepIndex?: number; openGenerator?: boolean }) {
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fabricRef = useRef<any>(null)
  const psdStepInputRef = useRef<HTMLInputElement>(null)
  // File System Access API: handle pro PSD externo vinculado pra sync.
  // Quando user clica "Editar Externo", exporta PSD + salva via showSaveFilePicker
  // + guarda handle. Botão "Sync" depois re-lê o arquivo (depois do user salvar
  // no Photoshop) e re-importa.
  const externalPsdHandle = useRef<any>(null)
  const [externalPsdName, setExternalPsdName] = useState<string | null>(null)
  const bgRef = useRef<any>(null)
  const campaignRef = useRef<Campaign | null>(null)
  const saveTimer = useRef<any>()
  const savedTextSelection = useRef<{ obj: any; start: number; end: number } | null>(null)
  // Debounce timer pro auto-fit do textbox (text:changed). Sem isso, cada
  // keystroke executava 2x initDimensions + setCoords + requestRenderAll —
  // em textos grandes com styles per-char ficava VISIVELMENTE lento.
  const autoFitTimer = useRef<any>(null)
  // Tick do Properties panel agendado via rAF pra coalescer re-renders.
  const selectedTickRaf = useRef<number | null>(null)
  // Debounce dos PUTs de lastOverride / asset content. Sem debounce, mudar
  // fontSize via input ou aplicar styles em sequencia rapida disparava 1
  // PUT por mudanca — backend ficava sob carga e a UI percebia 'lag'.
  const lastOverridePutTimer = useRef<any>(null)
  const lastOverridePendingPayload = useRef<{ aid: string; payload: any } | null>(null)
  const assetContentPutTimer = useRef<any>(null)
  const assetContentPendingPayload = useRef<{ aid: string; payload: any } | null>(null)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [piece, setPiece] = useState<any>(null)
  const pieceRef = useRef<any>(null)
  const isPieceMode = !!pieceId
  // STEPS (carrossel Meta etc): cada peca pode ter 1+ steps.
  //
  // Estrutura no piece.data:
  //   {
  //     width, height, bgColor,            // dimens\u00f5es da peca (compartilhadas)
  //     layers: [...],                     // step ATIVO (compat com pecas legadas)
  //     activeStepIndex?: number,          // 0-based; 0 = step 1
  //     steps?: Array<{ layers, bgColor, thumbnailUrl?, imageUrl? }>,
  //                                        // SNAPSHOTS dos steps inativos.
  //                                        // Tamanho = N-1 onde N = total de steps.
  //                                        // Index map: depende do step ativo.
  //   }
  //
  // Como funciona internamente:
  // - Total de steps = 1 + (steps?.length ?? 0)
  // - O step ATIVO esta no canvas + layers.
  // - Os step INATIVOS ficam serializados em steps[].
  // - Ao trocar de step ativo: salva canvas atual em steps[old], carrega steps[new] no canvas.
  //
  // Pra simplicidade no codigo client, mantemos no React state:
  //  - stepCount: total de steps
  //  - activeStepIndex: qual esta sendo editado (0-based)
  //  - inactiveStepsRef: array com OS OUTROS steps (length = stepCount - 1)
  const [stepCount, setStepCount] = useState(1)
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  // Refs espelham os states pra leitura sincrona dentro de funcoes que rodam
  // entre renders (performSave, doSaveNow, addStep). React state \u00e9 batched,
  // entao logo apos setStepCount/setActiveStepIndex o valor lido por funcao
  // pode estar STALE — use sempre o ref pra logica de save/step.
  const stepCountRef = useRef(1)
  const activeStepIndexRef = useRef(0)
  const inactiveStepsRef = useRef<Array<{ layers: any[]; bgColor: string; bgOpacity?: number; thumbnailUrl?: string | null; imageUrl?: string | null }>>([])
  // Setters que mantem ref e state em sincrono. Use sempre estes pra mudar
  // stepCount/activeStepIndex (NUNCA setStepCount diretamente — quebra o ref).
  function setStepCountSync(next: number | ((prev: number) => number)) {
    const value = typeof next === "function" ? (next as any)(stepCountRef.current) : next
    stepCountRef.current = value
    setStepCount(value)
  }
  function setActiveStepIndexSync(next: number | ((prev: number) => number)) {
    const value = typeof next === "function" ? (next as any)(activeStepIndexRef.current) : next
    activeStepIndexRef.current = value
    setActiveStepIndex(value)
  }
  const [selected, setSelected] = useState<any>(null)
  // selectedRef: usado em handlers/funcoes (changeBg, addBgLayer, etc) que
  // precisam ler o selected atual sem depender de stale closure de re-renders.
  const selectedRef = useRef<any>(null)
  useEffect(() => { selectedRef.current = selected }, [selected])
  const [hexInput, setHexInput] = useState<string>("#111111")
  const [bgHexInput, setBgHexInput] = useState<string>("#ffffff")
  const [fontSizeInput, setFontSizeInput] = useState<string>("80")
  const [leadingInput, setLeadingInput] = useState<string>("96")
  // Ref pra rastrear se algum input numérico do painel está em digitação.
  // Mais confiável que document.activeElement (que pode estar stale em
  // re-renders concorrentes do React 18). Usado pra impedir o useEffect
  // de sobrescrever fontSizeInput/leadingInput durante a digitação do user.
  const numericInputFocusedRef = useRef(false)
  const [selectedTick, setSelectedTick] = useState(0)
  // Pulse key — incrementa toda vez que um NOVO layer eh selecionado. Usado no
  // painel Layers pra disparar uma animacao breve de glow (cor da marca) que
  // ajuda o user a localizar o layer correspondente apos clicar no canvas.
  // Trocar o `key` da div forca o React a remontar com a animation no inicio.
  const [layerPulseKey, setLayerPulseKey] = useState(0)
  // Largura do painel Layers (esquerda) — resizable pelo user. Persiste em
  // localStorage pra preservar a preferencia entre sessoes.
  const [layersPanelWidth, setLayersPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return LW
    try {
      const saved = window.localStorage?.getItem(LW_STORAGE_KEY)
      const n = saved ? parseInt(saved, 10) : NaN
      return Number.isFinite(n) ? Math.max(LW_MIN, Math.min(LW_MAX, n)) : LW
    } catch { return LW }
  })
  // Ref sincronizado pra closure do onResize do canvas (que foi criado dentro
  // de useEffect [campaign] e nao re-monta quando layersPanelWidth muda).
  const layersPanelWidthRef = useRef(layersPanelWidth)
  useEffect(() => {
    layersPanelWidthRef.current = layersPanelWidth
    try { window.localStorage?.setItem(LW_STORAGE_KEY, String(layersPanelWidth)) } catch {}
    // Dispara resize do canvas pra recentralizar com nova largura disponivel.
    if (typeof window !== "undefined") window.dispatchEvent(new Event("resize"))
  }, [layersPanelWidth])
  // Drag em curso pra resize do painel — guarda mouseX inicial + width inicial.
  const layersResizeRef = useRef<{ startX: number; startW: number } | null>(null)
  // Largura do painel Properties (direita) — resizable pelo user, mesmo padrao
  // do layersPanelWidth. Persiste em localStorage.
  const [propsPanelWidth, setPropsPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return PW
    try {
      const saved = window.localStorage?.getItem(PW_STORAGE_KEY)
      const n = saved ? parseInt(saved, 10) : NaN
      return Number.isFinite(n) ? Math.max(PW_MIN, Math.min(PW_MAX, n)) : PW
    } catch { return PW }
  })
  const propsPanelWidthRef = useRef(propsPanelWidth)
  useEffect(() => {
    propsPanelWidthRef.current = propsPanelWidth
    try { window.localStorage?.setItem(PW_STORAGE_KEY, String(propsPanelWidth)) } catch {}
    if (typeof window !== "undefined") window.dispatchEvent(new Event("resize"))
  }, [propsPanelWidth])
  const propsResizeRef = useRef<{ startX: number; startW: number } | null>(null)
  // Estado do drag-and-drop no painel Layers (visualIndex sendo arrastado / sobre)
  const [dragLayerIdx, setDragLayerIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  // Drag de FOLDER inteiro: armazena o path do folder sendo arrastado pra que
  // o drop em outro folder/layer mova o folder completo (com subfolders).
  const [dragFolderPath, setDragFolderPath] = useState<string[] | null>(null)
  // Renaming inline: folder cujo nome esta sendo editado in-place no painel.
  const [renamingFolderKey, setRenamingFolderKey] = useState<string | null>(null)
  // Folder header sob o cursor durante drag (pra magnify dock-style)
  const [dragOverFolderKey, setDragOverFolderKey] = useState<string | null>(null)
  // Posicao do drop dentro do row alvo: "before" (top half) ou "after" (bottom
  // half). Permite distinguir "vai cair entre A e B" (gap), com os dois rows
  // vizinhos sofrendo magnify pra abrir espaco — feedback Photoshop+Dock.
  const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(null)
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  // historyTick: força re-render dos botões undo/redo quando push/undo/redo
  // muda o stack. Refs não disparam re-render — sem isso, botões disabled
  // ficam stale.
  const [historyTick, setHistoryTick] = useState(0)
  const isDirtyRef = useRef(false)
  const [isDirty, setIsDirty] = useState(false)
  const isApplyingHistory = useRef(false)
  // Gera um seq incrementado a cada applySnapshot — usado pelos rebakes de
  // raster mask pra detectar undo rapido (Cmd+Z duas vezes em <100ms). Se um
  // rebake async terminar e o seq mudou, ele aborta antes de setar _element
  // (evita race entre 2 rebakes do mesmo objeto — audit H1).
  const applySnapshotSeq = useRef(0)
  const isInitialized = useRef(false)
  // Blob URLs criados via createObjectURL (SVG patcher e similares) precisam
  // ser revogados explicitamente — o GC do browser NAO libera blob URLs
  // criados via URL.createObjectURL ate revokeObjectURL ou navegacao. Sem
  // limpeza, abrir/fechar editor varias vezes acumula MBs/GBs de blobs.
  const svgBlobUrlsRef = useRef<string[]>([])
  // Guard sincrono pra prevenir double-init em Strict Mode / re-renders rapidos.
  // useEffect roda 2x em dev (strict mode). Se init e async, ambos podem passar pelos
  // guards iniciais antes do primeiro chegar a setar fabricRef.current = fc, resultando
  // em 2 canvas criados e cada layer adicionado 2x. Esse flag e setado SINCRONO antes
  // de qualquer await.
  const isInitInProgress = useRef(false)
  const pendingTextPropagation = useRef(false)
  // Trava de reentrada do saveNow. Se save anterior ainda esta rodando, novo
  // saveNow aborta. Previne PATCHes simultaneos que poderiam corromper estado.
  const savingInFlightRef = useRef(false)
  const [confirmExit, setConfirmExit] = useState<null | (() => void)>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportPieces, setExportPieces] = useState<any[]>([])
  // Ref pro componente PsdImporter (renderizado hidden no fim do JSX) — chamado
  // via button "Importar PSD" da topbar. Componente gerencia file picker + upload
  // + redirect; aqui so disparamos importFile programaticamente.
  const psdImporterRef = useRef<PsdImporterHandle | null>(null)
  const [layers, setLayers] = useState<any[]>([])
  const [editingLayerAssetId, setEditingLayerAssetId] = useState<string | null>(null)
  // Mask focus mode: o assetId do layer cuja mask esta sendo editada via
  // brush. Quando setado: canvas mostra overlay vermelho indicando edit
  // mode + brush ativo. Click no MaskThumb toggla.
  const [maskFocusAssetId, setMaskFocusAssetId] = useState<string | null>(null)
  const [maskBrushColor, setMaskBrushColor] = useState<"white" | "black">("white")
  const [maskBrushSize, setMaskBrushSize] = useState(20)
  // Pastas do PSD recolhidas no painel de layers. Chave = path joined por "›"
  // (ex: "Header" ou "Header›Buttons"). Quando incluido aqui, todos os layers
  // dentro daquela pasta ficam escondidos no painel ate o user expandir.
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  function toggleFolder(key: string) {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  const [zoom, setZoom] = useState(0.5)
  const zoomRef = useRef(0.5)
  const [bgColor, setBgColor] = useState("#ffffff")
  const bgColorRef = useRef("#ffffff")
  const [bgOpacity, setBgOpacity] = useState(1)
  const bgOpacityRef = useRef(1)
  // Library de cores do cliente (Client.brandColors). Renderiza no topo das
  // SWATCHES no painel BG e no painel de texto pra acesso rapido.
  const [brandColors, setBrandColors] = useState<BrandColor[]>([])
  // Ref pra acesso síncrono em handlers (resolve brand refs no load do canvas
  // antes do React ter chance de re-renderizar).
  const brandColorsRef = useRef<BrandColor[]>([])
  useEffect(() => { brandColorsRef.current = brandColors }, [brandColors])
  // Cor principal da MARCA — usada nos destaques de drag/drop (linha amarela,
  // magnify glow, indicators). Fallback: amarelo zzosy. Re-calcula quando o
  // brandColors mudar (sync com Client).
  const accentColor = (typeof brandColors[0]?.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(brandColors[0].hex))
    ? brandColors[0].hex
    : "#F5C400"
  const accentRgba = (a: number) => {
    const m = /^#([0-9a-f]{6})$/i.exec(accentColor)
    if (!m) return `rgba(245,196,0,${a})`
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  }

  // Quando brandColors muda (depois do load do client), re-sincroniza fills
  // de texto e cores de BG SOLID que tem brand ref. Renderiza + marca dirty
  // pra proximo save persistir. Cobre o cenario: editor ja aberto E user
  // mudou cores da brand em outra aba (fetched via 'zzosy:brand-updated' que
  // ja faz refetch do client em alguns lugares — mas aqui dispara o sync).
  useEffect(() => {
    if (brandColors.length === 0) return
    const fc = fabricRef.current
    if (!fc) return
    // CRITICO: brand sync NAO eh acao do user — eh efeito colateral de mudanca
    // em outra aba (edicao no /clients/[id]). Setamos isApplyingHistory.current
    // = true ANTES dos obj.set pra que listeners object:modified/added/removed
    // NAO disparem pushHistory automatico. Caso contrario, brand sync entraria
    // como "acao" no stack, e undo do user desfaria o sync junto.
    const wasApplying = isApplyingHistory.current
    isApplyingHistory.current = true
    let bgChanged = false
    let textChanged = false
    try {
      bgChanged = syncBrandRefsInBgLayers()
      textChanged = syncBrandRefsInTextObjects(fc)
    } finally {
      isApplyingHistory.current = wasApplying
    }
    if (!bgChanged && !textChanged) return
    // ANTES: zerava undoStack inteiro (`undoStack.current = [snap]`). Resultado
    // catastrofico — qualquer brand update apagava TODO o trabalho previo do
    // user (sintoma: "undo de um layer reseta override de outro layer sem
    // relacao"). Agora apenas re-renderiza e marca dirty pro proximo save
    // persistir as novas cores. Undo permanece intacto.
    if (bgChanged) {
      ;(async () => {
        const fabricMod: any = await import("fabric")
        for (let i = 0; i < bgRectsRef.current.length; i++) {
          const r = bgRectsRef.current[i]
          const l = bgLayersRef.current[i]
          if (r && l) await syncBgLayerToRect(r, l, canvasWRef.current, canvasHRef.current, fabricMod)
        }
        fc.renderAll()
      })()
    } else {
      fc.renderAll()
    }
    // Marca dirty pra que o sync persista no proximo auto-save. Sem isso, se
    // user fechar a aba sem editar nada, o sync visual nao seria salvo no DB.
    isDirtyRef.current = true
    setIsDirty(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandColors])

  // Re-sincroniza fill dos Textboxes com __fillBrandIdx contra brandColors
  // atual. Retorna true se algum fill mudou.
  function syncBrandRefsInTextObjects(fc: any): boolean {
    if (!fc) return false
    let changed = false
    for (const o of fc.getObjects()) {
      const bIdx = (o as any).__fillBrandIdx
      if (typeof bIdx !== "number") continue
      const live = brandColorsRef.current[bIdx]
      if (!live || typeof live.hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(live.hex)) continue
      if (typeof o.fill === "string" && live.hex.toLowerCase() !== o.fill.toLowerCase()) {
        o.set("fill", live.hex)
        changed = true
      }
    }
    return changed
  }

  // Re-sincroniza as cores SOLID dos bgLayers com brandColors atual. Se algum
  // BG referencia (colorBrandIdx) um brand color cuja cor mudou desde o ultimo
  // save, atualiza color + marca dirty pra proximo auto-save persistir. Retorna
  // true se alguma layer foi modificada.
  function syncBrandRefsInBgLayers(): boolean {
    let changed = false
    for (let i = 0; i < bgLayersRef.current.length; i++) {
      const l = bgLayersRef.current[i]
      if (l.kind !== "solid" || typeof l.colorBrandIdx !== "number") continue
      const live = brandColorsRef.current[l.colorBrandIdx]
      if (!live || typeof live.hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(live.hex)) continue
      if (live.hex.toLowerCase() !== l.color.toLowerCase()) {
        bgLayersRef.current[i] = { ...l, color: live.hex }
        changed = true
      }
    }
    if (changed) {
      isDirtyRef.current = true
      setIsDirty(true)
    }
    return changed
  }
  // BG-2: multiplas BG layers empilhaveis (igual Photoshop). bgLayersRef =
  // fonte da verdade dos dados; bgRectsRef = Rects no canvas (mesma ordem).
  // bgColorRef/bgOpacityRef/bgRef continuam refletindo o BG[0] (fundo) pra
  // back-compat com codigo legacy de save/export/import.
  const bgLayersRef = useRef<BgLayerData[]>([{ kind: "solid", color: "#ffffff", opacity: 1 }])
  const bgRectsRef = useRef<any[]>([])
  const [modal, setModal] = useState(false)
  // openGenerator=true vem do botao "Gerar peca" em /campaigns/[id]: depois do
  // init do canvas, abre o modal automaticamente. Polling pq isInitialized eh
  // ref (nao reativo). So aplica em modo matriz (sem pieceId).
  useEffect(() => {
    if (!openGenerator) return
    if (pieceId) return
    let cancelled = false
    const t = setInterval(() => {
      if (cancelled) return
      if (isInitialized.current) {
        clearInterval(t)
        setModal(true)
      }
    }, 100)
    return () => { cancelled = true; clearInterval(t) }
  }, [openGenerator, pieceId])
  const [saving, setSaving] = useState(false)
  const [assetId, setAssetId] = useState("")
  const assetIdRef = useRef("")
  const [canvasW, setCanvasW] = useState(DEFAULT_W)
  const [canvasH, setCanvasH] = useState(DEFAULT_H)
  const canvasWRef = useRef(DEFAULT_W)
  const canvasHRef = useRef(DEFAULT_H)
  // Fontes do PSD que NAO foram encontradas no browser apos o pre-load.
  // Cada entrada tem family (nome puro), weight (CSS numerico) e style
  // pra permitir substituicao cirurgica (so nos textos que usam ESSA variante,
  // sem alterar outras com a mesma family).
  const [missingFonts, setMissingFonts] = useState<Array<{
    family: string
    weight: number
    style: "normal" | "italic"
    label: string
  }>>([])
  // Modal estilo Adobe que lista cada fonte missing com dropdown de substituicao
  // + botao de upload. Aberto via botao no banner.
  const [fontsModalOpen, setFontsModalOpen] = useState(false)
  // Estado pendente de substituicao por variante missing — { family, weight, style }.
  // Key = mf.label. Family-only choice (sem weight setado): assume weight/style
  // da fonte original missing. Permite o user picar so a familia e ter
  // substituicao "Bold Italic → Inter Bold Italic" sem precisar tocar no peso.
  const [replacementChoices, setReplacementChoices] = useState<Record<string, { family?: string; weight?: number; style?: "normal" | "italic" }>>({})
  // Ref pro input file de upload de fonte do modal. Re-uso entre as fontes:
  // pendingFontUpload guarda a variante clicada ANTES do picker.
  const fontUploadInputRef = useRef<HTMLInputElement>(null)
  const pendingFontUpload = useRef<{ family: string; weight: number; style: "normal" | "italic"; label: string } | null>(null)

  // Carregar campanha + peça (se for modo peça)
  useEffect(() => {
    let alive = true
    async function load() {
      const campRes = await fetch(`/api/campaigns/${campaignId}`)
      if (!alive) return
      const camp: Campaign = await campRes.json()
      if (!alive) return
      campaignRef.current = camp
      // ============================================================
      // CARREGAMENTO DE FONTES — pipeline em CAMADAS bem definidas:
      //   1. BRAND FONT (Design System): UMA estrategia por vez (custom OU
      //      Google), sem duplicar registro. Evita conflito de @font-face onde
      //      browser nao sabe qual usar.
      //   2. PSD/TEXTOS: fontes referenciadas em assets/overrides sao tentadas
      //      como Google Fonts via forceLoadFontFaces (404 silencioso se nao
      //      for Google valida). customFontFiles ja registrados em (1) cobrem
      //      a fonte da marca tb se referenciada nos textos.
      //   3. DETECTION: measureText decide se familia carregou ou nao —
      //      independente de qual origem foi (cache, Google CDN, custom file).
      // ============================================================
      try {
        const bf = (camp.client?.brandFont ?? "").trim()
        const files = camp.client?.customFontFiles
        const hasCustomFiles = Array.isArray(files) && files.length > 0
        if (bf) {
          if (hasCustomFiles) {
            // Cliente uploadou arquivos especificos pra esta fonte → fonte da
            // verdade eh o arquivo dele, nao a Google. Registra apenas
            // loadCustomFontFamily (que ja cobre family + PostScript + display
            // aliases). NAO chama loadGoogleFont — evita registro duplo no
            // mesmo nome (browser escolhia aleatoriamente entre os 2).
            loadCustomFontFamily(bf, files)
          } else {
            // Sem arquivos custom: tenta como Google Font. Se nao for Google
            // valida, link 404 silencioso e familia cai em fallback CSS no
            // render (detection avisa o user via banner).
            loadGoogleFont(bf)
          }
        }
      } catch {}
      // PSD fonts: coleta TODAS as fontes E SUAS VARIANTES (peso × estilo)
      // usadas pelos assets de texto E pelos overrides. Sem checar variantes,
      // o detection diz "Sicredi Sans OK" porque Sicredi Sans Regular esta
      // carregada — mas Sicredi Sans Bold Italic (que o titulo usa) NAO esta,
      // e o browser cai em serif italic fallback. Sintoma reportado: preview
      // raster perfeito mas titulo do editor vira serif italico.
      try {
        const fontSet = new Set<string>() // pra forceLoadFontFaces (preload geral)
        const variantSet = new Set<string>() // formato "family|weight|style" pra detection
        // Normaliza weight pra numero CSS (Sicredi/PSD pode salvar "bold", 700, "700").
        const weightToNum = (w: any): number => {
          if (typeof w === "number") return w
          if (typeof w === "string") {
            const lower = w.trim().toLowerCase()
            if (lower === "bold") return 700
            if (lower === "normal" || lower === "regular") return 400
            const n = Number(lower)
            if (Number.isFinite(n) && n > 0) return n
          }
          return 400
        }
        const styleToCanon = (s: any): "normal" | "italic" => {
          if (typeof s === "string" && /italic|oblique/i.test(s)) return "italic"
          return "normal"
        }
        const addVariant = (family: any, weight: any, style: any) => {
          if (typeof family !== "string" || !family) return
          fontSet.add(family)
          variantSet.add(`${family}|${weightToNum(weight)}|${styleToCanon(style)}`)
        }
        for (const a of (camp.assets ?? [])) {
          if (a.type !== "TEXT") continue
          const spans: any = typeof a.content === "string" ? (() => { try { return JSON.parse(a.content as any) } catch { return [] } })() : a.content
          if (Array.isArray(spans)) {
            for (const s of spans) {
              addVariant(s?.style?.fontFamily, s?.style?.fontWeight, s?.style?.fontStyle)
            }
          }
          // lastOverride: template visual aplicado na matriz mais recente
          const lo: any = (a as any).lastOverride
          if (lo) addVariant(lo.fontFamily, lo.fontWeight, lo.fontStyle)
        }
        // Matriz layers (overrides per-instancia)
        const kvLayers: any = camp.keyVision?.layers
        const kvList = typeof kvLayers === "string" ? (() => { try { return JSON.parse(kvLayers) } catch { return [] } })() : (Array.isArray(kvLayers) ? kvLayers : [])
        for (const l of kvList) {
          const ov = l?.overrides
          if (ov) addVariant(ov.fontFamily, ov.fontWeight, ov.fontStyle)
          // Styles per-char (cada char pode ter weight/style proprio)
          const st = ov?.styles
          if (st && typeof st === "object") {
            for (const lineK of Object.keys(st)) {
              const line = st[lineK]
              if (!line || typeof line !== "object") continue
              for (const colK of Object.keys(line)) {
                const cs = line[colK]
                if (cs) addVariant(cs.fontFamily, cs.fontWeight, cs.fontStyle)
              }
            }
          }
        }
        if (fontSet.size > 0) {
          ensurePsdFontsReady(Array.from(fontSet))
          // Forca download EXPLICITO de cada @font-face (todos os pesos), pra
          // garantir que o textbox renderize com a fonte real, nao fallback.
          await forceLoadFontFaces(Array.from(fontSet), 6000)
          // Detecta variantes ausentes via measureText (font detection classica).
          // `document.fonts.check` da falso positivo em varios cenarios:
          //   - <link> 404 ainda registra a familia no CSS, check retorna true
          //   - Chrome sintetiza italic/bold a partir de Regular = check ok
          //   - Custom fonts com aliases multi-name confundem o matching
          // measureText compara a largura renderizada com a fonte custom vs com
          // fallback puro (serif). Se forem iguais, a fonte custom NAO esta
          // realmente sendo usada — caiu em fallback. Robusto e direto.
          try {
            // Aguarda CSSOM aplicar @font-face dos links injetados +
            // browser registrar todas as fontes. Sem isso, mesmo apos
            // forceLoadFontFaces resolver, o measureText do canvas podia
            // dar falso positivo de "missing" em fonts Google que carregam
            // lento (ex: Pacifico — handwriting, peso unico, raro de bater
            // antes do init terminar).
            try { await (document as any).fonts?.ready } catch {}
            const probeCanvas = document.createElement("canvas")
            const ctx = probeCanvas.getContext("2d")
            if (ctx) {
              const SAMPLE = "mwiI@#$%MNOQRS 1234567890"
              const FALLBACKS = ["serif", "sans-serif", "monospace"]
              // 1) Pra cada FAMILIA usada, await fonts.load() do Regular E
              // depois mede largura. Se a familia INTEIRA esta missing (nenhuma
              // variante carrega), reporta. Se Regular existe, browser sintetiza
              // bold/italic — visual nao eh perfeito mas eh aceitavel.
              const familyHasAnyVariant = async (family: string): Promise<boolean> => {
                const escFamily = family.replace(/"/g, '\\"')
                // Espera o <link rel=stylesheet> do CSS Google Fonts efetivamente
                // baixar antes de medir. Sem isso, fonts.load() resolvia (browser
                // promete carregar) mas o stylesheet ainda nao tinha @font-face
                // registrado -> canvas caia em fallback. Sintoma: Dancing Script
                // detectada como missing mesmo sendo a fonte do brand.
                const linkId = `gfont-${family.replace(/\s+/g, "-")}`
                const linkEl = document.getElementById(linkId) as HTMLLinkElement | null
                if (linkEl && !linkEl.sheet) {
                  await Promise.race([
                    new Promise<void>((res) => {
                      const done = () => res()
                      linkEl.addEventListener("load", done, { once: true })
                      linkEl.addEventListener("error", done, { once: true })
                    }),
                    new Promise<void>((res) => setTimeout(res, 5000)),
                  ])
                }
                // Forca download do font efetivo (depois do sheet carregado, isso
                // resolve quando a fonte esta REALMENTE disponivel pro canvas).
                try { await (document as any).fonts?.load?.(`72px "${escFamily}"`) } catch {}
                const probes: Array<{ w: number; s: "normal" | "italic" }> = [
                  { w: 400, s: "normal" }, { w: 700, s: "normal" }, { w: 400, s: "italic" },
                ]
                for (const p of probes) {
                  for (const fb of FALLBACKS) {
                    ctx.font = `${p.s} ${p.w} 72px ${fb}`
                    const baseW = ctx.measureText(SAMPLE).width
                    ctx.font = `${p.s} ${p.w} 72px "${escFamily}", ${fb}`
                    const testW = ctx.measureText(SAMPLE).width
                    if (Math.abs(testW - baseW) > 0.5) return true
                  }
                }
                return false
              }
              const familyAvailable = new Map<string, boolean>()
              const missingMap = new Map<string, { family: string; weight: number; style: "normal" | "italic"; label: string }>()
              for (const key of variantSet) {
                const [family] = key.split("|")
                let famOk = familyAvailable.get(family)
                if (famOk === undefined) {
                  famOk = await familyHasAnyVariant(family)
                  familyAvailable.set(family, famOk)
                }
                if (!famOk && !missingMap.has(family)) {
                  missingMap.set(family, { family, weight: 400, style: "normal", label: family })
                }
              }
              if (alive) setMissingFonts(Array.from(missingMap.values()))
            }
          } catch (e) { editorLog("[font-detection] falha:", e) }
        }
      } catch (e) { editorLog("[font-preload] falha:", e) }
      if (!alive) return
      if (camp.assets?.length) { assetIdRef.current = camp.assets[0].id }

      // MODO PEÇA: carrega peça PRIMEIRO, atualiza refs, depois disso seta campaign (que dispara init)
      if (pieceId) {
        const pieceRes = await fetch(`/api/pieces/${pieceId}`)
        if (!alive) return
        const p = await pieceRes.json()
        if (!alive) return
        const pdata = typeof p.data === "string" ? JSON.parse(p.data) : p.data
        const pw = pdata?.width ?? DEFAULT_W
        const ph = pdata?.height ?? DEFAULT_H
        // Piece fonts: coleta fontes dos overrides + per-char styles em TODOS
        // os steps (incluindo inativos pra que switchStep nao caia em fallback).
        // ensurePsdFontsReady eh idempotente — fontes ja carregadas via matriz
        // sao no-op.
        try {
          const pieceFonts = new Set<string>()
          const collectFromLayers = (layers: any[]) => {
            if (!Array.isArray(layers)) return
            for (const l of layers) {
              const f = l?.overrides?.fontFamily ?? l?.fontFamily
              if (typeof f === "string" && f) pieceFonts.add(f)
              const st = l?.overrides?.styles
              if (st && typeof st === "object") {
                for (const lineK of Object.keys(st)) {
                  const line = st[lineK]
                  if (!line || typeof line !== "object") continue
                  for (const colK of Object.keys(line)) {
                    const cf = line[colK]?.fontFamily
                    if (typeof cf === "string" && cf) pieceFonts.add(cf)
                  }
                }
              }
            }
          }
          collectFromLayers(pdata?.layers ?? [])
          if (Array.isArray(pdata?.steps)) {
            for (const s of pdata.steps) collectFromLayers(s?.layers ?? [])
          }
          if (pieceFonts.size > 0) {
            ensurePsdFontsReady(Array.from(pieceFonts))
            // Mesmo motivo: forca o download REAL de cada @font-face antes
            // do init criar os Textboxes — evita fallback Arial visual.
            await forceLoadFontFaces(Array.from(pieceFonts), 6000)
          }
        } catch (e) { editorLog("[piece-font-preload] falha:", e) }
        if (!alive) return
        // CRITICAL: setar refs ANTES de setCampaign para o init do canvas ter os dados certos
        pieceRef.current = p
        canvasWRef.current = pw
        canvasHRef.current = ph
        // Robustez: bgColor SEMPRE string. DB legado pode ter objeto.
        const rawBg = pdata?.bgColor ?? camp.keyVision?.bgColor
        const bg = typeof rawBg === "string" ? rawBg : "#ffffff"
        bgColorRef.current = bg
        const bop = typeof pdata?.bgOpacity === "number" ? pdata.bgOpacity : 1
        bgOpacityRef.current = bop
        setBgOpacity(bop)
        // Migra legacy → bgLayers[]: se pdata.bgLayers existe usa, senao cria
        // um BG solid com bgColor/bgOpacity (compat com pieces antigas).
        bgLayersRef.current = Array.isArray(pdata?.bgLayers) && pdata.bgLayers.length > 0
          ? pdata.bgLayers.map((l: any) => ({
              kind: "solid",
              color: typeof l.color === "string" ? l.color : "#ffffff",
              opacity: typeof l.opacity === "number" ? l.opacity : 1,
              hidden: l.hidden === true ? true : undefined,
              locked: l.locked === true ? true : undefined,
            }))
          : [{ kind: "solid", color: bg, opacity: bop }]
        // STEPS: inicializa buffer dos steps inativos + indice ativo.
        // O save grava TODOS os steps em data.steps (incluindo o ativo). No load,
        // precisamos:
        // 1. Extrair o step ativo (steps[activeStepIndex]) — vai pro canvas via layers.
        // 2. Os outros (steps[i] onde i != activeStepIndex) viram inactiveStepsRef.
        // stepCount total = data.steps.length (NAO eh 1 + inactives).
        const savedAllSteps: any[] = Array.isArray(pdata?.steps) ? pdata.steps : []
        const savedActive: number = typeof pdata?.activeStepIndex === "number" ? pdata.activeStepIndex : 0
        // Se a URL pediu um step especifico (?stepIndex=N vindo da apresentacao),
        // usa esse no lugar do savedActive — desde que seja valido pra esta peca.
        const requestedStep = (typeof initialStepIndex === "number"
          && initialStepIndex >= 0
          && initialStepIndex < savedAllSteps.length)
          ? initialStepIndex
          : savedActive
        if (savedAllSteps.length >= 2) {
          // Peca multi-step: separa ativo dos inativos.
          inactiveStepsRef.current = savedAllSteps.filter((_, i) => i !== requestedStep)
          setStepCountSync(savedAllSteps.length)
          setActiveStepIndexSync(requestedStep)
        } else {
          // Peca legada / 1 step: nao mexe.
          inactiveStepsRef.current = []
          setStepCountSync(1)
          setActiveStepIndexSync(0)
        }
        // Agora seta states (dispara render + init do canvas)
        setPiece(p)
        setCanvasW(pw); setCanvasH(ph)
        setBgColor(bg)
        if (camp.assets?.length) setAssetId(camp.assets[0].id)
        setCampaign(camp)
      } else {
        // MODO MATRIZ
        const rawBg = camp.keyVision?.bgColor
        // Robustez: DB pode ter bgColor como objeto serializado (legado/bug).
        // bgColor.toLowerCase() crasha se nao for string — normaliza aqui.
        const bg = typeof rawBg === "string" ? rawBg : "#ffffff"
        const cw = camp.keyVision?.width ?? DEFAULT_W
        const ch = camp.keyVision?.height ?? DEFAULT_H
        bgColorRef.current = bg
        canvasWRef.current = cw
        canvasHRef.current = ch
        setBgColor(bg)
        setCanvasW(cw); setCanvasH(ch)
        // Matriz so suporta 1 BG por enquanto (multi-BG eh por peca em V1)
        bgLayersRef.current = [{ kind: "solid", color: bg, opacity: 1 }]
        if (camp.assets?.length) setAssetId(camp.assets[0].id)
        setCampaign(camp)
      }
    }
    load()
    return () => { alive = false }
  }, [campaignId, pieceId])

  // Carrega a library de cores do cliente da campanha. Usado pra renderizar
  // swatches "Marca" no topo dos color pickers (BG + texto). Re-fetch
  // automatico quando o evento 'zzosy:client-brand-updated' eh disparado
  // (pra refletir mudancas no /clients/[id]/edit sem reload do editor).
  useEffect(() => {
    const clientId = campaign?.client?.id
    if (!clientId) { setBrandColors([]); return }
    let cancelled = false
    function load() {
      fetch(`/api/clients/${clientId}`, { cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .then(c => {
          if (cancelled || !c) return
          const arr: any[] = Array.isArray(c?.brandColors) ? c.brandColors : []
          const cleaned: BrandColor[] = arr
            .filter(x => typeof x?.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(x.hex))
            .map(x => ({ hex: x.hex, name: x.name ?? null, role: x.role }))
          setBrandColors(cleaned)
        })
        .catch(() => { if (!cancelled) setBrandColors([]) })
    }
    load()
    function onUpdate(e: any) {
      // Refetch so se o evento eh pro client desta campanha (ou sem detail = refetch sempre)
      const detailId = e?.detail?.clientId
      if (!detailId || detailId === clientId) load()
    }
    window.addEventListener("zzosy:client-brand-updated", onUpdate)
    return () => { cancelled = true; window.removeEventListener("zzosy:client-brand-updated", onUpdate) }
  }, [campaign?.client?.id])

  // Sempre que voltar para o editor (foco), apenas atualiza campaignRef em memoria.
  // NAO toca no canvas: qualquer "sync" automatico apaga edicoes locais nao salvas
  // (cor por letra, tamanho custom, etc). Sync visual real acontece so no remount da pagina.
  useEffect(() => {
    function onFocus() {
      fetch(`/api/campaigns/${campaignId}`).then(r => r.json()).then((d: Campaign) => {
        campaignRef.current = d
      }).catch(() => {})
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [campaignId])

  // Atalhos Cmd/Ctrl+Z (undo) e Cmd/Ctrl+Shift+Z (redo)
  // Atalho Cmd/Ctrl+Shift+>/< pra aumentar/diminuir 4pt no fontSize do texto selecionado
  // (igual Photoshop). So funciona quando o textbox esta selecionado mas NAO em edicao inline.
  useEffect(() => {
    function isTypingInPanel(t: EventTarget | null): boolean {
      if (!t) return false
      const el = t as HTMLElement
      const tag = (el.tagName || "").toUpperCase()
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
      if (el.isContentEditable) return true
      return false
    }
    function onKey(e: KeyboardEvent) {
      // Se o usuario esta digitando num input/textarea do painel, nao intercepta atalhos.
      // Permite digitar valores numericos, buscar fontes, etc, sem que Cmd+Z (undo) ou
      // Cmd+Shift+>/< (font size) roubem a tecla.
      if (isTypingInPanel(e.target)) return

      const fc = fabricRef.current
      const active = fc?.getActiveObject() as any
      const isTextActive = active && (active.type === "textbox" || active.type === "i-text")

      // Cmd+Shift+L/C/R/J — alinhamento (Photoshop). Funciona inclusive em modo edicao.
      if (isTextActive && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        const k = e.key.toLowerCase()
        const map: Record<string, string> = { l: "left", c: "center", r: "right", j: "justify" }
        if (map[k]) {
          e.preventDefault()
          active.set("textAlign", map[k])
          if (active.initDimensions) active.initDimensions()
          active.setCoords()
          fc?.renderAll()
          fc?.fire("object:modified", { target: active })
          setSelectedTick(t => t + 1)
          return
        }
      }

      // Option+↑/↓ — entrelinhas em PONTOS (Adobe-style). 1pt sem Shift, 10pt com Shift.
      // Funciona em modo edicao. Se estava em "Auto", primeira mexida congela no valor
      // efetivo atual e comeca a editar dali (igual Photoshop).
      if (isTextActive && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const delta = e.key === "ArrowUp" ? step : -step
        const fs = active.fontSize ?? 48
        const curPt: number = (active.leadingPt !== undefined && active.leadingPt !== null)
          ? active.leadingPt
          : Math.round((active.lineHeight ?? 1.0) * fs) // congela do auto (1:1 com fontSize)
        const next = Math.max(1, curPt + delta)
        active.leadingPt = next
        // Sincroniza lineHeight do Fabric (detalhe interno do motor)
        active.set("lineHeight", next / fs)
        if (active.initDimensions) active.initDimensions()
        active.setCoords()
        fc?.renderAll()
        fc?.fire("object:modified", { target: active })
        setSelectedTick(t => t + 1)
        return
      }

      if (active?.isEditing) return // demais atalhos: nao interfere com edicao de texto

      // Cmd+C — copia objeto selecionado pro clipboard interno
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && !e.shiftKey && !e.altKey) {
        if (!active || (active as any).__isBg) return
        e.preventDefault()
        // Serializa COM props customizadas que precisamos preservar
        // (__assetId pra link com CampaignAsset; __assetLabel pra rotulo;
        //  leadingPt pra entrelinhas em pt; styles pra formatacao per-char).
        const json = active.toObject([
          "__assetId", "__assetLabel", "__isBg", "leadingPt", "__maskData",
        ])
        setClipboard({ campaignId, json, copiedAt: Date.now() })
        return
      }

      // Cmd+V — cola da clipboard interna
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v" && !e.shiftKey && !e.altKey) {
        const cb = getClipboard()
        if (!cb) return
        if (cb.campaignId !== campaignId) {
          alert("Asset copiado pertence a outra campanha — copie/cole apenas dentro da mesma campanha por enquanto.")
          return
        }
        e.preventDefault()
        ;(async () => {
          const { util } = await import("fabric")
          // enlivenObjects retorna Promise<FabricObject[]> em v6+
          const enlivened = await util.enlivenObjects([cb.json]) as any[]
          const cloned = enlivened?.[0]
          if (!cloned || !fc) return
          // CRITICO: enlivenObjects reconstroi via construtor Fabric, que NAO copia
          // props customizadas (__assetId/__assetLabel/leadingPt). Sem isso, o objeto
          // colado fica com __assetId=undefined e ao salvar/recarregar a peca o load
          // pula esse layer (assetMap[null] = undefined) -> texto "desaparece".
          if (cb.json.__assetId) (cloned as any).__assetId = cb.json.__assetId
          if (cb.json.__assetLabel) (cloned as any).__assetLabel = cb.json.__assetLabel
          if (cb.json.leadingPt !== undefined) (cloned as any).leadingPt = cb.json.leadingPt
          // Mascara: re-aplicar a partir do __maskData (clipPath serializado e parcial)
          if (cb.json.__maskData) {
            (cloned as any).__maskData = cb.json.__maskData
            const { Image: FabImage, Path } = await import("fabric")
            ;(cloned as any).clipPath = null
            await applyMaskToFabricObject({ Image: FabImage, Path }, cloned, cb.json.__maskData)
          }
          // Offset visivel pra nao ficar exatamente em cima do original
          cloned.set({
            left: (cloned.left ?? 0) + 20,
            top: (cloned.top ?? 0) + 20,
          })
          cloned.setCoords()
          fc.add(cloned)
          fc.setActiveObject(cloned)
          fc.requestRenderAll()
          // Dispara save (via object:modified que ja escuta)
          fc.fire("object:modified", { target: cloned })
        })()
        return
      }

      // Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z OU Cmd/Ctrl+Y = redo.
      // Stack mantém 30 entradas (ver pushHistory).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault()
        redo()
        return
      }
      // Cmd+Shift+> / Cmd+Shift+< (Photoshop-style font size)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === ">" || e.key === "." || e.key === "<" || e.key === ",")) {
        if (!active || (active.type !== "textbox" && active.type !== "i-text")) return
        e.preventDefault()
        const delta = (e.key === ">" || e.key === ".") ? 4 : -4
        const cur = Math.round(active.fontSize ?? 48)
        const next = Math.max(1, cur + delta)
        active.set("fontSize", next)
        if (active.initDimensions) active.initDimensions()
        fc?.renderAll()
        // dispara o mesmo evento que o painel escuta pra reflitir a mudanca
        fc?.fire("object:modified", { target: active })
      }
      // Cmd+Opt+G (Mac) / Ctrl+Alt+G (Win) — Create/Release Clipping Mask (Photoshop)
      // Liga/desliga clipping mask no objeto selecionado.
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === "g") {
        if (!active) return
        e.preventDefault()
        const hasMask = !!(active as any).__maskData
        if (hasMask && (active as any).__maskData.type === "clipping") {
          // Release clipping mask
          removeMaskFromObject(active)
        } else {
          addClippingMaskToSelected()
        }
      }

      // Cmd/Ctrl+J — Duplicate layer (Photoshop style).
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        if (!active || (active as any).__isBg || (active as any).__isBleedOverlay) return
        e.preventDefault()
        ;(async () => {
          try {
            // Fabric v7: clone() returns Promise<FabricObject>. Second arg is
            // propsToInclude (mantém metadata custom no clone).
            const cloned: any = await (active as any).clone([
              "__assetId", "__assetLabel", "__isImage", "__maskData",
              "__embedded", "imageDataUrl", "__hidden", "__locked",
              "__fillBrandIdx", "__psdEffects", "__psdNameSource", "__groupPath", "__isSmartObject", "__smartObjectGuid", "__smartObjectMime", "__smartObjectFilePath", "__smartObjectOriginalName", "leadingPt",
            ])
            if (!cloned || !fc) return
            cloned.set({ left: (active.left ?? 0) + 30, top: (active.top ?? 0) + 30 })
            // __assetId: mantem mesmo do original — duplicata referencia o mesmo
            // CampaignAsset (estilo "smart object linked"). Visual edits ficam
            // como overrides per-layer. NUNCA usar "_copy" suffix — quebra match
            // em assetMap no reload (audit C3).
            fc.add(cloned)
            fc.setActiveObject(cloned)
            fc.renderAll()
            pushHistory()
            refreshLayers(fc)
          } catch (err) { console.warn("[duplicate] falhou:", err) }
        })()
        return
      }

      // Cmd/Ctrl+] — Bring forward (1 step). Cmd+Shift+] — Bring to front.
      if ((e.metaKey || e.ctrlKey) && e.key === "]") {
        if (!active || !fc) return
        e.preventDefault()
        try {
          if (e.shiftKey) (fc as any).bringObjectToFront ? (fc as any).bringObjectToFront(active) : (fc as any).bringToFront(active)
          else (fc as any).bringObjectForward ? (fc as any).bringObjectForward(active) : (fc as any).bringForward(active)
          // Re-eleva bleed overlays
          const overlays = (fc as any).__bleedOverlays as any[] | undefined
          if (overlays) for (const o of overlays) { try { (fc as any).bringObjectToFront ? (fc as any).bringObjectToFront(o) : (fc as any).bringToFront(o) } catch {} }
          fc.renderAll()
          pushHistory()
          refreshLayers(fc)
        } catch {}
        return
      }

      // Cmd/Ctrl+[ — Send backward (1 step). Cmd+Shift+[ — Send to back.
      if ((e.metaKey || e.ctrlKey) && e.key === "[") {
        if (!active || !fc) return
        e.preventDefault()
        try {
          if (e.shiftKey) (fc as any).sendObjectToBack ? (fc as any).sendObjectToBack(active) : (fc as any).sendToBack(active)
          else (fc as any).sendObjectBackwards ? (fc as any).sendObjectBackwards(active) : (fc as any).sendBackwards(active)
          // BG fica no fundo absoluto sempre
          const bgRects = bgRectsRef.current
          for (let i = bgRects.length - 1; i >= 0; i--) {
            try { (fc as any).sendObjectToBack ? (fc as any).sendObjectToBack(bgRects[i]) : (fc as any).sendToBack(bgRects[i]) } catch {}
          }
          fc.renderAll()
          pushHistory()
          refreshLayers(fc)
        } catch {}
        return
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [campaignId])

  // Hand tool (Photoshop-style): segura Space pra ativar pan do canvas.
  // - So ativa fora de inputs, fora de edicao inline de texto e fora de overlays/menus
  // - Cursor vira grab/grabbing, selecao/edit do canvas desabilitada enquanto ativa
  // - Pan via mouse:down/move/up modificando viewportTransform direto (Photoshop-style)
  // - Soltar Space restaura tudo. O viewport fica onde foi pannado (nao reseta)
  useEffect(() => {
    let isSpaceDown = false
    let isPanning = false
    let lastX = 0, lastY = 0
    // Snapshots de estado pra restaurar ao soltar Space
    let savedSelection: boolean | null = null
    let savedCursors: { default: string; hover: string; move: string } | null = null
    let savedObjectSelectability: Map<any, boolean> | null = null

    function isTypingTarget(t: EventTarget | null): boolean {
      if (!t) return false
      const el = t as HTMLElement
      const tag = (el.tagName || "").toUpperCase()
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
      if (el.isContentEditable) return true
      return false
    }

    function activate() {
      const fc = fabricRef.current
      if (!fc || isSpaceDown) return
      const active = fc.getActiveObject() as any
      if (active?.isEditing) return // nao interfere com edicao inline de texto
      isSpaceDown = true
      // Salva estado anterior
      savedSelection = fc.selection ?? true
      savedCursors = {
        default: fc.defaultCursor ?? "default",
        hover: fc.hoverCursor ?? "move",
        move: fc.moveCursor ?? "move",
      }
      savedObjectSelectability = new Map()
      for (const o of fc.getObjects()) {
        savedObjectSelectability.set(o, (o as any).selectable !== false)
        ;(o as any).selectable = false
        ;(o as any).evented = false
      }
      fc.selection = false
      fc.defaultCursor = "grab"
      fc.hoverCursor = "grab"
      fc.moveCursor = "grab"
      fc.discardActiveObject()
      fc.requestRenderAll()
    }

    function deactivate() {
      const fc = fabricRef.current
      if (!fc || !isSpaceDown) return
      isSpaceDown = false
      isPanning = false
      // Restaura estado
      if (savedCursors) {
        fc.defaultCursor = savedCursors.default
        fc.hoverCursor = savedCursors.hover
        fc.moveCursor = savedCursors.move
      }
      if (savedSelection !== null) fc.selection = savedSelection
      if (savedObjectSelectability) {
        for (const o of fc.getObjects()) {
          const wasSelectable = savedObjectSelectability.get(o) ?? true
          ;(o as any).selectable = wasSelectable
          ;(o as any).evented = wasSelectable
        }
      }
      savedSelection = null
      savedCursors = null
      savedObjectSelectability = null
      fc.requestRenderAll()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space") return
      if (isTypingTarget(e.target)) return // permite Space normal em inputs
      // Importante: prevent default pra Space nao scrollar pagina nem inserir em outros lugares
      e.preventDefault()
      activate()
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return
      deactivate()
    }

    // Pan via mouse handlers do Fabric, ativos so quando isSpaceDown
    function onMouseDown(opt: any) {
      if (!isSpaceDown) return
      const fc = fabricRef.current; if (!fc) return
      isPanning = true
      const ev = opt.e as MouseEvent
      lastX = ev.clientX
      lastY = ev.clientY
      fc.defaultCursor = "grabbing"
    }
    function onMouseMove(opt: any) {
      if (!isPanning) return
      const fc = fabricRef.current; if (!fc) return
      const ev = opt.e as MouseEvent
      const dx = ev.clientX - lastX
      const dy = ev.clientY - lastY
      lastX = ev.clientX
      lastY = ev.clientY
      const vt = fc.viewportTransform
      if (!vt) return
      vt[4] += dx
      vt[5] += dy
      fc.setViewportTransform(vt)
      fc.requestRenderAll()
    }
    function onMouseUp() {
      if (!isPanning) return
      isPanning = false
      const fc = fabricRef.current; if (!fc) return
      fc.defaultCursor = "grab"
      fc.requestRenderAll()
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    // Se a janela perde foco (tab change), desativa pra nao ficar travado
    window.addEventListener("blur", deactivate)

    // Liga handlers do Fabric quando o canvas existir
    let attachedFc: any = null
    const attachInterval = setInterval(() => {
      const fc = fabricRef.current
      if (!fc || attachedFc === fc) return
      attachedFc = fc
      fc.on("mouse:down", onMouseDown)
      fc.on("mouse:move", onMouseMove)
      fc.on("mouse:up", onMouseUp)
    }, 100)

    return () => {
      clearInterval(attachInterval)
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", deactivate)
      if (attachedFc) {
        attachedFc.off("mouse:down", onMouseDown)
        attachedFc.off("mouse:move", onMouseMove)
        attachedFc.off("mouse:up", onMouseUp)
      }
    }
  }, [])

  // beforeunload: avisa se ha mudancas nao salvas
  useEffect(() => {
    function onBefore(e: BeforeUnloadEvent) {
      if (isDirtyRef.current) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", onBefore)
    return () => window.removeEventListener("beforeunload", onBefore)
  }, [])

  // Inicializar Fabric
  useEffect(() => {
    if (!campaign || !canvasRef.current) return
    // Se ja existe um canvas Fabric, mas ele aponta para um DOM element diferente
    // do canvasRef.current atual (Strict Mode re-mount, hot reload, etc), descarta o velho
    if (fabricRef.current) {
      const existingEl = (fabricRef.current as any).lowerCanvasEl ?? (fabricRef.current as any).getElement?.()
      if (existingEl === canvasRef.current) return  // mesmo DOM, ja inicializado
      try { fabricRef.current.dispose() } catch {}
      fabricRef.current = null
    }
    // Guard sincrono: previne double-init em Strict Mode quando useEffect roda 2x.
    // Setamos a flag ANTES de qualquer await, e zeramos no cleanup.
    if (isInitInProgress.current) {
      return
    }
    isInitInProgress.current = true
    let alive = true
    const cleanupFns: Array<() => void> = []

    const init = async () => {
      const { Canvas, Rect, Textbox, FabricImage } = await import("fabric")
      if (!alive || !canvasRef.current) return

      const cw = canvasWRef.current
      const ch = canvasHRef.current

      // Canvas DOM enche TODA a area visivel entre paineis (sem subtrair
      // margem). Os handles do Fabric so podem ser renderizados DENTRO do
      // canvas DOM — sem essa area total, handles fora da peca eram cortados
      // pelas bordas. Margem visual entre canvas e paineis vem do estilo do
      // container, nao do tamanho do canvas.
      const availW = window.innerWidth - layersPanelWidth - propsPanelWidth
      const availH = window.innerHeight - TH - BH
      // HANDLE_MARGIN: pixels reservados ao redor da peca para os handles de
      // selecao aparecerem (mesmo modelo Photoshop/Figma). Sem isso, peca
      // com fit zoom encosta nas bordas do canvas e os handles top/right/
      // bottom/left ficam cortados.
      const HANDLE_MARGIN = 120
      const z = Math.round(Math.min(0.8,
        Math.max(0.05, (availW - HANDLE_MARGIN * 2) / cw),
        Math.max(0.05, (availH - HANDLE_MARGIN * 2) / ch),
      ) * 100) / 100
      zoomRef.current = z
      setZoom(z)

      // CANVAS PHOTOSHOP-STYLE: o canvas DOM ocupa toda a area visivel
      // disponivel (entre painel esquerdo, painel direito, topbar e footer).
      // A "peca" (artboard) renderiza centralizada como um Rect bg de
      // dimensoes cw x ch em coords do mundo Fabric.
      //
      // Vantagens vs canvas justinho-na-peca:
      //  - Handles de selecao funcionam em qualquer lugar da area visivel,
      //    nao so dentro da peca. Mesmo modelo de Photoshop/Figma/Illustrator.
      //  - Objetos fora da peca ficam interativos (clicar, arrastar, escalar).
      //  - Overlays "passe-partout" mascaram o que esta fora da peca pra UI
      //    nao ficar poluida.
      //
      // viewportTransform[4,5] centraliza a peca no canvas. Os bleed
      // overlays cobrem TUDO fora da regiao (0,0)->(cw,ch) no mundo Fabric.
      const fullW = Math.max(1, availW)
      const fullH = Math.max(1, availH)

      const fc = new Canvas(canvasRef.current, {
        width: Math.round(fullW),
        height: Math.round(fullH),
        selection: true,
        preserveObjectStacking: true,
        // controlsAboveOverlay: garante que as alcas de selecao (handles)
        // sao desenhadas POR CIMA de qualquer overlay/object do canvas,
        // mesmo se o objeto estiver atras dos bleed overlays. Sem isso, em
        // alguns casos os handles ficavam invisiveis quando o objeto ja
        // estava no z-stack abaixo de outros.
        controlsAboveOverlay: true,
      })
      fc.setZoom(z)
      // Offset pra centralizar a peca no canvas grande. Em coords do canvas DOM:
      //   peca renderiza em [(fullW - cw*z)/2, (fullH - ch*z)/2] -> [+ cw*z, + ch*z]
      const offsetX = (fullW - cw * z) / 2
      const offsetY = (fullH - ch * z) / 2
      const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
      vt[0] = z; vt[3] = z
      vt[4] = offsetX
      vt[5] = offsetY
      fc.setViewportTransform(vt)
      fabricRef.current = fc
      // Guarda dimensoes do canvas pra applyZoom/resize calcularem offset novo.
      ;(fabricRef as any).__canvasFullW = fullW
      ;(fabricRef as any).__canvasFullH = fullH

      // BG: vira layers REAIS (igual Photoshop). Cria 1 Rect por entry em
      // bgLayersRef. Idx 0 = fundo; ultimo = topo do grupo de BGs (ainda
      // abaixo de qualquer asset). bgRef.current aponta pro fundo (compat
      // com save/export legacy que assumiam 1 BG so).
      const fabricForBg: any = await import("fabric")
      const bgRects: any[] = []
      for (let i = 0; i < bgLayersRef.current.length; i++) {
        const ld = bgLayersRef.current[i]
        const r = new Rect({
          left: 0, top: 0, width: cw, height: ch,
          selectable: true, evented: true,
          hasControls: false, hasBorders: true,
          lockMovementX: true, lockMovementY: true,
          lockScalingX: true, lockScalingY: true, lockRotation: true,
          excludeFromExport: true,
        })
        await syncBgLayerToRect(r, ld, cw, ch, fabricForBg)
        ;(r as any).__isBg = true
        ;(r as any).__bgIdx = i
        ;(r as any).__assetLabel = i === 0 ? "Background" : `Background ${i + 1}`
        ;(r as any).__hidden = ld.hidden === true
        ;(r as any).__locked = ld.locked === true
        fc.add(r)
        bgRects.push(r)
      }
      bgRectsRef.current = bgRects
      bgRef.current = bgRects[0]

      // BLEED MASK dinamico: 4 overlays cobrindo tudo fora da peca dentro
      // do canvas. Tamanho deles depende do zoom e do espaco disponivel.
      createBleedOverlays(fc, Rect, cw, ch, fullW, fullH, z)

      // CRITICO: clipa o render do canvas inteiro a area da peca (0,0)-(cw,ch).
      // Sem isso, layers PSD que extrapolam a peca (ex: Pá at x=205-3016 com
      // peca cw=2160) vazam pro bleed mesmo com os overlays. Os overlays usam
      // z-order pra mascarar, mas alguns paths (object:added pos-render, etc)
      // podem deixar conteudo passar por baixo. clipPath nivel-canvas garante
      // que pixels fora da bbox da peca NAO renderizem, periodo.
      // absolutePositioned: true = coords em mundo, nao em viewport (preserva
      // o clip durante pan/zoom).
      ;(fc as any).clipPath = new Rect({
        left: 0, top: 0, width: cw, height: ch,
        absolutePositioned: true,
      })

      fc.on("selection:created", (e: any) => { if (alive) setSelected(e.selected?.[0] ?? null) })
      fc.on("selection:updated", (e: any) => { if (alive) setSelected(e.selected?.[0] ?? null) })
      // Salva seleção de texto via mouse:up e keyup no canvas (text:selection:changed
      // nao dispara no Fabric v7). Intervalo de polling enquanto objeto esta em edicao.
      let selPollTimer: any = null
      function pollTextSelection() {
        const active = fc.getActiveObject() as any
        if (active?.isEditing && active.selectionStart !== active.selectionEnd) {
          savedTextSelection.current = { obj: active, start: active.selectionStart, end: active.selectionEnd }
        }
      }
      fc.on("text:editing:entered", () => {
        selPollTimer = setInterval(pollTextSelection, 100)
      })
      fc.on("text:editing:exited", () => {
        clearInterval(selPollTimer)
      })
      // Limpa interval pendente no cleanup pro caso de unmount durante edicao.
      cleanupFns.push(() => { if (selPollTimer) clearInterval(selPollTimer) })
      fc.on("selection:cleared", () => { if (alive) setSelected(null) })
      // Photoshop-style chain mask: a raster mask anda junto com o layer
      // quando o user move/redimensiona. Sem isso, mover o layer no editor
      // deixava a mask "presa" no canvas — visualmente o layer movia com a
      // mask ja bakeada no bitmap (correto), mas no SAVE o layer.mask.raster
      // ficava nas coords originais — exportar pro PSD reposicionava a mask
      // ERRADA. Aqui detectamos o delta entre o __maskAnchor (registrado em
      // addAssetToCanvas) e a posicao atual, e propagamos pro __maskData.
      const syncMaskToObj = (obj: any) => {
        if (!obj) return
        const anchor = obj.__maskAnchor
        const maskData = obj.__maskData
        if (!anchor || !maskData) return
        const dLeft = (obj.left ?? 0) - anchor.left
        const dTop = (obj.top ?? 0) - anchor.top
        // Mask raster: ajusta posX/Y. Width/Height ficam intactos (resize do
        // layer ainda nao escala a mask — Photoshop tambem nao escala por
        // default; user precisa quebrar o chain pra editar).
        if (maskData.type === "raster" && maskData.raster && (dLeft !== 0 || dTop !== 0)) {
          maskData.raster.posX = Math.round(maskData.raster.posX + dLeft)
          maskData.raster.posY = Math.round(maskData.raster.posY + dTop)
        }
        // Vector: mesma logica no bbox do path.
        if (maskData.type === "vector" && maskData.vector && (dLeft !== 0 || dTop !== 0)) {
          maskData.vector.posX = Math.round(maskData.vector.posX + dLeft)
          maskData.vector.posY = Math.round(maskData.vector.posY + dTop)
          // Path: nao re-escrevemos string aqui (caro). PSD export recalcula
          // bbox a partir de posX/Y/W/H — suficiente pra Photoshop. Visual no
          // canvas usa clipPath via applyMaskToFabric (binario silhueta).
        }
        anchor.left = obj.left ?? 0
        anchor.top = obj.top ?? 0
      }
      fc.on("object:modified", (e: any) => { syncMaskToObj(e?.target) })
      fc.on("object:modified", () => { if (alive) doSave() })
      // Clipping mask LIVE sync — Photoshop: clip sempre acompanha o base
      // em tempo real conforme user move/escala/rota. Estrategia:
      //   - object:moving/scaling/rotating (LIVE): sync APENAS transform
      //     do clipPath existente (left/top/scale/angle) — fast path sem
      //     re-clonar (clone() eh async + pesado, frame rate cai).
      //   - object:modified (COMMIT): re-clona base completo (fill/path/
      //     content podem ter mudado alem do transform).
      function syncClippingMasksAboveLive(target: any) {
        if (!target || target.__isBg || target.__isBleedOverlay || target.__isStrokeGhost) return
        const all = fc.getObjects().filter((o: any) =>
          !o.__isBg && !o.__isBleedOverlay && !o.__isStrokeGhost
        )
        const baseIdx = all.indexOf(target)
        if (baseIdx === -1) return
        for (let i = baseIdx + 1; i < all.length; i++) {
          const above: any = all[i]
          const maskData = above?.__maskData
          if (maskData?.type === "clipping" && maskData?.enabled !== false && above.clipPath) {
            above.clipPath.set({
              left: target.left, top: target.top,
              scaleX: target.scaleX, scaleY: target.scaleY,
              angle: target.angle,
            })
            above.clipPath.setCoords?.()
            above.dirty = true
          } else break
        }
      }
      fc.on("object:moving" as any, (e: any) => { if (alive) { syncClippingMasksAboveLive(e?.target); fc.requestRenderAll() } })
      fc.on("object:scaling" as any, (e: any) => { if (alive) { syncClippingMasksAboveLive(e?.target); fc.requestRenderAll() } })
      fc.on("object:rotating" as any, (e: any) => { if (alive) { syncClippingMasksAboveLive(e?.target); fc.requestRenderAll() } })
      fc.on("object:modified", async (e: any) => {
        if (!alive || !fc) return
        const modified = e?.target
        if (!modified || modified.__isBg || modified.__isBleedOverlay || modified.__isStrokeGhost) return
        const all = fc.getObjects().filter((o: any) =>
          !o.__isBg && !o.__isBleedOverlay && !o.__isStrokeGhost
        )
        const baseIdx = all.indexOf(modified)
        if (baseIdx === -1) return
        for (let i = baseIdx + 1; i < all.length; i++) {
          const above: any = all[i]
          const maskData = above?.__maskData
          if (maskData?.type === "clipping" && maskData?.enabled !== false) {
            await applyClippingMaskNative(fc, above)
          } else break
        }
        fc.requestRenderAll()
      })
      // SAFE-AREA SNAP: ao mover texto, snap suave em padding mínimo lateral
      // (~30-50px proporcional ao canvas, escalado pelo maior eixo). Photoshop
      // smart guides. Soft snap: cede quando user "puxa" pra fora alem de
      // tolerancia ou segura Cmd/Alt — extrapolar manualmente permitido.
      // Tambem desenha guides visuais temporarias durante o move.
      const SNAP_TOL = 8 // px de tolerancia pro snap "puxar"
      const RELEASE_FORCE = 18 // px alem do snap pra liberar
      fc.on("object:moving" as any, (e: any) => {
        if (!alive) return
        const obj = e?.target
        if (!obj || (obj as any).__isBg || (obj as any).__isBleedOverlay) return
        // Permite extrapolar sem snap se user segura Alt/Cmd (modifier key)
        if ((e?.e as any)?.altKey || (e?.e as any)?.metaKey) {
          ;(fc as any).__safeAreaGuides = null
          return
        }
        const cw = canvasWRef.current
        const ch = canvasHRef.current
        // Padding proporcional: 4% do menor eixo, clamped 24..72
        const pad = Math.round(Math.max(24, Math.min(72, Math.min(cw, ch) * 0.04)))
        // Bbox do objeto (considera scale + width/height + origin)
        const oL = obj.left ?? 0
        const oT = obj.top ?? 0
        const oW = (obj.width ?? 0) * (obj.scaleX ?? 1)
        const oH = (obj.height ?? 0) * (obj.scaleY ?? 1)
        const oR = oL + oW
        const oB = oT + oH
        // Snap conditions: distancia ate borda interna (cw - pad / ch - pad)
        let newLeft = oL
        let newTop = oT
        const guides: { kind: "v" | "h"; pos: number }[] = []
        // Esquerda
        const distL = oL - pad
        if (Math.abs(distL) < SNAP_TOL) {
          newLeft = pad
          guides.push({ kind: "v", pos: pad })
        } else if (distL < 0 && distL > -RELEASE_FORCE) {
          // Dentro da safe area pela esquerda, mas nao no snap exato — soft pull
          newLeft = pad
          guides.push({ kind: "v", pos: pad })
        }
        // Direita
        const distR = (cw - pad) - oR
        if (Math.abs(distR) < SNAP_TOL) {
          newLeft = (cw - pad) - oW
          guides.push({ kind: "v", pos: cw - pad })
        } else if (distR < 0 && distR > -RELEASE_FORCE) {
          newLeft = (cw - pad) - oW
          guides.push({ kind: "v", pos: cw - pad })
        }
        // Topo
        const distT = oT - pad
        if (Math.abs(distT) < SNAP_TOL) {
          newTop = pad
          guides.push({ kind: "h", pos: pad })
        } else if (distT < 0 && distT > -RELEASE_FORCE) {
          newTop = pad
          guides.push({ kind: "h", pos: pad })
        }
        // Base
        const distB = (ch - pad) - oB
        if (Math.abs(distB) < SNAP_TOL) {
          newTop = (ch - pad) - oH
          guides.push({ kind: "h", pos: ch - pad })
        } else if (distB < 0 && distB > -RELEASE_FORCE) {
          newTop = (ch - pad) - oH
          guides.push({ kind: "h", pos: ch - pad })
        }
        if (newLeft !== oL) obj.left = newLeft
        if (newTop !== oT) obj.top = newTop
        // Armazena guides ativas pra after:render desenhar (linhas tracejadas)
        ;(fc as any).__safeAreaGuides = guides.length > 0 ? guides : null
      })
      fc.on("mouse:up" as any, () => {
        ;(fc as any).__safeAreaGuides = null
        fc.requestRenderAll()
      })
      // Desenha guides visuais (smart guides) sobre o canvas pos-render.
      // Fabric "after:render" roda apos cada renderAll — desenha por cima
      // sem virar parte do canvas state (limpo no proximo render).
      fc.on("after:render" as any, () => {
        const guides = (fc as any).__safeAreaGuides as Array<{ kind: "v" | "h"; pos: number }> | null
        if (!guides || guides.length === 0) return
        const ctx = (fc as any).getTopContext?.() || fc.contextTop
        if (!ctx) return
        const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
        ctx.save()
        // Aplica viewport transform (mesmo modo que os objetos)
        ctx.transform(vt[0], vt[1], vt[2], vt[3], vt[4], vt[5])
        ctx.strokeStyle = accentColor
        ctx.lineWidth = 1 / (vt[0] || 1) // mantem 1px visual independente do zoom
        ctx.setLineDash([6 / (vt[0] || 1), 4 / (vt[0] || 1)])
        const cw = canvasWRef.current
        const ch = canvasHRef.current
        for (const g of guides) {
          ctx.beginPath()
          if (g.kind === "v") { ctx.moveTo(g.pos, 0); ctx.lineTo(g.pos, ch) }
          else { ctx.moveTo(0, g.pos); ctx.lineTo(cw, g.pos) }
          ctx.stroke()
        }
        ctx.restore()
      })
      // Quando o usuario muda a selecao DENTRO de um textbox em modo edicao (cursor moveu,
      // selecao expandida, palavra selecionada), forca re-render do painel pra ler estilos
      // do caractere onde o cursor esta agora. Sem isso, painel mostra estado obsoleto
      // quando texto tem estilos per-char.
      // Fabric dispara mouseup/keyup nesses casos. Usamos uma checagem leve no proprio canvas.
      const onCanvasInteract = () => {
        if (!alive) return
        const active = fc.getActiveObject() as any
        if (active?.isEditing) setSelectedTick(t => t + 1)
      }
      fc.on("mouse:up", onCanvasInteract)
      // Escalar via canto/handle do box: dispara em real time pra atualizar painel
      // Photoshop-style: ao escalar TEXTBOX pelo canto, consolida o scale em fontSize
      // (em vez de manter scaleX/scaleY do Fabric). Resultado: o numero do tamanho de fonte
      // no painel reflete o tamanho real renderizado, e os exports/PSD sempre veem fontSize
      // limpo sem precisar multiplicar por scale.
      //
      // Cuidados:
      // - So aplica em textbox/i-text — outros objetos mantem scale normal
      // - Multiplica fontSize do obj E todos os styles per-char (overrides)
      // - Multiplica width pra preservar largura visual
      // - Reseta scaleX/scaleY pra 1 e re-aplica initDimensions pra wrap correto
      // - object:modified dispara DEPOIS (ao soltar mouse), com estado ja consolidado,
      //   resultando em UMA entrada de undo
      fc.on("object:scaling" as any, (e: any) => {
        if (!alive) return
        const obj = e?.target
        if (!obj) return
        const isText = obj.type === "textbox" || obj.type === "i-text"
        if (!isText) return

        const corner: string = e?.transform?.corner ?? ""
        const isSide = corner === "ml" || corner === "mr" || corner === "mt" || corner === "mb"

        if (isSide) {
          // LATERAIS (esq/dir/topo/baixo): comportamento Photoshop wrap. Soh muda width
          // e deixa Fabric quebrar texto naturalmente. NUNCA mexer em fontSize aqui — o
          // user esta ajustando a CAIXA, nao o tamanho do texto. Tambem nao reseta scaleX
          // durante o drag (Fabric perde referencia do delta e wrap quebra). object:modified
          // (no soltar mouse) consolida sX/sY em width/height final via re-set.
          return
        }

        // CANTOS (escala uniforme): Photoshop-style — consolida scaleX/scaleY em fontSize
        // e width raw. Resultado: numero do tamanho de fonte no painel reflete o real
        // renderizado; exports/PSD veem fontSize limpo sem multiplicar por scale.
        const sX = obj.scaleX ?? 1
        const sY = obj.scaleY ?? 1
        if (Math.abs(sY - 1) < 0.0001 && Math.abs(sX - 1) < 0.0001) return
        const newFontSize = (obj.fontSize ?? 48) * sY
        if (obj.styles && typeof obj.styles === "object") {
          for (const lineKey of Object.keys(obj.styles)) {
            const line = obj.styles[lineKey]
            for (const colKey of Object.keys(line)) {
              const cs = line[colKey]
              if (cs && typeof cs.fontSize === "number") {
                cs.fontSize = cs.fontSize * sY
              }
            }
          }
        }
        // Photoshop-style: entrelinhas (leadingPt) escala JUNTO com fontSize. Sem isso, ao
        // aumentar o texto pelo canto, o espacamento ficaria desproporcionalmente apertado
        // (e o painel direito mostraria leading antigo enquanto fonte aumenta).
        const curLeadingPt: number | undefined | null = (obj as any).leadingPt
        if (curLeadingPt !== undefined && curLeadingPt !== null) {
          ;(obj as any).leadingPt = curLeadingPt * sY
        }
        const newWidth = (obj.width ?? 100) * sX
        obj.set({ fontSize: newFontSize, width: newWidth, scaleX: 1, scaleY: 1 })
        // Recalcula lineHeight via helper central (compensa Fabric _fontSizeMult 1.13)
        if (curLeadingPt !== undefined && curLeadingPt !== null) {
          obj.set({ lineHeight: leadingPtToFabricLineHeight((obj as any).leadingPt, newFontSize) })
        }
        if ((obj as any).initDimensions) (obj as any).initDimensions()
        obj.setCoords()
        setSelectedTick(t => t + 1)
      })

      // SHAPE: scaling parametric DESABILITADO (tentativas anteriores
      // bbcf965/9313ed3 introduziram regressoes — slider stroke, bg saindo
      // do canvas). Comportamento atual: Fabric.Path escala normalmente,
      // cantos distorcem em scale nao-uniforme (igual PS Path). Slider de
      // raio em Properties continua editavel manual.
      //
      // Pra Live Shape real (cantos preservados em scale), proximo passo
      // seria Fabric subclass custom com _render override — backlog.

      // Ao SOLTAR o mouse apos arrastar lateral, consolida scaleX em width pra que o save
      // grave o estado limpo (scaleX=1, width final). Sem isso, scaleX!=1 ficaria salvo e
      // ao recarregar o textbox apareceria com scale ainda aplicado.
      fc.on("object:modified" as any, (e: any) => {
        if (!alive) return
        const obj = e?.target
        if (!obj) return
        const isText = obj.type === "textbox" || obj.type === "i-text"
        if (!isText) return
        const sX = obj.scaleX ?? 1
        const sY = obj.scaleY ?? 1
        // So consolida se scale ainda nao foi resetado (cantos ja consolidaram em scaling)
        if (Math.abs(sX - 1) < 0.0001 && Math.abs(sY - 1) < 0.0001) return
        // Lateral arrastada: consolida sX em width (mantem fontSize intocado, deixa wrap fluir)
        const newWidth = (obj.width ?? 100) * sX
        const newHeight = (obj.height ?? 100) * sY
        obj.set({ width: newWidth, height: newHeight, scaleX: 1, scaleY: 1 })
        if ((obj as any).initDimensions) (obj as any).initDimensions()
        obj.setCoords()
        fc.requestRenderAll()
      })
      // Tambem captura quando teclas (Shift+Arrow etc) mudam a selecao
      const onKeyUp = (_e: KeyboardEvent) => {
        if (!alive) return
        const active = fc.getActiveObject() as any
        if (active?.isEditing) setSelectedTick(t => t + 1)
      }
      window.addEventListener("keyup", onKeyUp)
      cleanupFns.push(() => window.removeEventListener("keyup", onKeyUp))
      fc.on("text:changed", (e: any) => {
        if (!alive) return
        // Coalesce Properties panel re-renders no proximo frame. Sem isso,
        // cada keystroke disparava re-render completo do painel direito (font,
        // size, color pickers, swatches) — em maquinas mais fracas, gerava
        // lag visivel na digitacao.
        if (selectedTickRaf.current == null) {
          selectedTickRaf.current = requestAnimationFrame(() => {
            selectedTickRaf.current = null
            setSelectedTick(t => t + 1)
          })
        }
        // AUTO-FIT: ajusta o width do textbox ao conteudo quando o texto muda.
        // DEBOUNCE 120ms: cada keystroke re-mede o texto inteiro via
        // initDimensions x2 + calcTextWidth, o que em textos grandes (>100
        // chars com styles per-char) e' MUITO caro. Debounce evita rodar em
        // cada tecla durante digitacao continua — auto-fit roda quando o user
        // para de digitar por 120ms (imperceptivel) e a digitacao em si volta
        // a ser instantanea. Sintoma corrigido: 'lag pra atualizar os textos'.
        const obj = e?.target
        if (!obj || obj.type !== "textbox") return
        clearTimeout(autoFitTimer.current)
        autoFitTimer.current = setTimeout(() => {
          if (!alive) return
          // Validacao: pode ter mudado o objeto / saido de edicao no entremeio
          if (obj.type !== "textbox") return
          try {
            const oldWidth = obj.width
            obj.set("width", 5000)
            if (obj.initDimensions) obj.initDimensions()
            const measured = obj.calcTextWidth ? obj.calcTextWidth() : oldWidth
            const newWidth = Math.max(20, Math.ceil(measured) + 8)
            obj.set("width", newWidth)
            if (obj.initDimensions) obj.initDimensions()
            obj.setCoords()
            fc.requestRenderAll()
          } catch (err) { console.warn("auto-fit textbox fail:", err) }
        }, 120)
      })
      fc.on("object:added", () => { if (alive) refreshLayers(fc) })
      fc.on("object:removed", () => { if (alive) refreshLayers(fc) })
      // Captura mudancas para historico de undo/redo.
      // IGNORA bleed overlays e BG: sao objetos internos da UI (cobrem area
      // fora da peca / pintam o fundo), nao representam acoes do usuario que
      // deveriam ir pro undo stack. applyZoom remove e re-cria overlays a
      // cada zoom — antes do filtro, isso poluía o stack com snapshots
      // duplicados e tambem rodava o orphan-detect com lixo transitorio.
      const isInternalOverlay = (target: any) => target?.__isBleedOverlay || target?.__isBg
      // Guard adicional !isInitialized.current — sem isso, cada addAssetToCanvas
      // durante o load inicial dispara object:added → pushHistory(), populando
      // undoStack com 20+ snapshots intermediarios capturados ANTES das fontes
      // terminarem de carregar e os textos reflowarem. Undo do user volta pra
      // esses estados ruins (textos com layout pre-font-load, sem override
      // visivel). Apos isInitialized=true, listeners voltam ao normal pra
      // capturar acoes reais do user (modify, add, remove via drag-drop/paste).
      fc.on("object:modified", (e: any) => {
        if (!isInitialized.current) return
        if (!isInternalOverlay(e?.target)) pushHistory()
      })
      fc.on("object:added", (e: any) => {
        if (isApplyingHistory.current) return
        if (!isInitialized.current) return
        if (isInternalOverlay(e?.target)) return
        pushHistory()
      })
      fc.on("object:removed", (e: any) => {
        if (isApplyingHistory.current) return
        if (!isInitialized.current) return
        if (isInternalOverlay(e?.target)) return
        pushHistory()
      })
      // text:changed nao chama pushHistory - text:editing:exited cobre o flush final

      // Re-eleva os overlays do bleed ao topo do z-stack sempre que objetos
      // novos sao adicionados (addAssetToCanvas, paste, etc). Sem isso, novos
      // objetos ficariam ACIMA dos overlays e voltariam a vazar pra area do
      // bleed visualmente.
      fc.on("object:added", (e: any) => {
        if (!alive) return
        const added = e?.target
        // Nao re-eleva se o objeto adicionado e um dos proprios overlays
        if (added && (added as any).__isBleedOverlay) return
        const overlays = (fc as any).__bleedOverlays as any[] | undefined
        if (!overlays) return
        for (const o of overlays) {
          try { (fc as any).bringObjectToFront ? (fc as any).bringObjectToFront(o) : (fc as any).bringToFront(o) } catch {}
        }
      })

      // Captura texto+styles ao ENTRAR em modo edicao (T0 para diff posterior)
      fc.on("text:editing:entered", (e: any) => {
        if (!alive || !e?.target) return
        ;(e.target as any).__editStartText = e.target.text ?? ""
        ;(e.target as any).__editStartStyles = JSON.parse(JSON.stringify(e.target.styles ?? {}))
      })

      fc.on("text:editing:exited", async (e: any) => {
        if (!alive) return
        const obj = e.target
        if (!obj) return

        // Sempre limpar refs de edicao
        const startText = (obj as any).__editStartText
        const startStyles = (obj as any).__editStartStyles
        delete (obj as any).__editStartText
        delete (obj as any).__editStartStyles

        // Modelo final:
        //  - PECA: edicao grava overrides locais (texto + styles per-char) no layer,
        //    nunca propaga pro asset.
        //  - MATRIZ: propaga texto cru pro asset.content (fonte da verdade) E grava
        //    estilo no asset.lastOverride (template visual aplicado em novas pecas).
        updateAssetLastOverride(obj)
        updateAssetContent(obj)
        // CRITICO: marca dirty pra o ConfirmExit aparecer caso o user clique
        // 'Voltar' antes do debounce do doSave (800ms) disparar. Sem isso o
        // user perdia a edicao silenciosamente ao sair logo apos editar texto.
        isDirtyRef.current = true
        setIsDirty(true)
        // History push explicito do estado final pos-edit. Fabric NAO dispara
        // object:modified ao sair de text editing (so dispara em set() externo),
        // entao sem esse push o undo pulava a edicao inteira. Compara contra
        // start: se nada mudou (entrou e saiu sem digitar), pula o push pra
        // nao poluir a pilha.
        try {
          const curText = (obj as any).text ?? ""
          const curStyles = (obj as any).styles ?? {}
          const textChanged = typeof startText === "string" && startText !== curText
          const stylesChanged = startStyles && JSON.stringify(startStyles) !== JSON.stringify(curStyles)
          if ((textChanged || stylesChanged) && !isApplyingHistory.current && isInitialized.current) {
            pushHistory()
          }
        } catch {}
        if (!isApplyingHistory.current) doSave()
      })

      // Zoom Photoshop-style: Ctrl+Scroll
      const wrapper = wrapperRef.current
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return
        if (!alive || !fabricRef.current) return
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.05 : 0.05
        const newZ = Math.min(3, Math.max(0.05, zoomRef.current + delta))
        applyZoom(fabricRef.current, newZ)
      }
      if (wrapper) wrapper.addEventListener("wheel", onWheel, { passive: false })
      cleanupFns.push(() => { if (wrapper) wrapper.removeEventListener("wheel", onWheel) })

      // Resize da janela: recalcula tamanho do canvas DOM e recentraliza a peca.
      // Sem isso, se o user redimensiona a janela, a peca fica desencaixada do
      // centro e a area visivel nao cresce/diminui. Debounce de 150ms pra evitar
      // disparos durante drag de resize.
      let resizeTimer: any = null
      const onResize = () => {
        if (resizeTimer) clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          if (!alive || !fabricRef.current) return
          // Usa ref pra pegar o valor MAIS RECENTE — o useEffect [campaign] que
          // captura essa closure nao re-roda quando layersPanelWidth muda.
          // Canvas DOM = area visivel total (ver init pra contexto). Margem
          // pros handles eh reservada no zoom calc, nao no tamanho do canvas.
          const newAvailW = window.innerWidth - layersPanelWidthRef.current - propsPanelWidthRef.current
          const newAvailH = window.innerHeight - TH - BH
          const fcRef = fabricRef.current
          ;(fabricRef as any).__canvasFullW = Math.max(1, newAvailW)
          ;(fabricRef as any).__canvasFullH = Math.max(1, newAvailH)
          fcRef.setDimensions({ width: Math.round(newAvailW), height: Math.round(newAvailH) })
          // applyZoom recalcula offset + overlays
          applyZoom(fcRef, zoomRef.current)
        }, 150)
      }
      window.addEventListener("resize", onResize)
      cleanupFns.push(() => {
        window.removeEventListener("resize", onResize)
        if (resizeTimer) clearTimeout(resizeTimer)
      })

      // Delete key remove selected + atalhos de viewport (estilo Figma)
      const onKey = (e: KeyboardEvent) => {
        if (!alive || !fabricRef.current) return
        // Guard global: nao interfere quando user esta digitando num input/textarea
        const t = e.target as HTMLElement | null
        const inField = !!t && (() => {
          const tag = (t.tagName || "").toUpperCase()
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
          if (t.isContentEditable) return true
          return false
        })()
        // Atalhos de viewport (estilo Figma):
        //   Shift+1 = Zoom to fit (centraliza peca)
        //   Shift+2 = Zoom to selection (foca objeto ativo)
        //   Shift+0 = Zoom 100%
        // So dispara se nao estiver em campo de texto E nao ha modifier conflitante.
        if (!inField && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
          if (e.key === "1" || e.code === "Digit1") {
            e.preventDefault()
            centerView()
            return
          }
          if (e.key === "2" || e.code === "Digit2") {
            e.preventDefault()
            zoomToSelection()
            return
          }
          if (e.key === "0" || e.code === "Digit0") {
            e.preventDefault()
            const fc = fabricRef.current
            applyZoom(fc, 1)
            return
          }
        }
        // Delete/Backspace remove objeto selecionado
        if (e.key !== "Delete" && e.key !== "Backspace") return
        if (inField) return
        const obj = fabricRef.current.getActiveObject()
        if (obj && !(obj as any).__isBg && !(obj as any).isEditing) {
          fabricRef.current.remove(obj)
          fabricRef.current.renderAll()
          doSave()
        }
      }
      window.addEventListener("keydown", onKey)
      cleanupFns.push(() => window.removeEventListener("keydown", onKey))

      // Matriz: edicao livre (chars vao pro asset via updateAssetContent, \n
      // fica em layer.overrides.text local).
      // Peca: bloqueia digitacao mas permite Enter (quebra de linha local) +
      // navegacao/selecao. Chars na peca vem do asset — pra alterar caracteres
      // o user edita na matriz (que propaga via asset.content pra todas as pecas).
      {
        const blockKey = (e: KeyboardEvent) => {
          const fcc = fabricRef.current
          if (!fcc) return
          // Matriz: edicao livre, nao bloqueia nada.
          if (!pieceId) return
          // Primeiro checa se algum textbox esta em edicao — se sim, bloqueia
          // mesmo que o evento venha do hiddenTextarea do Fabric (que e onde
          // o Fabric captura digitacao pra escrever no canvas).
          const active = fcc.getActiveObject() as any
          const isFabricEditing = active?.isEditing
          // Se NAO esta editando texto no canvas, deixa passar pros inputs do painel.
          if (!isFabricEditing) {
            const t = e.target as HTMLElement | null
            if (t) {
              const tag = (t.tagName || "").toUpperCase()
              if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
              if (t.isContentEditable) return
            }
            return
          }
          // Peca em edicao: bloquear digitacao mas permitir teclas de
          // navegacao/selecao + Enter (quebra de linha local).
          const allowed = new Set([
            "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
            "Home", "End", "PageUp", "PageDown", "Tab", "Escape",
            "Shift", "Control", "Alt", "Meta",
            "Enter",
          ])
          if (allowed.has(e.key)) return
          // Permitir Cmd/Ctrl+A, Cmd/Ctrl+C (selecionar/copiar)
          if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "c")) return
          // Backspace/Delete: SEMPRE permitido. User precisa poder
          // remover \n que adicionou + apagar espaços antes/depois pra
          // reorganizar o texto local da peça. Caracteres do asset não
          // são "perdidos" — eles continuam no asset.content; o que muda
          // é a versão LOCAL persistida em overrides.text.
          if (e.key === "Backspace" || e.key === "Delete") return
          // Bloquear o resto (digitação de chars novos, paste, etc).
          // Adicionar chars novos quebraria a regra "chars vêm do asset" —
          // user adiciona/edita chars em /campaigns/[id]/assets.
          e.preventDefault()
          e.stopPropagation()
        }
        const onPaste = (e: ClipboardEvent) => {
          const fcc = fabricRef.current
          if (!fcc) return
          // Matriz: paste livre. Peca: bloqueia paste em edicao de texto.
          if (!pieceId) return
          const active = fcc.getActiveObject() as any
          if (active?.isEditing) { e.preventDefault(); e.stopPropagation() }
        }
        document.addEventListener("keydown", blockKey, true)
        document.addEventListener("paste", onPaste, true)
        ;(fc as any).__blockKeyHandler = blockKey
        ;(fc as any).__blockPasteHandler = onPaste
      }

      // Restaurar layers (bloquear push history para nao poluir undo stack durante init)
      isApplyingHistory.current = true
      const c = campaignRef.current!
      if (pieceId && pieceRef.current) {
        // MODO PEÇA v2: layers + assets (sync automatico com asset)
        const p = pieceRef.current
        const pdata = typeof p.data === "string" ? JSON.parse(p.data) : p.data
        const assetMap = Object.fromEntries(c.assets.map((a: Asset) => [a.id, a]))

        // STEPS: se a URL pediu um step especifico (?stepIndex=N) que NAO eh o
        // savedActive, precisamos carregar os layers DESSE step (que estao em
        // pdata.steps[N].layers, NAO em pdata.layers que sempre eh o savedActive).
        const savedAllSteps: any[] = Array.isArray(pdata?.steps) ? pdata.steps : []
        const savedActiveIdx = typeof pdata?.activeStepIndex === "number" ? pdata.activeStepIndex : 0
        const loadIdx = (typeof initialStepIndex === "number"
          && initialStepIndex >= 0
          && initialStepIndex < savedAllSteps.length
          && savedAllSteps.length >= 2)
          ? initialStepIndex
          : null
        const layersToLoad = (loadIdx !== null && loadIdx !== savedActiveIdx)
          ? (savedAllSteps[loadIdx]?.layers ?? [])
          : (pdata?.layers ?? [])
        const bgToLoad = (loadIdx !== null && loadIdx !== savedActiveIdx)
          ? (savedAllSteps[loadIdx]?.bgColor ?? pdata?.bgColor ?? "#ffffff")
          : (pdata?.bgColor ?? "#ffffff")
        const bgOpToLoad = (loadIdx !== null && loadIdx !== savedActiveIdx)
          ? (typeof savedAllSteps[loadIdx]?.bgOpacity === "number" ? savedAllSteps[loadIdx].bgOpacity : 1)
          : (typeof pdata?.bgOpacity === "number" ? pdata.bgOpacity : 1)
        const bgLayersToLoadRaw: any = (loadIdx !== null && loadIdx !== savedActiveIdx)
          ? savedAllSteps[loadIdx]?.bgLayers
          : pdata?.bgLayers
        const bgLayersToLoad: BgLayerData[] = Array.isArray(bgLayersToLoadRaw) && bgLayersToLoadRaw.length > 0
          ? bgLayersToLoadRaw.map(migrateBgLayerJson)
          : [{ kind: "solid", color: bgToLoad, opacity: bgOpToLoad }]
        // Atualiza bgLayersRef SEMPRE — canvas init le isso pra criar os Rects.
        // bgColorRef/bgOpacityRef sao espelhos do BG[0] pra back-compat (so faz
        // sentido pra kind=solid; gradient pega 1o stop; image pega branco).
        bgLayersRef.current = bgLayersToLoad
        bgColorRef.current = bgLayerLegacyColor(bgLayersToLoad[0])
        bgOpacityRef.current = bgLayersToLoad[0].opacity
        if (loadIdx !== null && loadIdx !== savedActiveIdx) {
          setBgColor(bgLayerLegacyColor(bgLayersToLoad[0]))
          setBgOpacity(bgLayersToLoad[0].opacity)
        }

        if (pdata?.version === 2 && Array.isArray(layersToLoad)) {
          // Renderiza cada layer da peca
          const sorted = [...layersToLoad].sort((a: any, b: any) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
          // DIAGNÓSTICO peça
          const matchedP = sorted.filter((l: any) => l.assetId && assetMap[l.assetId]).length
          const embeddedP = sorted.filter((l: any) => l.__embedded).length
          console.log("[LOAD-PIECE-DIAG] piece layers:", sorted.length, "assets na campanha:", c.assets.length, "matched:", matchedP, "embedded:", embeddedP, "unmatched:", sorted.length - matchedP - embeddedP)
          for (const layer of sorted) {
            // Layer LINKADO a um asset (peca gerada ou linkada do PSD)
            const asset = assetMap[layer.assetId] as Asset
            if (asset) {
              // DEBUG: loga o estado da mask de cada layer da peca antes de
              // criar o objeto Fabric. Permite inspecionar coords/tipo/schema
              // diretamente do console — util pra diagnosticar mask deslocada.
              if (layer.mask) {
                console.log("[piece-load-mask]", asset.label, {
                  type: layer.mask.type,
                  enabled: layer.mask.enabled,
                  schemaV: (layer.mask as any)._schemaV ?? "v1",
                  layer_pos: { x: layer.posX, y: layer.posY },
                  layer_scale: { x: layer.scaleX, y: layer.scaleY },
                  layer_size: { w: layer.width, h: layer.height },
                  mask_raster: layer.mask.raster,
                  mask_vector_summary: layer.mask.vector ? { posX: layer.mask.vector.posX, posY: layer.mask.vector.posY, w: layer.mask.vector.width, h: layer.mask.vector.height, pathLen: (layer.mask.vector.path || "").length } : null,
                })
              }
              // Aplica overrides ao layer base
              const layerWithOverrides = {
                ...layer,
                ...(layer.overrides ?? {}),
              }
              await addAssetToCanvas(fc, asset, layerWithOverrides)
              // Aplicar overrides especificos de TEXTO depois do textbox criado
              const objs = fc.getObjects()
              const created = objs[objs.length - 1] as any
              if (created && (created.type === "textbox" || created.type === "i-text") && layer.overrides) {
                if (layer.overrides.fill !== undefined) created.set("fill", layer.overrides.fill)
                if (layer.overrides.fontSize !== undefined) created.set("fontSize", layer.overrides.fontSize)
                if (layer.overrides.fontFamily !== undefined) created.set("fontFamily", layer.overrides.fontFamily)
                if (layer.overrides.fontWeight !== undefined) created.set("fontWeight", layer.overrides.fontWeight)
                if (layer.overrides.fontStyle !== undefined) created.set("fontStyle", layer.overrides.fontStyle)
                if (layer.overrides.charSpacing !== undefined) created.set("charSpacing", layer.overrides.charSpacing)
                if (layer.overrides.lineHeight !== undefined) created.set("lineHeight", layer.overrides.lineHeight)
                if (layer.overrides.textAlign !== undefined) created.set("textAlign", layer.overrides.textAlign)
                // Adobe-style leading: leadingPt e a fonte da verdade. lineHeight e derivado
                // (recomputado aqui pra garantir consistencia com o fontSize atual).
                if (layer.overrides.leadingPt !== undefined && layer.overrides.leadingPt !== null) {
                  ;(created as any).leadingPt = layer.overrides.leadingPt
                  syncLineHeightFromLeading(created)
                }
                if (layer.overrides.styles !== undefined) {
                  const migrated = migrateFlatStylesToLineIndexed(
                    (created as any).text ?? layer.text ?? "",
                    layer.overrides.styles
                  )
                  created.set("styles", migrated)
                  if (created.initDimensions) created.initDimensions()
                }
                ;(created as any).__pieceLayerIdx = sorted.indexOf(layer)
                // Em modo peca, deixa editavel pra permitir seleção de caracteres,
                // mas o key handler abaixo bloqueia digitacao real
              } else if (created) {
                ;(created as any).__pieceLayerIdx = sorted.indexOf(layer)
              }
              // Aplica mascara se o layer tiver. Acontece DEPOIS do objeto estar
              // criado e com overrides aplicados pra que a mascara use bounds
              // corretos. Async porque mascara raster precisa carregar Image.
              if (created && layer.mask) {
                const { Image: FabImage, Path } = await import("fabric")
                try {
                  await applyMaskToFabricObject({ Image: FabImage, Path }, created, layer.mask)
                  ;(created as any).dirty = true
                  // Forca renderAll APOS mascara aplicada. Sem isso, clipPath
                  // pode ficar 'mudo' ate proxima interacao (Fabric cache de
                  // render do objeto nao invalida automaticamente quando se
                  // seta clipPath programaticamente).
                  fc.requestRenderAll?.()
                } catch (e) {
                  srvLog("mask-APPLY-FAIL", { type: layer.mask?.type, label: (created as any)?.__assetLabel, err: String((e as any)?.message ?? e) })
                }
              }
              if (created) applyHiddenLockedToObject(created, layer)
              continue
            }
            // Layer EMBEDDED (peca importada PSD avulsa). Conteudo cru no proprio
            // layer.data. Cria objeto Fabric direto sem asset.
            if (layer.__embedded) {
              await addEmbeddedLayer(fc, layer)
              const objs = fc.getObjects()
              const created = objs[objs.length - 1] as any
              if (created && layer.mask) {
                const { Image: FabImage, Path } = await import("fabric")
                try {
                  await applyMaskToFabricObject({ Image: FabImage, Path }, created, layer.mask)
                  ;(created as any).dirty = true
                  // Forca renderAll APOS mascara aplicada. Sem isso, clipPath
                  // pode ficar 'mudo' ate proxima interacao (Fabric cache de
                  // render do objeto nao invalida automaticamente quando se
                  // seta clipPath programaticamente).
                  fc.requestRenderAll?.()
                } catch (e) {
                  srvLog("mask-APPLY-FAIL", { type: layer.mask?.type, label: (created as any)?.__assetLabel, err: String((e as any)?.message ?? e) })
                }
              }
              if (created) applyHiddenLockedToObject(created, layer)
              continue
            }
            // Layer orfao (nem asset valido nem embedded): pula com warning
            editorLog("[LOAD-PIECE] layer ignorado (sem asset valido nem __embedded):", layer)
          }
          fc.renderAll()
        } else if (pdata?.canvasData) {
          // LEGACY (v1): peca antiga com canvasData direto - mantem compatibilidade
          const sourceW = pdata?.sourceWidth ?? canvasWRef.current
          const sourceH = pdata?.sourceHeight ?? canvasHRef.current
          const targetW = canvasWRef.current
          const targetH = canvasHRef.current
          // Fabric v6 quirk: 2o arg eh REVIVER (per-obj), nao completion cb.
          // Aguarda apenas a Promise pra garantir todos os objetos carregados.
          await fc.loadFromJSON(pdata.canvasData)
          await new Promise(r => setTimeout(r, 250))
          const scale = Math.min(targetW / sourceW, targetH / sourceH)
          const offsetX = (targetW - sourceW * scale) / 2
          const offsetY = (targetH - sourceH * scale) / 2
          for (const obj of fc.getObjects()) {
            if ((obj as any).__isBg) {
              obj.set({ left: 0, top: 0, width: targetW, height: targetH, scaleX: 1, scaleY: 1 })
              continue
            }
            obj.set({
              left: (obj.left ?? 0) * scale + offsetX,
              top: (obj.top ?? 0) * scale + offsetY,
              scaleX: (obj.scaleX ?? 1) * scale,
              scaleY: (obj.scaleY ?? 1) * scale,
            })
            obj.setCoords()
          }
          const bgObj = fc.getObjects().find((o: any) => o.__isBg)
          if (bgObj) fc.sendObjectToBack(bgObj)
        }
      } else {
        // MODO MATRIZ
        const savedLayers = c.keyVision?.layers
        if (savedLayers && Array.isArray(savedLayers) && savedLayers.length > 0) {
          const assetMap = Object.fromEntries(c.assets.map((a: Asset) => [a.id, a]))
          const sorted = [...savedLayers].sort((a: any, b: any) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
          let skippedCount = 0
          // DIAGNÓSTICO: quantos layers no KV vs quantos assets na campanha vs match
          const matched = sorted.filter((l: any) => l.assetId && assetMap[l.assetId]).length
          console.log("[LOAD-MATRIX-DIAG] KV layers:", sorted.length, "assets na campanha:", c.assets.length, "matched:", matched, "unmatched:", sorted.length - matched)
          for (const layer of sorted) {
            const asset = assetMap[layer.assetId] as Asset
            if (!asset) {
              skippedCount++
              if (!layer.assetId) {
                editorLog("[LOAD-MATRIX] layer com assetId vazio (campanha pode ter dados corrompidos antigos):", layer)
              } else {
                editorLog("[LOAD-MATRIX] layer aponta pra asset inexistente:", layer.assetId)
              }
              continue
            }
            await addAssetToCanvas(fc, asset, layer)
            // Aplicar overrides depois (igual modo peça)
            const objs = fc.getObjects()
            const created = objs[objs.length - 1] as any
            if (created && (created.type === "textbox" || created.type === "i-text") && (layer as any).overrides) {
              const ov = (layer as any).overrides
              if (ov.fill !== undefined) created.set("fill", ov.fill)
              if (ov.fontSize !== undefined) created.set("fontSize", ov.fontSize)
              if (ov.fontFamily !== undefined) created.set("fontFamily", ov.fontFamily)
              if (ov.fontWeight !== undefined) created.set("fontWeight", ov.fontWeight)
              if (ov.fontStyle !== undefined) created.set("fontStyle", ov.fontStyle)
              if (ov.charSpacing !== undefined) created.set("charSpacing", ov.charSpacing)
              if (ov.lineHeight !== undefined) created.set("lineHeight", ov.lineHeight)
              if (ov.textAlign !== undefined) created.set("textAlign", ov.textAlign)
              // Adobe-style leading (ver comentario no outro load)
              if (ov.leadingPt !== undefined && ov.leadingPt !== null) {
                ;(created as any).leadingPt = ov.leadingPt
                syncLineHeightFromLeading(created)
              }
              if (ov.styles !== undefined) {
                created.set("styles", ov.styles)
                if (created.initDimensions) created.initDimensions()
              }
            }
            // Aplica mascara em layer da matriz tambem (estava so na peca antes).
            if (created && (layer as any).mask) {
              const { Image: FabImage, Path } = await import("fabric")
              try {
                await applyMaskToFabricObject({ Image: FabImage, Path }, created, (layer as any).mask)
                ;(created as any).dirty = true
                fc.requestRenderAll?.()
                srvLog("load-MATRIX-mask-applied", { type: (layer as any).mask?.type, label: (created as any)?.__assetLabel, maskDataPresent: !!(created as any).__maskData })
              } catch (e) {
                srvLog("mask-APPLY-FAIL-MATRIX", { type: (layer as any).mask?.type, label: (created as any)?.__assetLabel, err: String((e as any)?.message ?? e) })
              }
            } else if (created && (layer as any).mask === undefined) {
              // Sem nada a fazer — asset legitimamente sem mask.
            }
            if (created) applyHiddenLockedToObject(created, layer)
          }
        }
      }

      fc.renderAll()
      if (alive) refreshLayers(fc)
      // SAUDE: remove objetos orfaos (sem __assetId nem __embedded) que possam
      // ter vindo do banco ou de bugs antigos. Layers validos:
      //  - __assetId: linkado a um CampaignAsset (peca gerada ou linkada do PSD)
      //  - __embedded: conteudo cru gravado no piece.data (peca importada PSD avulsa)
      // Limpar aqui evita que entrem no undoStack e causem desync no undo/redo.
      const orphans = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay && !o.__assetId && !o.__embedded && !o.__isStrokeGhost)
      if (orphans.length > 0) {
        editorLog("[INIT-CLEAN]", pieceId ? "peca" : "matriz", "tinha", orphans.length, "objetos orfaos no canvas. Removendo.")
        for (const orphan of orphans) fc.remove(orphan)
        fc.renderAll()
        if (alive) refreshLayers(fc)
      }
      // Snapshot inicial (estado limpo, sem dirty)
      try {
        const snap = JSON.stringify((fc as any).toObject(["__assetId", "__assetLabel", "__isBg", "__isImage", "__maskData", "__clippingMask", "__embedded", "imageDataUrl", "__hidden", "__locked", "__fillBrandIdx", "__psdEffects", "__psdNameSource", "__groupPath", "__isSmartObject", "__smartObjectGuid", "__smartObjectMime", "__smartObjectFilePath", "__smartObjectOriginalName", "styles", "leadingPt", "lineHeight", "charSpacing"]))
        undoStack.current = [snap]
        redoStack.current = []
      } catch (e) {}
      isApplyingHistory.current = false
      // Marca init concluido — saves sao liberados a partir daqui. Antes disso, salvar
      // poderia gravar layers: [] (canvas ainda nao tinha objetos carregados).
      isInitialized.current = true

      // Re-aplica clipping masks salvas (mask.type === "clipping") agora que
      // todos os objetos estao no canvas. applyMaskToFabric so anota
      // __clippingMask=true; o clipPath real depende do layer abaixo, entao
      // precisa rodar APOS todos os objects loaded (z-order completo).
      try {
        const objs = fc.getObjects().filter((o: any) =>
          (o as any).__maskData?.type === "clipping" && (o as any).__maskData?.enabled !== false
        )
        for (const o of objs) {
          await applyClippingMaskNative(fc, o)
        }
        if (objs.length > 0) fc.requestRenderAll()
      } catch (e) { console.warn("[init] re-apply clipping masks falhou:", e) }
      // RE-MEASURE textboxes se uma fonte chegou DEPOIS do init: o load pre-
      // request todas as fontes, mas se alguma demorou pra chegar no momento
      // de criar o Textbox, ele foi medido com fallback (Arial) — letras
      // ficam visualmente mais largas/compactas que o real. Quando a fonte
      // chegar via fonts.ready, re-mede tudo. Sem isso, tracking PSD
      // negativo aparece visualmente errado.
      if (typeof document !== "undefined" && (document as any).fonts?.ready) {
        ;(document as any).fonts.ready.then(() => {
          if (!alive || !isInitialized.current) return
          const objs = fc.getObjects()
          let touched = 0
          for (const o of objs) {
            if (o.type === "textbox" || o.type === "i-text") {
              if ((o as any).initDimensions) (o as any).initDimensions()
              touched++
            }
          }
          if (touched > 0) {
            fc.requestRenderAll()
            console.log("[fonts-ready] re-mediu", touched, "textboxes pos-load")
          }
        }).catch(() => {})
      }
      // Auto-gera thumbnails pra steps inativos sem preview (background).
      // Renderiza offscreen — nao mexe no canvas principal. User nao vê piscar.
      // RESET do flag pra rodar de novo nesta peca (cada init = nova oportunidade).
      autoGenDoneRef.current = false
      console.log("[init] terminou. pieceId:", pieceId, "vai chamar autoGen:", !!pieceId)
      try {
        const objs = fc.getObjects()
        const sample = objs.slice(0, 5).map((o: any) => ({
          t: o.type, vis: o.visible, op: o.opacity, hid: o.__hidden,
          l: Math.round(o.left ?? 0), tp: Math.round(o.top ?? 0),
          w: Math.round(o.width ?? 0), h: Math.round(o.height ?? 0),
          sx: o.scaleX, sy: o.scaleY,
          clip: !!o.clipPath, mask: !!o.__maskData,
        }))
        const vt = fc.viewportTransform
        console.log("[init-health] objects:", objs.length, "canvas:", fc.getWidth(), "x", fc.getHeight(), "zoom:", fc.getZoom(), "vt:", vt, "first5:", sample)
        ;(window as any).__fc = fc
      } catch (e) { console.warn("[init-health] erro:", e) }
      if (pieceId) {
        autoGenerateMissingStepThumbs().catch(e => console.warn("[auto-thumbs] erro:", e))
      }
      // AUTO-REGEN ON OPEN: regera + sobe o thumb principal sempre que o user
      // abre o editor (mesmo sem editar). Garante que apresentacao/cards refletem
      // o estado atual — caso util quando o asset.content mudou em outra aba/
      // chamada API e o thumb antigo ficou stale. Roda em background (1.2s pra
      // dar tempo de fontes Google + imagens carregarem assincronamente).
      setTimeout(() => {
        const fcc = fabricRef.current
        if (!alive || !fcc || !isInitialized.current) return
        if (pieceId) {
          uploadPieceThumb(fcc, pieceId).catch(e => console.warn("[auto-regen piece]", e))
        } else {
          uploadMatrixThumb(fcc).catch(e => console.warn("[auto-regen matrix]", e))
        }
      }, 1200)
    }

    init()
    return () => {
      alive = false
      // Bloqueia saves apos cleanup. Sem isso, um saveTimer pendente (debounce 800ms)
      // dispararia depois do dispose, e poderia salvar sobre um canvas em meio de re-init
      // (causando layers: [] no banco — bug "KV volta vazio ao alternar com /assets").
      isInitialized.current = false
      // Cancela qualquer save pendente pra nao gravar lixo apos o user sair
      clearTimeout(saveTimer.current)
      clearTimeout(autoFitTimer.current)
      // Flush dos PUTs debounceados pendentes antes do unmount — sem isso,
      // user editar e sair rapido podia perder a ultima mudanca (timer
      // cancelado, PUT nunca foi enviado).
      try {
        const p1 = lastOverridePendingPayload.current
        if (p1) {
          lastOverridePendingPayload.current = null
          fetch(`/api/campaigns/${campaignId}/assets/${p1.aid}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p1.payload), keepalive: true,
          }).catch(() => {})
        }
        const p2 = assetContentPendingPayload.current
        if (p2) {
          assetContentPendingPayload.current = null
          fetch(`/api/campaigns/${campaignId}/assets/${p2.aid}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p2.payload), keepalive: true,
          }).catch(() => {})
        }
      } catch {}
      clearTimeout(lastOverridePutTimer.current)
      clearTimeout(assetContentPutTimer.current)
      if (selectedTickRaf.current != null) { cancelAnimationFrame(selectedTickRaf.current); selectedTickRaf.current = null }
      // Revoga todos os blob URLs criados pelo SVG patcher. Em sessoes longas
      // ou com varios PSDs importados, a acumulacao chega a centenas de MB
      // (cada SVG vira um blob URL retido na memoria).
      try {
        for (const u of svgBlobUrlsRef.current) {
          try { URL.revokeObjectURL(u) } catch {}
        }
        svgBlobUrlsRef.current = []
      } catch {}
      const fcc: any = fabricRef.current
      if (fcc) {
        if (fcc.__blockKeyHandler) document.removeEventListener("keydown", fcc.__blockKeyHandler, true)
        if (fcc.__blockPasteHandler) document.removeEventListener("paste", fcc.__blockPasteHandler, true)
      }
      cleanupFns.forEach(fn => { try { fn() } catch {} })
      // Dispose o canvas e libera fabricRef para que a próxima execução do useEffect
      // (em strict mode, hot reload, ou navegação de peça pra peça) possa re-inicializar
      // num <canvas> DOM novo. Sem isso, fabricRef segura referencia stale.
      if (fabricRef.current) {
        try { fabricRef.current.dispose() } catch {}
        fabricRef.current = null
      }
      isInitInProgress.current = false
    }
  }, [campaign])

  function spansToFabricProps(spans: TextSpan[]) {
    const first = spans[0]?.style ?? {}
    const fullText = spans.map(s => s.text).join("")
    return {
      text: fullText,
      fontSize: (first.fontSize as number) ?? 80,
      fontFamily: first.fontFamily ?? "Arial",
      fontWeight: first.fontWeight ?? "normal",
      fill: first.color ?? "#111111",
    }
  }

  function pushHistory() {
    if (isApplyingHistory.current) return
    const fc = fabricRef.current
    if (!fc) return
    try {
      // ORPHAN HANDLING: antes este pushHistory pulava completamente se detectava
      // orfaos (objetos sem __assetId/__embedded). Resultado: edicoes do usuario
      // logo apos um undo ficavam ORA fora do stack, ORA dentro — undo seguinte
      // pulava estados intermediarios e o usuario sentia "perdeu a cor".
      // Estrategia nova: ainda detecta orfaos, mas em vez de pular o push,
      // continua salvando. O snapshot pode incluir orfaos visualmente, mas:
      //  1. saveNow filtra orfaos antes de gravar no banco (existing logica).
      //  2. Undo→applySnapshot tem health-cleanup de orphans-pos-restore.
      // Assim o undo stack mantem continuidade temporal — cada acao do user
      // entra na pilha mesmo que o canvas tenha um orfao transitorio.
      const orphans = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay && !o.__assetId && !o.__embedded && !o.__isStrokeGhost)
      if (orphans.length > 0) {
        console.warn("[pushHistory] aviso —", orphans.length, "objetos orfaos detectados. Snapshot ainda eh salvo (continuidade temporal preservada).")
      }
      const snap = JSON.stringify((fc as any).toObject(["__assetId", "__assetLabel", "__isBg", "__isImage", "__maskData", "__clippingMask", "__embedded", "imageDataUrl", "__hidden", "__locked", "__fillBrandIdx", "__psdEffects", "__psdNameSource", "__groupPath", "__isSmartObject", "__smartObjectGuid", "__smartObjectMime", "__smartObjectFilePath", "__smartObjectOriginalName", "styles", "leadingPt", "lineHeight", "charSpacing"]))
      // Evita push duplicado quando snap eh igual ao topo
      const top = undoStack.current[undoStack.current.length - 1]
      if (top === snap) return
      // DIAGNOSTICO: detecta MULTI-OBJ DIFF entre top atual e novo snap.
      // Esperado: 1 obj mudou (a acao explicita do user). Se >1 mudou, algo
      // foi modificado silenciosamente sem pushHistory entre as 2 acoes do
      // user — sintoma reportado: "undo na posicao reseta override de
      // outro layer". Log alerta no console, sem bloquear o save.
      try {
        if (top) {
          const prevObjs: any[] = JSON.parse(top)?.objects ?? []
          const newObjs: any[] = JSON.parse(snap)?.objects ?? []
          const keyOf = (o: any) => o?.__assetId ?? o?.__assetLabel ?? `${o?.type}@${Math.round(o?.left ?? 0)},${Math.round(o?.top ?? 0)}`
          const prevByKey = new Map<string, any>()
          for (const o of prevObjs) prevByKey.set(keyOf(o), o)
          const changes: Array<{ label: string; diffs: string[] }> = []
          for (const o of newObjs) {
            const prev = prevByKey.get(keyOf(o))
            if (!prev) continue
            const diffs: string[] = []
            // Compara propriedades relevantes (props que o user esperaria controlar)
            for (const k of ["left", "top", "scaleX", "scaleY", "angle", "width", "height",
                             "fill", "fontSize", "fontFamily", "fontWeight", "fontStyle",
                             "charSpacing", "lineHeight", "textAlign", "text", "opacity",
                             "visible", "globalCompositeOperation"]) {
              if (JSON.stringify(prev[k]) !== JSON.stringify(o[k])) diffs.push(k)
            }
            // styles per-char
            if (JSON.stringify(prev.styles ?? {}) !== JSON.stringify(o.styles ?? {})) diffs.push("styles")
            if (diffs.length > 0) changes.push({ label: o.__assetLabel ?? "?", diffs })
          }
          if (changes.length > 1) {
            console.warn("[pushHistory] MULTI-OBJ DIFF detectado — provavel modificacao silenciosa entre acoes:", changes)
          }
        }
      } catch {}
      undoStack.current.push(snap)
      // Mantém 31 entradas: 30 undos + estado atual.
      if (undoStack.current.length > 31) undoStack.current.shift()
      redoStack.current = []
      setHistoryTick(t => t + 1)
      isDirtyRef.current = true
      setIsDirty(true)
    } catch (e) { /* ignora */ }
  }

  // Retorna true se aplicou com sucesso, false se abortou (circuit breaker).
  // Permite que undo()/redo() saibam reverter o pop quando o snap eh ruim.
  async function applySnapshot(snap: string): Promise<boolean> {
    const fc = fabricRef.current
    if (!fc) return false
    isApplyingHistory.current = true
    // Incrementa seq pra invalidar rebakes assincronos em voo (H1).
    const mySeq = ++applySnapshotSeq.current
    // Cancela qualquer save pendente IMEDIATAMENTE — antes do loadFromJSON disparar
    // eventos que poderiam re-agendar saves em estado transitorio.
    clearTimeout(saveTimer.current)
    try {
      // Parse o snapshot pra ter acesso aos dados originais (precisaremos pra restaurar
      // styles per-char e props customizadas que loadFromJSON pode perder)
      const snapData = JSON.parse(snap)
      const snapObjects: any[] = Array.isArray(snapData?.objects) ? snapData.objects : []

      // CRITICO 0 (bug fix "tudo preto"): injeta bgColor no snapData ANTES do load
      // pra evitar gap entre load e re-add do bg Rect. Sem isso, loadFromJSON
      // limpa canvas, deixa transparente, e mostra fundo escuro do editor por
      // alguns frames antes do bg ser re-adicionado.
      snapData.background = bgColorRef.current
      // Remove backgroundImage/overlayImage do snap se existirem
      delete snapData.backgroundImage
      delete snapData.overlayImage

      // CIRCUIT BREAKER: se o snap esta vazio mas o canvas atual tem objetos
      // validos, ABORTA o restore. Quase certamente o snap foi corrompido
      // (push num momento ruim) e aplica-lo apagaria todo o trabalho do user.
      // Sintoma reportado: "undo apaga tudo, vira bagunca". Melhor manter o
      // estado atual e remover o snap ruim do topo da pilha.
      const currentValidObjects = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay && (o.__assetId || o.__embedded))
      const snapValidObjects = (Array.isArray(snapData?.objects) ? snapData.objects : []).filter((s: any) => !s?.__isBg && !s?.__isBleedOverlay && (s?.__assetId || s?.__embedded))
      if (snapValidObjects.length === 0 && currentValidObjects.length > 0) {
        srvLog("undo-ABORT-empty-snap", { currentObjs: currentValidObjects.length })
        isApplyingHistory.current = false
        return false
      }

      // Fabric v6: 2o arg de loadFromJSON eh REVIVER (callback per-objeto), nao
      // callback de conclusao. Passar `() => resolve()` ali resolvia a Promise
      // no PRIMEIRO objeto desserializado, fazendo o resto do applySnapshot
      // rodar com `fc.getObjects()` ainda vazio (ou parcial). Resultado no log:
      // `[undo-RESTORE-COUNTS] restored:0, snap:4` — snapshot OK, canvas vazio.
      // Solucao: aguardar a Promise retornada (Fabric v6 sempre retorna Promise).
      await fc.loadFromJSON(snapData)

      // backgroundColor TRANSPARENT pra que a area de bleed (extra ao redor
      // da peca, pra handles ficarem clicaveis) mostre o fundo escuro do
      // editor por baixo, e nao a cor da peca. A cor real da peca e pintada
      // pelo Rect bgRef (do tamanho exato cw x ch) que adicionamos depois.
      ;(fc as any).backgroundColor = "transparent"
      ;(fc as any).backgroundImage = null
      ;(fc as any).overlayImage = null
      fc.renderAll() // render imediato com bg setado, antes de qualquer outro processamento

      // CRITICO 1: Fabric Textbox ignora `styles` no construtor. Apos loadFromJSON,
      // os textboxes restaurados perdem styles per-char. Reaplica manualmente do snapshot.
      // CRITICO 2: __assetId / __assetLabel / __embedded podem se perder na reconstrucao - garante.
      // CRITICO 3 (bug fix): filtramos BG dos restored, MAS snapObjects pode incluir o BG.
      // Isso desalinha os indices (restored[0] eh o 1o nao-BG, mas snapObjects[0] pode ser BG).
      // Solucao: filtra BG dos snapObjects tambem antes de iterar.
      const restored = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay)
      const snapObjectsNoBg = snapObjects.filter((s: any) => !s?.__isBg && !s?.__isBleedOverlay)
      // Sanidade: log detalhado pra debugar undo perdendo layers.
      srvLog("undo-RESTORE-COUNTS", {
        restored: restored.length,
        snap: snapObjectsNoBg.length,
        restoredTypes: restored.map((o: any) => `${o.type}:${o.__assetId ?? "noId"}`),
        snapTypes: snapObjectsNoBg.map((s: any) => `${s.type}:${s.__assetId ?? "noId"}`),
      })
      if (restored.length !== snapObjectsNoBg.length) {
        console.warn("[applySnapshot] mismatch: restored=", restored.length, "vs snap=", snapObjectsNoBg.length)
      }
      // ESTRATEGIA DE PAREAMENTO src↔restored — robusta contra:
      //  - reordenacao do loadFromJSON (raro mas possivel)
      //  - layers sobrepostos com type+position identicos (bug antigo: dois
      //    textos arrastados pra mesma coord colidiam no map por chave, undo
      //    pareava errado e __assetId/__maskData iam pro objeto errado —
      //    sintoma reportado pelo user: 'undo confunde layers, apaga tudo')
      // Niveis de match em ordem decrescente de confiabilidade:
      //  1. __assetId com FILA (queue por aid) — mesmo aid pode ter N copias,
      //     parea na ordem em que aparecem no snap vs no restored.
      //  2. __embedded com fila (PSD-avulso sem aid)
      //  3. Fallback POSITIONAL POR INDEX (mesma ordem do array de objects).
      // Sem mapeamento por chave colisiva.
      const buildQueues = (arr: any[]) => {
        const aidQ = new Map<string, any[]>()
        const embQ: any[] = []
        const rest: any[] = []
        for (const o of arr) {
          if (!o) continue
          if (o.__assetId) {
            const q = aidQ.get(o.__assetId) ?? []
            q.push(o)
            aidQ.set(o.__assetId, q)
          } else if (o.__embedded) {
            embQ.push(o)
          } else {
            rest.push(o)
          }
        }
        return { aidQ, embQ, rest }
      }
      const srcQ = buildQueues(snapObjectsNoBg)
      const restAidPos = new Map<string, number>() // contador per-aid pra fallback
      let embCursor = 0
      for (let i = 0; i < restored.length; i++) {
        const obj: any = restored[i]
        let src: any = null
        if (obj.__assetId) {
          const q = srcQ.aidQ.get(obj.__assetId)
          if (q && q.length > 0) {
            const idx = restAidPos.get(obj.__assetId) ?? 0
            src = q[idx]
            restAidPos.set(obj.__assetId, idx + 1)
          }
        } else if (obj.__embedded) {
          src = srcQ.embQ[embCursor++] ?? null
        }
        if (!src) {
          // Ultimo recurso: positional por index global no snap. Funciona quando
          // loadFromJSON preserva ordem (caso comum); falha graciosamente caso
          // contrario (props customizadas ficam ausentes pro objeto, save vai
          // bloquear no filtro __assetId).
          src = snapObjectsNoBg[i]
          if (!src) continue
          // Se src ja foi reclamado por __assetId acima, evita usa-lo de novo
          // (preferiu o match estavel). O proximo nao-aid pode acabar sem src,
          // o que e melhor que sobrescrever props erradas.
        }
        // CRITICO: Fabric loadFromJSON pode NÃO restaurar props customizadas
        // mesmo passando-as no toJSON. Restaurar EXPLICITAMENTE preservando
        // o valor original (mesmo se o obj atual já tem — sobrescreve com o
        // src pra garantir consistência com o snap).
        if (src.__assetId !== undefined) obj.__assetId = src.__assetId
        if (src.__assetLabel !== undefined) obj.__assetLabel = src.__assetLabel
        if (src.__isImage !== undefined) obj.__isImage = src.__isImage
        if (src.__hidden !== undefined) obj.__hidden = src.__hidden
        if (src.__locked !== undefined) obj.__locked = src.__locked
        // Layers embedded (PSD avulso importado): preserva flag + dataUrl da imagem
        if (src.__embedded) obj.__embedded = true
        if (src.imageDataUrl) obj.imageDataUrl = src.imageDataUrl
        // Brand ref do fill (texto vinculado a brand color do cliente)
        if (typeof src.__fillBrandIdx === "number") obj.__fillBrandIdx = src.__fillBrandIdx
        // PSD layer effects (dropShadow/stroke/outerGlow) — round-trip
        if (src.__psdEffects && typeof src.__psdEffects === "object") obj.__psdEffects = src.__psdEffects
        // PSD 'lnsr' (nameSource) — controla auto-rename de text layer no PS
        if (typeof src.__psdNameSource === "string") obj.__psdNameSource = src.__psdNameSource
        // groupPath: hierarquia de folders do PSD preservada
        if (Array.isArray(src.__groupPath) && src.__groupPath.length > 0) obj.__groupPath = src.__groupPath
        // Smart Object metadata preservada — re-export emite placedLayer nativo
        if (src.__isSmartObject === true) obj.__isSmartObject = true
        if (typeof src.__smartObjectGuid === "string") obj.__smartObjectGuid = src.__smartObjectGuid
        if (typeof src.__smartObjectMime === "string") obj.__smartObjectMime = src.__smartObjectMime
        if (typeof src.__smartObjectFilePath === "string") obj.__smartObjectFilePath = src.__smartObjectFilePath
        if (typeof src.__smartObjectOriginalName === "string") obj.__smartObjectOriginalName = src.__smartObjectOriginalName
        // Restaurar styles per-char em textboxes. SEMPRE restaura (mesmo se
        // src.styles for vazio) — antes pulava quando vazio, mas isso deixava
        // obj.styles com o conteudo anterior (do estado pos-loadFromJSON) em
        // vez de zerar. User reportou 2026-05-22: "undo desconfigura outro
        // layer de texto, perdendo overrides de cor".
        //
        // Fix robusto:
        //  - DEEP CLONE pra evitar reference sharing entre snap e canvas
        //  - obj.styles = direct assign (set("styles", ...) pode passar por
        //    paths internos de Fabric que normalizam/clobbam)
        //  - dirty + _styleMap=null pra invalidar cache do Textbox
        //  - initDimensions pra re-medir
        if (obj.type === "textbox" || obj.type === "i-text") {
          const srcStyles = src.styles ?? {}
          // Deep clone (Fabric muta styles internamente em algumas ops)
          const cloned = typeof structuredClone === "function"
            ? structuredClone(srcStyles)
            : JSON.parse(JSON.stringify(srcStyles))
          ;(obj as any).styles = cloned
          ;(obj as any).dirty = true
          if ((obj as any)._styleMap) (obj as any)._styleMap = null
          if (obj.initDimensions) obj.initDimensions()
          if (obj.setCoords) obj.setCoords()
        }
        // Restaurar mascara: clipPath reconstruido pelo loadFromJSON pode estar
        // quebrado (e.g. Image clipPath nao re-carrega o dataUrl). Re-aplicamos
        // do __maskData original — fonte da verdade do LayerMask.
        if (src.__maskData) {
          obj.__maskData = src.__maskData
          // Recria anchor de mask-tracking. Sem isso, mover layer pos-undo
          // faria a mask "saltar" (delta calculado em relacao a anchor zerado).
          obj.__maskAnchor = {
            left: obj.left ?? 0, top: obj.top ?? 0,
            scaleX: obj.scaleX ?? 1, scaleY: obj.scaleY ?? 1,
          }
          const { Image: FabImage, Path } = await import("fabric")
          obj.clipPath = null
          // PARA IMAGES COM RASTER MASK: re-baka a mask no bitmap. Fabric v7
          // nao tem alpha-mask via clipPath (Image clipPath vira silhueta
          // solida). No load inicial fazemos via composeRasterMaskIntoImage;
          // no undo o snap serializou src=URL original (sem bake), entao
          // o bake se perde. Aqui re-bakamos pra restaurar o visual identico.
          if (obj.type === "image" && src.__maskData.type === "raster" && src.__maskData.raster?.dataUrl && src.__maskData.enabled !== false) {
            try {
              // Pega o element atual (imagem ja carregada pelo loadFromJSON)
              const el = (obj as any)._element ?? (obj as any).getElement?.()
              if (el) {
                const naturalW = (el as any).naturalWidth || (el as any).width || 1
                const naturalH = (el as any).naturalHeight || (el as any).height || 1
                const posX = obj.left ?? 0
                const posY = obj.top ?? 0
                const composed = await composeRasterMaskIntoImage(
                  el, src.__maskData.raster, posX, posY, naturalW, naturalH,
                  !!src.__maskData.inverted,
                  obj.scaleX ?? 1, obj.scaleY ?? 1,
                )
                // Aborta se outro applySnapshot disparou enquanto isto estava
                // em voo — escrever _element agora sobrescreve rebake mais novo (H1).
                if (mySeq !== applySnapshotSeq.current) {
                  srvLog("undo-MASK-REBAKE-STALE", { label: (obj as any).__assetLabel })
                } else if (composed) {
                  if (typeof (obj as any).setElement === "function") {
                    ;(obj as any).setElement(composed)
                  } else {
                    ;(obj as any)._element = composed
                    ;(obj as any)._originalElement = composed
                  }
                  ;(obj as any).dirty = true
                  srvLog("undo-MASK-REBAKE-OK", { label: (obj as any).__assetLabel, w: composed.width, h: composed.height })
                }
              }
            } catch (e) {
              srvLog("undo-MASK-REBAKE-FAIL", { label: (obj as any).__assetLabel, err: String((e as any)?.message ?? e) })
            }
          } else {
            // Vector ou clipping mask: usa o caminho clipPath padrao (alpha
            // nao eh necessario, Fabric clipPath funciona bem com paths).
            await applyMaskToFabricObject({ Image: FabImage, Path }, obj, src.__maskData)
          }
        }
      }

      // DESABILITADO 2026-05-18: orphan cleanup pos-restore removia layers
      // validos depois do undo. Causa: indexacao por posicao entre
      // fc.getObjects() e snapObjectsNoBg podia divergir (ex: ordem que
      // loadFromJSON cria os objetos != ordem do snapshot), entao
      // __assetId/__embedded eram atribuidos pro objeto ERRADO; objetos com
      // __assetId virando "orfaos" pelo filtro, e a limpeza apagava-os do
      // canvas. Sintoma reportado pelo user: 'Cmd+Z faz o layer sumir'.
      // Mantemos o log de diagnostico mas NAO removemos. Objetos com problema
      // de restauracao ficam no canvas; se realmente forem fantasma serao
      // limpos no proximo save (ja tem filtro la). Continuidade do undo
      // stack tem prioridade sobre limpeza imediata.
      const orphansAfterRestore = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay && !o.__assetId && !o.__embedded && !o.__isStrokeGhost)
      if (orphansAfterRestore.length > 0) {
        srvLog("undo-RESTORE-ORPHANS", { count: orphansAfterRestore.length, types: orphansAfterRestore.map((o: any) => o.type) })
      }

      // CRITICO 3: BGs tem excludeFromExport=true, ficam fora do snapshot.
      // Re-cria todos os BG layers (idx 0 = fundo).
      const fabricMod: any = await import("fabric")
      const { Rect } = fabricMod
      const newBgRects: any[] = []
      for (let i = 0; i < bgLayersRef.current.length; i++) {
        const ld = bgLayersRef.current[i]
        const r = new Rect({
          left: 0, top: 0, width: canvasWRef.current, height: canvasHRef.current,
          selectable: true, evented: true,
          hasControls: false, hasBorders: true,
          lockMovementX: true, lockMovementY: true,
          lockScalingX: true, lockScalingY: true, lockRotation: true,
          excludeFromExport: true,
        })
        await syncBgLayerToRect(r, ld, canvasWRef.current, canvasHRef.current, fabricMod)
        ;(r as any).__isBg = true
        ;(r as any).__bgIdx = i
        ;(r as any).__assetLabel = i === 0 ? "Background" : `Background ${i + 1}`
        ;(r as any).__hidden = ld.hidden === true
        ;(r as any).__locked = ld.locked === true
        fc.add(r)
        newBgRects.push(r)
      }
      bgRectsRef.current = newBgRects
      bgRef.current = newBgRects[0]
      // sendObjectToBack manda pro fundo. Iterando do topo pro fundo, o ultimo
      // a ser enviado fica no fundo absoluto — assim idx 0 termina no fundo.
      for (let i = newBgRects.length - 1; i >= 0; i--) fc.sendObjectToBack(newBgRects[i])
      // Recria os bleed overlays — tambem ficam fora do snapshot (excludeFromExport)
      // e precisam ser re-adicionados no topo do z-stack apos restore.
      const fc2 = fc
      const fullW = (fabricRef as any).__canvasFullW ?? fc2.getWidth()
      const fullH = (fabricRef as any).__canvasFullH ?? fc2.getHeight()
      createBleedOverlays(fc, Rect, canvasWRef.current, canvasHRef.current, fullW, fullH, zoomRef.current || 1)
      // Reaplica clipPath ao canvas (loadFromJSON pode ter resetado).
      ;(fc as any).clipPath = new Rect({
        left: 0, top: 0, width: canvasWRef.current, height: canvasHRef.current,
        absolutePositioned: true,
      })
      fc.renderAll()
      refreshLayers(fc)
      // BRAND RESYNC POS-UNDO: snaps antigos podem ter fills/cores DESATUALIZADOS
      // se brand color do cliente mudou entre o momento do snap e agora. Sem
      // este sync, undo "desfazia" brand changes que NAO foram acao do user —
      // sintoma: "undo na posicao de um layer reseta override de outro layer".
      // Re-aplica os fills atuais aos objetos que tem __fillBrandIdx, e cores
      // atuais aos bgLayers que tem colorBrandIdx. Continua dentro do guard
      // isApplyingHistory=true pra nao disparar push automatico.
      try {
        syncBrandRefsInBgLayers()
        syncBrandRefsInTextObjects(fc)
        fc.renderAll()
      } catch {}
    } catch (e) {
      console.warn("applySnapshot fail:", e)
      clearTimeout(saveTimer.current)
      isApplyingHistory.current = false
      return false
    }
    // Limpa quaisquer save timers pendentes que poderiam ter sido enfileirados
    // por eventos de Fabric durante o loadFromJSON (object:added/modified).
    // Esses timers, se disparassem agora, salvariam layers em estado intermediario.
    clearTimeout(saveTimer.current)
    isApplyingHistory.current = false
    // Marca como dirty pra trigger save EXPLICITO (nao via debounce)
    // do estado pos-undo. Sem isso, se usuario fechar e abrir a peca,
    // o estado anterior ao undo permanece no banco.
    isDirtyRef.current = true
    setIsDirty(true)
    // Dispara save imediato do novo estado (sem debounce)
    doSave()
    return true
  }

  async function undo() {
    if (undoStack.current.length < 2) return
    // Re-entrancy guard: undo/redo clicados rapido em sequencia podem
    // iniciar um segundo applySnapshot enquanto o primeiro ainda esta no
    // await loadFromJSON ou mask rebake. Resultado: canvas em estado misto
    // de dois snaps, listeners de Fabric disparando em ordem imprevisivel.
    // Sintoma reportado pelo user: 'undo confunde os layers, apaga tudo'.
    if (isApplyingHistory.current) return
    const fc = fabricRef.current
    if (!fc) return
    // Topo da pilha eh o estado atual; guarda no redo e aplica o anterior
    const current = undoStack.current.pop()!
    const previous = undoStack.current[undoStack.current.length - 1]
    if (!previous) {
      undoStack.current.push(current)
      return
    }
    const ok = await applySnapshot(previous)
    if (!ok) {
      // applySnapshot abortou (snap ruim). Restaura a pilha pra estado antes
      // do undo — sem isso, redoStack ganhava um snap que nunca foi aplicado
      // e undo seguinte pulava pra um estado inconsistente.
      undoStack.current.push(current)
      return
    }
    redoStack.current.push(current)
    setSelected(null)
    setHistoryTick(t => t + 1)
  }

  async function redo() {
    if (redoStack.current.length === 0) return
    // Re-entrancy guard (mesmo motivo do undo).
    if (isApplyingHistory.current) return
    const next = redoStack.current.pop()!
    const ok = await applySnapshot(next)
    if (!ok) {
      // Mesmo tratamento do undo: snap ruim, devolve pro redoStack pra nao
      // perder o estado nem deixar a pilha incoerente.
      redoStack.current.push(next)
      return
    }
    undoStack.current.push(next)
    setSelected(null)
    setHistoryTick(t => t + 1)
  }

  function fitLayerToCanvas() {
    // FIT = encaixar a 100% (menor lado limita) E centralizar no canvas.
    // Botoes 20/40/60/80% nao centralizam (so escalam ancorado no centro do obj).
    scaleLayerToCanvas(1, true)
  }

  /**
   * Escala o layer pra que sua MAIOR dimensao ocupe N% da MENOR dimensao da peca.
   * E uma operacao ABSOLUTA: clicar 20% duas vezes da o mesmo resultado.
   * Isso evita "pulos cumulativos" e bate com o comportamento intuitivo (Photoshop:
   * o usuario quer um tamanho-alvo, nao um delta).
   *
   * percent: 0.2 = 20%, 0.4 = 40%, ..., 1.0 = 100% (caber inteiro - menor lado limita).
   * recenter: se true, centraliza no canvas. Se false (default), ancora no centro
   *           atual do objeto (so muda tamanho, posicao visual fica igual).
   */
  function scaleLayerToCanvas(percent: number, recenter: boolean = false) {
    const fc = fabricRef.current
    const obj: any = selected
    if (!fc || !obj) return
    const cw = canvasWRef.current, ch = canvasHRef.current
    const ow = obj.width ?? 100
    const oh = obj.height ?? 100
    if (!ow || !oh) return
    const isText = obj.type === "textbox" || obj.type === "i-text"

    // CALCULO ABSOLUTO: pega o tamanho fisico atual do objeto (incluindo scale),
    // descobre o tamanho-alvo, depois aplica.
    // Tamanho atual fisico:
    const curScaleX = obj.scaleX ?? 1
    const curScaleY = obj.scaleY ?? 1
    const curPhysW = ow * curScaleX
    const curPhysH = oh * curScaleY
    // Centro-alvo: se recenter, centro do canvas; senao, centro atual do objeto.
    // recenter=true (Encaixar): centraliza no canvas.
    // recenter=false (20/40/60/80): ancora no centro atual — so muda tamanho.
    const curLeft = obj.left ?? 0
    const curTop = obj.top ?? 0
    const centerX = recenter ? cw / 2 : (curLeft + curPhysW / 2)
    const centerY = recenter ? ch / 2 : (curTop + curPhysH / 2)
    // Tamanho-alvo: a maior dimensao do objeto vai ocupar `percent` da menor dimensao da peca.
    // (igual Photoshop Image Size com Constrain Proportions ligado.)
    const minCanvas = Math.min(cw, ch)
    const maxObj = Math.max(curPhysW, curPhysH)
    if (maxObj < 0.001) return
    // Fator que faz maxObj virar minCanvas * percent.
    const factor = (minCanvas * percent) / maxObj

    if (isText) {
      // Textbox: NUNCA usar scaleX/scaleY no objeto Fabric pra mudar tamanho.
      // Consolida em fontSize + width + styles per-char + leadingPt direto.
      const curFontSize = obj.fontSize ?? 48
      const newFontSize = curFontSize * factor
      const newWidth = ow * factor
      const curLeadingPt: number | undefined | null = (obj as any).leadingPt
      if (curLeadingPt !== undefined && curLeadingPt !== null) {
        ;(obj as any).leadingPt = curLeadingPt * factor
      }
      if (obj.styles && typeof obj.styles === "object") {
        for (const lineKey of Object.keys(obj.styles)) {
          const line = obj.styles[lineKey]
          for (const colKey of Object.keys(line)) {
            const cs = line[colKey]
            if (typeof cs.fontSize === "number") cs.fontSize = cs.fontSize * factor
          }
        }
      }
      obj.set({ fontSize: newFontSize, width: newWidth, scaleX: 1, scaleY: 1 })
      if (curLeadingPt !== undefined && curLeadingPt !== null) {
        obj.set({ lineHeight: leadingPtToFabricLineHeight((obj as any).leadingPt, newFontSize) })
      }
      if (obj.initDimensions) obj.initDimensions()
      // Re-mede e ancora no centro original (mantem posicao visual, so muda tamanho)
      const effW = (obj.width ?? newWidth)
      const effH = (obj.height ?? newFontSize)
      obj.set({ left: centerX - effW / 2, top: centerY - effH / 2 })
    } else {
      // Imagens/shapes: scaleX/scaleY legitimos. Aplica factor por cima do scale atual.
      const newScaleX = curScaleX * factor
      const newScaleY = curScaleY * factor
      const newPhysW = ow * newScaleX
      const newPhysH = oh * newScaleY
      // Ancora no centro original: mantem posicao visual, so muda tamanho.
      obj.set({ scaleX: newScaleX, scaleY: newScaleY, left: centerX - newPhysW / 2, top: centerY - newPhysH / 2 })
    }
    obj.setCoords()
    fc.renderAll()
    setSelectedTick(t => t + 1)
    doSave()
  }

  /**
   * Renomeia um layer (nome do asset). Atualiza Fabric obj.__assetLabel e
   * persiste no banco (PUT no asset). Atualiza o estado da campanha em memoria
   * pra refletir em todas as instancias do mesmo asset (KV usa o mesmo asset
   * em multiplas pecas).
   */
  async function renameLayer(layerObj: any, newLabel: string) {
    const fc = fabricRef.current
    if (!fc || !layerObj) return
    const trimmed = newLabel.trim()
    if (!trimmed) return
    const assetId = layerObj.__assetId
    if (!assetId) return
    // Atualiza imediatamente no Fabric (todos os objetos do mesmo asset)
    fc.getObjects().forEach((o: any) => {
      if (o.__assetId === assetId) o.__assetLabel = trimmed
    })
    refreshLayers(fc)
    // Persiste no banco
    try {
      await fetch(`/api/campaigns/${campaignId}/assets/${assetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      })
      // Atualiza state da campanha em memoria
      setCampaign(prev => prev ? {
        ...prev,
        assets: prev.assets.map(a => a.id === assetId ? { ...a, label: trimmed } : a),
      } : prev)
    } catch (e) {
      console.warn("[renameLayer] falha ao persistir:", e)
    }
  }

  function applyZoom(fc: any, z: number) {
    if (!fc || fc.disposed) return
    // Fabric v7 expoe canvas DOM em diferentes propriedades dependendo do estado
    const hasEl = (fc as any).lowerCanvasEl || (fc as any).lower?.el || (fc as any).elements?.lower
    if (!hasEl) return
    zoomRef.current = z
    setZoom(z)
    try {
      fc.setZoom(z)
      // Canvas DOM mantem o tamanho fixo (toda area visivel). Mudanca de zoom
      // recentraliza a peca via viewportTransform e redimensiona overlays.
      const fullW = (fabricRef as any).__canvasFullW ?? fc.getWidth()
      const fullH = (fabricRef as any).__canvasFullH ?? fc.getHeight()
      const cw = canvasWRef.current
      const ch = canvasHRef.current
      const offsetX = (fullW - cw * z) / 2
      const offsetY = (fullH - ch * z) / 2
      const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
      vt[0] = z; vt[3] = z
      vt[4] = offsetX
      vt[5] = offsetY
      fc.setViewportTransform(vt)
      // Re-dimensiona os overlays pra cobrirem a nova area fora da peca.
      // Mais simples: remove e recria com novos parametros.
      const existingOverlays = (fc as any).__bleedOverlays as any[] | undefined
      if (existingOverlays) {
        for (const o of existingOverlays) fc.remove(o)
      }
      ;(async () => {
        const { Rect } = await import("fabric")
        createBleedOverlays(fc, Rect, cw, ch, fullW, fullH, z)
        fc.renderAll()
      })()
      fc.renderAll()
    } catch (e) { console.warn("applyZoom fail:", e) }
  }

  /**
   * Cria um objeto Fabric a partir de um layer EMBEDDED (sem asset vinculado).
   * Usado em pecas importadas de PSD avulso onde o layer nao tem match com
   * nenhum CampaignAsset. Conteudo cru vem direto do proprio layer:
   *  - TEXT: text, fontFamily, fontSize, fontWeight, fill, textAlign, styles
   *  - IMAGE: imageDataUrl (base64 data URL gravado no piece.data)
   * Marca o objeto com __embedded = true pra survive ao save/load.
   */
  async function addEmbeddedLayer(fc: any, layer: any) {
    const { Textbox, FabricImage } = await import("fabric")
    const posX = layer?.posX ?? 100
    const posY = layer?.posY ?? 100
    const width = layer?.width ?? 400
    const height = layer?.height ?? 200
    const scaleX = layer?.scaleX ?? 1
    const scaleY = layer?.scaleY ?? 1

    if (layer.type === "TEXT") {
      const tb = new Textbox(layer.text ?? "", {
        left: posX, top: posY,
        width,
        fontFamily: layer.fontFamily ?? "Arial",
        fontSize: layer.fontSize ?? 48,
        fontWeight: layer.fontWeight ?? "normal",
        fill: layer.fill ?? "#111111",
        textAlign: layer.textAlign ?? "left",
        scaleX, scaleY,
        angle: layer.rotation ?? 0,
      })
      if (layer.styles && Object.keys(layer.styles).length > 0) {
        tb.set("styles", layer.styles)
        if (tb.initDimensions) tb.initDimensions()
      }
      ;(tb as any).__embedded = true
      ;(tb as any).__assetLabel = "(embedded)"
      if (Array.isArray(layer.groupPath) && layer.groupPath.length > 0) (tb as any).__groupPath = layer.groupPath
      fc.add(tb)
    } else if (layer.type === "IMAGE") {
      const dataUrl = layer.imageDataUrl
      if (!dataUrl) {
        editorLog("[addEmbeddedLayer] IMAGE sem imageDataUrl, ignorando:", layer)
        return
      }
      // Carrega via HTMLImageElement (FabricImage.fromURL pode falhar silenciosamente com base64)
      await new Promise<void>((resolve) => {
        const htmlImg = new Image()
        htmlImg.crossOrigin = "anonymous"
        htmlImg.onload = () => {
          const fabImg = new FabricImage(htmlImg, {
            left: posX, top: posY,
            scaleX, scaleY,
            angle: layer.rotation ?? 0,
          })
          // Mantem dataUrl original pra round-trip ao salvar (a FabricImage perde
          // o src embedded em algumas conversoes; gravamos a parte na prop custom).
          ;(fabImg as any).imageDataUrl = dataUrl
          ;(fabImg as any).__embedded = true
          ;(fabImg as any).__assetLabel = "(embedded)"
          if (Array.isArray(layer.groupPath) && layer.groupPath.length > 0) (fabImg as any).__groupPath = layer.groupPath
          fc.add(fabImg)
          resolve()
        }
        htmlImg.onerror = () => {
          editorLog("[addEmbeddedLayer] falha ao carregar imagem embedded")
          resolve()
        }
        htmlImg.src = dataUrl
      })
    }
  }

  // Aplica layer effects do PSD (drop shadow, stroke, outer glow) num
  // Fabric object. Drop shadow e outer glow viram shadow nativo (ZZOSY só
  // suporta UM shadow por object — drop shadow ganha precedência sobre glow).
  // Stroke vira stroke nativo do Fabric.
  // ShadowClass passada como param: Fabric v7 exige Shadow INSTANCE (não plain
  // object) — passar {color,blur,...} cru faz render virar branco silenciosamente.
  // COBERTURA VISUAL:
  //  - dropShadow, outerGlow         → Fabric shadow
  //  - stroke                        → fabric stroke/strokeWidth
  //  - colorOverlay (texto/forma)    → override do fill
  //  - gradientOverlay (texto/forma) → fill como fabric Gradient
  // PRESERVADOS NO JSON (sem render visual ainda):
  //  - innerShadow, innerGlow, bevel, satin, patternOverlay
  //  Esses exigem offscreen comp custom; ficam preservados pra round-trip ao
  //  re-exportar pro Photoshop (designer vê o efeito ao re-abrir o PSD).
  /**
   * Compose effect color with its own opacity into rgba string.
   * F12.14: cada effect tem opacity propria; precisa multiplicar com cor
   * hex pra Fabric.Shadow color aplicar visualmente. Antes "rgba(0,0,0,0.5)"
   * era hardcoded — agora respeita effect.opacity do PSD.
   */
  function effectColorWithOpacity(color: string | undefined, opacity: number | undefined, fallback: string): string {
    const op = typeof opacity === "number" ? Math.max(0, Math.min(1, opacity)) : 1
    if (!color) return fallback
    // Color hex sem alpha (#rrggbb) → adiciona alpha
    const m = /^#([0-9a-f]{6})$/i.exec(color)
    if (m) {
      const r = parseInt(m[1].slice(0, 2), 16)
      const g = parseInt(m[1].slice(2, 4), 16)
      const b = parseInt(m[1].slice(4, 6), 16)
      return `rgba(${r}, ${g}, ${b}, ${op})`
    }
    // Color rgba(...) com alpha existente → multiplica
    const rgba = /^rgba\(([^)]+)\)$/i.exec(color)
    if (rgba) {
      const parts = rgba[1].split(",").map(s => s.trim())
      if (parts.length === 4) {
        const a = parseFloat(parts[3]) * op
        return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${a})`
      }
    }
    return color
  }

  function applyFabricEffects(obj: any, effects: any, ShadowClass: any) {
    if (!effects) return
    // F12.14: dropShadow + outerGlow agora respeitam opacity per-effect via
    // rgba() composto. Antes hardcoded "0.5" no fallback ignorava o valor.
    if (effects.dropShadow) {
      const d = effects.dropShadow
      // Adobe angle eh em graus: 0=direita, 90=baixo. Distance + angle viram offsetX/Y.
      const angleRad = ((d.angle ?? 120) * Math.PI) / 180
      const dist = d.distance ?? 5
      const offsetX = Math.cos(angleRad) * dist
      const offsetY = Math.sin(angleRad) * dist
      obj.set("shadow", new ShadowClass({
        color: effectColorWithOpacity(d.color, d.opacity, "rgba(0,0,0,0.5)"),
        offsetX,
        offsetY,
        blur: d.blur ?? 5,
      }))
    } else if (effects.outerGlow) {
      const g = effects.outerGlow
      obj.set("shadow", new ShadowClass({
        color: effectColorWithOpacity(g.color, g.opacity, "rgba(255,255,255,0.5)"),
        offsetX: 0, offsetY: 0,
        blur: g.blur ?? 5,
      }))
    }
    if (effects.stroke && effects.stroke.color) {
      // F12.14: stroke effect agora respeita opacity (se diferente de 1)
      // via rgba composto. Sem isso opacity era ignorado.
      //
      // CRITICO: SHAPE com vectorStroke proprio (PS Properties bar Stroke) +
      // Layer Style Stroke (effects.stroke) sao 2 strokes INDEPENDENTES no
      // PS. Antes, applyFabricEffects sobrescrevia obj.stroke (que tinha o
      // vectorStroke) com effects.stroke → vectorStroke perdido.
      // Fix: pra SHAPE com stroke proprio, PRESERVA vectorStroke e nao
      // aplica effects.stroke aqui (round-trip preserva via layer.effects).
      // Quando renderizar AMBOS visualmente requer outline duplo, sera
      // trabalho futuro — por ora vectorStroke ganha (eh o primario).
      const isShapeWithOwnStroke = (obj as any).__isShape === true
        && typeof obj.stroke === "string"
        && obj.stroke !== ""
        && (obj.strokeWidth ?? 0) > 0
      if (!isShapeWithOwnStroke) {
        const c = typeof effects.stroke.opacity === "number" && effects.stroke.opacity < 1
          ? effectColorWithOpacity(effects.stroke.color, effects.stroke.opacity, effects.stroke.color)
          : effects.stroke.color
        obj.set("stroke", c)
        obj.set("strokeWidth", effects.stroke.width ?? 1)
      }
    }
    // Color Overlay: substitui o fill por uma cor sólida.
    if (effects.colorOverlay && effects.colorOverlay.color) {
      const isImg = obj.type === "image"
      if (!isImg) {
        obj.set("fill", effects.colorOverlay.color)
      } else {
        // Imagem: PSDs importados pelo flow novo já tem o overlay baked no
        // bitmap (PsdImporter remove effects.colorOverlay nesse caso). Mas
        // campanhas antigas (imports pré-bake) ainda carregam o JSON com
        // colorOverlay E o PNG original — aplicamos BlendColor.tint em runtime
        // pra renderizar visualmente. Lazy-import do filter pra nao bloquear
        // o caminho de objetos sem effects.
        ;(async () => {
          try {
            const fab: any = await import("fabric")
            // Fabric v7: BlendColor exportado em filters namespace
            // (`fab.filters.BlendColor`), NAO direto em `fab.BlendColor`.
            // Antes este caminho retornava silenciosamente (BlendColor=undefined)
            // e colorOverlay sumia no editor mesmo presente no PSD (user
            // reportou 2026-05-22: "preview KV vem perfeito mas editor some").
            const BlendColor = fab.filters?.BlendColor ?? fab.BlendColor
            if (!BlendColor) {
              editorLog("[colorOverlay runtime] Fabric.BlendColor nao encontrado")
              return
            }
            const alpha = Math.max(0, Math.min(1, typeof effects.colorOverlay.opacity === "number" ? effects.colorOverlay.opacity : 1))
            obj.filters = [new BlendColor({ color: effects.colorOverlay.color, mode: "tint", alpha })]
            if (typeof obj.applyFilters === "function") obj.applyFilters()
            ;(obj as any).dirty = true
            obj.canvas?.requestRenderAll?.()
          } catch (e) { editorLog("[colorOverlay runtime] falhou:", e) }
        })()
      }
    }
    // Gradient Overlay: aplica gradiente como fill. Mesma restrição (texto/forma).
    if (effects.gradientOverlay && Array.isArray(effects.gradientOverlay.stops) && effects.gradientOverlay.stops.length > 0) {
      const isImg = obj.type === "image"
      if (!isImg) {
        // Converte angle PSD (0=cima, sentido horário) pros coords do Fabric Gradient.
        // Linear: usa coords relativas ao bbox do objeto via coordsType:"percentage".
        const go = effects.gradientOverlay
        const angleRad = ((go.angle ?? 90) * Math.PI) / 180
        // Eixo do gradiente: vector unitário no angle dado. Multiplica por raio que
        // garante cobertura total da diagonal do bbox (0.5 * √2 ≈ 0.707).
        const r = 0.707
        const cx = 0.5, cy = 0.5
        const dx = Math.cos(angleRad) * r
        const dy = Math.sin(angleRad) * r
        // ag-psd gradient.colorStops: location 0..1
        const stops = go.reverse
          ? go.stops.map((s: any) => ({ offset: 1 - (s.offset ?? 0), color: s.color }))
          : go.stops.map((s: any) => ({ offset: s.offset ?? 0, color: s.color }))
        // Fabric Gradient: importa lazy. Setar fill via gradiente requer instância.
        try {
          // Import síncrono não disponível aqui; criamos a config — Fabric aceita
          // gradiente como objeto literal via set("fill", literal) em v7.
          obj.set("fill", {
            type: go.type === "radial" ? "radial" : "linear",
            coords: go.type === "radial"
              ? { x1: cx, y1: cy, x2: cx, y2: cy, r1: 0, r2: r }
              : { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy },
            colorStops: stops,
            gradientUnits: "percentage",
          } as any)
        } catch (e) {
          console.warn("[applyFabricEffects] gradientOverlay falhou:", e)
        }
      }
    }
  }

  async function addAssetToCanvas(fc: any, asset: Asset, layer: any) {
    const fabricMod = await import("fabric")
    const { Rect, Textbox, FabricImage, Shadow, Path } = fabricMod as any
    const posX = layer?.posX ?? 100
    const posY = layer?.posY ?? 100
    const width = layer?.width ?? 400
    const scaleX = layer?.scaleX ?? 1
    const scaleY = layer?.scaleY ?? 1
    const angle = layer?.rotation ?? 0
    // PSD opacity/blendMode (extraídos no import) preservados como props do
    // Fabric object. Só repassa quando há valor explícito (não-default) —
    // setar `opacity: 1` ou `globalCompositeOperation: "source-over"` no
    // Canvas interativo pode trigerar render anômalo (canvas em branco)
    // mesmo sendo equivalente aos defaults.
    const psdExtraProps: any = {}
    // Sanity: opacity exatamente 1/255 (≈ 0.0039) ou < 0.01 = bug do importer
    // antigo (dividia opacity 2x por 255). Descarta o valor, trata como visível.
    // Re-importe o PSD pra grudar opacities reais corretamente.
    if (typeof layer?.opacity === "number" && layer.opacity < 1 && layer.opacity >= 0.01) {
      psdExtraProps.opacity = layer.opacity
    }
    if (typeof layer?.blendMode === "string" && layer.blendMode && layer.blendMode !== "source-over") {
      psdExtraProps.globalCompositeOperation = layer.blendMode
    }
    const psdEffects = (layer?.effects && typeof layer.effects === "object") ? layer.effects : null
    // groupPath: hierarquia de folders do PSD preservada no Fabric object pra
    // re-exportar com a mesma estrutura de groups. Array de nomes raiz → pai.
    const psdGroupPath = Array.isArray(layer?.groupPath) && layer.groupPath.length > 0 ? layer.groupPath as string[] : null

    // SHAPE assets — Fabric.Path com fill/stroke editaveis via Properties.
    // Tentamos antes (commits bbcf965/9313ed3) usar Fabric.Rect/Ellipse pra
    // Live Shape behavior, mas introduziu varias regressoes: slider de
    // stroke nao funcionava, stroke crescia com scale (strokeUniform nao
    // propagava), bg saia do canvas (cache invalidation agressivo).
    // Voltei pra Fabric.Path estavel. Cantos distorcem em scale nao-uniforme
    // (mesmo comportamento que PS Path) — slider de raio em Properties
    // continua funcionando pra ajustar raio absoluto manualmente.
    if (asset.type === "SHAPE") {
      try {
        const shape = (asset as any).content ?? null
        const parsedShape = typeof shape === "string" ? JSON.parse(shape) : shape
        if (!parsedShape?.path) {
          console.warn("[shape] asset sem path data:", asset.label)
          return
        }
        const layerOv = layer?.overrides ?? {}
        const baseFill = parsedShape.fill?.kind === "solid"
          ? parsedShape.fill.color
          : "transparent"
        const baseStroke = parsedShape.stroke?.color ?? undefined
        const baseStrokeW = parsedShape.stroke?.width ?? 0
        const fillProp = layerOv.fill !== undefined ? layerOv.fill : baseFill
        const strokeProp = layerOv.stroke !== undefined ? layerOv.stroke : baseStroke
        const strokeWidth = layerOv.strokeWidth !== undefined ? layerOv.strokeWidth : baseStrokeW
        // Effective bbox W/H — pra parametric, MULTIPLICA pelo layer.scaleX/Y
        // a menos que ja exista override explicito. Sem isso, shape salvo com
        // scale != 1 reabria com path no tamanho original e scale aplicado
        // visualmente — assimetrico (path internal 400 mas visible 800), que
        // depois confundia o export PSD (3x menor que editor).
        const isParametric = !!parsedShape.kind
        let effBboxW = 0, effBboxH = 0
        if (parsedShape.pathBbox) {
          effBboxW = (parsedShape.pathBbox.right ?? 400) - (parsedShape.pathBbox.left ?? 0)
          effBboxH = (parsedShape.pathBbox.bottom ?? 300) - (parsedShape.pathBbox.top ?? 0)
        }
        if (typeof layerOv.bboxW === "number" && layerOv.bboxW > 0) {
          effBboxW = layerOv.bboxW  // override absoluto do scaling hook
        } else if (isParametric) {
          effBboxW = effBboxW * scaleX  // bake scale no path
        }
        if (typeof layerOv.bboxH === "number" && layerOv.bboxH > 0) {
          effBboxH = layerOv.bboxH
        } else if (isParametric) {
          effBboxH = effBboxH * scaleY
        }
        const effCornerR_load = typeof layerOv.cornerRadius === "number"
          ? layerOv.cornerRadius
          : (typeof parsedShape.cornerRadius === "number" ? parsedShape.cornerRadius : 0)
        const isParametricFinal = isParametric && effBboxW > 0 && effBboxH > 0
        // Recomputa path com cornerRadius override se shape eh parametric.
        const pathStr: string = isParametricFinal
          ? buildShapePath(parsedShape.kind as ShapeKind, effBboxW, effBboxH, effCornerR_load)
          : parsedShape.path
        const p = new Path(pathStr, {
          left: posX, top: posY,
          // Path parametric ja tem dims absolutos (bake do scale acima),
          // entao scaleX/scaleY = 1. Path nao-parametric mantem scale cru.
          scaleX: isParametricFinal ? 1 : scaleX,
          scaleY: isParametricFinal ? 1 : scaleY,
          angle,
          fill: fillProp,
          stroke: strokeProp,
          strokeWidth,
          strokeUniform: true,
          fillRule: parsedShape.fillRule ?? "nonzero",
          ...psdExtraProps,
        })
        ;(p as any).__assetId = asset.id
        ;(p as any).__assetLabel = asset.label
        ;(p as any).__isShape = true
        if (parsedShape.kind) (p as any).__shapeKind = parsedShape.kind
        if (effCornerR_load !== undefined) (p as any).__cornerRadius = effCornerR_load
        if (isParametricFinal) {
          ;(p as any).__pathBbox = { left: 0, top: 0, right: effBboxW, bottom: effBboxH }
        } else if (parsedShape.pathBbox) {
          ;(p as any).__pathBbox = parsedShape.pathBbox
        }
        if (psdEffects) (p as any).__psdEffects = psdEffects
        if (psdGroupPath) (p as any).__groupPath = psdGroupPath
        applyFabricEffects(p, psdEffects, Shadow)

        // Render dual stroke: vectorStroke (no main p) + effects.stroke (ghost
        // path atras). PS desenha os 2 simultaneos. Ghost = mesmo path, sem
        // fill, com strokeWidth = main_stroke + effects_stroke.
        const effStroke = psdEffects?.stroke
        const hasMainStroke = typeof p.stroke === "string" && p.stroke !== "" && (p.strokeWidth ?? 0) > 0
        if (hasMainStroke && effStroke?.color && (effStroke.width ?? 0) > 0) {
          // strokeWidth do ghost = main_strokeWidth + 2 * effect_strokeWidth.
          // Como Fabric centraliza stroke no path, o ghost mais largo deixa
          // exatamente effect_strokeWidth aparente alem do main (de cada lado).
          // Posicionado ANTES do main no fc → renderiza atras → so o "anel"
          // externo aparece (parte interna fica coberta pelo main com fill).
          const ghostW = (p.strokeWidth ?? 1) + 2 * (effStroke.width ?? 1)
          const ghost = new Path(pathStr, {
            left: posX, top: posY,
            scaleX, scaleY, angle,
            fill: "",
            stroke: effStroke.color,
            strokeWidth: ghostW,
            strokeUniform: true,
            fillRule: parsedShape.fillRule ?? "nonzero",
            // NAO selecionavel — ghost segue o main via __assetId.
            selectable: false,
            evented: false,
            excludeFromExport: true,
          } as any)
          ;(ghost as any).__assetId = asset.id
          ;(ghost as any).__isStrokeGhost = true
          fc.add(ghost)
        }
        fc.add(p)
        fc.requestRenderAll()
        return
      } catch (e) {
        console.error("[shape] render falhou:", asset.label, e)
      }
    }
    if (asset.type === "IMAGE") {
      if (asset.imageUrl) {
        try {
          const isSvg = /\.svg(\?|$)/i.test(asset.imageUrl)
          // SVGs sem width/height EXPLICITOS no markup carregam com naturalWidth=150 (default
          // do user-agent), e Fabric usa naturalWidth como tamanho. Solucao robusta:
          // baixa o SVG, injeta width/height extraidos do viewBox no proprio markup,
          // e cria um Blob URL pro <img>. Assim naturalWidth bate com o tamanho real.
          let imgSrc = asset.imageUrl
          if (isSvg) {
            try {
              const txt = await fetch(asset.imageUrl).then(r => r.text())
              const widthAttr = txt.match(/<svg[^>]*\swidth\s*=\s*["']([^"']+)["']/i)?.[1]
              const heightAttr = txt.match(/<svg[^>]*\sheight\s*=\s*["']([^"']+)["']/i)?.[1]
              const viewBox = txt.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
              const numFromAttr = (s?: string) => {
                if (!s) return undefined
                const n = parseFloat(s)
                return Number.isFinite(n) && n > 0 ? n : undefined
              }
              let w = numFromAttr(widthAttr)
              let h = numFromAttr(heightAttr)
              if ((!w || !h) && viewBox) {
                const parts = viewBox.split(/[\s,]+/).map(Number)
                if (parts.length === 4 && parts.every(Number.isFinite)) {
                  w = w ?? parts[2]
                  h = h ?? parts[3]
                }
              }
              if (w && h && (!widthAttr || !heightAttr)) {
                // Injeta width/height na primeira tag <svg ...> do markup
                const patched = txt.replace(/<svg\b([^>]*)>/i, (_, attrs) => {
                  let a = attrs
                  if (!/\swidth\s*=/i.test(a)) a += ` width="${w}"`
                  if (!/\sheight\s*=/i.test(a)) a += ` height="${h}"`
                  return `<svg${a}>`
                })
                const blob = new Blob([patched], { type: "image/svg+xml" })
                imgSrc = URL.createObjectURL(blob)
                svgBlobUrlsRef.current.push(imgSrc)
              }
            } catch (e) { console.warn("[SVG] falha lendo dimensoes:", e) }
          }

          const img = await new Promise<any>((resolve, reject) => {
            const el = new window.Image()
            el.crossOrigin = "anonymous"
            el.onload = async () => {
              const naturalW = el.naturalWidth || el.width || 1
              const naturalH = el.naturalHeight || el.height || 1
              let sx: number, sy: number
              if (scaleX !== 1 || scaleY !== 1) {
                // Scale ja vem do layer (peca/matriz carregada): usa direto
                sx = scaleX; sy = scaleY
              } else if (layer?.height != null) {
                // Tem width E height explicitos: pode distorcer (matriz com tamanho custom)
                sx = width / naturalW
                sy = layer.height / naturalH
              } else {
                // Tem so width (botao "+ Adicionar ao canvas"): mantem proporcao
                // pra nao distorcer. Usa ratio uniforme baseado no width alvo.
                const ratio = width / naturalW
                sx = ratio; sy = ratio
              }
              // Bake raster mask no bitmap. Fabric v6 renderiza Image clipPath
              // como silhueta solida (ignora alpha do PNG da mask) — o jeito
              // de obter alpha-mask real eh pre-compor a mascara DENTRO do
              // bitmap antes de criar a FabricImage. So aplicamos pra mask
              // type=raster; vector/clipping continuam usando clipPath
              // (que respeitam geometric shape no Fabric).
              let sourceForFabric: HTMLImageElement | HTMLCanvasElement = el
              if (layer?.mask?.type === "raster" && layer.mask.enabled !== false && layer.mask.raster?.dataUrl) {
                srvLog("mask-BAKE-START", { label: asset.label, posX, posY, naturalW, naturalH, maskPos: { x: layer.mask.raster.posX, y: layer.mask.raster.posY }, maskSize: { w: layer.mask.raster.width, h: layer.mask.raster.height } })
                // Console debug: deixa o user inspecionar sem precisar abrir
                // /api/debug. Roda 1x por layer no load — barato.
                console.log("[mask-bake-debug]", asset.label, {
                  layer_pos: { x: posX, y: posY },
                  layer_scale: { x: sx, y: sy },
                  image_natural: { w: naturalW, h: naturalH },
                  layer_size_canvas: { w: naturalW * sx, h: naturalH * sy },
                  mask: layer.mask.raster,
                  mask_schemaV: (layer.mask as any)._schemaV ?? "v1-pre-scaleLayerMask",
                  computed_ratio: { x: 1/sx, y: 1/sy },
                  computed_offset_natural: { x: (layer.mask.raster.posX - posX) / sx, y: (layer.mask.raster.posY - posY) / sy },
                  computed_size_natural: { w: layer.mask.raster.width / sx, h: layer.mask.raster.height / sy },
                })
                try {
                  // sx/sy: scale do layer no canvas atual. Mask coords sao em
                  // canvas-space, sourceImg em image-natural-space — passamos
                  // o scale pra conversao acontecer dentro de composeRaster*.
                  const composed = await composeRasterMaskIntoImage(el, layer.mask.raster, posX, posY, naturalW, naturalH, !!layer.mask.inverted, sx, sy)
                  if (composed) {
                    sourceForFabric = composed
                    srvLog("mask-BAKE-OK", { label: asset.label, canvasW: composed.width, canvasH: composed.height })
                    console.log("[mask-bake-result]", asset.label, "composed canvas:", composed.width, "x", composed.height)
                  } else {
                    srvLog("mask-BAKE-NULL", { label: asset.label, reason: "composeRasterMaskIntoImage returned null" })
                  }
                } catch (e) { srvLog("mask-BAKE-FAIL", { label: asset.label, err: String((e as any)?.message ?? e) }) }
              }
              resolve(new FabricImage(sourceForFabric, { left: posX, top: posY, scaleX: sx, scaleY: sy, angle, ...psdExtraProps }))
            }
            el.onerror = reject
            el.src = imgSrc
          })
          // Nota: nao revogamos o Blob URL aqui porque Fabric pode reler a fonte
          // em re-renders/exports. Browser libera o blob no GC quando nada mais usa.
          ;(img as any).__assetId = asset.id
          ;(img as any).__assetLabel = asset.label
          // Smart Object preservado do PSD original: marcamos pra render
          // distinto (badge SO no Properties Panel) e pra GARANTIR que o
          // re-export emita placedLayer nativo (nao rasterizado). Sem essa
          // flag, asset.smartObject podia ser perdido em algum save→reload
          // e o re-export caia em image raster.
          if (asset.smartObject) {
            ;(img as any).__isSmartObject = true
            ;(img as any).__smartObjectGuid = asset.smartObject.guid
            ;(img as any).__smartObjectMime = asset.smartObject.mime
            ;(img as any).__smartObjectFilePath = asset.smartObject.filePath
            ;(img as any).__smartObjectOriginalName = asset.smartObject.originalName
          }
          if (psdEffects) (img as any).__psdEffects = psdEffects
          if (psdGroupPath) (img as any).__groupPath = psdGroupPath
          // Mask metadata: anota __maskData direto, sem depender de
          // applyMaskToFabricObject. Para imagens com raster mask, o bake ja
          // foi feito acima (composeRasterMaskIntoImage), mas precisamos da
          // anotacao pra que saveNow consiga gravar layer.mask no proximo save.
          // Sem isso, swap de asset / re-render perdia a mascara silenciosamente.
          if (layer?.mask) {
            ;(img as any).__maskData = layer.mask
            // Anchor pra tracking de movimento. Quando o user arrasta o layer,
            // object:modified detecta delta entre __maskAnchor.{left,top} e
            // obj.{left,top}, e propaga pro __maskData.raster.posX/Y. Sem isso,
            // mover o layer no editor deixava a mascara presa nas coords
            // originais (Photoshop liga mask ao layer por default — chain icon).
            ;(img as any).__maskAnchor = {
              left: posX, top: posY,
              scaleX: img.scaleX ?? 1, scaleY: img.scaleY ?? 1,
            }
          }
          // F12: pixelsIncludeEffects=true (Smart Objects) → effects ja estao
          // no pixel raster do canvas (PS rasterizou com layer styles). NAO
          // aplica Fabric.Shadow extra senao DOBRA. Pra rasters cruos (default),
          // aplica normalmente.
          const pixelsBaked = (asset as any).pixelsIncludeEffects === true
          if (!pixelsBaked) applyFabricEffects(img, psdEffects, Shadow)
          fc.add(img)
          fc.requestRenderAll()
          return
        } catch (e) { console.error("Image load failed:", e) }
      }
      const r = new Rect({
        left: posX, top: posY, width, height: layer?.height ?? 300,
        fill: "#d0d0d0", stroke: "#999", strokeWidth: 1,
        scaleX, scaleY, angle,
        ...psdExtraProps,
      })
      ;(r as any).__assetId = asset.id
      ;(r as any).__assetLabel = asset.label
      if (psdGroupPath) (r as any).__groupPath = psdGroupPath
      // Preserva mask metadata mesmo no fallback (imagem falhou ao carregar).
      // Sem isso, o proximo save grava layer sem mask e a mascara some
      // permanentemente — mesmo quando a URL da imagem voltar a funcionar.
      if (layer?.mask) {
        ;(r as any).__maskData = layer.mask
        ;(r as any).__maskAnchor = { left: posX, top: posY, scaleX: scaleX ?? 1, scaleY: scaleY ?? 1 }
      }
      fc.add(r)
    } else {
      const spans = getSpans(asset)
      const data = spansToTextboxData(spans)
      const def = data.defaultStyle
      // Texto: MERGE entre assetTpl (lastOverride - template do asset) e layerOv
      // (override per-instancia na peca/matriz). Layer prevalece quando ambos
      // setam o mesmo campo. Sem o merge, layer parcial (so com fontSize)
      // bloqueava acesso ao asset.lastOverride.leadingPt — leading caia em
      // default Fabric (1.0). Sintoma: "entrelinhas vem alterada".
      const layerOv = layer?.overrides
      const assetTpl: any = ((asset as any).lastOverride && typeof (asset as any).lastOverride === "object")
        ? (asset as any).lastOverride
        : null
      const ov: any = (layerOv || assetTpl)
        ? { ...(assetTpl ?? {}), ...(layerOv ?? {}) }
        : null
      // Texto: PECA pode ter override per-instancia (layer.overrides.text), usado
      // pra preservar quebras de linha inseridas localmente sem propagar pra matriz.
      // Se nao houver override, texto vem do asset.content (data.text) — fonte da
      // verdade dos caracteres. Matriz sempre cai no asset (matriz NAO grava
      // overrides.text; edicoes propagam pra asset.content via updateAssetContent).
      const initialText = (layerOv && typeof layerOv.text === "string") ? layerOv.text : data.text

      // Back-compat: pecas antigas geradas com scaleX!=1 (antes do fix da geracao). Consolida
      // scale no fontSize/width na hora de criar pra evitar que Fabric "salte" o tamanho ao
      // clicar. Apos consolidar, scaleX/scaleY = 1 (Photoshop-style). NAO mexe em imagens.
      let effScaleX = scaleX
      let effScaleY = scaleY
      let effWidth = width
      let effFontSize = (ov?.fontSize ?? def.fontSize ?? 80)
      let effLeadingPt = ov?.leadingPt
      let effStyles = ov?.styles
      const needsConsolidation = Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001
      if (needsConsolidation) {
        const sY = scaleY
        const sX = scaleX
        effFontSize = effFontSize * sY
        effWidth = (width ?? 400) * sX
        if (typeof effLeadingPt === "number") effLeadingPt = effLeadingPt * sY
        if (effStyles && typeof effStyles === "object") {
          const newStyles: any = {}
          for (const lineKey of Object.keys(effStyles)) {
            newStyles[lineKey] = {}
            for (const colKey of Object.keys(effStyles[lineKey])) {
              const cs = { ...effStyles[lineKey][colKey] }
              if (typeof cs.fontSize === "number") cs.fontSize = cs.fontSize * sY
              newStyles[lineKey][colKey] = cs
            }
          }
          effStyles = newStyles
        }
        effScaleX = 1
        effScaleY = 1
      }

      // Brand ref: se override aponta pra um brand color via fillBrandIdx e
      // brandColors[idx].hex difere do que esta salvo (brand mudou desde o
      // ultimo save), prefere a cor LIVE da marca. Marca dirty pra proximo
      // auto-save persistir o novo hex no overrides.fill.
      let effFill: string = (ov?.fill ?? def.color ?? "#111111")
      const fillBrandIdx = ov?.fillBrandIdx
      if (typeof fillBrandIdx === "number" && brandColorsRef.current[fillBrandIdx]) {
        const liveHex = brandColorsRef.current[fillBrandIdx].hex
        if (typeof liveHex === "string" && /^#[0-9a-fA-F]{6}$/.test(liveHex)) {
          if (liveHex.toLowerCase() !== String(effFill).toLowerCase()) {
            effFill = liveHex
            // GUARD load-time: brand re-sync durante init NAO deve marcar
            // dirty — usuario nao fez nada, nao mostrar prompt de save.
            // Next save eventual (quando user interagir) inclui sync.
            if (isInitialized.current) {
              isDirtyRef.current = true
              setIsDirty(true)
            }
          }
        }
      }
      // Brand refs PER-CHAR + PRUNE de entradas alem do texto.
      //
      // PRUNE: ao editar texto via /assets ou no editor, o numero de chars
      // pode encolher. styles[line][col] com col >= line length viram lixo
      // que confunde Fabric (renderiza chars fantasmas / overlap visivel).
      // Sintoma reportado: 'texto da umas encavaladas conforme abre/fecha'.
      //
      // BRAND REFS: itera styles[line][col].fillBrandIdx e re-resolve contra
      // brandColors atual. Sem isso, chars pintados via swatch Marca com
      // selecao parcial mantem cor velha apos mudanca de brand.
      if (effStyles && typeof effStyles === "object") {
        // Lines reais do textbox = split por \n. So mantem entradas validas.
        const textLines = (initialText ?? "").split("\n")
        const newPerCharStyles: any = {}
        let perCharChanged = false
        for (const lineKey of Object.keys(effStyles)) {
          const lineIdx = Number(lineKey)
          if (!Number.isFinite(lineIdx) || lineIdx < 0 || lineIdx >= textLines.length) {
            // Linha alem do texto — descarta.
            perCharChanged = true
            continue
          }
          const lineLen = textLines[lineIdx].length
          newPerCharStyles[lineKey] = {}
          for (const colKey of Object.keys(effStyles[lineKey])) {
            const colIdx = Number(colKey)
            if (!Number.isFinite(colIdx) || colIdx < 0 || colIdx >= lineLen) {
              // Col alem da linha — descarta.
              perCharChanged = true
              continue
            }
            const cs = { ...effStyles[lineKey][colKey] }
            if (typeof cs.fillBrandIdx === "number" && brandColorsRef.current[cs.fillBrandIdx]) {
              const charLive = brandColorsRef.current[cs.fillBrandIdx].hex
              if (typeof charLive === "string" && /^#[0-9a-fA-F]{6}$/.test(charLive)
                  && charLive.toLowerCase() !== String(cs.fill ?? "").toLowerCase()) {
                cs.fill = charLive
                perCharChanged = true
              }
            }
            newPerCharStyles[lineKey][colKey] = cs
          }
          // Linha sem nenhuma entrada valida — limpa.
          if (Object.keys(newPerCharStyles[lineKey]).length === 0) {
            delete newPerCharStyles[lineKey]
          }
        }
        if (perCharChanged) {
          effStyles = newPerCharStyles
          // GUARD load-time: prune + brand re-sync during init nao deve
          // marcar dirty — usuario nao fez nada.
          if (isInitialized.current) {
            isDirtyRef.current = true
            setIsDirty(true)
          }
        }
      }

      // Initial lineHeight Adobe-style. effLeadingPt eh absoluto em pt; lineHeight
      // do Fabric eh multiplicador. Conversao: lh = leadingPt / fontSize.
      //
      // NAO inflamos lineHeight pra acomodar fontSize variavel per-char (chars
      // maiores que o default). Inflar aumenta a altura TOTAL do textbox e faz
      // ele sobrepor textboxes posicionados logo abaixo (titulo cobrindo o
      // subtitulo, p.ex.). PS aplica leading per-linha — Fabric nao tem isso —
      // entao linha com glyph maior pode overflow visualmente dentro do textbox,
      // mas a altura TOTAL bate com o PSD e textboxes vizinhos nao colidem.
      const initialLineHeight = (typeof effLeadingPt === "number" && effFontSize > 0)
        ? leadingPtToFabricLineHeight(effLeadingPt, effFontSize)
        : (typeof ov?.lineHeight === "number" ? ov.lineHeight : 1.2)
      const t = new Textbox(initialText, {
        left: posX, top: posY,
        width: Math.max(effWidth, 200),
        fontSize: effFontSize,
        fontFamily: (ov?.fontFamily ?? def.fontFamily ?? "Arial"),
        fontWeight: (ov?.fontWeight ?? def.fontWeight ?? "normal"),
        fontStyle: (ov?.fontStyle ?? (def as any).fontStyle ?? "normal"),
        fill: effFill,
        lineHeight: initialLineHeight,
        // editable: true permite duplo-clique pra SELECIONAR caracteres (necessario
        // pra aplicar styles per-char no painel direito). Mas digitar/apagar e
        // bloqueado por listener separado abaixo, porque caracteres so podem ser
        // alterados via /assets.
        editable: true,
        scaleX: effScaleX, scaleY: effScaleY, angle,
        ...psdExtraProps,
      })
      // Aplica overrides do layer (estilos editados pelo usuário no editor)
      if (ov) {
        if (ov.charSpacing !== undefined) t.set("charSpacing", ov.charSpacing)
        if (ov.lineHeight !== undefined) t.set("lineHeight", ov.lineHeight)
        if (ov.textAlign !== undefined) t.set("textAlign", ov.textAlign)
        if (effLeadingPt !== undefined && effLeadingPt !== null) {
          ;(t as any).leadingPt = effLeadingPt
          syncLineHeightFromLeading(t)
        }
        // Styles per-char (eventualmente ja consolidados acima por needsConsolidation)
        if (effStyles && Object.keys(effStyles).length > 0) {
          t.set("styles", effStyles)
        }
      }
      if ((t as any).initDimensions) (t as any).initDimensions()
      // Anti-overwrap: PSD mede o text box com sub-pixel precision do Photoshop.
      // Browsers/Fabric usam font metrics que podem variar em centesimos de
      // pixel, fazendo um texto que cabia em N linhas no PSD quebrar pra N+1 no
      // canvas. Detectamos pelo numero de "\n" explicitos vs textLines reais
      // do Textbox apos initDimensions, e expandimos o width incrementalmente
      // ate que o wrap volte a respeitar o layout original (max 3 tentativas
      // pra evitar loop em casos patologicos).
      try {
        // expectedLines: prioridade 1 = altura do bbox PSD / leading (PSD ja
        // sabe quantas linhas o designer quis). Prioridade 2 = \n explicitos
        // + 1 (text sintetico do editor). Sem isso, textos PSD com wrap
        // intencional (ex: "Incentivo para investimentos" em 3 linhas no
        // box estreito) eram tratados como 1 linha e o autofit expandia o
        // width pra "consertar", invadindo textos vizinhos.
        const psdHeight = typeof ov?.height === "number" ? ov.height : null
        const leadingForCalc = (typeof effLeadingPt === "number" && effLeadingPt > 0)
          ? effLeadingPt
          : (effFontSize > 0 ? effFontSize * 1.2 : 24)
        const explicitLines = (initialText.match(/\n/g)?.length ?? 0) + 1
        const psdLines = psdHeight ? Math.max(1, Math.round(psdHeight / leadingForCalc)) : 0
        const expectedLines = Math.max(explicitLines, psdLines)
        let attempts = 0
        // _textLines eh propriedade interna do Fabric Textbox pos initDimensions.
        while (((t as any)._textLines?.length ?? 0) > expectedLines && attempts < 3) {
          const currentWidth = (t as any).width ?? Math.max(effWidth, 200)
          ;(t as any).set("width", Math.ceil(currentWidth * 1.05))
          if ((t as any).initDimensions) (t as any).initDimensions()
          attempts++
        }
        if (attempts > 0) {
          editorLog("[autofit-text]", asset.label, `expanded ${attempts}x to fit ${expectedLines} lines (psd=${psdLines}, explicit=${explicitLines})`)
        }
        // SHRINK-TO-CONTENT: depois de garantir que o text wrapping respeita
        // expectedLines, encolhe o width pra HUGGAR o conteudo. Sem isso, um
        // textbox importado do PSD com bbox de 1200px continua com 1200px de
        // largura mesmo se o texto so usa 600px — handles ficam la longe,
        // edicao no canvas vira pesadelo. Pattern Adobe/Figma: "Point Type"
        // texto-tem-largura-do-conteudo.
        try {
          const lineCount = (t as any)._textLines?.length ?? 0
          if (lineCount > 0 && lineCount === expectedLines) {
            let maxLineW = 0
            for (let i = 0; i < lineCount; i++) {
              const lw = typeof (t as any).getLineWidth === "function"
                ? (t as any).getLineWidth(i)
                : 0
              if (lw > maxLineW) maxLineW = lw
            }
            // Padding 8px pra cursor de edicao caber + arredondamento Photoshop.
            // MIN 100 pra textboxes muito curtos (1-2 chars) nao virarem clickable
            // alvo minusculo.
            const targetW = Math.max(100, Math.ceil(maxLineW + 8))
            const currentW = (t as any).width ?? 0
            // So encolhe — nunca expande aqui (a expansao foi cuidada acima).
            if (targetW < currentW * 0.95) {
              ;(t as any).set("width", targetW)
              if ((t as any).initDimensions) (t as any).initDimensions()
              editorLog("[autofit-text]", asset.label, `shrunk ${currentW}→${targetW} pra hugger conteudo`)
            }
          }
        } catch (e) { editorLog("[autofit-text-shrink] erro:", e) }
      } catch (e) { editorLog("[autofit-text] erro:", e) }
      ;(t as any).__assetId = asset.id
      ;(t as any).__assetLabel = asset.label
      if (typeof fillBrandIdx === "number") (t as any).__fillBrandIdx = fillBrandIdx
      if (psdEffects) (t as any).__psdEffects = psdEffects
      if (psdGroupPath) (t as any).__groupPath = psdGroupPath
      // DS link tracking: textbox vinculado ao preset do Design System tem
      // bolinha verde no painel de layers. Layer customizado pelo user via
      // Properties Panel quebra o vinculo (vermelho). Flag persistida no
      // override do layer pra round-trip — se vier false do save, mantem;
      // senao default true pra layers de asset com brandPresetKey.
      const assetHasBrandPreset = !!(asset as any)?.lastOverride?.brandPresetKey
      const savedDsLinked = (layerOv as any)?.dsLinked
      if (assetHasBrandPreset) {
        ;(t as any).__dsLinked = savedDsLinked !== false // default true; salva false explicito mantem
      }
      // Mask metadata: anotacao garantida pra que saveNow consiga gravar
      // layer.mask. Independente de applyMaskToFabricObject rodar depois.
      if (layer?.mask) {
        ;(t as any).__maskData = layer.mask
        ;(t as any).__maskAnchor = {
          left: posX, top: posY,
          scaleX: t.scaleX ?? 1, scaleY: t.scaleY ?? 1,
        }
      }
      applyFabricEffects(t, psdEffects, Shadow)
      fc.add(t)
    }
  }

  function refreshLayers(fc: any) {
    // Igual Photoshop: layers visiveis aparecem no painel, BG sempre embaixo
    // (no fim da lista — UI renderiza top→bottom matching o z-stack do canvas).
    // Placeholders de folder vazio sao incluidos (pra `__groupPath` deles
    // fazer o folder aparecer nos headers), mas marcados como isPlaceholder
    // pra UI esconder a row em si.
    const objs = fc.getObjects().filter((o: any) => !o.__isBleedOverlay)
    setLayers(
      objs.map((o: any, i: number) => ({
          id: i,
          label: o.__assetLabel ?? o.type,
          type: o.type,
          obj: o,
          hidden: o.__hidden === true,
          locked: o.__locked === true,
          isBg: o.__isBg === true,
          // groupPath: array de folders ancestrais do PSD ("Header", "Header > Logo").
          // Painel usa pra renderizar hierarquia indentada com headers de folder
          // entre layers (igual Photoshop).
          groupPath: Array.isArray(o.__groupPath) ? o.__groupPath : [],
          // Placeholder de folder vazio: o painel renderiza o header do folder
          // mas pula a row do layer em si.
          isPlaceholder: o.__folderPlaceholder === true,
        }))
        .reverse()
    )
  }

  function moveLayer(obj: any, direction: "up" | "down") {
    const fc = fabricRef.current
    if (!fc || !obj) return
    if ((obj as any).__isBg) return // BG fica sempre embaixo (igual Photoshop)
    if (direction === "up") fc.bringObjectForward(obj)
    else fc.sendObjectBackwards(obj)
    // BG sempre no fundo apos qualquer reorder
    const bgObj = fc.getObjects().find((o: any) => o.__isBg)
    if (bgObj) fc.sendObjectToBack(bgObj)
    fc.renderAll()
    refreshLayers(fc)
    // History: Fabric NAO dispara object:modified em bring/send. Sem este
    // push, reorder via botoes ou teclado nao entra no undo stack.
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  // Reordena layer absolutamente: pega o objeto e coloca em targetVisualIndex
  // (indice visual no painel, contando de cima pra baixo). Topo da lista = topo
  // do canvas (mais a frente). targetVisualIndex 0 = mais a frente.
  function reorderLayer(obj: any, targetVisualIndex: number, targetGroupPath?: string[]) {
    const fc = fabricRef.current
    if (!fc || !obj) return
    if ((obj as any).__isBg) return // BG nao se move (igual Photoshop)
    // Se um path explicito foi passado, atualiza groupPath do objeto. Permite
    // entrar/sair de folders ao arrastar (Photoshop-style). Quando undefined,
    // preserva o groupPath atual (apenas reordering z-stack).
    if (targetGroupPath !== undefined) {
      if (targetGroupPath.length === 0) delete (obj as any).__groupPath
      else (obj as any).__groupPath = targetGroupPath
      // Limpa placeholder do folder destino se ele virou "ocupado" — agora
      // tem layer real dentro, o placeholder eh redundante.
      const targetKey = targetGroupPath.join("›")
      const placeholders = fc.getObjects().filter((o: any) => o.__folderPlaceholder
        && Array.isArray(o.__groupPath)
        && o.__groupPath.join("›") === targetKey)
      for (const p of placeholders) fc.remove(p)
    }
    // Painel mostra os objetos invertidos (topo painel = topo canvas), entao o
    // indice "real" na lista de objects (de tras pra frente) eh: (total-1) - visualIdx
    const objects = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay)
    const total = objects.length
    const targetCanvasIndex = Math.max(0, Math.min(total - 1, total - 1 - targetVisualIndex))
    // Fabric API: moveObjectTo(obj, idx). Mas precisamos contar todos os obj
    // (incluindo bg/overlays) pra acertar o index. O moveObjectTo do Fabric usa
    // o array completo. Encontramos o idx do alvo no array completo.
    const allObjs = fc.getObjects()
    // Filtra apenas reais e pega o targetCanvasIndex-esimo
    const realObjs = allObjs.filter((o: any) => !o.__isBg && !o.__isBleedOverlay)
    const targetObj = realObjs[targetCanvasIndex]
    if (!targetObj) return
    const targetIndexInAll = allObjs.indexOf(targetObj)
    fc.moveObjectTo(obj, targetIndexInAll)
    // BG sempre embaixo apos reorder
    const bgObj = fc.getObjects().find((o: any) => o.__isBg)
    if (bgObj) fc.sendObjectToBack(bgObj)
    fc.renderAll()
    refreshLayers(fc)
    // History: Fabric NAO dispara object:modified em moveObjectTo. Sem este
    // push, drag-drop pra reordenar layers / mover entre folders nao entra
    // no undo stack — Cmd+Z nao desfaz reorders.
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  function toggleLayerVisibility(obj: any) {
    const fc = fabricRef.current
    if (!fc || !obj) return
    const hidden = !(obj.__hidden === true)
    obj.__hidden = hidden
    obj.set("visible", !hidden)
    fc.renderAll()
    refreshLayers(fc)
    // History: set('visible') nao dispara object:modified. Sem push, toggle
    // do olho/cadeado fica fora do undo stack.
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    // Save sem debounce: acao deliberada do user, nao pode ser perdida se ele
    // sair da pagina logo apos clicar (cleanup do useEffect cancelaria o timer).
    doSaveNow()
  }

  /**
   * Aplica visibilidade/lock em TODOS os layers cujo __groupPath comeca com
   * folderPath (i.e. o layer esta dentro daquela pasta ou sub-pasta).
   * Operacao em massa Photoshop-style: olho/cadeado no folder afeta filhos.
   * value=true significa hidden/locked; false significa visible/unlocked.
   */
  function setGroupAttribute(folderPath: string[], attr: "__hidden" | "__locked", value: boolean) {
    const fc = fabricRef.current
    if (!fc) return
    const allObjs = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay)
    let changed = 0
    for (const o of allObjs) {
      const op: string[] = Array.isArray((o as any).__groupPath) ? (o as any).__groupPath : []
      if (op.length < folderPath.length) continue
      let inside = true
      for (let i = 0; i < folderPath.length; i++) {
        if (op[i] !== folderPath[i]) { inside = false; break }
      }
      if (!inside) continue
      ;(o as any)[attr] = value
      if (attr === "__hidden") (o as any).set("visible", !value)
      changed++
    }
    if (changed > 0) {
      fc.renderAll()
      refreshLayers(fc)
      // History: toggle massivo de visibility/lock em folder nao dispara
      // object:modified (set('visible') eh setter direto). Push pra entrar
      // no undo stack.
      if (isInitialized.current && !isApplyingHistory.current) pushHistory()
      doSaveNow()
    }
  }
  function isGroupHidden(folderPath: string[]): boolean {
    // Folder eh considerado "hidden" se TODOS os filhos diretos+indiretos estao hidden.
    const fc = fabricRef.current
    if (!fc) return false
    const children = fc.getObjects().filter((o: any) => {
      if (o.__isBg || o.__isBleedOverlay) return false
      const op: string[] = Array.isArray(o.__groupPath) ? o.__groupPath : []
      if (op.length < folderPath.length) return false
      for (let i = 0; i < folderPath.length; i++) if (op[i] !== folderPath[i]) return false
      return true
    })
    if (children.length === 0) return false
    return children.every((o: any) => o.__hidden === true)
  }
  function isGroupLocked(folderPath: string[]): boolean {
    const fc = fabricRef.current
    if (!fc) return false
    const children = fc.getObjects().filter((o: any) => {
      if (o.__isBg || o.__isBleedOverlay) return false
      const op: string[] = Array.isArray(o.__groupPath) ? o.__groupPath : []
      if (op.length < folderPath.length) return false
      for (let i = 0; i < folderPath.length; i++) if (op[i] !== folderPath[i]) return false
      return true
    })
    if (children.length === 0) return false
    return children.every((o: any) => o.__locked === true)
  }

  // === FOLDER MANAGEMENT (Photoshop-style groups) ===
  // Folders sao derivados de __groupPath nos Fabric objects. Pra criar/mover/
  // renomear/deletar folders, basta mexer no __groupPath dos filhos.

  // Coleta todos os layers cujo __groupPath comeca por folderPath (descendentes
  // recursivos do folder, incluindo subfolders). Usado por moveFolder, rename,
  // delete pra atuar no folder inteiro de uma vez.
  function getFolderDescendants(folderPath: string[]): any[] {
    const fc = fabricRef.current
    if (!fc) return []
    return fc.getObjects().filter((o: any) => {
      if (o.__isBg || o.__isBleedOverlay) return false
      const op: string[] = Array.isArray(o.__groupPath) ? o.__groupPath : []
      if (op.length < folderPath.length) return false
      for (let i = 0; i < folderPath.length; i++) if (op[i] !== folderPath[i]) return false
      return true
    })
  }

  /**
   * Seleciona TODOS os layers de um folder (incluso sub-folders) no canvas.
   * Photoshop-style: clicar no folder no painel = manipular composite do grupo.
   * Fabric ActiveSelection move/escala/rotaciona como grupo preservando posicoes
   * relativas. Pula layers locked (Fabric ActiveSelection bug: objeto locked
   * dentro de selecao impede o resto de se mover).
   */
  async function selectFolderInCanvas(folderPath: string[]): Promise<void> {
    const fc = fabricRef.current
    if (!fc) return
    const objects = getFolderDescendants(folderPath).filter((o: any) => !o.__locked && o.selectable !== false)
    if (objects.length === 0) {
      // Folder so com layers locked/hidden — desativa selecao atual e sai.
      fc.discardActiveObject()
      fc.requestRenderAll()
      return
    }
    fc.discardActiveObject()
    if (objects.length === 1) {
      fc.setActiveObject(objects[0])
    } else {
      // Fabric v6: ActiveSelection eh a forma canonica de "multi-select".
      // Suporta move/scale/rotate como grupo, e os children mantem coords
      // relativas ao centro do bbox da selecao.
      const { ActiveSelection } = await import("fabric")
      const sel = new (ActiveSelection as any)(objects, { canvas: fc })
      fc.setActiveObject(sel)
    }
    fc.requestRenderAll()
  }

  // Coleta todos os paths de folders existentes (derivados dos groupPaths dos
  // layers — folder existe se PELO MENOS um layer aponta pra ele). Usado pra
  // detectar conflito de nome ao criar/renomear.
  function getAllFolderPaths(): Set<string> {
    const fc = fabricRef.current
    if (!fc) return new Set()
    const out = new Set<string>()
    for (const o of fc.getObjects()) {
      if ((o as any).__isBg || (o as any).__isBleedOverlay) continue
      const op: string[] = Array.isArray((o as any).__groupPath) ? (o as any).__groupPath : []
      // Adiciona TODOS os prefixos (folder pai + ancestrais)
      for (let i = 1; i <= op.length; i++) {
        out.add(op.slice(0, i).join("›"))
      }
    }
    return out
  }

  // Cria um folder novo. Se ha selecao no canvas (selected ou ActiveSelection
  // multi), move OS layers selecionados pra dentro do folder. Senao, cria
  // folder vazio com placeholder — mas como o painel deriva folders de layers
  // reais, folder vazio nao apareceria. Por isso na ausencia de selecao,
  // alertamos o user.
  // parentPath: se passado, o novo folder eh subfolder dessa pasta.
  /**
   * Cria um folder novo. Comportamento Adobe-style:
   *  - `moveSelection=false` (default do botao "+ Folder"): cria folder VAZIO.
   *    Adiciona placeholder Rect 1x1 invisivel pra o painel renderizar o folder.
   *    User arrasta layers pra dentro manualmente.
   *  - `moveSelection=true`: pega selecao ativa e move pra dentro (Cmd+G no PS).
   *
   * Antes: o botao "+ Folder" SEMPRE movia a selecao ativa. Combinado com a
   * feature recente de `selectFolderInCanvas` (clicar no header do folder seleciona
   * todos os children via ActiveSelection), clicar "+ Folder" depois de clicar
   * num folder existente MOVIA TUDO pra dentro do novo folder. Bug visivel:
   * "perde os outros layers" do folder de origem.
   */
  async function createFolder(name: string, parentPath: string[] = [], moveSelection = false) {
    const fc = fabricRef.current
    if (!fc || !name?.trim()) return
    const cleanName = name.trim()
    const newPath = [...parentPath, cleanName]
    const key = newPath.join("›")
    const existing = getAllFolderPaths()
    if (existing.has(key)) {
      alert(`Folder "${cleanName}" ja existe nesse nivel.`)
      return
    }
    if (moveSelection) {
      // Cmd+G style: move selecao ativa pra dentro.
      const active = fc.getActiveObject() as any
      let targets: any[] = []
      if (active) {
        const inner = Array.isArray(active._objects) ? active._objects : null
        targets = inner ?? [active]
        targets = targets.filter((o: any) => !o.__isBg && !o.__isBleedOverlay)
      }
      if (targets.length === 0) {
        alert("Selecione um ou mais layers no canvas pra mover pra dentro do folder.")
        return
      }
      for (const o of targets) {
        ;(o as any).__groupPath = newPath
      }
    } else {
      // Folder vazio: cria placeholder invisivel pra o painel renderizar.
      // Rect 1x1 com excludeFromExport=true (nao sai no PNG/PSD export) e
      // __folderPlaceholder=true (marker pra deletar quando user arrasta layer
      // real pra dentro). NAO mexe na selecao atual.
      const { Rect } = await import("fabric")
      const ph = new (Rect as any)({
        left: 0, top: 0, width: 1, height: 1,
        fill: "rgba(0,0,0,0)", stroke: "rgba(0,0,0,0)",
        selectable: false, evented: false, excludeFromExport: true, visible: false,
      })
      ;(ph as any).__folderPlaceholder = true
      ;(ph as any).__groupPath = newPath
      ;(ph as any).__assetLabel = "(folder placeholder)"
      fc.add(ph)
    }
    fc.renderAll()
    refreshLayers(fc)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  // Renomeia um folder existente: muda o segmento `folderPath[depth]` em todos
  // os descendentes pro novo nome. Subfolders e layers preservam a hierarquia.
  function renameFolder(folderPath: string[], newName: string) {
    const fc = fabricRef.current
    if (!fc || !newName?.trim() || folderPath.length === 0) return
    const cleanName = newName.trim()
    // Conflito: se ja existe folder com mesmo path renomeado, aborta
    const newPath = [...folderPath.slice(0, -1), cleanName]
    const newKey = newPath.join("›")
    const existing = getAllFolderPaths()
    if (existing.has(newKey) && newKey !== folderPath.join("›")) {
      alert(`Folder "${cleanName}" ja existe nesse nivel.`)
      return
    }
    const depth = folderPath.length - 1
    const descs = getFolderDescendants(folderPath)
    for (const o of descs) {
      const op: string[] = [...((o as any).__groupPath ?? [])]
      op[depth] = cleanName
      ;(o as any).__groupPath = op
    }
    fc.renderAll()
    refreshLayers(fc)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  // Move um folder INTEIRO (com subfolders e layers) pra um novo parentPath.
  // Ex: mover ["LOGO","Subfolder"] pra parent ["CODEZIN"] → vira ["CODEZIN","Subfolder"].
  // Pra mover pra raiz, passa parentPath = [].
  function moveFolderTo(folderPath: string[], newParentPath: string[]) {
    const fc = fabricRef.current
    if (!fc || folderPath.length === 0) return
    // Sanity: nao pode mover folder pra dentro de si mesmo (ou descendente).
    // newParentPath nao pode comecar com folderPath.
    if (newParentPath.length >= folderPath.length) {
      let isDescendant = true
      for (let i = 0; i < folderPath.length; i++) {
        if (newParentPath[i] !== folderPath[i]) { isDescendant = false; break }
      }
      if (isDescendant) return // mover pra dentro de si mesmo: ignora
    }
    const folderName = folderPath[folderPath.length - 1]
    const newFolderPath = [...newParentPath, folderName]
    // Conflito de nome no destino
    const existing = getAllFolderPaths()
    if (newFolderPath.join("›") !== folderPath.join("›") && existing.has(newFolderPath.join("›"))) {
      alert(`Ja existe um folder "${folderName}" no destino.`)
      return
    }
    const descs = getFolderDescendants(folderPath)
    for (const o of descs) {
      const op: string[] = [...((o as any).__groupPath ?? [])]
      // Substitui o prefixo folderPath por newFolderPath
      const tail = op.slice(folderPath.length)
      ;(o as any).__groupPath = [...newFolderPath, ...tail]
    }
    // Limpa placeholder do PARENT destino (se folder destino era vazio antes,
    // agora tem conteudo real — placeholder vira lixo). Aceita apenas placeholders
    // cujo groupPath bate EXATO com newParentPath.
    const parentKey = newParentPath.join("›")
    if (parentKey) {
      const placeholders = fc.getObjects().filter((o: any) => o.__folderPlaceholder
        && Array.isArray(o.__groupPath)
        && o.__groupPath.join("›") === parentKey)
      for (const p of placeholders) fc.remove(p)
    }
    // Reposiciona descendentes do folder movido pra ficarem contiguos no z-stack
    // (Fabric usa ordem do array). Sem isso, layers do folder movido podem ficar
    // intercalados com layers de outros folders no painel, e a renderizacao de
    // headers/indentacao parece "fora do folder destino" mesmo o __groupPath
    // estando correto.
    if (descs.length > 0) {
      const allObjs = fc.getObjects()
      // Acha o ultimo layer (no z-stack) do PARENT destino que NAO eh dos descs movidos
      const parentSiblings = allObjs.filter((o: any) => {
        const op: string[] = Array.isArray(o.__groupPath) ? o.__groupPath : []
        if (op.join("›") !== parentKey) return false
        return !descs.includes(o)
      })
      // Se ha algum sibling, posiciona descs logo APOS o ultimo sibling no
      // z-stack (= visualmente CONTIGUO com o folder destino no painel).
      // Se nao ha sibling (parent eh raiz vazia / so o placeholder), envia
      // descs pro topo do z-stack (apareceram na ordem natural).
      let insertAfter = parentSiblings.length > 0
        ? allObjs.indexOf(parentSiblings[parentSiblings.length - 1])
        : -1
      for (const d of descs) {
        const currentIdx = allObjs.indexOf(d)
        if (currentIdx < 0) continue
        // moveObjectTo posiciona objeto no index dado. Apos cada move,
        // recalcula posicao (Fabric mantem o array atualizado).
        insertAfter = Math.min(insertAfter + 1, fc.getObjects().length - 1)
        fc.moveObjectTo(d, insertAfter)
      }
    }
    // BG sempre no fundo
    const bgObj = fc.getObjects().find((o: any) => o.__isBg)
    if (bgObj) fc.sendObjectToBack(bgObj)
    fc.renderAll()
    refreshLayers(fc)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  // Deleta um folder. Por padrao, MOVE os filhos pra pasta pai (ou raiz se folder
  // era topo). Se deleteContents=true, remove os filhos do canvas tambem.
  function deleteFolder(folderPath: string[], deleteContents: boolean = false) {
    const fc = fabricRef.current
    if (!fc || folderPath.length === 0) return
    const descs = getFolderDescendants(folderPath)
    if (deleteContents) {
      for (const o of descs) fc.remove(o)
    } else {
      // Move filhos pra parent path (1 nivel acima)
      const parentPath = folderPath.slice(0, -1)
      for (const o of descs) {
        const op: string[] = [...((o as any).__groupPath ?? [])]
        const tail = op.slice(folderPath.length)
        if (parentPath.length === 0 && tail.length === 0) {
          delete (o as any).__groupPath
        } else {
          ;(o as any).__groupPath = [...parentPath, ...tail]
        }
      }
    }
    fc.renderAll()
    refreshLayers(fc)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  function toggleLayerLock(obj: any) {
    const fc = fabricRef.current
    if (!fc || !obj) return
    const locked = !(obj.__locked === true)
    obj.__locked = locked
    console.log("[TOGGLE-LOCK] novo estado:", locked, "label:", obj?.__assetLabel)
    // Lock = nao move, nao redimensiona, nao rotaciona, nao seleciona via clique
    obj.set({
      selectable: !locked,
      evented: !locked,
      lockMovementX: locked,
      lockMovementY: locked,
      lockScalingX: locked,
      lockScalingY: locked,
      lockRotation: locked,
    })
    if (locked && fc.getActiveObject() === obj) fc.discardActiveObject()
    fc.renderAll()
    refreshLayers(fc)
    // History: obj.set({selectable, evented, lock*}) nao dispara modified.
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    // Save sem debounce: acao deliberada do user, nao pode ser perdida se ele
    // sair da pagina logo apos clicar (cleanup do useEffect cancelaria o timer).
    doSaveNow()
  }

  // Aplica flags __hidden/__locked vindas do JSON salvo no objeto Fabric criado.
  // Chamado depois de addAssetToCanvas/addEmbeddedLayer pra restaurar estado.
  function applyHiddenLockedToObject(obj: any, layer: any) {
    // DEBUG: envia trace pro servidor pra Giovanni inspecionar via curl
    try {
      fetch("/api/debug/load-trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "applyHiddenLockedToObject",
          layer_hidden: layer?.hidden,
          layer_locked: layer?.locked,
          obj_label: obj?.__assetLabel,
          obj_type: obj?.type,
          had_hidden_before: obj?.__hidden,
          had_locked_before: obj?.__locked,
        }),
      })
    } catch {}
    if (layer?.hidden === true) {
      obj.__hidden = true
      obj.set("visible", false)
    }
    if (layer?.locked === true) {
      obj.__locked = true
      obj.set({
        selectable: false,
        evented: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
      })
    }
  }

  // ============= MASK HELPERS =============
  // Adiciona/remove/inverte/toggle mascara no objeto Fabric selecionado.
  // Os 3 tipos suportados: raster, vector (path SVG), clipping (recorta layer abaixo).

  async function applyMaskAndPersist(obj: any, mask: any) {
    const fc = fabricRef.current
    if (!fc) return
    ;(obj as any).__maskData = mask
    if (mask) {
      const { Image: FabImage, Path } = await import("fabric")
      await applyMaskToFabricObject({ Image: FabImage, Path }, obj, mask)
    } else {
      obj.clipPath = null
      delete (obj as any).__clippingMask
      obj.dirty = true
    }
    fc.requestRenderAll()
    refreshLayers(fc)
    doSave()
  }

  async function addClippingMaskToSelected() {
    const fc = fabricRef.current
    const obj = fc?.getActiveObject()
    if (!fc || !obj) return
    await applyMaskAndPersist(obj, { type: "clipping", enabled: true, clipping: true })
    // Aplica o clip de fato: o layer ABAIXO (Photoshop clipping mask = clipa
    // pelo layer imediatamente abaixo). applyMaskToFabric.ts so anota
    // __clippingMask = true (sem render); aqui resolvemos visualmente.
    await applyClippingMaskNative(fc, obj)
    fc.requestRenderAll()
    isDirtyRef.current = true
    setIsDirty(true)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  /**
   * Aplica clipPath nativo de Fabric usando o silhouette do layer ABAIXO
   * (PSD clipping mask). Detecta base via fc.getObjects() — proximo layer
   * com __assetId (skipa bg/bleed overlay) anterior ao obj atual.
   *
   * Pra que o clip mostre apenas onde o base tem pixels:
   *   - SHAPE base: clona Fabric.Path (mesmo path/fill/stroke)
   *   - IMAGE base: clona Fabric.Image absolutePositioned
   *   - TEXT base: clona Textbox
   * Cria clone com absolutePositioned: true. Fabric clipPath assim renderiza
   * em coords absolutas do canvas (mesma posicao do base original).
   */
  async function applyClippingMaskNative(fc: any, obj: any) {
    const all = fc.getObjects().filter((o: any) =>
      !o.__isBg && !o.__isBleedOverlay && !o.__isStrokeGhost
    )
    const idx = all.indexOf(obj)
    if (idx <= 0) {
      // Sem layer abaixo — nada pra clipar. Remove clipPath previo.
      obj.clipPath = null
      return
    }
    const base = all[idx - 1]
    if (!base) { obj.clipPath = null; return }
    try {
      // Clone Fabric do base — mantem mesma geometria pra usar como clipPath.
      // clone() eh assincrono em Fabric v7 (retorna Promise).
      const baseClone = await base.clone()
      ;(baseClone as any).absolutePositioned = true
      // ClipPath nao precisa de fill/stroke pra clipar — so a silhouette
      // (alpha) eh usada. Mas se for IMAGE/TEXT, mantemos como esta —
      // Fabric usa o alpha do bitmap.
      obj.clipPath = baseClone
      obj.dirty = true
    } catch (e) {
      console.warn("[clipping-mask] falha ao clonar base:", e)
      obj.clipPath = null
    }
  }

  // Cria vector mask retangular (Reveal All do Photoshop: caixa = todo bounding box,
  // texto/imagem visivel inteiro). Reveal Selection seria menor.
  async function addRectVectorMaskToSelected(revealAll: boolean = true) {
    const fc = fabricRef.current
    const obj = fc?.getActiveObject()
    if (!fc || !obj) return
    const x = obj.left ?? 0
    const y = obj.top ?? 0
    const w = (obj.width ?? 200) * (obj.scaleX ?? 1)
    const h = (obj.height ?? 200) * (obj.scaleY ?? 1)
    // Reveal All: mascara cobre tudo. Hide All: mascara invertida (esconde tudo).
    const path = `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`
    const mask = {
      type: "vector" as const,
      enabled: true,
      inverted: !revealAll,
      vector: { path, posX: x, posY: y, width: w, height: h },
    }
    await applyMaskAndPersist(obj, mask)
  }

  // Cria vector mask eliptica no bounding box do objeto.
  async function addEllipseVectorMaskToSelected(revealAll: boolean = true) {
    const fc = fabricRef.current
    const obj = fc?.getActiveObject()
    if (!fc || !obj) return
    const x = obj.left ?? 0
    const y = obj.top ?? 0
    const w = (obj.width ?? 200) * (obj.scaleX ?? 1)
    const h = (obj.height ?? 200) * (obj.scaleY ?? 1)
    const cx = x + w / 2
    const cy = y + h / 2
    const rx = w / 2
    const ry = h / 2
    // SVG path eliptico usando 2 arcos.
    const path = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
    const mask = {
      type: "vector" as const,
      enabled: true,
      inverted: !revealAll,
      vector: { path, posX: x, posY: y, width: w, height: h },
    }
    await applyMaskAndPersist(obj, mask)
  }

  // Toggle: mascara enabled/disabled (Shift+clique no Photoshop).
  async function toggleMaskEnabled(obj: any) {
    if (!obj?.__maskData) return
    const mask = { ...(obj as any).__maskData, enabled: !(obj as any).__maskData.enabled }
    await applyMaskAndPersist(obj, mask)
    // Clipping mask: applyMaskToFabricObject so trata raster/vector enabled.
    // Clipping eh feito pelo applyClippingMaskNative (depende do layer abaixo).
    // Aqui precisa sincronizar: enabled=true → re-aplica; false → remove clipPath
    // mas preserva __maskData pra round-trip.
    if (mask.type === "clipping") {
      const fc = fabricRef.current
      if (!fc) return
      if (mask.enabled === false) {
        obj.clipPath = null
        obj.dirty = true
      } else {
        await applyClippingMaskNative(fc, obj)
      }
      fc.requestRenderAll()
    }
  }

  async function toggleMaskInverted(obj: any) {
    if (!obj?.__maskData) return
    const mask = { ...(obj as any).__maskData, inverted: !(obj as any).__maskData.inverted }
    await applyMaskAndPersist(obj, mask)
  }

  async function removeMaskFromObject(obj: any) {
    if (!obj?.__maskData) return
    delete (obj as any).__maskData
    await applyMaskAndPersist(obj, null)
  }

  function getMaskOfSelected(): any | null {
    const fc = fabricRef.current
    const obj = fc?.getActiveObject()
    return (obj as any)?.__maskData ?? null
  }

  // Renderiza um step OFFSCREEN (sem mexer no canvas principal) e retorna o blob.
  // Usado pra gerar thumbnails de steps inativos automaticamente quando a peca
  // abre. Sem isso, o user teria que ativar cada step manualmente.
  async function renderStepOffscreenToBlob(
    step: { layers: any[]; bgColor: string; bgOpacity?: number; bgLayers?: BgLayerData[] }
  ): Promise<Blob | null> {
    const camp = campaignRef.current
    if (!camp) return null
    try {
      const w = canvasWRef.current
      const h = canvasHRef.current
      const TARGET = 2400
      const scale = Math.min(TARGET / w, TARGET / h, 1)
      const tw = Math.round(w * scale)
      const th = Math.round(h * scale)
      const fabricMod = await import("fabric") as any
      const { StaticCanvas, FabricImage, Path, Textbox, Rect } = fabricMod
      const canvasEl = document.createElement("canvas")
      canvasEl.width = tw; canvasEl.height = th
      const sfc = new StaticCanvas(canvasEl, {
        width: tw, height: th,
        enableRetinaScaling: false,
      })
      // BG layers: aplica via mesma logica do canvas principal pra suportar
      // multi-BG / gradient / image. Fallback pra step.bgColor (legacy).
      const stepBgLayers: BgLayerData[] = Array.isArray(step.bgLayers) && step.bgLayers.length > 0
        ? step.bgLayers.map(migrateBgLayerJson)
        : [{ kind: "solid", color: step.bgColor, opacity: typeof step.bgOpacity === "number" ? step.bgOpacity : 1 }]
      for (const ld of stepBgLayers) {
        if (ld.hidden) continue
        const r = new Rect({
          left: 0, top: 0, width: tw, height: th,
          selectable: false, evented: false,
        })
        await syncBgLayerToRect(r, ld, tw, th, fabricMod)
        sfc.add(r)
      }
      // Re-cria cada layer manualmente. Replica a logica de addAssetToCanvas
      // de forma minima — soh o que precisamos pra render visual.
      for (const layer of step.layers) {
        if (layer.embedded) continue
        if (!layer.assetId) continue
        const asset = camp.assets.find((a: Asset) => a.id === layer.assetId)
        if (!asset) continue
        const left = (layer.posX ?? 0) * scale
        const top = (layer.posY ?? 0) * scale
        const sx = (layer.scaleX ?? 1) * scale
        const sy = (layer.scaleY ?? 1) * scale
        const angle = layer.rotation ?? 0
        const overrides = layer.overrides ?? {}
        // PSD blend/opacity preservados no thumb. Sem isso, step thumbs (auto-gen
        // ou export) renderizam multiply/screen como "source-over" — preview
        // diferente do editor que respeita esses.
        const psdProps: any = {}
        if (typeof layer.opacity === "number" && layer.opacity < 1 && layer.opacity >= 0.01) {
          psdProps.opacity = layer.opacity
        }
        if (typeof layer.blendMode === "string" && layer.blendMode && layer.blendMode !== "source-over") {
          psdProps.globalCompositeOperation = layer.blendMode
        }
        if (asset.type === "IMAGE") {
          if (!asset.imageUrl) continue
          try {
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
              const el = new Image()
              el.crossOrigin = "anonymous"
              el.onload = () => resolve(el)
              el.onerror = () => reject(new Error("img load"))
              el.src = asset.imageUrl!
            })
            const fimg = new FabricImage(img, {
              left, top, scaleX: sx, scaleY: sy, angle,
              ...psdProps,
            })
            sfc.add(fimg)
          } catch (e) { /* skip */ }
        } else if (asset.type === "TEXT") {
          // Reconstroi text a partir do content + overrides.
          // CRITICO: aplica TODOS os overrides (fontWeight, lineHeight, leadingPt,
          // charSpacing, styles per-char) pra que o thumb reflita o que o user vê
          // no editor. Antes faltava esses — thumb exportado pro PPT saia sem
          // formatacao, mesmo com a peca formatada no editor.
          const content = typeof asset.content === "string" ? JSON.parse(asset.content) : asset.content
          const spans = Array.isArray(content) ? content : []
          const text = (typeof overrides.text === "string" ? overrides.text : spans.map((s: any) => s.text ?? "").join(""))
          const firstStyle = spans[0]?.style ?? {}
          // Width DO TEXTO precisa ser escalada pelo mesmo 'scale' do canvas
          // offscreen. fontSize idem.
          const baseFontSize = overrides.fontSize ?? firstStyle.fontSize ?? 80
          const tb = new Textbox(text || asset.label, {
            left, top, angle,
            fontFamily: overrides.fontFamily ?? firstStyle.fontFamily ?? "Arial",
            fontSize: baseFontSize * scale,
            fontWeight: overrides.fontWeight ?? firstStyle.fontWeight ?? "normal",
            fill: overrides.fill ?? firstStyle.color ?? "#111111",
            width: (layer.width ?? 400) * scale,
            textAlign: overrides.textAlign ?? "left",
            lineHeight: overrides.lineHeight ?? 1.0,
            charSpacing: overrides.charSpacing ?? 0,
            ...psdProps,
          })
          if (overrides.styles) {
            // Migra legacy flat → line-indexed (audit H10) antes de escalar.
            const migratedStyles = migrateFlatStylesToLineIndexed(text || asset.label, overrides.styles)
            // styles per-char tem fontSize na escala da peca; precisa re-escalar
            // pelo offscreen scale antes de aplicar.
            const scaledStyles: any = {}
            for (const lineKey of Object.keys(migratedStyles)) {
              scaledStyles[lineKey] = {}
              for (const colKey of Object.keys(migratedStyles[lineKey])) {
                const cs = { ...migratedStyles[lineKey][colKey] }
                if (typeof cs.fontSize === "number") cs.fontSize = cs.fontSize * scale
                scaledStyles[lineKey][colKey] = cs
              }
            }
            tb.set("styles", scaledStyles)
          }
          // leadingPt (entrelinhas em pontos) — substitui o lineHeight quando
          // setado. Conversao: lineHeight = leadingPt / fontSize.
          if (typeof overrides.leadingPt === "number" && overrides.leadingPt > 0) {
            const scaledLeading = overrides.leadingPt * scale
            const effFontSize = baseFontSize * scale
            if (effFontSize > 0) tb.set("lineHeight", leadingPtToFabricLineHeight(scaledLeading, effFontSize))
          }
          if ((tb as any).initDimensions) (tb as any).initDimensions()
          sfc.add(tb)
        }
      }
      sfc.renderAll()
      await new Promise(r => setTimeout(r, 100))
      const dataUrl = sfc.toDataURL({ format: "png", multiplier: 1 })
      sfc.dispose()
      return await (await fetch(dataUrl)).blob()
    } catch (e) {
      console.warn("[renderStepOffscreen] fail:", e)
      return null
    }
  }

  // Detecta steps sem thumbnail no piece.data e os gera offscreen.
  // Chamado ao abrir uma peca multi-step no editor. Roda em background
  // — nao trava o user.
  // Flag de controle: autoGenerate so roda uma vez por carregamento.
  const autoGenDoneRef = useRef(false)
  async function autoGenerateMissingStepThumbs() {
    if (autoGenDoneRef.current) return
    autoGenDoneRef.current = true
    if (!pieceId) return
    const p = pieceRef.current
    if (!p) return
    const pdata = typeof p.data === "string" ? JSON.parse(p.data) : (p.data ?? {})
    const allSteps: any[] = Array.isArray(pdata.steps) ? pdata.steps : []
    console.log("[autoGen] iniciando. stepCount:", allSteps.length, "isDirty:", isDirtyRef.current)
    if (allSteps.length < 2) return
    const activeIdx = pdata.activeStepIndex ?? 0
    for (let i = 0; i < allSteps.length; i++) {
      const step = allSteps[i]
      // Soh gera quem nao tem thumb. Steps que ja tem ficam quietos.
      if (step?.imageUrl) {
        console.log("[autoGen] step", i, "ja tem thumb")
        continue
      }
      // Renderiza offscreen pra todos os steps sem thumb (inclusive o ativo).
      // Antes usavamos uploadPieceThumb pro ativo, mas isso le do canvas que
      // pode estar vazio durante o init.
      console.log("[autoGen] gerando thumb pro step", i, i === activeIdx ? "(ATIVO)" : "")
      const blob = await renderStepOffscreenToBlob({
        layers: step.layers ?? [],
        bgColor: step.bgColor ?? bgColorRef.current,
      })
      if (!blob) {
        console.log("[autoGen] blob vazio pro step", i)
        continue
      }
      // CRITICO: re-busca o estado atual do banco JUSTAMENTE antes do upload.
      // Outro save (do user) pode ter gerado um thumb melhor pra este step.
      // Se ja tem imageUrl agora, NAO sobrescreve.
      try {
        const freshRes = await fetch(`/api/pieces/${pieceId}`, { cache: "no-store" })
        const freshPiece = await freshRes.json()
        const freshData = typeof freshPiece.data === "string" ? JSON.parse(freshPiece.data) : (freshPiece.data ?? {})
        const freshStep = Array.isArray(freshData.steps) ? freshData.steps[i] : null
        if (freshStep?.imageUrl) {
          console.log("[autoGen] step", i, "ja tem thumb no banco (gerado por outro save) — pulando")
          continue
        }
      } catch (e) { /* segue mesmo se a checagem falhar */ }
      const fd = new FormData()
      fd.append("thumbnail", blob, `step${i}.png`)
      try {
        await fetch(`/api/pieces/${pieceId}/step-thumbnail?index=${i}`, { method: "POST", body: fd })
        console.log("[autoGen] thumb upload OK step", i)
      } catch (e) { console.warn("[auto thumb] upload fail step", i, e) }
    }
  }

  // Gera o blob de thumbnail do canvas atual (PNG 2400px max).
  // Separado de uploadPieceThumb pra reuso (upload de step thumb tambem).
  async function generateCurrentThumbBlob(fc: any): Promise<Blob | null> {
    try {
      const w = canvasWRef.current
      const h = canvasHRef.current
      const TARGET = 2400
      const thumbScale = Math.min(TARGET / w, TARGET / h, 1)

      // O canvas Fabric do editor eh GRANDE (fullW x fullH ~ painel do editor)
      // com a peca centralizada via viewportTransform. Sem bounds explicitos,
      // toDataURL capturava o canvas inteiro -> thumb saia com area de bleed
      // ao redor da peca + objetos perto da borda saindo cortados.
      //
      // Fix: calcular regiao da peca em coords do canvas DOM:
      //   mundo Fabric (0,0,w,h) -> canvas DOM (vt[4], vt[5], w*z, h*z)
      // onde z = vt[0] (zoom atual).
      const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
      const z = vt[0] ?? 1
      const offsetX = vt[4] ?? 0
      const offsetY = vt[5] ?? 0

      // Esconde temporariamente o bleed overlay
      const bleedOverlays = fc.getObjects().filter((o: any) => o.__isBleedOverlay)
      bleedOverlays.forEach((o: any) => { o.visible = false })
      try {
        const dataUrl = fc.toDataURL({
          format: "png",
          // multiplier dividido por z compensa o zoom — resultado: PNG com
          // exatamente w*thumbScale x h*thumbScale (proporcao da peca).
          multiplier: thumbScale / z,
          enableRetinaScaling: false,
          left: offsetX,
          top: offsetY,
          width: w * z,
          height: h * z,
        })
        const blob = await (await fetch(dataUrl)).blob()
        console.log("[thumb] gerado", blob.size, "bytes", `${Math.round(w * thumbScale)}x${Math.round(h * thumbScale)}`)
        srvLog("thumb-GENERATED", { bytes: blob.size, w: Math.round(w * thumbScale), h: Math.round(h * thumbScale), objects: fc.getObjects().length })
        return blob
      } finally {
        bleedOverlays.forEach((o: any) => { o.visible = true })
        fc.requestRenderAll()
      }
    } catch (e: any) {
      console.error("[generateCurrentThumbBlob] FALHOU:", e)
      srvLog("thumb-FAILED", { error: String(e?.message ?? e), stack: e?.stack?.split("\n").slice(0, 4).join(" | ") })
      return null
    }
  }

  // Regenera + sobe o thumbnail do KV (matriz) sem persistir layers. Usado no
  // auto-regen-on-open: garante preview da apresentacao/cards sempre atualizado
  // mesmo se o usuario nao editou nada nesta sessao.
  async function uploadMatrixThumb(fc: any) {
    try {
      const thumbScale = Math.min(1920 / canvasWRef.current, 1920 / canvasHRef.current, 1)
      const z = zoomRef.current || 1
      const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
      const offsetX = vt[4] ?? 0
      const offsetY = vt[5] ?? 0
      const dataUrl = fc.toDataURL({
        // PNG (nao JPEG): preserva o canal alpha quando a peca tem mascaras
        // raster com transparencia ou bg transparente. JPEG flatava tudo
        // pra cor solida — apresentacao perdia o look correto.
        format: "png",
        multiplier: thumbScale / z,
        left: offsetX, top: offsetY,
        width: canvasWRef.current * z,
        height: canvasHRef.current * z,
      })
      const blob = await (await fetch(dataUrl)).blob()
      const fd = new FormData()
      fd.append("thumbnail", blob, "kv-thumb.png")
      await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: fd })
      // Broadcast cross-tab pra preview em outras paginas (campanhas list,
      // dashboard) refetch o KV thumb atualizado.
      try {
        if (typeof BroadcastChannel !== "undefined") {
          const bc = new BroadcastChannel("zzosy:campaigns")
          bc.postMessage({ type: "kv-updated", campaignId, ts: Date.now() })
          bc.close()
        }
      } catch {}
    } catch (e) { console.warn("[uploadMatrixThumb] fail:", e) }
  }

  async function uploadPieceThumb(fc: any, pId: string) {
    console.log("[uploadPieceThumb] inicio pra", pId)
    srvLog("uploadPieceThumb-START", { pieceId: pId, stepCount: stepCountRef.current, activeStep: activeStepIndexRef.current })
    const blob = await generateCurrentThumbBlob(fc)
    if (!blob) {
      console.error("[uploadPieceThumb] ABORTADO — blob veio null!")
      srvLog("uploadPieceThumb-ABORTED", "blob veio null")
      return
    }
    console.log("[uploadPieceThumb] blob ok,", blob.size, "bytes. Subindo...")
    srvLog("uploadPieceThumb-BLOB-OK", { bytes: blob.size })
    const fd = new FormData()
    fd.append("thumbnail", blob, "thumb.png")
    try {
      // SEM keepalive: o navegador limita body de keepalive em ~64KB.
      // Thumbs costumam passar disso (70+ KB). Sem keepalive precisamos
      // garantir que await termina antes de window.location.href navegar
      // (responsabilidade do caller — Voltar handler ja faz isso).
      const r = await fetch(`/api/pieces/${pId}/thumbnail`, { method: "POST", body: fd })
      console.log("[uploadPieceThumb] thumb principal status:", r.status)
      srvLog("uploadPieceThumb-MAIN-STATUS", { status: r.status })
    } catch (e: any) {
      console.warn("[uploadPieceThumb] main thumb failed:", e)
      srvLog("uploadPieceThumb-MAIN-FAIL", { error: String(e?.message ?? e) })
    }
    // STEPS: se a peca tem multiplos steps, atualiza tambem o thumb do step ativo.
    if (stepCountRef.current > 1) {
      const fd2 = new FormData()
      fd2.append("thumbnail", blob, `step${activeStepIndexRef.current}.png`)
      try {
        const r2 = await fetch(`/api/pieces/${pId}/step-thumbnail?index=${activeStepIndexRef.current}`, {
          method: "POST", body: fd2,
        })
        srvLog("uploadPieceThumb-STEP-STATUS", { index: activeStepIndexRef.current, status: r2.status })
      } catch (e: any) {
        console.warn("[uploadPieceThumb] step thumb failed:", e)
        srvLog("uploadPieceThumb-STEP-FAIL", { error: String(e?.message ?? e) })
      }
    }
    // Broadcast pra OUTRAS ABAS (lista de pecas, apresentacao) atualizarem
    // preview em tempo real. BroadcastChannel funciona same-origin entre tabs
    // sem precisar de server push. Listener em /pieces refetch imediato.
    try {
      if (typeof BroadcastChannel !== "undefined") {
        const bc = new BroadcastChannel("zzosy:pieces")
        bc.postMessage({ type: "piece-updated", pieceId: pId, campaignId, ts: Date.now() })
        bc.close()
      }
    } catch {}
  }

  // Helper: envia log do client pro terminal do servidor (pra debug fica
  // visivel sem F12). Best-effort: nao espera resposta, nao quebra se falhar.
  function srvLog(tag: string, data: any) {
    try {
      fetch("/api/debug/client-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, data }),
        keepalive: true,
      }).catch(() => {})
    } catch {}
  }

  async function saveNow() {
    clearTimeout(saveTimer.current)
    srvLog("saveNow-CALLED", { pieceId, isDirty: isDirtyRef.current, savingInFlight: savingInFlightRef.current })
    // Guards: nao salva durante apply de historico, nem antes do init terminar.
    // Sem isso, fechar a aba durante remount podia gravar layers em estado
    // transitorio (sem __assetId restaurados) -> KV vazia/quebrada.
    if (isApplyingHistory.current) {
      editorLog("[saveNow] abortado — undo/redo em andamento")
      srvLog("saveNow-SKIPPED", "applying history")
      return
    }
    if (!isInitialized.current) {
      editorLog("[saveNow] abortado — init nao terminou")
      srvLog("saveNow-SKIPPED", "init nao terminou")
      return
    }
    // Trava de reentrada: se outro saveNow ja esta rodando, ESPERA ele terminar
    // antes de comecar este. Antes abortava silenciosamente, mas isso causava
    // bug grave no fluxo "Voltar pra apresentacao":
    //   1. User edita -> debounce 800ms agenda auto-save
    //   2. Auto-save comeca (PATCH lento, upload thumb pendente)
    //   3. User clica Voltar -> saveNow() chamado -> abortava
    //   4. window.location.href acontece ANTES do auto-save terminar upload
    //   5. Thumb nunca era subido -> preview na apresentacao nao atualizava
    if (savingInFlightRef.current) {
      editorLog("[saveNow] aguardando save anterior terminar...")
      // Espera ate 5s pelo save anterior. Polling simples.
      const startWait = Date.now()
      while (savingInFlightRef.current && Date.now() - startWait < 5000) {
        await new Promise(r => setTimeout(r, 50))
      }
      if (savingInFlightRef.current) {
        editorLog("[saveNow] timeout esperando save anterior — abortando")
        return
      }
    }
    savingInFlightRef.current = true
    setSaving(true)
    // Flush sincrono de PUTs de asset pendentes ANTES de gravar peca/KV.
    // Sem isso, layer.overrides poderia referenciar template antigo do asset
    // (lastOverride debounceado nao subiu ainda) — proxima peca gerada herda
    // o estado errado.
    try { await flushPendingAssetPuts() } catch {}
    // Snapshot dos refs ALVO desta operacao. Se o user navegar pra outra peca
    // no meio, este save ainda persistira a peca onde a edicao foi feita
    // (em vez de gravar dados antigos sobre a peca nova).
    const targetPieceId = pieceId
    const targetPiece = pieceRef.current
    const fc = fabricRef.current
    if (!fc) { savingInFlightRef.current = false; setSaving(false); return }
    if (targetPieceId && targetPiece) {
      const p = targetPiece
      const oldData = typeof p.data === "string" ? JSON.parse(p.data) : (p.data ?? {})
      const newLayers = fc.getObjects()
        .filter((o: any) => {
          if (o.__isBg) return false
          if ((o as any).__isStrokeGhost === true) return false
          if (!o.__assetId) {
            editorLog("[PIECE-SAVE-NOW] objeto sem __assetId BLOQUEADO:", {
              type: o.type, text: (o as any).text?.slice(0, 30),
              left: o.left, top: o.top,
            })
            return false
          }
          return true
        })
        .map((o: any, i: number) => {
          const layer: any = {
            assetId: o.__assetId,
            posX: Math.round(o.left ?? 0), posY: Math.round(o.top ?? 0),
            scaleX: o.scaleX ?? 1, scaleY: o.scaleY ?? 1,
            rotation: o.angle ?? 0, zIndex: i,
            width: Math.round(o.width ?? 400), height: Math.round(o.height ?? 100),
            overrides: {},
          }
          // Metadados PSD (mask/hidden/locked/opacity/blendMode/effects/
          // nameSource/groupPath) via helper centralizado. Era duplicado em
          // 4 sites — qualquer novo metadato PSD entra so no helper agora.
          applyPsdLayerMetadata(o, layer)
          if (o.type === "textbox" || o.type === "i-text") {
            // PECA: caracteres (asset.content) continuam vindo do asset, MAS quebras
            // de linha (\n) e edicoes locais ficam em overrides per-instancia.
            // serializeTextboxOverrides eh a fonte unica de verdade — qualquer prop
            // nova adicionada la propaga automaticamente pros 6 sites.
            Object.assign(layer.overrides, serializeTextboxOverrides(o, { preserveExplicitNewlinesOnly: true }))
          } else if ((o as any).__isShape === true || o.type === "path" || o.type === "Path") {
            // SHAPE override via helper centralizado.
            Object.assign(layer.overrides, serializeShapeOverrides(o))
          }
          return layer
        })
      const newData: any = { ...oldData, version: 2, width: canvasWRef.current, height: canvasHRef.current, bgColor: bgColorRef.current, bgOpacity: bgOpacityRef.current, bgLayers: bgLayersRef.current, layers: newLayers }
      // (bgOpacity acima persiste a opacidade do BG no piece.data — back-compat:
      // peças antigas sem o campo são tratadas como 1.0 no load)
      // STEPS: mesmo tratamento do performSave. Sem isso, "Salvar e sair"
      // gravaria a peca SEM o campo steps, destruindo todos os steps inativos.
      if (stepCountRef.current > 1) {
        const fullSteps: any[] = []
        let inactiveCursor = 0
        // Le oldData.steps pra preservar imageUrl do step ativo no save.
        // Sem isso, toda vez que o user salva, o imageUrl do step ativo
        // some (o save sobrescreve com {layers, bgColor} sem imageUrl).
        const oldSteps: any[] = Array.isArray(oldData.steps) ? oldData.steps : []
        // Fallback: peca era single-step (sem data.steps), thumb esta em piece.imageUrl.
        const pieceImgFallback = (!oldSteps.length) ? ((pieceRef.current as any)?.imageUrl ?? null) : null
        for (let i = 0; i < stepCountRef.current; i++) {
          if (i === activeStepIndexRef.current) {
            const oldActive = oldSteps[i] ?? {}
            fullSteps.push({
              layers: newLayers,
              bgColor: bgColorRef.current, bgOpacity: bgOpacityRef.current, bgLayers: bgLayersRef.current,
              // Preserva imageUrl/thumbnailUrl gerados anteriormente. O upload
              // do thumb novo (uploadPieceThumb após o save) sobrescreve esses.
              imageUrl: oldActive.imageUrl ?? (i === 0 ? pieceImgFallback : null),
              thumbnailUrl: oldActive.thumbnailUrl ?? (i === 0 ? pieceImgFallback : null),
            })
          } else {
            fullSteps.push(inactiveStepsRef.current[inactiveCursor] ?? { layers: [], bgColor: "#ffffff" })
            inactiveCursor++
          }
        }
        newData.steps = fullSteps
        newData.activeStepIndex = activeStepIndexRef.current
      } else {
        delete newData.steps
        delete newData.activeStepIndex
      }
      try {
        // Fix #12: marca isDirty=false APENAS apos o PATCH ter sucesso. Se o usuario
        // fechar a aba durante o upload, ainda mostra "salvando" e nao perde o
        // estado "dirty" silenciosamente.
        await fetch(`/api/pieces/${targetPieceId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: JSON.stringify(newData) }) })
        // CRITICO: atualiza pieceRef.current.data pra refletir o save. Sem isso,
        // serializeCurrentStep continua lendo data antigo do banco e pode perder
        // imageUrl que ja foi gravado no banco mas nao no ref local.
        if (pieceRef.current) {
          pieceRef.current = { ...pieceRef.current, data: JSON.stringify(newData) } as any
        }
        // Upload do thumb e best-effort; falha nao deve marcar como dirty de novo
        // mas o save da peca em si ja persistiu.
        try {
          srvLog("saveNow-PRE-UPLOAD", { pieceId: targetPieceId, isDirty: isDirtyRef.current })
          await uploadPieceThumb(fc, targetPieceId)
          srvLog("saveNow-POST-UPLOAD", { pieceId: targetPieceId })
          // Re-fetch pieceRef pra pegar o imageUrl novo dos steps (gravado por
          // uploadPieceThumb). Sem isso, switchToStep posterior usa imageUrl
          // null e perde o thumb que acabou de ser gerado.
          try {
            const r = await fetch(`/api/pieces/${targetPieceId}`, { cache: "no-store" })
            if (r.ok) {
              const fresh = await r.json()
              if (pieceRef.current) pieceRef.current = fresh
            }
          } catch (e) { /* nao critico */ }
        } catch (e) { console.warn("thumb fail:", e) }
        isDirtyRef.current = false
        setIsDirty(false)
      } catch (e) {
        console.warn("[saveNow PECA] falha no PATCH:", e)
        // Mantem isDirty=true pro user saber que nao salvou
      }
    } else {
      const layersToSave: Layer[] = fc.getObjects()
        .filter((o: any) => {
          if (o.__isBg) return false
          if ((o as any).__isStrokeGhost === true) return false
          // Bloqueia save de objetos sem __assetId — antes salvava com "" e o load
          // descartava silenciosamente, fazendo o canvas voltar vazio (bug grave de
          // perda de conteudo). Se acontecer, logamos pra detectar a causa-raiz.
          if (!o.__assetId) {
            editorLog("[SAVE-MATRIX] objeto sem __assetId ignorado no save:", o.type, { left: o.left, top: o.top, text: (o as any).text })
            return false
          }
          return true
        })
        .map((o: any, i: number) => {
          const layer: any = {
            assetId: o.__assetId,
            posX: Math.round(o.left ?? 0), posY: Math.round(o.top ?? 0),
            scaleX: o.scaleX ?? 1, scaleY: o.scaleY ?? 1,
            rotation: o.angle ?? 0, zIndex: i,
            width: Math.round(o.width ?? 400),
            height: Math.round((o.height ?? 300) * (o.scaleY ?? 1)),
            overrides: {},
          }
          // Metadados PSD via helper centralizado. MATRIZ tambem loga warning
          // quando mask vem ausente (era o bug do auto-save apagando masks
          // do PSD logo apos import).
          if (!(o as any).__maskData) {
            srvLog("save-MATRIX-no-mask", {
              assetLabel: (o as any).__assetLabel ?? "?",
              type: o.type,
              hasClipPath: !!o.clipPath,
            })
          }
          applyPsdLayerMetadata(o, layer)
          // DEBUG: log do que tah indo pra matriz
          console.log("[SAVE-MATRIX] layer", i, "type:", o.type, "label:", o.__assetLabel, "fill:", o.fill, "stroke:", o.stroke, "strokeWidth:", o.strokeWidth, "psdEffects:", o.__psdEffects, "__hidden:", o.__hidden, "__locked:", o.__locked)
          // Espelha a logica do modo PECA: salva overrides per-instancia (fill,
          // fontSize, styles per-char, leadingPt, etc) pra preservar formatacao
          // ao alternar entre KV/Assets/Campanha. Sem isso, recarregar o KV
          // perdia mudancas de estilo (estilos sao salvos no asset.content e
          // sobrescritos por overrides do layer).
          if (o.type === "textbox" || o.type === "i-text") {
            // MATRIZ: caracteres vem do asset (updateAssetContent propaga). \n
            // local em overrides.text preserva quebra entre reloads sem vazar
            // pro asset. Toda outra prop via helper centralizado.
            Object.assign(layer.overrides, serializeTextboxOverrides(o, { preserveExplicitNewlinesOnly: true }))
          } else if ((o as any).__isShape === true || o.type === "path" || o.type === "Path") {
            // SHAPE override (matriz) via helper centralizado.
            Object.assign(layer.overrides, serializeShapeOverrides(o))
          }
          return layer
        })
      // Circuit breaker (mesma logica do doSave): nao grava matriz vazia sobre KV que tinha layers
      if (layersToSave.length === 0) {
        const previousLayers = (campaignRef.current?.keyVision?.layers as any) ?? []
        const hadLayers = Array.isArray(previousLayers) && previousLayers.length > 0
        if (hadLayers) {
          editorLog("[saveNow MATRIX] abortado — tentaria gravar layers:[] sobre KV que tinha", previousLayers.length, "layers. Provavel race condition.")
          isDirtyRef.current = false
          setIsDirty(false)
          setSaving(false)
          savingInFlightRef.current = false
          return
        }
      }
      await fetch(`/api/campaigns/${campaignId}/key-vision`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bgColor: bgColorRef.current, bgOpacity: bgOpacityRef.current, bgLayers: bgLayersRef.current, layers: layersToSave, width: canvasWRef.current, height: canvasHRef.current }) })
      try {
        // Thumb HIGH-RES (1920px max, JPEG 0.92). 480/0.85 ficava pixelado no
        // preview de apresentacao e PPTX (slide widescreen tem 960px de largura
        // a 72 DPI; pptxgenjs escala thumb pra 8-12" -> ampliacao 8x).
        const thumbScale = Math.min(1920 / canvasWRef.current, 1920 / canvasHRef.current, 1)
        // CROP da area da peca. toDataURL aceita left/top/width/height em
        // coords do CANVAS DOM (px do canvas HTML). A peca renderiza
        // centralizada via viewportTransform[4,5] (offset). Le o offset real
        // pra cortar exatamente a regiao da peca.
        const z = zoomRef.current || 1
        const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
        const offsetX = vt[4] ?? 0
        const offsetY = vt[5] ?? 0
        const dataUrl = fc.toDataURL({
          // PNG preserva alpha (ver comentario em uploadMatrixThumb).
          format: "png",
          multiplier: thumbScale / z,
          left: offsetX,
          top: offsetY,
          width: canvasWRef.current * z,
          height: canvasHRef.current * z,
        })
        const blob = await (await fetch(dataUrl)).blob()
        const fd = new FormData()
        fd.append("thumbnail", blob, "kv-thumb.png")
        await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: fd })
        // Broadcast pro /presentation e /pieces refrescarem sem esperar polling
        // de 6s (audit H7). saveNow inlinava o upload sem chamar uploadMatrixThumb
        // — listeners ficavam stale.
        try {
          if (typeof BroadcastChannel !== "undefined") {
            const bc = new BroadcastChannel("zzosy:campaigns")
            bc.postMessage({ type: "kv-updated", campaignId, ts: Date.now() })
            bc.close()
          }
        } catch {}
      } catch (e) { console.warn("KV thumb upload failed:", e) }
    }
    isDirtyRef.current = false
    setIsDirty(false)
    setSaving(false)
    savingInFlightRef.current = false
  }

  // ============================================================
  // STEPS MANAGEMENT — carrosseis, sequencias, posts de varios cards
  // ============================================================

  // Serializa o canvas ATUAL no formato {layers, bgColor} pra salvar como
  // snapshot em inactiveStepsRef. Replica a logica do performSave modo peca.
  function serializeCurrentStep(): { layers: any[]; bgColor: string; bgOpacity: number; bgLayers: BgLayerData[]; imageUrl?: string | null; thumbnailUrl?: string | null } {
    const fc = fabricRef.current
    if (!fc) return { layers: [], bgColor: bgColorRef.current, bgOpacity: bgOpacityRef.current, bgLayers: bgLayersRef.current }
    const layers = fc.getObjects()
      .filter((o: any) => {
        if (o.__isBg) return false
          if ((o as any).__isStrokeGhost === true) return false
        if (o.__isBleedOverlay) return false
        if (!o.__assetId && !o.__embedded) return false
        return true
      })
      .map((o: any, i: number) => {
        const layer: any = {
          posX: Math.round(o.left ?? 0),
          posY: Math.round(o.top ?? 0),
          scaleX: o.scaleX ?? 1,
          scaleY: o.scaleY ?? 1,
          rotation: o.angle ?? 0,
          zIndex: i,
          width: Math.round(o.width ?? 400),
          height: Math.round(o.height ?? 100),
          overrides: {},
        }
        if (o.__assetId) layer.assetId = o.__assetId
        if (o.__hidden === true) layer.hidden = true
        if (o.__locked === true) layer.locked = true
        if (o.__embedded) {
          layer.embedded = true
          layer.embeddedData = o.__embeddedData ?? null
        }
        // Overrides per-step: helper centralizado captura tudo.
        if (o.type === "textbox" || o.type === "i-text") {
          Object.assign(layer.overrides, serializeTextboxOverrides(o, { preserveExplicitNewlinesOnly: true }))
        }
        if (o.__mask) layer.mask = o.__mask
        return layer
      })
    // CRITICO: preserva imageUrl/thumbnailUrl do banco pro step ATIVO. Sem isso,
    // toda vez que o user troca de step, o snapshot do step que era ativo
    // entra no buffer dos inativos SEM imageUrl. O save depois persiste null
    // -> preview some na apresentacao.
    const p = pieceRef.current as any
    const pdata = p?.data ? (typeof p.data === "string" ? JSON.parse(p.data) : p.data) : {}
    const oldSteps: any[] = Array.isArray(pdata.steps) ? pdata.steps : []
    const oldActive = oldSteps[activeStepIndexRef.current] ?? {}
    // Fallback: se a peca era SINGLE-STEP (sem data.steps no banco), o thumb
    // ja gerado esta em piece.imageUrl. Usar isso como imageUrl do step ativo
    // quando transitamos pra multi-step pela primeira vez (ex: addStep).
    const fallbackImg = (!oldSteps.length && activeStepIndexRef.current === 0) ? (p?.imageUrl ?? null) : null
    return {
      layers,
      bgColor: bgColorRef.current, bgOpacity: bgOpacityRef.current, bgLayers: bgLayersRef.current,
      imageUrl: oldActive.imageUrl ?? fallbackImg,
      thumbnailUrl: oldActive.thumbnailUrl ?? fallbackImg,
    }
  }

  // Aplica um step {layers, bgColor} no canvas: limpa tudo e re-cria.
  async function loadStepIntoCanvas(step: { layers: any[]; bgColor: string; bgOpacity?: number; bgLayers?: BgLayerData[] }) {
    const fc = fabricRef.current
    const camp = campaignRef.current
    if (!fc || !camp) return
    // Marca que esta aplicando para guards nao salvarem durante load
    isApplyingHistory.current = true
    try {
      // Limpa TODOS os objetos (inclusive BGs) exceto bleed overlay — vamos
      // recriar os BGs do step abaixo.
      const toRemove = fc.getObjects().filter((o: any) => !o.__isBleedOverlay)
      toRemove.forEach((o: any) => fc.remove(o))
      // Migra legacy → bgLayers (preserva kind: solid/gradient/image)
      const stepBgLayers: BgLayerData[] = Array.isArray(step.bgLayers) && step.bgLayers.length > 0
        ? step.bgLayers.map(migrateBgLayerJson)
        : [{ kind: "solid", color: step.bgColor, opacity: typeof step.bgOpacity === "number" ? step.bgOpacity : 1 }]
      bgLayersRef.current = stepBgLayers
      // Atualiza espelhos legacy (BG[0]) — bgColor representativo so faz sentido pra solid
      bgColorRef.current = bgLayerLegacyColor(stepBgLayers[0])
      setBgColor(bgLayerLegacyColor(stepBgLayers[0]))
      bgOpacityRef.current = stepBgLayers[0].opacity
      setBgOpacity(stepBgLayers[0].opacity)
      // Re-cria todos os Rects BG
      const fabricMod: any = await import("fabric")
      const { Rect } = fabricMod
      const newBgRects: any[] = []
      for (let i = 0; i < stepBgLayers.length; i++) {
        const ld = stepBgLayers[i]
        const r = new Rect({
          left: 0, top: 0, width: canvasWRef.current, height: canvasHRef.current,
          selectable: true, evented: true,
          hasControls: false, hasBorders: true,
          lockMovementX: true, lockMovementY: true,
          lockScalingX: true, lockScalingY: true, lockRotation: true,
          excludeFromExport: true,
        })
        await syncBgLayerToRect(r, ld, canvasWRef.current, canvasHRef.current, fabricMod)
        ;(r as any).__isBg = true
        ;(r as any).__bgIdx = i
        ;(r as any).__assetLabel = i === 0 ? "Background" : `Background ${i + 1}`
        ;(r as any).__hidden = ld.hidden === true
        ;(r as any).__locked = ld.locked === true
        fc.add(r)
        newBgRects.push(r)
      }
      bgRectsRef.current = newBgRects
      bgRef.current = newBgRects[0]
      for (let i = newBgRects.length - 1; i >= 0; i--) fc.sendObjectToBack(newBgRects[i])
      // Re-cria layers.
      for (const layer of step.layers) {
        if (layer.embedded) {
          // Embedded: cria o objeto cru a partir de embeddedData.
          // Pra simplicidade, pula no minimo viavel — depois melhoramos.
          continue
        }
        if (!layer.assetId) continue
        const asset = camp.assets.find((a: Asset) => a.id === layer.assetId)
        if (!asset) continue
        await addAssetToCanvas(fc, asset, layer)
        const created = fc.getObjects()[fc.getObjects().length - 1]
        if (created) applyHiddenLockedToObject(created, layer)
      }
      fc.renderAll()
      refreshLayers(fc)
    } finally {
      isApplyingHistory.current = false
    }
  }

  async function switchToStep(newIndex: number) {
    if (newIndex < 0 || newIndex >= stepCountRef.current) return
    if (newIndex === activeStepIndexRef.current) return
    // 1. Serializa step atual no inactiveStepsRef na posicao certa.
    const currentSnapshot = serializeCurrentStep()
    // Reconstroi o array completo de steps incluindo o atual.
    const fullSteps: any[] = []
    let cursor = 0
    for (let i = 0; i < stepCountRef.current; i++) {
      if (i === activeStepIndexRef.current) fullSteps.push(currentSnapshot)
      else { fullSteps.push(inactiveStepsRef.current[cursor]); cursor++ }
    }
    // 2. Carrega o novo step.
    await loadStepIntoCanvas(fullSteps[newIndex])
    // 3. Atualiza o buffer: remove o novo step (agora ativo) e mantem os outros.
    const newInactive = fullSteps.filter((_, i) => i !== newIndex)
    inactiveStepsRef.current = newInactive
    setActiveStepIndexSync(newIndex)
    isDirtyRef.current = true
    await doSaveNow()
  }

  async function addStep() {
    // Adiciona novo step no fim, copiando o conteudo do ATIVO atual,
    // e ATIVA o novo step automaticamente (user vai ver/editar ele direto).
    const newStepIndex = stepCountRef.current // 0-indexed; novo step ocupa esse indice
    console.log("[addStep] inicio. stepCount:", stepCountRef.current, "newStepIndex:", newStepIndex)
    // Gera thumb do canvas atual (sera o thumb inicial do novo step E
    // do step que era ativo, ja que sao copias visuais identicas no momento).
    const fc = fabricRef.current
    let currentBlob: Blob | null = null
    if (fc) {
      currentBlob = await generateCurrentThumbBlob(fc)
    }
    // Snapshot do step que era ATIVO (sera empurrado pro buffer).
    const previousActiveSnapshot = serializeCurrentStep()
    // Inclui no buffer o step antigo na posicao do activeIndex atual.
    // (Antes ele estava "fora" do buffer porque era o ativo).
    const previousActiveIndex = activeStepIndexRef.current
    const newBuffer = [...inactiveStepsRef.current]
    newBuffer.splice(previousActiveIndex, 0, previousActiveSnapshot)
    inactiveStepsRef.current = newBuffer
    // Aumenta count e troca ativo pro novo (que ainda nao foi adicionado ao
    // buffer porque agora ELE eh o ativo no canvas).
    setStepCountSync(c => c + 1)
    setActiveStepIndexSync(newStepIndex)
    isDirtyRef.current = true
    // O canvas NAO precisa ser recarregado — eh o mesmo conteudo (cópia).
    await doSaveNow()
    console.log("[addStep] save terminou. Step novo agora eh o ativo:", newStepIndex)
    // Sobe thumb pro novo step (que agora eh ativo).
    if (currentBlob && pieceId) {
      const fd = new FormData()
      fd.append("thumbnail", currentBlob, `step${newStepIndex}.png`)
      try {
        const r = await fetch(`/api/pieces/${pieceId}/step-thumbnail?index=${newStepIndex}`, {
          method: "POST", body: fd, keepalive: true,
        })
        console.log("[addStep] thumb upload status:", r.status)
      } catch (e) { console.warn("[addStep] thumb upload falhou:", e) }
      // Re-fetch pieceRef
      try {
        const r = await fetch(`/api/pieces/${pieceId}`, { cache: "no-store" })
        if (r.ok) {
          const fresh = await r.json()
          if (pieceRef.current) pieceRef.current = fresh
        }
      } catch (e) {}
    }
  }

  // Substitui o conteudo do step ATIVO por um PSD. Cada layer do PSD com nome
  // que bater (case-insensitive) com asset.label dum CampaignAsset existente
  // vira um layer linkado ao asset (mesma logica do PsdImporter da matriz).
  //
  // Filosofia: import PSD = OVERRIDE TOTAL da peca.
  //  - BG: extraido do PSD (cor solida do layer "Background" top-level; fallback
  //    pixel central do composite).
  //  - Layers matched: posicao, dimensoes, fonte, peso, tamanho e cor vem do PSD
  //    (vao pra layer.overrides). O texto CRU continua vindo do asset.content[]
  //    (essa eh a UNICA excecao — assets sao fonte da verdade pro conteudo
  //    textual; PSD so determina onde/como aparece).
  //  - Layers sem match: IGNORADAS (precisam virar asset em /assets antes).

  // Persistência do handle da pasta raiz pra organizar PSDs externos em
  // hierarquia (cliente/campanha/veiculo/midia/peca.psd). User escolhe a
  // pasta raiz UMA vez (showDirectoryPicker) — handle persistido em
  // IndexedDB. Próximas chamadas reusam a mesma pasta.
  async function idbGet(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("zzosy-handles", 1)
      req.onupgradeneeded = () => req.result.createObjectStore("h")
      req.onsuccess = () => {
        try {
          const db = req.result
          const tx = db.transaction("h", "readonly")
          const g = tx.objectStore("h").get(key)
          g.onsuccess = () => resolve(g.result)
          g.onerror = () => reject(g.error)
        } catch (e) { reject(e) }
      }
      req.onerror = () => reject(req.error)
    })
  }
  async function idbSet(key: string, value: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("zzosy-handles", 1)
      req.onupgradeneeded = () => req.result.createObjectStore("h")
      req.onsuccess = () => {
        try {
          const db = req.result
          const tx = db.transaction("h", "readwrite")
          tx.objectStore("h").put(value, key)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        } catch (e) { reject(e) }
      }
      req.onerror = () => reject(req.error)
    })
  }

  async function ensurePsdRootDir(force = false): Promise<any | null> {
    if (!force) {
      let cached: any = null
      try { cached = await idbGet("psd-root-dir") } catch {}
      if (cached) {
        try {
          const p = await cached.queryPermission({ mode: "readwrite" })
          if (p === "granted") return cached
          const r = await cached.requestPermission({ mode: "readwrite" })
          if (r === "granted") return cached
        } catch {}
      }
    }
    try {
      const h = await (window as any).showDirectoryPicker({
        mode: "readwrite",
        startIn: "documents",
      })
      await idbSet("psd-root-dir", h)
      return h
    } catch { return null }
  }

  // Editar externamente: exporta o PSD da peça pro disco do user, criando
  // a hierarquia cliente/campanha/veiculo/midia/peca.psd automaticamente.
  // Browsers em sandbox não podem ABRIR Photoshop — user tem que abrir
  // manualmente. Sync depois via re-leitura do file handle persistido.
  async function openInExternalApp(forceNewRoot = false) {
    if (!pieceId || !pieceRef.current) {
      alert("Disponível apenas pra peças geradas (não pra matriz)")
      return
    }
    const piece = pieceRef.current
    const camp = campaignRef.current
    try {
      // Sanitiza nomes pra filesystem (remove chars proibidos em paths)
      const safe = (s: string | undefined | null) =>
        (s ?? "").replace(/[\\/:*?"<>| -]+/g, "_").trim() || "Sem nome"
      // Busca info de MediaFormat (vehicle/media) — não vem direto no piece
      let vehicle = "Sem veiculo"
      let media = "Sem midia"
      const mfId = (piece as any).mediaFormatId
      if (mfId) {
        try {
          const r = await fetch("/api/medias", { cache: "no-store" })
          if (r.ok) {
            const all = await r.json()
            const mf = Array.isArray(all) ? all.find((m: any) => m.id === mfId) : null
            if (mf) {
              vehicle = mf.vehicle || vehicle
              media = mf.media || media
            }
          }
        } catch (e) { console.warn("[external-edit] fetch medias falhou:", e) }
      }
      const { exportPSDBlob } = await import("@/lib/exportPiece")
      const data = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
      const blob = await exportPSDBlob({
        id: piece.id, name: piece.name ?? "Peça",
        data,
        width: canvasWRef.current, height: canvasHRef.current,
      })
      const fileName = `${safe(piece.name)}.psd`
      const supportsFSA = typeof window !== "undefined" && "showDirectoryPicker" in window
      if (supportsFSA) {
        const root = await ensurePsdRootDir(forceNewRoot)
        if (!root) { return /* user cancelou */ }
        // Cria subfolders: client / campanha / veiculo / midia
        const clientName = safe(camp?.client?.name ?? "Cliente")
        const campName = safe(camp?.name ?? "Campanha")
        const vehName = safe(vehicle)
        const mediaName = safe(media)
        const clientDir = await root.getDirectoryHandle(clientName, { create: true })
        const campDir = await clientDir.getDirectoryHandle(campName, { create: true })
        const vehDir = await campDir.getDirectoryHandle(vehName, { create: true })
        const mediaDir = await vehDir.getDirectoryHandle(mediaName, { create: true })
        const fileHandle = await mediaDir.getFileHandle(fileName, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()
        externalPsdHandle.current = fileHandle
        setExternalPsdName(fileName)
        const path = `${clientName} / ${campName} / ${vehName} / ${mediaName} / ${fileName}`
        alert(`PSD salvo em:\n${path}\n\n1. Abra o arquivo no Photoshop\n2. Edite + salve (Cmd+S)\n3. Volta e clica em Sync`)
      } else {
        // Fallback: download
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url; a.download = fileName
        document.body.appendChild(a); a.click()
        setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 100)
        alert(`PSD baixado: ${fileName}\n\nSeu browser não suporta sync automático (use Chrome ou Edge).\nDepois de editar no Photoshop, re-importe o arquivo via "PSD".`)
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return
      console.error("[external-edit] falha:", e)
      alert("Erro ao exportar PSD: " + (e?.message ?? e))
    }
  }

  // Sync: re-lê o PSD vinculado e re-importa pra dentro da peça atual.
  // Requer permission de leitura (concedida no salvar inicial; pode pedir
  // de novo se o browser invalidou).
  async function syncFromExternalApp() {
    const handle = externalPsdHandle.current
    if (!handle) {
      alert("Nenhum PSD externo vinculado. Use 'Editar Externo' primeiro.")
      return
    }
    try {
      const perm = await handle.queryPermission({ mode: "read" })
      if (perm !== "granted") {
        const req = await handle.requestPermission({ mode: "read" })
        if (req !== "granted") {
          alert("Permissão de leitura negada — não dá pra sincronizar")
          return
        }
      }
      const file = await handle.getFile()
      const mtime = file.lastModified ? new Date(file.lastModified).toLocaleTimeString() : "?"
      if (!confirm(`Sincronizar com "${file.name}" (modificado em ${mtime})?\n\nO conteúdo do Step ativo será substituído pelos layers do PSD.`)) return
      await replaceStepFromPsd(file)
    } catch (e: any) {
      console.error("[external-sync] falha:", e)
      alert("Falha ao sincronizar: " + (e?.message ?? e))
    }
  }

  async function replaceStepFromPsd(file: File) {
    const fc = fabricRef.current
    if (!fc) return
    const camp = campaignRef.current
    if (!camp) return
    try {
      setSaving(true)
      const agPsd: any = await import("ag-psd")
      if (agPsd.initializeCanvas) {
        agPsd.initializeCanvas(
          (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c },
          (c: any) => (c as HTMLCanvasElement).getContext("2d")
        )
      }
      const buffer = await file.arrayBuffer()
      // skipLayerImageData/skipCompositeImageData: false — precisamos do canvas
      // pra amostrar a cor do BG (layer "Background" top-level OU composite).
      const psd: any = (agPsd as any).readPsd(buffer, { skipLayerImageData: false, skipCompositeImageData: false, skipThumbnail: true })

      // Recolhe folhas (layers leaf) visiveis. Folders intermediarios sao
      // transparentes pra esse fluxo (so leaves tem posicao concreta).
      function collectLeaves(layers: any[], parentHidden = false): any[] {
        const out: any[] = []
        for (const l of layers ?? []) {
          const hidden = parentHidden || l.hidden === true
          if (hidden) continue
          if (l.children?.length) out.push(...collectLeaves(l.children, hidden))
          else out.push(l)
        }
        return out
      }
      const leaves = collectLeaves(psd.children ?? [])

      // === BG: extrai BG layer (BgLayerData) do PSD igual Photoshop ===
      // Ordem de tentativa (do mais confiavel pro fallback):
      //  1. Layer "Background" top-level (nao-SO): pode ser Solid Color FILL,
      //     Gradient FILL ou raster — extractPsdBgLayer escolhe o tipo certo
      //  2. PRIMEIRO layer top-level que cobre o canvas inteiro
      //  3. Pixel central do composite (cor solida fallback)
      // Suporta SOLID, GRADIENT e raster→solid amostrado. Image fica pra V2
      // (geraria piece.data inchada com base64 do raster gigante do PSD).
      const psdW = psd.width || canvasWRef.current
      const psdH = psd.height || canvasHRef.current
      function layerCoversCanvas(l: any): boolean {
        if (l?.vectorFill?.type === "color" || l?.vectorFill?.type === "solid") return true
        const lw = (l?.right ?? 0) - (l?.left ?? 0)
        const lh = (l?.bottom ?? 0) - (l?.top ?? 0)
        const tol = 0.02
        return lw >= psdW * (1 - tol) && lh >= psdH * (1 - tol)
      }
      let psdBg: BgLayerData | null = null
      // 1: layer "Background" top-level
      for (const l of (psd.children ?? [])) {
        const isSO = !!(l as any).placedLayer
        if (l.name === "Background" && !isSO) {
          psdBg = extractPsdBgLayer(l, psdW, psdH)
          if (psdBg) break
        }
      }
      // 2: PRIMEIRO layer top-level que cobre canvas
      if (!psdBg) {
        for (const l of (psd.children ?? [])) {
          const isSO = !!(l as any).placedLayer
          if (isSO || l.hidden === true || l.children?.length) continue
          if (!layerCoversCanvas(l)) continue
          psdBg = extractPsdBgLayer(l, psdW, psdH)
          if (psdBg) break
        }
      }
      // 3: composite fallback
      if (!psdBg && psd.canvas) {
        const cc = psd.canvas as HTMLCanvasElement
        const c = sampleHexAt(cc, cc.width / 2, cc.height / 2) || sampleHexAt(cc, 0, 0)
        if (c) psdBg = { kind: "solid", color: c, opacity: 1 }
      }

      // Index de assets por nome normalizado pra match rapido. Usa normalizeName
      // (mesma logica do PsdPieceImporter + import-psd endpoint) — remove acentos
      // e espacos internos, garantindo match consistente em todos os caminhos.
      const assetsByName = new Map<string, any>()
      for (const a of (camp.assets ?? [])) {
        const k = normalizeName(a.label ?? "")
        if (k) assetsByName.set(k, a)
      }

      const pieceW = canvasWRef.current
      const pieceH = canvasHRef.current
      const scale = Math.min(pieceW / psdW, pieceH / psdH)
      const offX = (pieceW - psdW * scale) / 2
      const offY = (pieceH - psdH * scale) / 2

      // Limpa canvas: remove tudo exceto BG e bleed overlay
      const toRemove = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay)
      for (const obj of toRemove) fc.remove(obj)

      // Aplica BG do PSD via replaceBgLayers (cria novo BG layer real,
      // suporta solid/gradient/etc). Se nada foi extraido, mantem o BG atual.
      if (psdBg) {
        await replaceBgLayers([psdBg])
      }

      let matched = 0, ignored = 0
      const missingNames: string[] = []
      for (const layer of leaves) {
        const name = (layer.name ?? "").trim()
        if (!name || name === "Background") { ignored++; continue }
        const asset = assetsByName.get(normalizeName(name))
        if (!asset) {
          ignored++
          missingNames.push(name)
          console.log("[psd-step] sem match no asset, ignorando:", name)
          continue
        }
        const left = layer.left ?? 0
        let top = layer.top ?? 0
        const w = Math.max((layer.right ?? left + 200) - left, 10)
        const h = Math.max((layer.bottom ?? top + 50) - top, 10)
        // Pra TEXTO: quando o PSD tem text.transform com translateY (caso
        // típico de PSDs gerados pelo ZZOSY que usam baseline anchor com
        // translateY = top + fontSize), `layer.top` pode incluir o offset
        // do baseline — texto cairia ~fontSize px abaixo do esperado.
        // Compensa usando transform[5] - fontSize quando disponível.
        if (asset.type === "TEXT" && layer.text) {
          const tform: number[] | undefined = layer.text.transform
          const fontSize = layer.text.style?.fontSize ?? 0
          if (Array.isArray(tform) && tform.length >= 6 && typeof tform[5] === "number" && fontSize > 0) {
            const visualTop = tform[5] - fontSize
            // Só compensa se a diferença bate (~fontSize). Sem isso, PSDs
            // de outras fontes (Photoshop original) que tem transform[5]
            // SEMANTIC diferente não seriam afetados.
            if (Math.abs(visualTop - top) > fontSize * 0.3) {
              top = visualTop
            }
          }
        }
        const layerObj: any = {
          assetId: asset.id,
          posX: Math.round(left * scale + offX),
          posY: Math.round(top * scale + offY),
          scaleX: 1, scaleY: 1, rotation: 0,
          width: Math.round(w * scale),
          height: Math.round(h * scale),
          overrides: {},
        }
        // TEXTO: extrai estilo do PSD (fonte/peso/tamanho/cor + styles per-char
        // quando ha multiplas cores) pra overrides. NAO setamos overrides.text
        // — addAssetToCanvas usa asset.content como fonte da verdade do texto
        // cru. styles per-char sao distribuidos PROPORCIONALMENTE no texto do
        // asset (asset pode ter length diferente do PSD).
        if (asset.type === "TEXT" && layer.text) {
          const assetText = getSpans(asset).map(s => s.text).join("")
          const ov = psdTextLayerToOverride(layer, scale, layerObj.width, layerObj.height, assetText)
          if (ov) layerObj.overrides = ov
        }
        try {
          await addAssetToCanvas(fc, asset, layerObj)
          matched++
        } catch (e) {
          console.warn("[psd-step] falha addAssetToCanvas pra", name, e)
          ignored++
        }
      }

      fc.renderAll()
      refreshLayers(fc)
      isDirtyRef.current = true
      setIsDirty(true)
      // Save now pra persistir o step substituido + regenerar thumb
      await doSaveNow()

      const msg = `Step substituído: ${matched} layer(s) linkadas, ${ignored} ignoradas.`
      const detail = missingNames.length > 0
        ? `\n\nSem match no asset (nomeie os assets em /assets pra reusar):\n• ${missingNames.slice(0, 10).join("\n• ")}${missingNames.length > 10 ? `\n…+${missingNames.length - 10}` : ""}`
        : ""
      alert(msg + detail)
    } catch (e: any) {
      console.error("[replaceStepFromPsd] erro:", e)
      alert(`Erro ao processar PSD: ${e?.message ?? e}`)
    } finally {
      setSaving(false)
    }
  }

  async function removeStep(indexToRemove: number, skipConfirm = false) {
    if (stepCountRef.current <= 1) return // nao deixa apagar o ultimo
    if (!skipConfirm && !window.confirm(`Apagar Step ${indexToRemove + 1}? Os steps seguintes serao renumerados.`)) return
    // Caso A: apaga step ativo. Precisa carregar outro no canvas primeiro.
    if (indexToRemove === activeStepIndexRef.current) {
      // Escolhe vizinho: anterior se houver, senao proximo.
      const fallbackIndex = indexToRemove === 0 ? 1 : indexToRemove - 1
      // Pega o step de fallback do buffer (sem incluir o ativo).
      // Mapeia: se fallbackIndex < activeStepIndex, eh posicao fallbackIndex no buffer.
      //         se fallbackIndex > activeStepIndex, eh posicao fallbackIndex-1.
      const bufferIdx = fallbackIndex < activeStepIndexRef.current ? fallbackIndex : fallbackIndex - 1
      const fallbackStep = inactiveStepsRef.current[bufferIdx]
      if (fallbackStep) {
        await loadStepIntoCanvas(fallbackStep)
        // Remove fallback do buffer (agora eh ativo).
        const newBuffer = inactiveStepsRef.current.filter((_, i) => i !== bufferIdx)
        inactiveStepsRef.current = newBuffer
        // Novo activeStepIndex: o fallback ocupa a posicao do removido.
        // Se fallback era anterior, novo activeIndex eh fallbackIndex.
        // Se era posterior, depois do shift de remocao, eh fallbackIndex - 1.
        setActiveStepIndexSync(fallbackIndex < indexToRemove ? fallbackIndex : fallbackIndex - 1)
      }
    } else {
      // Caso B: apaga step inativo. Soh remove do buffer.
      const bufferIdx = indexToRemove < activeStepIndexRef.current ? indexToRemove : indexToRemove - 1
      inactiveStepsRef.current = inactiveStepsRef.current.filter((_, i) => i !== bufferIdx)
      // Se o removido vinha ANTES do ativo, o indice do ativo diminui em 1.
      if (indexToRemove < activeStepIndexRef.current) setActiveStepIndexSync(activeStepIndexRef.current - 1)
    }
    setStepCountSync(c => c - 1)
    // CRITICO: apagar um step renumera todos depois dele. Os imageUrl ficam
    // apontando pros thumbs ANTIGOS (do indice errado agora). Limpa todos os
    // imageUrl/thumbnailUrl dos steps no buffer pra forcar autoGen rodar.
    inactiveStepsRef.current = inactiveStepsRef.current.map(s => ({
      layers: s.layers,
      bgColor: s.bgColor,
      // remove imageUrl e thumbnailUrl
    }))
    isDirtyRef.current = true
    await doSaveNow()
    // Re-dispara autoGen pra gerar novos thumbs com os indices corretos.
    // AWAIT crítico: se o user fechar o editor antes do autoGen terminar,
    // alguns steps ficam sem preview. Esperar garante consistencia.
    autoGenDoneRef.current = false
    try {
      await autoGenerateMissingStepThumbs()
    } catch (e) { console.warn("[removeStep] autoGen erro:", e) }
  }

  // Percorre todos os steps gerando thumbnail individual pra cada um.
  // Util pra pecas multi-step antigas que tem steps sem preview (criados
  // antes do fix de auto-thumb-on-add). Visualmente eh ruim — pisca entre
  // os steps — mas eh a forma confiavel sem render server-side.
  const [regeneratingThumbs, setRegeneratingThumbs] = useState(false)
  async function regenerateAllStepThumbs() {
    if (!pieceId) return
    if (stepCountRef.current <= 1) return
    setRegeneratingThumbs(true)
    const originalActive = activeStepIndexRef.current
    try {
      for (let i = 0; i < stepCountRef.current; i++) {
        if (i !== activeStepIndexRef.current) {
          await switchToStep(i)  // ja faz upload do thumb via doSaveNow
        }
      }
      // Volta pro step original que o user estava editando.
      if (originalActive !== activeStepIndexRef.current) {
        await switchToStep(originalActive)
      }
    } finally {
      setRegeneratingThumbs(false)
    }
  }

  // ============================================================
  // FIM STEPS MANAGEMENT
  // ============================================================

  function doSave() {
    // MODO MANUAL: NAO faz auto-save mais. Apenas marca dirty pra que o
    // botao "Salvar" no header e o confirm-exit ao fechar saibam que ha
    // mudancas pendentes. User precisa clicar Salvar explicitamente — UX
    // pedido pelo user: "nao e para o editor salvar automatico".
    isDirtyRef.current = true
    setIsDirty(true)
  }

  function doSaveNow(): Promise<void> {
    // Manual mode: doSaveNow tb so marca dirty agora. Operacoes que precisam
    // de sync REAL com banco (add step, undo/redo que pre-popula thumb)
    // chamam performSave() diretamente.
    isDirtyRef.current = true
    setIsDirty(true)
    return Promise.resolve()
  }

  /**
   * Flush sincrono dos PUTs debounceados pendentes de asset (lastOverride +
   * content). Necessario antes de qualquer save manual/automatico pra que o
   * banco esteja com o template/content mais recente antes do PATCH da peca/KV
   * persistir layers. Sem isso, race: PATCH grava layer.overrides apontando
   * pra template antigo que ainda nao subiu.
   */
  async function flushPendingAssetPuts(): Promise<void> {
    clearTimeout(lastOverridePutTimer.current)
    clearTimeout(assetContentPutTimer.current)
    const promises: Promise<any>[] = []
    const p1 = lastOverridePendingPayload.current
    if (p1) {
      lastOverridePendingPayload.current = null
      promises.push(fetch(`/api/campaigns/${campaignId}/assets/${p1.aid}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p1.payload),
      }).catch(err => console.warn("[flush lastOverride] failed:", err)))
    }
    const p2 = assetContentPendingPayload.current
    if (p2) {
      assetContentPendingPayload.current = null
      promises.push(fetch(`/api/campaigns/${campaignId}/assets/${p2.aid}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p2.payload),
      }).catch(err => console.warn("[flush assetContent] failed:", err)))
    }
    if (promises.length > 0) await Promise.all(promises)
  }

  async function performSave() {
    // Guard 0: durante apply de undo/redo, NUNCA salva. loadFromJSON dispara
    // object:added/modified que poderiam acionar saves com canvas em estado
    // transitorio (sem __assetId restaurados, sem bg, etc).
    if (isApplyingHistory.current) {
      editorLog("[performSave] abortado — undo/redo em andamento")
      return
    }
    // Guard 1: se o init nao terminou (ou se o cleanup ja rodou), aborta.
    // Sem isso, um timer pendurado dispararia depois do useEffect re-rodar
    // mas antes do init recarregar layers, gravando layers: [] no banco.
    if (!isInitialized.current) {
      editorLog("[performSave] abortado — init nao terminou (canvas em re-mount)")
      return
    }
    // Se ha propagacao de texto em curso (PUT asset migrando styles em todos
    // escopos), adia o save: rodar agora salvaria layers com styles em
    // indices errados.
    if (pendingTextPropagation.current) {
      saveTimer.current = setTimeout(performSave, 200)
      return
    }
    // Mutex de save: se outro save ja esta em voo (saveNow ou performSave),
    // ESPERA terminar antes de prosseguir. Sem isso, 2 performSave paralelos
    // gravavam a mesma peca em PATCHes concorrentes — ultimo ganhava, podia
    // sobrescrever dados mais recentes do primeiro.
    if (savingInFlightRef.current) {
      const startWait = Date.now()
      while (savingInFlightRef.current && Date.now() - startWait < 5000) {
        await new Promise(r => setTimeout(r, 50))
      }
      if (savingInFlightRef.current) {
        editorLog("[performSave] timeout esperando save anterior — abortando")
        return
      }
    }
    savingInFlightRef.current = true
    // Flush sincrono de PUTs de asset pendentes ANTES de gravar peca/KV.
    // Sem isso, layer.overrides poderia referenciar template antigo do asset
    // (lastOverride debounceado nao subiu ainda).
    try { await flushPendingAssetPuts() } catch {}
    const fc = fabricRef.current
    if (!fc) { savingInFlightRef.current = false; return }
    setSaving(true)

    if (pieceId && pieceRef.current) {
      // MODO PEÇA v2: salva layers[] com posicoes + overrides
      const p = pieceRef.current
      const oldData = typeof p.data === "string" ? JSON.parse(p.data) : (p.data ?? {})

      const newLayers = fc.getObjects()
        .filter((o: any) => {
          if (o.__isBg) return false
          if ((o as any).__isStrokeGhost === true) return false
          if (o.__isBleedOverlay) return false
          // Layer valido: __assetId (linkado) ou __embedded (PSD avulso importado).
          // Sem essas flags eh fantasma. Loga warning pra detectar caminhos
          // problematicos (paste mal feito, drag-from-asset com bug, etc).
          if (!o.__assetId && !o.__embedded) {
            editorLog("[PIECE-SAVE] objeto sem __assetId nem __embedded BLOQUEADO:", {
              type: o.type, text: (o as any).text?.slice(0, 30),
              left: o.left, top: o.top,
            })
            return false
          }
          return true
        })
        .map((o: any, i: number) => {
          const layer: any = {
            posX: Math.round(o.left ?? 0),
            posY: Math.round(o.top ?? 0),
            scaleX: o.scaleX ?? 1,
            scaleY: o.scaleY ?? 1,
            rotation: o.angle ?? 0,
            zIndex: i,
            width: Math.round(o.width ?? 400),
            height: Math.round(o.height ?? 100),
            overrides: {},
          }
          // Linkado a um asset: grava assetId.
          if (o.__assetId) layer.assetId = o.__assetId
          // Visibilidade e lock: persiste se diferente do default.
          if (o.__hidden === true) layer.hidden = true
          if (o.__locked === true) layer.locked = true
          // DEBUG: log do que tah indo pra peca
          console.log("[SAVE-PIECE] layer", i, "type:", o.type, "__hidden:", o.__hidden, "__locked:", o.__locked, "-> hidden:", layer.hidden, "locked:", layer.locked)
          // Embedded: grava flag + conteudo cru (sem asset).
          if (o.__embedded) {
            layer.__embedded = true
            if (o.type === "textbox" || o.type === "i-text") {
              layer.type = "TEXT"
              layer.text = o.text ?? ""
              layer.fontFamily = o.fontFamily
              layer.fontSize = o.fontSize
              layer.fontWeight = o.fontWeight
              layer.fill = o.fill
              if (o.textAlign) layer.textAlign = o.textAlign
            } else if (o.type === "image") {
              layer.type = "IMAGE"
              if ((o as any).imageDataUrl) {
                layer.imageDataUrl = (o as any).imageDataUrl
              } else if ((o as any).getSrc) {
                // Fallback: pega src atual da imagem (pode ser blob: ou data: URL)
                try { layer.imageDataUrl = (o as any).getSrc() } catch {}
              }
            }
          }
          // Metadados PSD (mask/hidden/locked/opacity/blendMode/effects/
          // nameSource/groupPath) via helper centralizado. Antes este site NAO
          // propagava __hidden/__locked (drift sutil) — agora alinhado com
          // PIECE/MATRIX saves.
          applyPsdLayerMetadata(o, layer)
          // Captura overrides para textos via helper centralizado
          if (o.type === "textbox" || o.type === "i-text") {
            Object.assign(layer.overrides, serializeTextboxOverrides(o, { preserveExplicitNewlinesOnly: true }))
          } else if ((o as any).__isShape === true || o.type === "path" || o.type === "Path") {
            // SHAPE override (doSave peca) via helper centralizado.
            Object.assign(layer.overrides, serializeShapeOverrides(o))
          }
          return layer
        })

      // Circuit breaker: nao grava layers: [] sobre piece.data que tinha layers.
      // Race condition tipica: load do PSD importado retorna layer com schema
      // antigo, addAssetToCanvas/addEmbeddedLayer falham, canvas fica vazio,
      // doSave dispara e sobrescreve o data original com [] -> peca destruida.
      if (newLayers.length === 0) {
        const previousLayers = (oldData?.layers as any) ?? []
        const hadLayers = Array.isArray(previousLayers) && previousLayers.length > 0
        if (hadLayers) {
          editorLog("[doSave PIECE] abortado — tentaria gravar layers:[] sobre piece.data que tinha", previousLayers.length, "layers. Provavel race no load.")
          isDirtyRef.current = false
          setIsDirty(false)
          setSaving(false)
          savingInFlightRef.current = false
          return
        }
      }

      const newData: any = {
        ...oldData,
        version: 2,
        width: canvasWRef.current,
        height: canvasHRef.current,
        bgColor: bgColorRef.current, bgOpacity: bgOpacityRef.current, bgLayers: bgLayersRef.current,
        layers: newLayers,
      }
      // STEPS: se a peca tem multiplos steps, persiste TODOS em data.steps[].
      // Estrutura: data.steps eh um array onde steps[i] = { layers, bgColor }.
      // O step ativo eh sincronizado: pegamos newLayers (canvas atual) e
      // injetamos em steps[activeStepIndex]. Os outros vem do inactiveStepsRef.
      //
      // CRITICO: usa REFS (stepCountRef, activeStepIndexRef) pra ler valores
      // sincronos. React state \u00e9 batched e pode estar stale se essa funcao
      // foi chamada logo apos setStepCount/setActiveStepIndex.
      //
      // Pecas com 1 step soh: nao gravamos data.steps (compat formato legado).
      if (stepCountRef.current > 1) {
        // Monta array completo: steps[i] = se i==activeStepIndex, usa o canvas atual.
        // Senao usa inactiveStepsRef.current[mapInactive(i)].
        const fullSteps: any[] = []
        let inactiveCursor = 0
        // Le oldData.steps pra preservar imageUrl do step ativo no save.
        // Sem isso, toda vez que o user salva, o imageUrl do step ativo
        // some (o save sobrescreve com {layers, bgColor} sem imageUrl).
        const oldSteps: any[] = Array.isArray(oldData.steps) ? oldData.steps : []
        // Fallback: peca era single-step (sem data.steps), thumb esta em piece.imageUrl.
        const pieceImgFallback = (!oldSteps.length) ? ((pieceRef.current as any)?.imageUrl ?? null) : null
        for (let i = 0; i < stepCountRef.current; i++) {
          if (i === activeStepIndexRef.current) {
            const oldActive = oldSteps[i] ?? {}
            fullSteps.push({
              layers: newLayers,
              bgColor: bgColorRef.current, bgOpacity: bgOpacityRef.current, bgLayers: bgLayersRef.current,
              // Preserva imageUrl/thumbnailUrl gerados anteriormente. O upload
              // do thumb novo (uploadPieceThumb após o save) sobrescreve esses.
              imageUrl: oldActive.imageUrl ?? (i === 0 ? pieceImgFallback : null),
              thumbnailUrl: oldActive.thumbnailUrl ?? (i === 0 ? pieceImgFallback : null),
            })
          } else {
            fullSteps.push(inactiveStepsRef.current[inactiveCursor] ?? { layers: [], bgColor: "#ffffff" })
            inactiveCursor++
          }
        }
        newData.steps = fullSteps
        newData.activeStepIndex = activeStepIndexRef.current
      } else {
        delete newData.steps
        delete newData.activeStepIndex
      }
      await fetch(`/api/pieces/${pieceId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: JSON.stringify(newData) })
      })
      // CRITICO: atualiza pieceRef.current.data pra refletir o save (mesmo
      // motivo do saveNow PECA acima).
      if (pieceRef.current) {
        pieceRef.current = { ...pieceRef.current, data: JSON.stringify(newData) } as any
      }
      await uploadPieceThumb(fc, pieceId)
      // Re-fetch pra pegar imageUrl dos steps gerados pelo upload.
      try {
        const r = await fetch(`/api/pieces/${pieceId}`, { cache: "no-store" })
        if (r.ok) {
          const fresh = await r.json()
          if (pieceRef.current) pieceRef.current = fresh
        }
      } catch (e) { /* nao critico */ }
      isDirtyRef.current = false
      setIsDirty(false)
    } else {
      // MODO MATRIZ
      const layersToSave: any[] = fc.getObjects()
        .filter((o: any) => {
          if (o.__isBg) return false
          if ((o as any).__isStrokeGhost === true) return false
          if (!o.__assetId) {
            editorLog("[SAVE-MATRIX-2] objeto sem __assetId ignorado:", o.type, { left: o.left, top: o.top })
            return false
          }
          return true
        })
        .map((o: any, i: number) => {
          const layer: any = {
            assetId: o.__assetId,
            posX: Math.round(o.left ?? 0),
            posY: Math.round(o.top ?? 0),
            scaleX: o.scaleX ?? 1,
            scaleY: o.scaleY ?? 1,
            rotation: o.angle ?? 0,
            zIndex: i,
            width: Math.round(o.width ?? 400),
            height: Math.round((o.height ?? 300) * (o.scaleY ?? 1)),
            overrides: {},
          }
          // Metadados PSD (mask/hidden/locked/opacity/blendMode/effects/
          // nameSource/groupPath) via helper centralizado. Antes este site
          // (doSave matriz, dispara logo apos import via dirty trigger) NAO
          // propagava __hidden/__locked — agora alinhado com PIECE/MATRIX.
          applyPsdLayerMetadata(o, layer)
          // Captura overrides para textos: cor, fonte, tamanho, peso, espacamento, alinhamento, styles per-char
          // Matriz: caracteres vem do asset. Helper centralizado captura tudo.
          if (o.type === "textbox" || o.type === "i-text") {
            Object.assign(layer.overrides, serializeTextboxOverrides(o, { preserveExplicitNewlinesOnly: true }))
          } else if ((o as any).__isShape === true || o.type === "path" || o.type === "Path") {
            // SHAPE override (doSave matriz) via helper centralizado.
            Object.assign(layer.overrides, serializeShapeOverrides(o))
          }
          return layer
        })
      // Circuit breaker: se o save tentaria gravar matriz VAZIA mas o KV anterior tinha
      // layers, eh quase certamente um init incompleto disparando save por engano. Aborta
      // pra nao perder o trabalho. O usuario pode esvaziar de propriedade clicando em Apagar
      // em cada layer (passa por moveLayer/remove + doSave com canvas ja inicializado).
      if (layersToSave.length === 0) {
        const previousLayers = (campaignRef.current?.keyVision?.layers as any) ?? []
        const hadLayers = Array.isArray(previousLayers) && previousLayers.length > 0
        if (hadLayers) {
          editorLog("[SAVE-MATRIX-2] abortado — tentaria gravar layers:[] sobre KV que tinha", previousLayers.length, "layers. Provavel race condition.")
          setSaving(false)
          savingInFlightRef.current = false
          return
        }
      }
      await fetch(`/api/campaigns/${campaignId}/key-vision`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bgColor: bgColorRef.current, bgOpacity: bgOpacityRef.current, bgLayers: bgLayersRef.current, layers: layersToSave, width: canvasWRef.current, height: canvasHRef.current })
      })
      // Nota: lastOverride dos assets ja foi atualizado em tempo real via
      // updateAssetLastOverride() chamado em text:editing:exited e applyStyle.
      // Nao precisa propagar de novo aqui no doSave.

      // Gerar e enviar thumbnail do KV (max 1920px maior lado, JPEG 0.92).
      // High-res necessario pro preview de apresentacao e PPTX exportado nao
      // ficarem pixelados (slide widescreen escala thumb pra 8-12 polegadas).
      try {
        const thumbScale = Math.min(1920 / canvasWRef.current, 1920 / canvasHRef.current, 1)
        // CROP da area da peca. Le offset real do viewportTransform pra
        // cortar exatamente onde a peca renderiza no canvas DOM.
        const z = zoomRef.current || 1
        const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
        const offsetX = vt[4] ?? 0
        const offsetY = vt[5] ?? 0
        const dataUrl = fc.toDataURL({
          // PNG preserva alpha (ver comentario em uploadMatrixThumb).
          format: "png",
          multiplier: thumbScale / z,
          left: offsetX,
          top: offsetY,
          width: canvasWRef.current * z,
          height: canvasHRef.current * z,
        })
        const blob = await (await fetch(dataUrl)).blob()
        const fd = new FormData()
        fd.append("thumbnail", blob, "kv-thumb.png")
        await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: fd })
        try {
          if (typeof BroadcastChannel !== "undefined") {
            const bc = new BroadcastChannel("zzosy:campaigns")
            bc.postMessage({ type: "kv-updated", campaignId, ts: Date.now() })
            bc.close()
          }
        } catch {}
      } catch (e) { console.warn("KV thumb upload failed:", e) }
      isDirtyRef.current = false
      setIsDirty(false)
    }
    setSaving(false)
    savingInFlightRef.current = false
  }

  // Cria um asset TEXT novo na campanha + auto-seleciona ele no dropdown +
  // adiciona ao canvas. UX: usuário pode criar texto direto do editor sem
  // sair pra /campaigns/[id]/assets.
  async function createTextAssetAndAdd() {
    if (!campaignId) return
    const defaultText = "Novo texto"
    const span = { text: defaultText, style: { color: "#111111", fontSize: 80, fontWeight: "normal", fontFamily: "Arial" } }
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "TEXT", label: defaultText, value: defaultText, content: [span] }),
      })
      if (!res.ok) {
        alert("Falha ao criar asset de texto")
        return
      }
      const created = await res.json()
      // Refetch campanha pra ter o novo asset no estado
      const campRes = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" })
      if (campRes.ok) {
        const camp = await campRes.json()
        setCampaign(camp)
        campaignRef.current = camp
      }
      // Seleciona o novo asset + adiciona ao canvas
      setAssetId(created.id)
      assetIdRef.current = created.id
      // pequeno delay pra o state propagar
      await new Promise(r => setTimeout(r, 50))
      await addLayer()
    } catch (e) {
      console.warn("[createTextAssetAndAdd] falhou:", e)
      alert("Erro ao criar texto")
    }
  }

  async function addLayer() {
    const fc = fabricRef.current
    const c = campaignRef.current
    const aid = assetIdRef.current
    if (!fc || !c || !aid) return
    const asset = c.assets.find((a: Asset) => a.id === aid)
    if (!asset) return

    // Modelo final: cada asset guarda seu lastOverride (ultimo template visual
    // aplicado na MATRIZ). Quando adiciona o asset no canvas (matriz ou peca),
    // vem com esse template. Se o asset nunca foi configurado, vem default.
    const templateOverrides = (asset.lastOverride && typeof asset.lastOverride === "object")
      ? { ...asset.lastOverride }
      : undefined

    // Width default: limita a 40% do canvas pra IMAGE evitar overflow visual
    // em peças pequenas (ex: Stories 1080x1920 com asset adicionado a width=400
    // ainda renderiza dentro; mas em peças 600x600 width=400 ocupa 66% e a
    // imagem natural pode ser scaled up). Tambem evita layers grudados na borda
    // direita ao adicionar em sequencia.
    const cw = canvasWRef.current
    const defaultImgWidth = Math.min(400, Math.round(cw * 0.4))
    await addAssetToCanvas(fc, asset, {
      posX: 100,
      posY: 100,
      width: asset.type === "TEXT" ? 800 : defaultImgWidth,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      overrides: templateOverrides,
    })
    fc.renderAll()
    doSave()
  }

  // Indice do BG atualmente sendo editado no painel. Se um BG esta selecionado
  // no canvas, eh o __bgIdx dele. Senao, eh o 0 (fundo) — UX conservadora.
  function currentBgIdx(): number {
    const sel = selectedRef.current as any
    if (sel?.__isBg && typeof sel.__bgIdx === "number") return sel.__bgIdx
    return 0
  }

  // Helper unificado pra mutar o BG atualmente selecionado. Aplica updater no
  // bgLayersRef, recalcula fill (suporta solid + gradient via buildBgFill),
  // sincroniza espelhos legacy (BG[0]) e dispara save + re-render do painel.
  async function updateCurrentBg(updater: (layer: BgLayerData) => BgLayerData) {
    const fc = fabricRef.current
    if (!fc) return
    const idx = currentBgIdx()
    const current = bgLayersRef.current[idx]
    if (!current) return
    const next = updater(current)
    bgLayersRef.current[idx] = next
    const rect = bgRectsRef.current[idx]
    if (rect) {
      const fabricMod: any = await import("fabric")
      await syncBgLayerToRect(rect, next, canvasWRef.current, canvasHRef.current, fabricMod)
      fc.renderAll()
    }
    // Espelhos legacy (BG[0]) — save/export antigo continua funcionando.
    if (idx === 0) {
      bgOpacityRef.current = next.opacity
      bgColorRef.current = bgLayerLegacyColor(next)
    }
    if (next.kind === "solid") {
      setBgColor(next.color)
      setBgHexInput(next.color)
    }
    setBgOpacity(next.opacity)
    setSelectedTick(t => t + 1)
    doSave()
  }

  function changeBg(c: string, brandIdx?: number) {
    updateCurrentBg((l) => {
      // Brand ref: se foi clicado num swatch da Marca, marca colorBrandIdx
      // pra re-sync automatico. Senao, limpa pra desassociar.
      const bIdx = typeof brandIdx === "number" ? brandIdx : undefined
      if (l.kind === "solid") return { ...l, color: c, colorBrandIdx: bIdx }
      // Vinha de gradient/image — forca pra solid
      return { kind: "solid", color: c, colorBrandIdx: bIdx, opacity: l.opacity, hidden: l.hidden, locked: l.locked }
    })
  }

  function changeBgOpacity(op: number) {
    const v = Math.max(0, Math.min(1, op))
    updateCurrentBg((l) => ({ ...l, opacity: v }))
  }

  // BG-3/4: troca tipo do BG (solid/gradient/image). Preserva o que faz
  // sentido entre as conversoes. Pra image sem upload previo, deixa
  // imageDataUrl vazio — UI redireciona pro file picker.
  function changeBgKind(kind: "solid" | "gradient" | "image", opts?: { gradientType?: "linear" | "radial"; fit?: BgImageFit }) {
    updateCurrentBg((l) => {
      if (kind === "solid") {
        const color = l.kind === "solid"
          ? l.color
          : l.kind === "gradient" ? (l.stops[0]?.color ?? "#ffffff")
          : "#ffffff"
        return { kind: "solid", color, opacity: l.opacity, hidden: l.hidden, locked: l.locked }
      }
      if (kind === "gradient") {
        const gradientType = opts?.gradientType ?? (l.kind === "gradient" ? l.gradientType : "linear")
        if (l.kind === "gradient") return { ...l, gradientType }
        const baseColor = l.kind === "solid" ? l.color : "#ffffff"
        return {
          kind: "gradient", gradientType, angle: 90,
          stops: [{ offset: 0, color: baseColor }, { offset: 1, color: "#000000" }],
          opacity: l.opacity, hidden: l.hidden, locked: l.locked,
        }
      }
      // kind === "image"
      const fit = opts?.fit ?? (l.kind === "image" ? l.fit : "cover")
      const imageDataUrl = l.kind === "image" ? l.imageDataUrl : ""
      return { kind: "image", imageDataUrl, fit, opacity: l.opacity, hidden: l.hidden, locked: l.locked }
    })
  }

  // Le um File como dataURL e aplica como imagem do BG atual. Se o BG nao for
  // do tipo "image" ainda, converte automaticamente (intencao do user eh clara).
  function uploadBgImage(file: File, fit: BgImageFit = "cover") {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "")
      if (!dataUrl) return
      updateCurrentBg((l) => ({
        kind: "image", imageDataUrl: dataUrl, fit,
        opacity: l.opacity, hidden: l.hidden, locked: l.locked,
      }))
    }
    reader.onerror = () => alert("Falha ao ler imagem")
    reader.readAsDataURL(file)
  }

  function changeBgImageFit(fit: BgImageFit) {
    updateCurrentBg((l) => l.kind === "image" ? { ...l, fit } : l)
  }

  function changeBgBlendMode(blendMode: BgBlendMode) {
    updateCurrentBg((l) => ({ ...l, blendMode }))
  }

  // Adiciona/remove mascara no BG. Pra MVP, mascara default = retangulo
  // vetorial cobrindo metade superior da peca (UX pra ver que tem efeito;
  // user ajusta depois via MaskPanel ou Photoshop-style edicao).
  function setBgMaskDefault() {
    updateCurrentBg((l) => ({
      ...l,
      mask: {
        type: "vector" as const,
        enabled: true,
        vector: {
          path: `M 0 0 L ${canvasWRef.current} 0 L ${canvasWRef.current} ${canvasHRef.current / 2} L 0 ${canvasHRef.current / 2} Z`,
          posX: 0, posY: 0,
          width: canvasWRef.current, height: canvasHRef.current / 2,
        },
      },
    }))
  }

  function removeBgMask() {
    updateCurrentBg((l) => ({ ...l, mask: undefined }))
  }

  function toggleBgMaskEnabled() {
    updateCurrentBg((l) => {
      if (!l.mask) return l
      return { ...l, mask: { ...l.mask, enabled: !l.mask.enabled } }
    })
  }

  function changeBgGradientStop(stopIdx: number, patch: Partial<BgGradientStop>) {
    updateCurrentBg((l) => {
      if (l.kind !== "gradient") return l
      const stops = l.stops.map((s, i) => i === stopIdx ? { ...s, ...patch } : s)
        .sort((a, b) => a.offset - b.offset)
      return { ...l, stops }
    })
  }

  function changeBgGradientAngle(angle: number) {
    updateCurrentBg((l) => l.kind === "gradient" ? { ...l, angle } : l)
  }

  function addBgGradientStop() {
    updateCurrentBg((l) => {
      if (l.kind !== "gradient") return l
      // Adiciona stop no meio do espaco vazio mais largo entre stops vizinhos
      const sorted = [...l.stops].sort((a, b) => a.offset - b.offset)
      let bestGap = 0, bestMid = 0.5, bestColor = "#888888"
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = sorted[i + 1].offset - sorted[i].offset
        if (gap > bestGap) {
          bestGap = gap
          bestMid = (sorted[i].offset + sorted[i + 1].offset) / 2
          // Cor interpolada entre vizinhos (so visual; user pode trocar depois)
          bestColor = sorted[i].color
        }
      }
      return { ...l, stops: [...l.stops, { offset: bestMid, color: bestColor }].sort((a, b) => a.offset - b.offset) }
    })
  }

  function removeBgGradientStop(stopIdx: number) {
    updateCurrentBg((l) => {
      if (l.kind !== "gradient" || l.stops.length <= 2) return l
      return { ...l, stops: l.stops.filter((_, i) => i !== stopIdx) }
    })
  }

  // Adiciona um BG layer ACIMA do atualmente selecionado (ou do topo dos BGs
  // se nenhum estiver selecionado). Default: solid branco opacity 1.
  async function addBgLayer() {
    const fc = fabricRef.current
    if (!fc) return
    const { Rect } = await import("fabric")
    const insertAt = (() => {
      const sel = selectedRef.current as any
      if (sel?.__isBg && typeof sel.__bgIdx === "number") return sel.__bgIdx + 1
      return bgLayersRef.current.length
    })()
    const newLayer: BgLayerData = { kind: "solid", color: "#ffffff", opacity: 1 }
    bgLayersRef.current.splice(insertAt, 0, newLayer)
    const r = new Rect({
      left: 0, top: 0, width: canvasWRef.current, height: canvasHRef.current,
      fill: newLayer.color, opacity: newLayer.opacity,
      selectable: true, evented: true,
      hasControls: false, hasBorders: true,
      lockMovementX: true, lockMovementY: true,
      lockScalingX: true, lockScalingY: true, lockRotation: true,
      excludeFromExport: true,
    })
    ;(r as any).__isBg = true
    fc.add(r)
    bgRectsRef.current.splice(insertAt, 0, r)
    // Re-numera __bgIdx + labels + manda BGs pro fundo na ordem correta
    rebuildBgStack(fc)
    fc.setActiveObject(r)
    setSelected(r)
    refreshLayers(fc)
    doSave()
  }

  // Remove o BG layer no idx informado. Nao permite remover o ULTIMO (sempre
  // tem pelo menos 1 BG — igual o PS exige um Background na pilha).
  function removeBgLayer(idx: number) {
    const fc = fabricRef.current
    if (!fc) return
    if (bgLayersRef.current.length <= 1) return // protege o ultimo
    const rect = bgRectsRef.current[idx]
    if (rect) fc.remove(rect)
    bgLayersRef.current.splice(idx, 1)
    bgRectsRef.current.splice(idx, 1)
    rebuildBgStack(fc)
    setSelected(null)
    refreshLayers(fc)
    doSave()
  }

  // Substitui TODA a lista de BG layers da peca (usado pelo import PSD e
  // futuras features). Remove os Rects antigos, cria novos, atualiza
  // bgLayersRef + bgRectsRef + espelhos legacy.
  async function replaceBgLayers(layers: BgLayerData[]) {
    const fc = fabricRef.current
    if (!fc || layers.length === 0) return
    for (const r of bgRectsRef.current) fc.remove(r)
    bgRectsRef.current = []
    bgLayersRef.current = layers
    const fabricMod: any = await import("fabric")
    const { Rect } = fabricMod
    const newRects: any[] = []
    for (let i = 0; i < layers.length; i++) {
      const ld = layers[i]
      const r = new Rect({
        left: 0, top: 0, width: canvasWRef.current, height: canvasHRef.current,
        selectable: true, evented: true,
        hasControls: false, hasBorders: true,
        lockMovementX: true, lockMovementY: true,
        lockScalingX: true, lockScalingY: true, lockRotation: true,
        excludeFromExport: true,
      })
      await syncBgLayerToRect(r, ld, canvasWRef.current, canvasHRef.current, fabricMod)
      ;(r as any).__isBg = true
      ;(r as any).__bgIdx = i
      ;(r as any).__assetLabel = i === 0 ? "Background" : `Background ${i + 1}`
      ;(r as any).__hidden = ld.hidden === true
      ;(r as any).__locked = ld.locked === true
      fc.add(r)
      newRects.push(r)
    }
    bgRectsRef.current = newRects
    bgRef.current = newRects[0]
    // BGs sempre no fundo (idx 0 = mais embaixo)
    for (let i = newRects.length - 1; i >= 0; i--) fc.sendObjectToBack(newRects[i])
    // Espelhos legacy
    bgOpacityRef.current = layers[0].opacity
    setBgOpacity(layers[0].opacity)
    if (layers[0].kind === "solid") {
      const c = typeof layers[0].color === "string" ? layers[0].color : "#ffffff"
      bgColorRef.current = c
      setBgColor(c)
    } else if (layers[0].kind === "gradient") {
      const c = typeof layers[0].stops?.[0]?.color === "string" ? layers[0].stops[0].color : "#ffffff"
      bgColorRef.current = c
      setBgColor(c)
    }
    fc.renderAll()
  }

  // Re-numera __bgIdx + labels dos Rects BG e re-empilha no canvas (idx 0
  // no fundo, idx N no topo dos BGs mas abaixo de qualquer asset). Tambem
  // sincroniza bgColorRef/bgOpacityRef com o BG[0] (back-compat legacy).
  function rebuildBgStack(fc: any) {
    for (let i = 0; i < bgRectsRef.current.length; i++) {
      const r = bgRectsRef.current[i]
      ;(r as any).__bgIdx = i
      ;(r as any).__assetLabel = i === 0 ? "Background" : `Background ${i + 1}`
    }
    // sendObjectToBack do topo pro fundo deixa idx 0 no fundo absoluto
    for (let i = bgRectsRef.current.length - 1; i >= 0; i--) {
      fc.sendObjectToBack(bgRectsRef.current[i])
    }
    bgRef.current = bgRectsRef.current[0]
    if (bgLayersRef.current[0]) {
      bgColorRef.current = bgLayerLegacyColor(bgLayersRef.current[0])
      bgOpacityRef.current = bgLayersRef.current[0].opacity
    }
  }

  // Sincroniza hexInput com a cor efetiva (do caractere ou do textbox)
  useEffect(() => {
    const obj = selected as any
    if (!obj) return
    const isText = obj.type === "textbox" || obj.type === "i-text"
    let fill: string | undefined = obj.fill
    if (isText && obj.getSelectionStyles) {
      try {
        if (obj.isEditing && obj.selectionStart !== obj.selectionEnd) {
          const styles = obj.getSelectionStyles(obj.selectionStart, obj.selectionEnd)
          if (styles?.length > 0 && styles[0].fill) fill = styles[0].fill
        } else if (obj.isEditing) {
          const idx = (obj.selectionStart ?? 1) > 0 ? obj.selectionStart - 1 : 0
          const text: string = obj.text ?? ""
          if (idx < text.length) {
            const styles = obj.getSelectionStyles(idx, idx + 1)
            if (styles?.length > 0 && styles[0].fill) fill = styles[0].fill
          }
        } else {
          const text: string = obj.text ?? ""
          if (text.length > 0) {
            const styles = obj.getSelectionStyles(0, text.length)
            if (styles?.length > 0) {
              const fills = new Set(styles.map((s: any) => s.fill ?? obj.fill))
              if (fills.size === 1) fill = [...fills][0] as string
            }
          }
        }
      } catch {}
    }
    if (fill) setHexInput(fill)
  }, [selected, selectedTick])

  // Sincroniza bgHexInput com bgColor. Defensiva: bgColor sempre string aqui.
  useEffect(() => { setBgHexInput(typeof bgColor === "string" ? bgColor : "#ffffff") }, [bgColor])

  // Auto-scroll: traz o row do layer selecionado pro foco no painel Layers.
  // Quando o user seleciona um obj no CANVAS (clicando direto nele), o
  // painel pode estar com scroll diferente e o row sumido. Smooth scroll
  // pra ficar evidente onde ele esta na arvore.
  // Tambem dispara pulse de glow no row pra chamar a atencao do user —
  // remonta a div via key={layerPulseKey} pra reiniciar a CSS animation.
  useEffect(() => {
    if (!selected) return
    setLayerPulseKey(k => k + 1)
    // rAF pra esperar o re-render terminar antes de medir o DOM
    requestAnimationFrame(() => {
      try {
        const el = document.querySelector<HTMLElement>('[data-layer-selected="1"]')
        if (!el) return
        // scrollIntoView com block: "nearest" so rola se necessario (UX boa)
        el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" })
      } catch {}
    })
  }, [selected, selectedTick])

  // Sincroniza bgColor/bgOpacity state com o BG layer ATUALMENTE selecionado.
  // Quando nada esta selecionado, mostra os valores do BG[0] (fundo) — UX
  // conservadora: o painel sempre mostra ALGUM BG, igual antes.
  useEffect(() => {
    const obj = selected as any
    let idx = 0
    if (obj?.__isBg && typeof obj.__bgIdx === "number") idx = obj.__bgIdx
    const layer = bgLayersRef.current[idx]
    if (!layer) return
    setBgColor(bgLayerLegacyColor(layer))
    setBgOpacity(layer.opacity)
  }, [selected, selectedTick])

  // Sincroniza fontSizeInput com o tamanho efetivo do objeto selecionado.
  // - Se ha selecao parcial dentro do textbox: usa fontSize do caractere selecionado
  // - Se nao: usa fontSize raw (sem scale, igual Photoshop mostra)
  // selectedTick refresca em mouseup/keyup/object:modified, garantindo update apos
  // qualquer interacao (mover cursor, escalar pelo box, etc).
  // SKIP se o usuario esta digitando num input do painel — evita sobrescrever digitacao
  // em curso (ex: user tipo "8", reload do useEffect colocaria "5" antigo).
  useEffect(() => {
    if (!selected) return
    // Se algum input numérico do painel está em digitação, NÃO sincroniza —
    // sobrescrever fontSizeInput/leadingInput durante a digitação reseta o
    // input pro valor antigo e quebra o input visualmente.
    // Ref é mais confiável que document.activeElement (que pode estar stale
    // entre renders concorrentes do React 18).
    if (numericInputFocusedRef.current) return

    const obj = selected as any
    const isText = obj.type === "textbox" || obj.type === "i-text"
    let fs: number = obj.fontSize ?? 80
    if (isText && obj.getSelectionStyles) {
      try {
        if (obj.isEditing && obj.selectionStart !== obj.selectionEnd) {
          // edit mode + range: tamanho do range
          const styles = obj.getSelectionStyles(obj.selectionStart, obj.selectionEnd)
          if (styles?.length > 0 && styles[0].fontSize) fs = styles[0].fontSize
        } else if (obj.isEditing) {
          // edit mode + cursor: tamanho do caractere atual
          const idx = (obj.selectionStart ?? 1) > 0 ? obj.selectionStart - 1 : 0
          const text: string = obj.text ?? ""
          if (idx < text.length) {
            const styles = obj.getSelectionStyles(idx, idx + 1)
            if (styles?.length > 0 && styles[0].fontSize) fs = styles[0].fontSize
          }
        } else {
          // caixa selecionada: tamanho do TEXTO INTEIRO se uniforme; senao default
          const text: string = obj.text ?? ""
          if (text.length > 0) {
            const styles = obj.getSelectionStyles(0, text.length)
            if (styles?.length > 0) {
              const sizes = new Set(styles.map((s: any) => s.fontSize ?? obj.fontSize))
              if (sizes.size === 1) fs = [...sizes][0] as number
            }
          }
        }
      } catch {}
    }
    setFontSizeInput(String(Math.round(fs)))

    // Sincroniza leadingInput tambem (Adobe-style: leadingPt explicito ou Auto = 1:1 com fontSize)
    if (isText) {
      const lh = obj.lineHeight ?? 1.0
      const leadingPt = obj.leadingPt
      const effectiveLeading = (leadingPt === undefined || leadingPt === null)
        ? Math.round(lh * fs)
        : leadingPt
      setLeadingInput(String(Math.round(effectiveLeading)))
    }
  }, [selected, selectedTick])

  /**
   * Atualiza o lastOverride do asset (so na MATRIZ).
   * lastOverride = template visual que vai ser aplicado quando o asset for
   * adicionado em outro canvas ou via swap. Pecas NAO atualizam isso.
   */
  function updateAssetLastOverride(obj: any) {
    if (pieceId) return // peca nao atualiza lastOverride
    const aid = obj?.__assetId
    if (!aid) return
    const isText = obj.type === "textbox" || obj.type === "i-text"
    if (!isText) return // por ora so texto tem lastOverride

    const lastOverride: any = {}
    if (obj.fill !== undefined) lastOverride.fill = obj.fill
    if (obj.fontSize !== undefined) lastOverride.fontSize = obj.fontSize
    if (obj.fontFamily !== undefined) lastOverride.fontFamily = obj.fontFamily
    if (obj.fontWeight !== undefined) lastOverride.fontWeight = obj.fontWeight
    if (obj.charSpacing !== undefined) lastOverride.charSpacing = obj.charSpacing
    if (obj.lineHeight !== undefined) lastOverride.lineHeight = obj.lineHeight
    if (obj.textAlign !== undefined) lastOverride.textAlign = obj.textAlign
    if ((obj as any).leadingPt !== undefined && (obj as any).leadingPt !== null) {
      lastOverride.leadingPt = (obj as any).leadingPt
    }
    // Styles per-caractere (cores/tamanhos por letra). Sem salvar isso, swap perderia
    // a config quando usuario pinta letras individuais via duplo-clique + selecao.
    if (obj.styles && typeof obj.styles === "object" && Object.keys(obj.styles).length > 0) {
      lastOverride.styles = obj.styles
    }
    // BOX overrides: largura e altura da caixa de texto. Importante pra reset textos
    // ao swap (Photoshop-style: cada texto tem sua propria largura/altura de caixa).
    if (obj.width !== undefined) lastOverride.width = obj.width
    if (obj.height !== undefined) lastOverride.height = obj.height
    // Atualiza tambem o cache local pra swap funcionar dentro da mesma sessao
    const c = campaignRef.current
    if (c?.assets) {
      const asset = c.assets.find((a: Asset) => a.id === aid)
      if (asset) (asset as any).lastOverride = lastOverride
    }
    // Persiste no banco com DEBOUNCE 400ms: sliders/inputs em sequencia rapida
    // antes acumulavam 1 PUT por mudanca, sobrecarregando a API. O ultimo PUT
    // ganha (mantem payload mais recente).
    lastOverridePendingPayload.current = { aid, payload: { lastOverride } }
    clearTimeout(lastOverridePutTimer.current)
    lastOverridePutTimer.current = setTimeout(() => {
      const pending = lastOverridePendingPayload.current
      if (!pending) return
      lastOverridePendingPayload.current = null
      fetch(`/api/campaigns/${campaignId}/assets/${pending.aid}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending.payload),
      }).catch(err => console.warn("[updateAssetLastOverride] failed:", err))
    }, 400)
  }

  // Matriz: propaga caracteres editados pro asset.content (fonte da verdade
  // dos caracteres em TODAS as pecas geradas — atuais e futuras). Chamado em
  // text:editing:exited junto com updateAssetLastOverride.
  // IMPORTANTE: quebras de linha (\n) sao STRIPADAS aqui — o asset nunca tem
  // \n. Quebras ficam locais a matriz (em layer.overrides.text) e a cada peca
  // (em layer.overrides.text na peca). Novas pecas geradas herdam o \n da
  // matriz via spread em GeneratePiecesModal; depois disso ficam independentes.
  // Cuidado com o \n entre palavras: se o user seleciona o espaco e aperta
  // Enter ("Hello World" -> "Hello\nWorld"), strip puro vira "HelloWorld" e
  // come o espaco. Solucao: \n entre dois nao-whitespace vira " "; entre
  // whitespace+algo, e' removido (o whitespace ja separa as palavras).
  function updateAssetContent(obj: any) {
    if (pieceId) return // peca nao propaga pro asset
    const aid = obj?.__assetId
    if (!aid) return
    const isText = obj.type === "textbox" || obj.type === "i-text"
    if (!isText) return
    const fullText: string = obj.text ?? ""
    const objStyles = obj.styles ?? {}
    const defaultStyle = {
      color: obj.fill ?? "#111111",
      fontSize: obj.fontSize ?? 80,
      fontWeight: obj.fontWeight ?? "normal",
      fontFamily: obj.fontFamily ?? "Arial",
    }
    const lines = fullText.split("\n")
    const chars: Array<{ ch: string; style: any }> = []
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum]
      const lineStyles = objStyles[lineNum] ?? {}
      for (let col = 0; col < line.length; col++) {
        const cs = lineStyles[col] ?? {}
        chars.push({
          ch: line[col],
          style: {
            color: cs.fill ?? defaultStyle.color,
            fontSize: cs.fontSize ?? defaultStyle.fontSize,
            fontWeight: cs.fontWeight ?? defaultStyle.fontWeight,
            fontFamily: cs.fontFamily ?? defaultStyle.fontFamily,
          },
        })
      }
      // PRESERVA "\n" entre logical lines do raw text. Antes esse joiner
      // INSERIA UM " " — perdendo a quebra explicita e desalinhando per-char
      // styles no proximo load (chars indexados por linha visual nao batiam
      // com obj.styles indexado por linha logica). Resultado: cores per-char
      // sumiam no PSD export. Como agora usamos obj.text (raw) split por "\n"
      // como fonte de lines, todo "\n" original eh explicito.
      if (lineNum < lines.length - 1) {
        const lastStyle = chars.length > 0 ? chars[chars.length - 1].style : defaultStyle
        chars.push({ ch: "\n", style: lastStyle })
      }
    }
    // Agrupa chars consecutivos com mesmo style em spans
    const spans: TextSpan[] = []
    let buf = ""
    let bufStyle: any = null
    for (const { ch, style } of chars) {
      if (bufStyle === null) {
        buf = ch
        bufStyle = style
      } else if (JSON.stringify(bufStyle) === JSON.stringify(style)) {
        buf += ch
      } else {
        spans.push({ text: buf, style: bufStyle })
        buf = ch
        bufStyle = style
      }
    }
    if (buf) spans.push({ text: buf, style: bufStyle ?? defaultStyle })
    const finalSpans: TextSpan[] = spans.length > 0 ? spans : [{ text: "", style: defaultStyle }]
    // Atualiza cache local pra que swaps/reloads na mesma sessao usem o texto novo
    const c = campaignRef.current
    if (c?.assets) {
      const asset = c.assets.find((a: Asset) => a.id === aid)
      if (asset) (asset as any).content = finalSpans
    }
    // PUT debounceado 400ms — content do asset dispara TRANSACTION pesada
    // (migra styles em todas pecas + matriz). Sem debounce, sair de edicao
    // rapida em multiplos textboxes acumulava 1 transaction por exit.
    assetContentPendingPayload.current = { aid, payload: { content: finalSpans } }
    clearTimeout(assetContentPutTimer.current)
    assetContentPutTimer.current = setTimeout(() => {
      const pending = assetContentPendingPayload.current
      if (!pending) return
      assetContentPendingPayload.current = null
      fetch(`/api/campaigns/${campaignId}/assets/${pending.aid}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending.payload),
      }).catch(err => console.warn("[updateAssetContent] failed:", err))
    }, 400)
  }

  /**
   * Substitui cirurgicamente uma fonte missing por outra disponivel em TODOS
   * os textboxes do canvas que usam essa variante exata (family + weight + style).
   * Adobe-style "Replace Missing Fonts": preserva textos que usam outras variantes
   * da mesma familia (ex: substituir Sicredi Sans Bold Italic nao mexe em
   * Sicredi Sans Regular). Per-char styles tambem sao varridos.
   *
   * Persiste via doSave; canvas re-mede com initDimensions.
   */
  function substituteFontInCanvas(
    oldFamily: string,
    oldWeight: number,
    oldStyle: "normal" | "italic",
    newFamily: string,
  ) {
    const fc = fabricRef.current
    if (!fc) return
    const weightToNum = (w: any): number => {
      if (typeof w === "number") return w
      if (typeof w === "string") {
        const lower = w.trim().toLowerCase()
        if (lower === "bold") return 700
        if (lower === "normal" || lower === "regular") return 400
        const n = Number(lower)
        if (Number.isFinite(n) && n > 0) return n
      }
      return 400
    }
    const styleToCanon = (s: any): "normal" | "italic" =>
      typeof s === "string" && /italic|oblique/i.test(s) ? "italic" : "normal"
    let touched = 0
    for (const o of fc.getObjects()) {
      if (o.type !== "textbox" && o.type !== "i-text") continue
      const tb = o as any
      // CRITICO: captura defaults ORIGINAIS antes de mexer — fallback per-char
      // precisa comparar contra o que estava antes da substituicao, nao depois.
      const originalDefaultFamily = tb.fontFamily
      const originalDefaultWeight = tb.fontWeight
      const originalDefaultStyle = tb.fontStyle
      // Default do textbox: troca se a variante bate exatamente
      if (originalDefaultFamily === oldFamily
          && weightToNum(originalDefaultWeight) === oldWeight
          && styleToCanon(originalDefaultStyle) === oldStyle) {
        tb.set("fontFamily", newFamily)
        touched++
      }
      // Per-char: itera styles e troca cada char que bate
      const styles = tb.styles
      if (styles && typeof styles === "object") {
        for (const lineKey of Object.keys(styles)) {
          const line = styles[lineKey]
          if (!line || typeof line !== "object") continue
          for (const colKey of Object.keys(line)) {
            const cs = line[colKey]
            if (!cs) continue
            const charFamily = cs.fontFamily ?? originalDefaultFamily
            const charWeight = weightToNum(cs.fontWeight ?? originalDefaultWeight)
            const charStyle = styleToCanon(cs.fontStyle ?? originalDefaultStyle)
            if (charFamily === oldFamily && charWeight === oldWeight && charStyle === oldStyle) {
              cs.fontFamily = newFamily
              touched++
            }
          }
        }
      }
      if ((tb as any).initDimensions) (tb as any).initDimensions()
      tb.setCoords()
    }
    if (touched > 0) {
      fc.requestRenderAll()
      isDirtyRef.current = true
      setIsDirty(true)
      if (isInitialized.current && !isApplyingHistory.current) pushHistory()
      doSave()
    }
    return touched
  }

  function applyStyle(key: string, val: any, brandIdx?: number) {
    const fc = fabricRef.current; const obj = selected
    if (!fc || !obj) return
    const value = key === "fontSize" ? Number(val) : val
    const styleKey = key === "fill" ? "fill" : key
    // Brand ref: ao clicar num swatch de Marca, marca __fillBrandIdx. Em
    // qualquer outra mudanca de fill (color picker, hex, swatch padrao),
    // limpa pra desassociar. Persiste em overrides.fillBrandIdx no save.
    if (key === "fill") {
      if (typeof brandIdx === "number") {
        ;(obj as any).__fillBrandIdx = brandIdx
      } else {
        delete (obj as any).__fillBrandIdx
      }
    }
    // DS link: mudanca via Properties Panel em campos tipograficos quebra o
    // vinculo com o Design System (esse layer fica "customizado"). Scale,
    // posicao, rotacao, fill NAO quebram — soh esses 5 campos centrais:
    // fontFamily/fontWeight/fontSize/leadingPt/charSpacing (+ fontStyle).
    // Bolinha no painel de layers vira vermelha. Setado APENAS quando o
    // user atua via UI (esta funcao), nao em re-set programatico de save/load.
    // INCLUI fill (cor) quando aplicado SEM brandIdx — cor custom (hex picker)
    // quebra link com DS. Cor de swatch da marca (brandIdx setado) mantem link.
    // Sem isso, server propagava preset e sobrescrevia override de cor sem
    // detectar que o user havia customizado.
    const breaksDsLink =
      key === "fontFamily" || key === "fontWeight" || key === "fontStyle"
      || key === "fontSize" || key === "leadingPt" || key === "charSpacing"
      || (key === "fill" && typeof brandIdx !== "number")
    if (breaksDsLink) {
      ;(obj as any).__dsLinked = false
    }

    const isText = obj.type === "textbox" || obj.type === "i-text"
    const isEditing = (obj as any).isEditing
    const saved = savedTextSelection.current
    const hasSavedSel = !!(saved && saved.obj === obj && saved.start !== saved.end)
    const selStart = isEditing ? (obj.selectionStart ?? 0) : (hasSavedSel ? saved!.start : 0)
    const selEnd = isEditing ? (obj.selectionEnd ?? 0) : (hasSavedSel ? saved!.end : 0)
    const hasSelection = (isEditing || hasSavedSel) && selStart !== selEnd

    if (isText && hasSelection) {
      // Photoshop: aplica so nos caracteres selecionados
      // Brand ref per-char: quando fill vem via swatch Marca + tem seleção,
      // grava `fillBrandIdx` JUNTO no style do char pra que o cascade possa
      // re-resolver no futuro. Sem isso, char fica com fill literal e
      // perdemos o vinculo com a brand.
      const charStyle: any = { [styleKey]: value }
      if (key === "fill") {
        if (typeof brandIdx === "number") charStyle.fillBrandIdx = brandIdx
        else charStyle.fillBrandIdx = null // sinaliza pro merge desabilitar ref antigo
      }
      obj.setSelectionStyles(charStyle, selStart, selEnd)
      // Limpa fillBrandIdx=null nos styles (Fabric guarda null como valor real;
      // pra "nao ter" o campo, deletar). Itera styles afetados.
      if (key === "fill" && typeof brandIdx !== "number") {
        try {
          const styles = (obj as any).styles ?? {}
          for (const lineKey of Object.keys(styles)) {
            for (const colKey of Object.keys(styles[lineKey])) {
              if (styles[lineKey][colKey]?.fillBrandIdx === null) {
                delete styles[lineKey][colKey].fillBrandIdx
              }
            }
          }
        } catch {}
      }
      // initDimensions so eh necessario quando mudanca afeta layout (fontSize, fontFamily).
      // Mudar cor (fill) nao muda layout — chamar initDimensions a toa pode trigger bugs
      // (ex: ate observado que pode "comer" espacos em algumas situacoes de styles per-char).
      if (styleKey !== "fill" && (obj as any).initDimensions) (obj as any).initDimensions()
    } else if (isText) {
      // Aplica como default do textbox. Caracteres com override per-char MANTEM
      // seu estilo PRA COR (Photoshop: mudar cor padrao nao apaga cores das
      // letras especificas). MAS pra fontSize/fontFamily/fontWeight sem
      // selecao parcial, o user esperava "mudar tudo" — sintoma reportado:
      // "nao consigo alterar o tamanho da fonte do titulo". Removemos os
      // per-char overrides desses campos pra que o set() default tenha efeito
      // visual completo.
      if (styleKey === "fontSize" || styleKey === "fontFamily" || styleKey === "fontWeight" || styleKey === "fontStyle") {
        const styles = (obj as any).styles
        if (styles && typeof styles === "object") {
          for (const lineKey of Object.keys(styles)) {
            const line = styles[lineKey]
            if (!line || typeof line !== "object") continue
            for (const colKey of Object.keys(line)) {
              if (line[colKey] && Object.prototype.hasOwnProperty.call(line[colKey], styleKey)) {
                delete line[colKey][styleKey]
              }
              // Limpa entry vazio pra nao deixar lixo
              if (line[colKey] && Object.keys(line[colKey]).length === 0) delete line[colKey]
            }
            if (Object.keys(line).length === 0) delete styles[lineKey]
          }
        }
      }
      obj.set(styleKey, value)
      // Adobe-style: leading e fontSize sao independentes. Quando muda fontSize, o leadingPt
      // (em pontos absolutos) fica congelado, mas o lineHeight do Fabric (multiplicador)
      // precisa recalcular pra renderizar com o leading correto.
      if (styleKey === "fontSize") syncLineHeightFromLeading(obj)
      if (styleKey !== "fill" && (obj as any).initDimensions) (obj as any).initDimensions()
    } else {
      obj.set(styleKey, value)
    }

    obj.setCoords()
    fc.renderAll()
    setSelectedTick(t => t + 1)

    // Atualiza lastOverride do asset (so na matriz). Define o template visual
    // que sera aplicado em swaps futuros e novas pecas.
    if (isText) updateAssetLastOverride(obj)

    // History: applyStyle modifica obj via setSelectionStyles/.set, e Fabric
    // NAO dispara object:modified em mudancas programaticas (so em mouse
    // drag/resize/rotate). Sem push explicito, mudanças de cor/fontSize/
    // fontFamily/charSpacing/lineHeight/textAlign nao entram no undo stack.
    // Sintoma reportado: "undo desfaz config do texto que nao foi tocado
    // nessa acao" — porque o snap anterior nem capturou o estado COM config.
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    // Modelo final: styles editados via painel direito sao SEMPRE locais
    // (override do layer), tanto na matriz quanto na peca. Nao propaga pro asset.
    doSave()
  }

  /**
   * Aplica propriedade no textbox INTEIRO, ignorando selecao parcial.
   * Usado pra textAlign — Fabric nao suporta esses per-char.
   */
  function applyTextboxStyle(key: string, value: any) {
    const fc = fabricRef.current; const obj = selected
    if (!fc || !obj) return
    const isText = (obj as any).type === "textbox" || (obj as any).type === "i-text"
    if (!isText) return
    ;(obj as any).set(key, value)
    if ((obj as any).initDimensions) (obj as any).initDimensions()
    ;(obj as any).setCoords()
    fc.renderAll()
    setSelectedTick(t => t + 1)
    // History: mudanca programatica nao dispara object:modified.
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  /**
   * Aplica blend mode (PSD-style) no objeto selecionado. Canvas usa nomes
   * `globalCompositeOperation` (multiply, screen, overlay, etc). Persistido
   * no save como layer.blendMode (round-trip pro PSD).
   *
   * "source-over" = Normal (default). Outros valores ativam blending no
   * canvas Fabric. Funciona pra qualquer tipo de objeto (texto, imagem, etc).
   */
  function changeObjectBlendMode(mode: string) {
    const fc = fabricRef.current; const obj = selected
    if (!fc || !obj) return
    ;(obj as any).set("globalCompositeOperation", mode)
    fc.requestRenderAll()
    setSelectedTick(t => t + 1)
    isDirtyRef.current = true
    setIsDirty(true)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  /**
   * Opacidade 0..1 do objeto selecionado. Round-trip: vira layer.opacity
   * (preservado no PSD export).
   */
  function changeObjectOpacity(opacity: number) {
    const fc = fabricRef.current; const obj = selected
    if (!fc || !obj) return
    const clamped = Math.max(0, Math.min(1, opacity))
    ;(obj as any).set("opacity", clamped)
    fc.requestRenderAll()
    setSelectedTick(t => t + 1)
    isDirtyRef.current = true
    setIsDirty(true)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  /**
   * Sincroniza Fabric.lineHeight a partir do modelo de tipografia (Adobe-style):
   *   - Se leadingPt definido: lineHeight = leadingPt / fontSize
   *   - Se Auto (leadingPt undefined/null): lineHeight = 1.0 (1:1 com fontSize)
   *
   * Detalhe interno do motor — chamado quando muda leadingPt OU quando muda fontSize.
   * Usuario nao "sente" isso, ele soh pensa em pontos absolutos ou Auto.
   */
  function syncLineHeightFromLeading(obj: any) {
    if (!obj) return
    const isText = obj.type === "textbox" || obj.type === "i-text"
    if (!isText) return
    const fs = obj.fontSize ?? 48
    const leadingPt = obj.leadingPt
    const lh = (leadingPt === undefined || leadingPt === null)
      ? 1.0
      : leadingPtToFabricLineHeight(leadingPt, fs)
    obj.set("lineHeight", lh)
  }

  /**
   * Define leading em pontos (Adobe-style). Pass null pra resetar pra "Auto".
   * Leading e fontSize sao independentes — mudar um nao mexe no outro.
   */
  function setLeading(pt: number | null) {
    const fc = fabricRef.current; const obj = selected as any
    if (!fc || !obj) return
    const isText = obj.type === "textbox" || obj.type === "i-text"
    if (!isText) return
    if (pt === null) delete obj.leadingPt
    else obj.leadingPt = pt
    // DS link: alterar leading via Properties Panel quebra o vinculo.
    obj.__dsLinked = false
    syncLineHeightFromLeading(obj)
    if (obj.initDimensions) obj.initDimensions()
    obj.setCoords()
    fc.renderAll()
    // NAO disparar setSelectedTick aqui — isso re-roda o useEffect que
    // reescreve `leadingInput` no meio da digitacao, quebrando o input.
    // O reset ao Auto (botao "A") usa um caminho separado que sincroniza.
    if (pt === null) setSelectedTick(t => t + 1)
    doSave()
  }

  function changeZoom(delta: number) {
    const fc = fabricRef.current; if (!fc) return
    applyZoom(fc, Math.min(3, Math.max(0.05, zoomRef.current + delta)))
  }

  /**
   * Centraliza a peca no viewport com zoom fit — mesma logica do init: reserva
   * HANDLE_MARGIN ao redor da peca pros handles aparecerem mesmo em objetos
   * que extrapolam o artboard. applyZoom recalcula offset + overlays. Util
   * quando o user faz pan/zoom e quer voltar ao estado inicial.
   *
   * Atalho: Shift+1 (estilo Figma) ou clica em "Centralizar" na barra.
   */
  function centerView() {
    const fc = fabricRef.current; if (!fc) return
    const fullW = (fabricRef as any).__canvasFullW ?? fc.getWidth()
    const fullH = (fabricRef as any).__canvasFullH ?? fc.getHeight()
    const cw = canvasWRef.current
    const ch = canvasHRef.current
    const HANDLE_MARGIN = 120
    const z = Math.round(Math.min(0.8,
      Math.max(0.05, (fullW - HANDLE_MARGIN * 2) / cw),
      Math.max(0.05, (fullH - HANDLE_MARGIN * 2) / ch),
    ) * 100) / 100
    applyZoom(fc, z)
  }

  /**
   * Alinha o objeto selecionado ao centro da PECA (artboard), tanto horizontal
   * quanto verticalmente. Usa aCoords pra bbox real (respeita scale + rotacao);
   * fallback pra left/top/width/height quando aCoords nao disponivel.
   *
   * Importante: aqui "centro do canvas" eh o CENTRO DA PECA (coords do mundo
   * Fabric: cw/2, ch/2), nao o centro do canvas DOM. Sem isso, com zoom/pan
   * arbitrarios, o objeto cairia em pixels que nao tem nada a ver com a peca.
   *
   * Suporta ActiveSelection: move todo o grupo preservando spacing relativo.
   */
  function centerObjectInCanvas() {
    const fc = fabricRef.current; if (!fc) return
    const active = fc.getActiveObject() as any
    if (!active) return
    if ((active as any).__isBg || (active as any).__isBleedOverlay) return
    const cw = canvasWRef.current
    const ch = canvasHRef.current
    // Pega bbox em coords do mundo
    let bx: number, by: number, bw: number, bh: number
    if (active.aCoords) {
      const br = active.aCoords
      const xs = [br.tl.x, br.tr.x, br.bl.x, br.br.x]
      const ys = [br.tl.y, br.tr.y, br.bl.y, br.br.y]
      bx = Math.min(...xs); by = Math.min(...ys)
      bw = Math.max(...xs) - bx; bh = Math.max(...ys) - by
    } else {
      bx = active.left ?? 0
      by = active.top ?? 0
      bw = (active.width ?? 100) * (active.scaleX ?? 1)
      bh = (active.height ?? 100) * (active.scaleY ?? 1)
    }
    // Delta pra centralizar bbox no centro da peca
    const dx = (cw - bw) / 2 - bx
    const dy = (ch - bh) / 2 - by
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
    active.set({
      left: (active.left ?? 0) + dx,
      top: (active.top ?? 0) + dy,
    })
    active.setCoords()
    fc.fire("object:modified", { target: active })
    fc.requestRenderAll?.()
  }

  /**
   * Zoom-to-selection (estilo Figma Shift+2): ajusta zoom e pan pra que o
   * objeto ativo (ou ActiveSelection) preencha o viewport com margem. Se nada
   * estiver selecionado, faz o mesmo que centerView (fit da peca).
   *
   * Atalho: Shift+2.
   */
  function zoomToSelection() {
    const fc = fabricRef.current; if (!fc) return
    const active = fc.getActiveObject() as any
    if (!active) { centerView(); return }
    // bbox em coords do mundo
    const br = active.aCoords ?? null
    let minX: number, minY: number, maxX: number, maxY: number
    if (br) {
      minX = Math.min(br.tl.x, br.tr.x, br.bl.x, br.br.x)
      maxX = Math.max(br.tl.x, br.tr.x, br.bl.x, br.br.x)
      minY = Math.min(br.tl.y, br.tr.y, br.bl.y, br.br.y)
      maxY = Math.max(br.tl.y, br.tr.y, br.bl.y, br.br.y)
    } else {
      const l = active.left ?? 0, t = active.top ?? 0
      const w = (active.width ?? 100) * (active.scaleX ?? 1)
      const h = (active.height ?? 100) * (active.scaleY ?? 1)
      minX = l; minY = t; maxX = l + w; maxY = t + h
    }
    const bw = Math.max(1, maxX - minX)
    const bh = Math.max(1, maxY - minY)
    const fullW = (fabricRef as any).__canvasFullW ?? fc.getWidth()
    const fullH = (fabricRef as any).__canvasFullH ?? fc.getHeight()
    // Margem maior pro objeto nao encostar nas bordas
    const PAD = 160
    const z = Math.round(Math.min(3,
      Math.max(0.05, (fullW - PAD * 2) / bw),
      Math.max(0.05, (fullH - PAD * 2) / bh),
    ) * 100) / 100
    // Aplica zoom (recria overlays + setViewportTransform). Depois ajusta vt
    // pra centralizar o objeto especifico no canvas DOM.
    applyZoom(fc, z)
    const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    vt[4] = fullW / 2 - cx * z
    vt[5] = fullH / 2 - cy * z
    fc.setViewportTransform(vt)
    fc.requestRenderAll?.()
  }

  /**
   * Troca o asset associado a um objeto preservando seu transform
   * (left/top/scale/angle/width). Util pra "Trocar asset" no painel:
   * usuario reposicionou o layer e quer trocar o conteudo sem perder
   * o trabalho de layout.
   *
   * Apenas swaps entre assets do MESMO tipo (texto<->texto, imagem<->imagem).
   * Filtragem feita na UI (PropertiesPanel/dropdown).
   */
  async function swapAsset(currentObj: any, newAsset: Asset) {
    const fc = fabricRef.current
    if (!fc || !currentObj || !newAsset) return
    if (currentObj.__assetId === newAsset.id) return // no-op

    // Flush de qualquer save pendente antes de trocar — garante que overrides atuais estão no banco
    clearTimeout(saveTimer.current)

    // MODELO FINAL: cada asset tem seu lastOverride (template visual). Ao swap,
    // o novo asset vem com SEU lastOverride — nao herda os styles do asset
    // anterior. Isso permite swap de ida e volta entre ABC (amarelo) e DEF (azul).
    // Se o novo asset nunca foi configurado, vem default.
    //
    // IMPORTANTE: lastOverride guarda os valores da MATRIZ (ex: fontSize 80). Se
    // estamos numa PECA menor (ex: fontSize 40 = matriz_80 * 0.5), aplicar
    // lastOverride direto cresceria o texto. Calcular a proporcao atual da peca
    // a partir do currentObj e aplicar no newOverrides.
    const newAssetOverridesRaw: any = (newAsset.lastOverride && typeof newAsset.lastOverride === "object")
      ? { ...newAsset.lastOverride }
      : {}
    const newAssetOverrides: any = { ...newAssetOverridesRaw }

    // Descobre a proporcao atual: currentObj.fontSize / currentAsset.lastOverride.fontSize.
    // Se currentAsset tem lastOverride com fontSize, isso da a escala usada pra renderizar.
    // Aplicamos a mesma escala no fontSize do novo asset (se ele tem lastOverride.fontSize).
    if (pieceId) {
      const c = campaignRef.current
      const currentAsset = c?.assets.find((a: Asset) => a.id === currentObj.__assetId)
      const curTplFontSize = (currentAsset as any)?.lastOverride?.fontSize
      const curObjFontSize = currentObj.fontSize
      if (typeof curTplFontSize === "number" && curTplFontSize > 0 && typeof curObjFontSize === "number") {
        const ratio = curObjFontSize / curTplFontSize
        if (typeof newAssetOverrides.fontSize === "number") {
          newAssetOverrides.fontSize = newAssetOverrides.fontSize * ratio
        }
        if (typeof newAssetOverrides.leadingPt === "number") {
          newAssetOverrides.leadingPt = newAssetOverrides.leadingPt * ratio
        }
        if (newAssetOverrides.styles && typeof newAssetOverrides.styles === "object") {
          const scaledStyles: any = {}
          for (const lineKey of Object.keys(newAssetOverrides.styles)) {
            scaledStyles[lineKey] = {}
            for (const colKey of Object.keys(newAssetOverrides.styles[lineKey])) {
              const cs = { ...newAssetOverrides.styles[lineKey][colKey] }
              if (typeof cs.fontSize === "number") cs.fontSize = cs.fontSize * ratio
              scaledStyles[lineKey][colKey] = cs
            }
          }
          newAssetOverrides.styles = scaledStyles
        }
      }
    }

    // Box (width/height) do novo asset: usa lastOverride.width/height se existir,
    // escalado pela proporcao atual da peca. Senao mantem o width/height do textbox
    // atual (current). Modelo: cada asset texto tem sua propria caixa.
    let swapWidth = currentObj.width ?? 400
    let swapHeight = currentObj.height ?? 100
    if (pieceId) {
      const cAssets = campaignRef.current?.assets ?? []
      const curAsset = cAssets.find((a: Asset) => a.id === currentObj.__assetId)
      const curTplW = (curAsset as any)?.lastOverride?.width
      const curObjW = currentObj.width
      // ratio baseado em width (BOX): peca_w / matriz_w. Aplica em newAsset.lastOverride.width.
      const wRatio = (typeof curTplW === "number" && curTplW > 0 && typeof curObjW === "number")
        ? curObjW / curTplW : null
      const newTplW = (newAsset.lastOverride as any)?.width
      const newTplH = (newAsset.lastOverride as any)?.height
      if (typeof newTplW === "number" && wRatio !== null) swapWidth = newTplW * wRatio
      if (typeof newTplH === "number" && wRatio !== null) swapHeight = newTplH * wRatio
    } else {
      // Matriz: usa direto o lastOverride.width/height do novo asset (se existir)
      const newTplW = (newAsset.lastOverride as any)?.width
      const newTplH = (newAsset.lastOverride as any)?.height
      if (typeof newTplW === "number") swapWidth = newTplW
      if (typeof newTplH === "number") swapHeight = newTplH
    }

    // Pra IMAGE: pre-carrega a imagem do novo asset pra descobrir naturalW/H
    // e calcular scale uniforme baseado na MENOR DIMENSAO do current. Sem
    // isso, o novo asset herdava width E height do current e distorcia (caia
    // no caminho "width + height explicitos -> stretch" do addAssetToCanvas).
    // Anchor point: centro do bbox do current (vertical + horizontal). Mantem
    // o asset novo onde o antigo estava.
    let imageLayerOverride: { posX: number; posY: number; scaleX: number; scaleY: number } | null = null
    if (newAsset.type === "IMAGE" && newAsset.imageUrl) {
      try {
        const naturalDims = await new Promise<{ w: number; h: number } | null>((resolve) => {
          const el = new window.Image()
          el.crossOrigin = "anonymous"
          el.onload = () => resolve({ w: el.naturalWidth || el.width || 1, h: el.naturalHeight || el.height || 1 })
          el.onerror = () => resolve(null)
          el.src = newAsset.imageUrl!
        })
        if (naturalDims) {
          // Bbox em coords do mundo do current. aCoords respeita scale+rotation.
          let bx: number, by: number, bw: number, bh: number
          const aC = (currentObj as any).aCoords
          if (aC) {
            const xs = [aC.tl.x, aC.tr.x, aC.bl.x, aC.br.x]
            const ys = [aC.tl.y, aC.tr.y, aC.bl.y, aC.br.y]
            bx = Math.min(...xs); by = Math.min(...ys)
            bw = Math.max(...xs) - bx; bh = Math.max(...ys) - by
          } else {
            bx = currentObj.left ?? 0
            by = currentObj.top ?? 0
            bw = (currentObj.width ?? 100) * (currentObj.scaleX ?? 1)
            bh = (currentObj.height ?? 100) * (currentObj.scaleY ?? 1)
          }
          const minSide = Math.min(bw, bh)
          // Scale uniforme: novo asset cabe dentro do menor lado preservando
          // aspect ratio. Se asset eh wide e current eh tall, encolhe pelo
          // height; se asset eh tall e current eh wide, encolhe pelo width.
          const maxNatural = Math.max(naturalDims.w, naturalDims.h)
          const scale = minSide / maxNatural
          const scaledW = naturalDims.w * scale
          const scaledH = naturalDims.h * scale
          // Anchor central: posiciona o novo asset com center = center do current.
          imageLayerOverride = {
            posX: bx + (bw - scaledW) / 2,
            posY: by + (bh - scaledH) / 2,
            scaleX: scale,
            scaleY: scale,
          }
        }
      } catch (e) { editorLog("[swapAsset] preload image falhou:", e) }
    }

    const layerSpec = imageLayerOverride ? {
      posX: imageLayerOverride.posX,
      posY: imageLayerOverride.posY,
      scaleX: imageLayerOverride.scaleX,
      scaleY: imageLayerOverride.scaleY,
      rotation: currentObj.angle ?? 0,
      overrides: newAssetOverrides,
    } : {
      posX: currentObj.left ?? 0,
      posY: currentObj.top ?? 0,
      width: swapWidth,
      height: swapHeight,
      // Mantem o transform fisico (posicao/scale/angulo) — so o conteudo + estilos trocam
      scaleX: currentObj.scaleX ?? 1,
      scaleY: currentObj.scaleY ?? 1,
      rotation: currentObj.angle ?? 0,
      overrides: newAssetOverrides,
    }

    // Remove o atual e adiciona o novo asset com mesmo transform.
    // addAssetToCanvas faz fc.add(newObj) — nao retorna referencia.
    // Pego o ultimo objeto adicionado pra selecionar como ativo.
    const beforeIds = new Set(fc.getObjects())
    // Preserva a mascara antes de remover (move pra o novo objeto).
    const preservedMask = (currentObj as any).__maskData
    fc.remove(currentObj)
    await addAssetToCanvas(fc, newAsset, layerSpec)

    const newObj = fc.getObjects().find((o: any) => !beforeIds.has(o))

    // Re-aplica mascara no novo objeto. Modelo: mascara segue o LAYER (posicao no canvas),
    // nao o asset — entao swap de conteudo preserva o efeito visual.
    if (newObj && preservedMask) {
      ;(newObj as any).__maskData = preservedMask
      const { Image: FabImage, Path } = await import("fabric")
      ;(newObj as any).clipPath = null
      await applyMaskToFabricObject({ Image: FabImage, Path }, newObj, preservedMask)
    }

    fc.requestRenderAll()
    if (newObj) {
      fc.setActiveObject(newObj)
      fc.fire("object:modified", { target: newObj })
    }
  }

  if (!campaign) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#1a1a1a", color: "#888", fontSize: 14 }}>
      Carregando...
    </div>
  )

  // Sem assets cadastrados: nao da pra editar nada (o canvas precisa de pelo
  // menos 1 asset pra arrastar). Mostra orientacao + link pra pagina de assets.
  if (!Array.isArray(campaign.assets) || campaign.assets.length === 0) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#1a1a1a", color: "#aaa", fontSize: 14, gap: 16, padding: 20, textAlign: "center" }}>
      <div style={{ fontSize: 16, color: "#fff", fontWeight: 600 }}>Esta campanha ainda não tem assets.</div>
      <div style={{ maxWidth: 420 }}>Para editar a peça, cadastre ao menos um asset (imagem, logo, ou texto) na campanha.</div>
      <button
        onClick={() => router.push(`/campaigns/${campaignId}/assets`)}
        style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#111" }}
      >Cadastrar assets</button>
      <button
        onClick={() => router.push(`/campaigns/${campaignId}`)}
        style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer", color: "#aaa" }}
      >← Voltar para a campanha</button>
    </div>
  )

  const isText = selected && (selected.type === "textbox" || selected.type === "i-text")
  const pS = { position: "fixed" as const, top: 0, bottom: 0, background: "rgba(18,18,18,0.97)", backdropFilter: "blur(12px)", zIndex: 100, display: "flex", flexDirection: "column" as const, overflowY: "auto" as const }
  const bS = { background: "transparent", border: "none", cursor: "pointer", color: "#aaa", fontSize: 18, padding: "0 4px" } as React.CSSProperties
  // inpS/secS/numInpS/numFieldGrid: fonte unica de verdade em lib/editorFieldStyles.ts.
  // Mudar dimensoes/cores ali = propaga pro editor inteiro. Anti-padrao
  // duplicacao no editor eliminado (user pediu 2026-05-22).

  return (
    <div ref={wrapperRef} style={{ position: "fixed", inset: 0, background: "#1e1e1e", overflow: "hidden" }}>
      {/* CSS keyframes pra pulse de destaque do row selecionado no painel
          Layers. Usa CSS variable --zzosy-accent setada no row pra refletir
          a cor da marca atual. 3 batidas em 1.2s, depois descansa. */}
      <style>{`
        @keyframes zzosy-layer-pulse {
          0%   { box-shadow: 0 0 0 2px transparent; background: transparent; }
          15%  { box-shadow: 0 0 20px 4px var(--zzosy-accent-strong), inset 0 0 0 2px var(--zzosy-accent); background: var(--zzosy-accent-soft); }
          35%  { box-shadow: 0 0 8px 1px var(--zzosy-accent-soft); background: var(--zzosy-accent-faint); }
          55%  { box-shadow: 0 0 20px 4px var(--zzosy-accent-strong), inset 0 0 0 2px var(--zzosy-accent); background: var(--zzosy-accent-soft); }
          75%  { box-shadow: 0 0 8px 1px var(--zzosy-accent-soft); background: var(--zzosy-accent-faint); }
          100% { box-shadow: 0 0 0 2px transparent; background: var(--zzosy-accent-faint); }
        }
      `}</style>
      <div style={{
        position: "absolute",
        left: layersPanelWidth, top: TH + BH, right: propsPanelWidth, bottom: 0,
        overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ lineHeight: 0, flexShrink: 0 }}>
          <canvas ref={canvasRef} style={{ display: "block" }} />
        </div>
      </div>

      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: TH, background: "rgba(17,17,17,0.98)", borderBottom: "1px solid #2a2a2a", display: "flex", alignItems: "center", padding: "0 16px", gap: 12, zIndex: 200 }}>
        <button onClick={async () => {
          const hash = from === "presentation" && isPieceMode && pieceId ? `#piece-${pieceId}` : ""
          const base = from === "presentation"
            ? `/campaigns/${campaignId}/presentation`
            : `/campaigns/${campaignId}`
          const dest = `${base}${hash}`
          // FORCA exit do modo edit de texto. Se o user estava editando um
          // texto inline e clicou Voltar sem clicar fora, text:editing:exited
          // nao dispara naturalmente. Sem isso, a edicao do texto eh perdida.
          try {
            const fc: any = fabricRef.current
            const active = fc?.getActiveObject?.()
            if (active && (active.isEditing || (active as any).isEditing)) {
              if (typeof (active as any).exitEditing === "function") (active as any).exitEditing()
            }
          } catch (e) { /* nao critico */ }
          // Pequeno delay pra o text:editing:exited handler rodar e setar dirty.
          await new Promise(r => setTimeout(r, 50))
          srvLog("Voltar-CLICKED", { isDirty: isDirtyRef.current, dest, savingInFlight: savingInFlightRef.current })
          const navigate = () => {
            srvLog("Voltar-NAVIGATING", { dest })
            // HARD navigation: window.location forca full reload, ignora cache
            // do App Router. Garante que a pagina destino re-monta com dados
            // frescos do servidor.
            if (typeof window !== "undefined") window.location.href = dest
          }
          // Pergunta SOMENTE quando ha mudancas pendentes. Se tudo salvo,
          // navega direto — perguntar "deseja sair" sem razao real era
          // interrupcao desnecessaria (user clicou em Voltar => quer voltar).
          if (isDirtyRef.current) {
            setConfirmExit(() => navigate)
          } else {
            navigate()
          }
        }} style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "6px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#111" }}
          title={from === "presentation" ? "Voltar para a apresentacao" : "Voltar para a campanha"}>
          {from === "presentation" ? "← Voltar para apresentação" : "← Voltar para campanha"}
        </button>
        {/* Nome + indicador "Salvo"/"Não salvo" removidos da topbar a pedido
            do user (2026-05-22) — info redundante; estado salvo continua
            refletido pelo proprio botao Salvar (disabled quando nada mudou). */}
        {/* Botao SALVAR manual. Editor nao salva mais automatico — user precisa
            clicar pra persistir. Disabled quando nada mudou OU ja esta salvando. */}
        <button
          onClick={() => { performSave() }}
          disabled={!isDirty || saving}
          title={!isDirty ? "Nada pra salvar" : saving ? "Aguarde…" : "Salvar alteracoes"}
          style={{
            background: (!isDirty || saving) ? "#1a1a1a" : "#F5C400",
            border: (!isDirty || saving) ? "1px solid #333" : "none",
            borderRadius: 6, padding: "6px 14px", marginLeft: 8,
            fontWeight: 700, fontSize: 13,
            cursor: (!isDirty || saving) ? "not-allowed" : "pointer",
            color: (!isDirty || saving) ? "#666" : "#111",
          }}
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
        {/* Apresentacao movida pro fim (depois de Gerar Pecas) — botao amarelo
            destaque na extremidade direita da topbar (2026-05-22). */}
        {/* STEPS NAVIGATION (modo peca apenas) */}
        {isPieceMode && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8, padding: "4px 8px", background: "#1a1a1a", borderRadius: 6, border: "1px solid #2a2a2a" }}>
            {stepCount > 1 && (
              <>
                <button
                  onClick={() => switchToStep(activeStepIndex - 1)}
                  disabled={activeStepIndex === 0}
                  title="Step anterior"
                  style={{ background: "transparent", border: "none", color: activeStepIndex === 0 ? "#333" : "#aaa", cursor: activeStepIndex === 0 ? "not-allowed" : "pointer", fontSize: 14, padding: "2px 6px", lineHeight: 1 }}
                >
                  Anterior
                </button>
                <span style={{ fontSize: 11, color: "#bbb", fontWeight: 600, minWidth: 60, textAlign: "center" }}>
                  Step {activeStepIndex + 1} de {stepCount}
                </span>
                <button
                  onClick={() => switchToStep(activeStepIndex + 1)}
                  disabled={activeStepIndex >= stepCount - 1}
                  title="Proximo step"
                  style={{ background: "transparent", border: "none", color: activeStepIndex >= stepCount - 1 ? "#333" : "#aaa", cursor: activeStepIndex >= stepCount - 1 ? "not-allowed" : "pointer", fontSize: 14, padding: "2px 6px", lineHeight: 1 }}
                >
                  Próximo
                </button>
                <div style={{ width: 1, height: 16, background: "#333", margin: "0 2px" }} />
              </>
            )}
            <button
              onClick={addStep}
              title="Adicionar novo step (carrossel, sequencia, etc)"
              style={{ background: "transparent", border: "1px solid #444", borderRadius: 4, color: "#F5C400", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 8px" }}
            >
              + Step
            </button>
            <button
              onClick={() => psdStepInputRef.current?.click()}
              title="Substituir o conteúdo do step ativo por um PSD (layers com mesmo nome de asset são linkadas; sem match = ignoradas)"
              style={{ background: "transparent", border: "1px solid #444", borderRadius: 4, color: "#aaa", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 8px" }}
            >
              PSD
            </button>
            {/* Editar Externo: exporta PSD pro disco (FSA API) com hierarquia
                cliente/campanha/veiculo/midia automática. Option/Alt+click
                pra trocar a pasta raiz. */}
            <button
              onClick={(e) => openInExternalApp(e.altKey)}
              title="Exporta esta peça como PSD organizada em cliente/campanha/veiculo/midia. Option+click pra trocar pasta raiz. Depois edita no Photoshop, salva, clica 'Sync'."
              style={{ background: "transparent", border: "1px solid #444", borderRadius: 4, color: "#aaa", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 8px" }}
            >
              Editar Externo
            </button>
            {externalPsdName && (
              <button
                onClick={syncFromExternalApp}
                title={`Re-importa "${externalPsdName}" do disco (use após salvar no Photoshop)`}
                style={{ background: "#2a2a1a", border: "1px solid #F5C400", borderRadius: 4, color: "#F5C400", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 8px" }}
              >
                Sync
              </button>
            )}
            <input
              ref={psdStepInputRef}
              type="file"
              accept=".psd,application/octet-stream,image/vnd.adobe.photoshop"
              style={{ display: "none" }}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.currentTarget.value = ""
                if (!f) return
                if (!window.confirm(`Substituir o conteúdo do Step ${activeStepIndex + 1} pelos layers de "${f.name}"? O conteúdo atual desse step será descartado.`)) return
                await replaceStepFromPsd(f)
              }}
            />
            {stepCount > 1 && (
              <button
                onClick={(e) => removeStep(activeStepIndex, e.altKey)}
                title="Apagar este step (Option+click pula confirmacao)"
                style={{ background: "transparent", border: "1px solid #553333", borderRadius: 4, color: "#f87171", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 8px" }}
              >
                Remover step
              </button>
            )}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {/* Resolução {canvasW} × {canvasH} removida a pedido do user (2026-05-22) —
            info ruidosa na topbar. Undo/Redo botoes tambem removidos (atalhos
            Cmd+Z / Cmd+Shift+Z continuam funcionando). */}
        {/* Acoes secundarias alinhadas a direita: Importar PSD / Assets / Legendas */}
        <label
          title="Importar PSD pra esta campanha (substitui Key Vision atual)"
          style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: psdImporterRef.current?.isLoading() ? "wait" : "pointer", color: "#aaa", userSelect: "none" }}
        >
          {psdImporterRef.current?.isLoading() ? "Importando…" : "Importar PSD"}
          <input
            type="file"
            accept=".psd"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (!f) return
              if (psdImporterRef.current?.isLoading()) return
              // Pergunta se ha mudancas pendentes antes de substituir KV.
              const doImport = async () => {
                try { await psdImporterRef.current?.importFile(f) }
                catch (err) { console.error("[Importar PSD] falhou:", err) }
              }
              if (isDirtyRef.current) setConfirmExit(() => doImport)
              else doImport()
            }}
          />
        </label>
        {/* Botao Assets movido pro topo do Properties Panel (2026-05-22)
            pra reduzir poluicao visual da topbar. */}
        {isPieceMode && pieceId && (
          <button onClick={() => {
            const go = () => router.push(`/pieces/${pieceId}`)
            // Pergunta SO se tem mudancas pendentes.
            if (isDirtyRef.current) setConfirmExit(() => go)
            else go()
          }} style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", color: "#aaa" }}
            title="Editar legendas/copy desta peca">
            Legendas
          </button>
        )}
        <button
          onClick={async () => {
            // Salvar antes de exportar
            await saveNow()
            if (isPieceMode && piece) {
              setExportPieces([{
                id: piece.id, name: piece.name, data: piece.data,
                width: canvasWRef.current, height: canvasHRef.current,
              }])
              setExportOpen(true)
              return
            }
            // Modo matriz (KV): exporta SO O KV, nao todas as pecas geradas.
            // Constroi pseudo-piece a partir do estado atual do canvas (layers + bg).
            try {
              const fc = fabricRef.current
              if (!fc) { alert("Canvas indisponivel"); return }
              const W = canvasWRef.current
              const H = canvasHRef.current
              const layers = fc.getObjects()
                .filter((o: any) => !o.__isBg && o.__assetId)
                .map((o: any, i: number) => {
                  const isText = o.type === "textbox" || o.type === "i-text"
                  const isShape = (o as any).__isShape === true || o.type === "path" || o.type === "Path"
                  // KV export usa helpers centralizados — text + shape capturam tudo
                  // num lugar so. SHAPE branch ANTES caia no else vazio → fill/stroke
                  // editados na matriz nao iam pro pseudoData → export usava cor
                  // ORIGINAL do asset.content (regressao 2026-05-22 reportada pelo
                  // user). preserveExplicit NewlinesOnly: false porque KV export
                  // precisa do texto live completo.
                  const overrides: any = isText
                    ? serializeTextboxOverrides(o, { preserveExplicitNewlinesOnly: false })
                    : isShape
                      ? serializeShapeOverrides(o)
                      : {}
                  // Propriedades de round-trip PSD (blendMode/opacity/effects/mask/
                  // groupPath/hidden/locked) precisam vir DO OBJETO FABRIC pro
                  // pseudoData do export. Sem isso, o export do KV gerava PSD
                  // com tudo no default ("normal", opacity 1, sem effects, sem
                  // folders) — perdia mudancas que o user fez no editor.
                  const blendMode = (typeof o.globalCompositeOperation === "string"
                    && o.globalCompositeOperation
                    && o.globalCompositeOperation !== "source-over")
                    ? o.globalCompositeOperation : undefined
                  const opacity = (typeof o.opacity === "number" && o.opacity < 1) ? o.opacity : undefined
                  const psdEffects = ((o as any).__psdEffects && typeof (o as any).__psdEffects === "object")
                    ? (o as any).__psdEffects : undefined
                  const maskData = ((o as any).__maskData && typeof (o as any).__maskData === "object")
                    ? (o as any).__maskData : undefined
                  const groupPath = Array.isArray((o as any).__groupPath) && (o as any).__groupPath.length > 0
                    ? (o as any).__groupPath : undefined
                  const hidden = (o as any).__hidden === true ? true : undefined
                  const locked = (o as any).__locked === true ? true : undefined
                  return {
                    assetId: o.__assetId,
                    posX: Math.round(o.left ?? 0),
                    posY: Math.round(o.top ?? 0),
                    scaleX: o.scaleX ?? 1,
                    scaleY: o.scaleY ?? 1,
                    rotation: o.angle ?? 0,
                    zIndex: i,
                    width: Math.round(o.width ?? 400),
                    height: Math.round(o.height ?? 100),
                    overrides,
                    ...(blendMode ? { blendMode } : {}),
                    ...(opacity !== undefined ? { opacity } : {}),
                    ...(psdEffects ? { effects: psdEffects } : {}),
                    ...(maskData ? { mask: maskData } : {}),
                    ...(groupPath ? { groupPath } : {}),
                    ...(hidden ? { hidden } : {}),
                    ...(locked ? { locked } : {}),
                  }
                })
              const pseudoData = {
                version: 2,
                width: W, height: H,
                bgColor: bgColorRef.current, bgOpacity: bgOpacityRef.current, bgLayers: bgLayersRef.current,
                layers,
                sourceWidth: W,
                sourceHeight: H,
              }
              setExportPieces([{
                id: `kv-${campaignId}`,
                name: `${campaign.name} (Key Vision)`,
                data: pseudoData,
                width: W, height: H,
              }])
              setExportOpen(true)
            } catch (e) {
              console.error("[KV-EXPORT] falha", e)
              alert("Falha ao preparar exportacao do Key Vision")
            }
          }}
          style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "6px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", color: "#aaa" }}
          title={isPieceMode ? "Exportar esta peca" : "Exportar Key Vision (matriz)"}
        >
          Exportar
        </button>
        {!isPieceMode && (
          <button onClick={() => setModal(true)} style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "6px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#111" }}>Gerar Peças</button>
        )}
        {/* Apresentacao — extremidade direita da topbar. Estilo amarelo igual
            Gerar Pecas pra destaque visual da acao principal (ver resultado). */}
        {campaignId && (
          <button
            onClick={() => {
              const navigate = () => {
                if (typeof window !== "undefined") window.location.href = `/campaigns/${campaignId}/presentation`
              }
              if (isDirtyRef.current) setConfirmExit(() => navigate)
              else navigate()
            }}
            title="Ir direto para a apresentacao desta campanha"
            style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "6px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#111", marginLeft: "auto" }}
          >
            Apresentação
          </button>
        )}
        {/* Undo/Redo botoes removidos da topbar (2026-05-22) — atalhos
            Cmd+Z / Cmd+Shift+Z continuam funcionando. */}
      </div>

      <div style={{ position: "fixed", top: TH, left: layersPanelWidth, right: propsPanelWidth, height: BH, background: "rgba(26,26,26,0.98)", borderBottom: "1px solid #2a2a2a", display: "flex", alignItems: "center", padding: "0 16px", gap: 8, zIndex: 200, overflowX: "auto" }}>
        <span style={{ fontSize: 11, color: "#555", fontWeight: 600, flexShrink: 0 }}>Asset:</span>
        <select value={assetId} onChange={e => { setAssetId(e.target.value); assetIdRef.current = e.target.value }}
          style={{ background: "#222", color: "white", border: "1px solid #333", borderRadius: 4, padding: "4px 8px", fontSize: 12, maxWidth: 260 }}>
          {(campaign.assets ?? []).map((a: Asset) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        {(() => {
          // Regra: asset TEXTO so pode aparecer 1x no canvas (matriz ou peca).
          // Se ja existe layer com esse assetId E o asset eh TEXT, desabilita o botao.
          const currentAsset = (campaign.assets ?? []).find((a: Asset) => a.id === assetId)
          const isText = currentAsset?.type === "TEXT"
          const fc = fabricRef.current
          const alreadyOnCanvas = isText && fc
            ? fc.getObjects().some((o: any) => o.__assetId === assetId)
            : false
          // selectedTick na deps pra re-render quando layers mudam
          void selectedTick
          const disabled = alreadyOnCanvas
          return (
            <button
              onClick={addLayer}
              disabled={disabled}
              title={disabled ? "Este asset de texto ja esta no canvas. Cada asset texto so pode aparecer uma vez." : undefined}
              style={{
                background: disabled ? "#3a3a1a" : "#F5C400",
                color: disabled ? "#666" : "#111",
                border: "none",
                padding: "5px 14px",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 700,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >+ Adicionar ao canvas</button>
          )
        })()}
        {/* Botão "+ Texto novo" removido (UX request 2026-05-17): assets de
            texto agora sao criados exclusivamente via /campaigns/[id]/assets
            pra centralizar a criação e evitar texts órfãos no canvas. A função
            createTextAssetAndAdd permanece definida pra back-compat caso algum
            caminho ainda chame, mas nao tem mais UI. */}
        <div style={{ flex: 1 }} />
        <button onClick={centerObjectInCanvas} style={bS} title="Centralizar objeto selecionado no canvas (vertical + horizontal)">Centralizar</button>
        <button onClick={centerView} style={bS} title="Fit da peça no viewport (Shift+1)">Fit</button>
        <button onClick={zoomToSelection} style={bS} title="Focar no objeto selecionado (Shift+2)">Focar seleção</button>
        <button onClick={() => changeZoom(-0.1)} style={bS}>−</button>
        <span style={{ fontSize: 11, color: "#555", minWidth: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => changeZoom(+0.1)} style={bS}>+</button>
      </div>

      <div style={{ ...pS, left: 0, width: layersPanelWidth, borderRight: "1px solid #2a2a2a", paddingTop: TH }}>
        {/* Drag handle de resize do painel — barra fininha na borda direita.
            Mouse-down marca posicao inicial; mousemove em window recalcula
            largura; mouse-up libera. localStorage persiste. Clamped [180,500]
            pra nao ficar minusculo nem esmagar o canvas. */}
        <div
          onMouseDown={e => {
            e.preventDefault()
            layersResizeRef.current = { startX: e.clientX, startW: layersPanelWidth }
            const onMove = (ev: MouseEvent) => {
              const st = layersResizeRef.current
              if (!st) return
              const dx = ev.clientX - st.startX
              const next = Math.max(LW_MIN, Math.min(LW_MAX, st.startW + dx))
              setLayersPanelWidth(next)
            }
            const onUp = () => {
              layersResizeRef.current = null
              window.removeEventListener("mousemove", onMove)
              window.removeEventListener("mouseup", onUp)
              document.body.style.cursor = ""
              document.body.style.userSelect = ""
            }
            window.addEventListener("mousemove", onMove)
            window.addEventListener("mouseup", onUp)
            document.body.style.cursor = "ew-resize"
            document.body.style.userSelect = "none"
          }}
          onDoubleClick={() => setLayersPanelWidth(LW)}
          title="Arraste pra redimensionar · duplo-clique pra resetar"
          style={{
            position: "absolute",
            top: 0, right: -3, bottom: 0,
            width: 6,
            cursor: "ew-resize",
            zIndex: 110,
            background: "transparent",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = accentRgba(0.18) }}
          onMouseLeave={e => { if (!layersResizeRef.current) (e.currentTarget as HTMLElement).style.background = "transparent" }}
        />
        <div style={{ padding: "10px 14px", ...secS, borderBottom: "1px solid #2a2a2a", marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ flex: 1 }}>Layers</span>
          {/* Botao + Folder: cria folder novo movendo a selecao pra dentro.
              Sem selecao, mostra alerta orientando user a selecionar primeiro
              (Photoshop tambem nao cria folder vazio sem layer). */}
          <button
            title="Novo folder (move layers selecionados pra dentro)"
            onClick={() => {
              const name = window.prompt("Nome do folder:")
              if (name) createFolder(name)
            }}
            style={{
              background: "transparent", border: "1px solid #333", borderRadius: 4,
              padding: "2px 6px", fontSize: 10, color: "#aaa", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 3,
            }}>
            <span style={{ fontSize: 11 }}>+ Folder</span>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {!layers.length && <div style={{ fontSize: 11, color: "#444", textAlign: "center", padding: "24px 12px" }}>Adicione assets ao canvas</div>}
          {/* Pre-processa: pra cada layer, calcula quais folder headers devem
              aparecer ANTES dele (entradas novas vs layer anterior) e se ele
              esta dentro de pasta recolhida. Faz isso fora do map pra que o
              JSX do layer fique limpo. */}
          {(() => {
            const meta: Array<{ headers: Array<{ key: string; name: string; depth: number; collapsed: boolean }>; indent: number; hidden: boolean }> = []
            let prevPath: string[] = []
            for (let i = 0; i < layers.length; i++) {
              const path: string[] = Array.isArray(layers[i].groupPath) ? layers[i].groupPath : []
              let commonDepth = 0
              while (commonDepth < prevPath.length && commonDepth < path.length && prevPath[commonDepth] === path[commonDepth]) commonDepth++
              const headers: Array<{ key: string; name: string; depth: number; collapsed: boolean }> = []
              for (let d = commonDepth; d < path.length; d++) {
                const key = path.slice(0, d + 1).join("›")
                headers.push({ key, name: path[d], depth: d, collapsed: collapsedFolders.has(key) })
              }
              const hidden = path.some((_, idx) => collapsedFolders.has(path.slice(0, idx + 1).join("›")))
              meta.push({ headers, indent: path.length * 12, hidden })
              prevPath = path
            }
            ;(layers as any).__rowMeta = meta
            return null
          })()}
          {/* DROP ZONE TOPO: permite colocar layer ACIMA do primeiro (zIndex max).
              Aparece como uma faixa fina sempre que ha um drag ativo; durante
              dragOver mostra a linha amarela + abre espaco com magnify. */}
          {(dragLayerIdx !== null || dragFolderPath !== null) && layers.length > 0 && (
            <div
              onDragOver={e => {
                if (dragLayerIdx === null && !dragFolderPath) return
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
                if (dragOverIdx !== -1 || dropPosition !== "before") {
                  setDragOverIdx(-1)
                  setDropPosition("before")
                }
              }}
              onDragLeave={() => { if (dragOverIdx === -1) { setDragOverIdx(null); setDropPosition(null) } }}
              onDrop={e => {
                e.preventDefault()
                setDragOverIdx(null); setDropPosition(null)
                // Topo = posicao visual 0 (mais acima no painel = topo do z-stack).
                // Preserva o groupPath do layer atualmente no topo (entra na pasta).
                const topPath: string[] = Array.isArray(layers[0]?.groupPath) ? layers[0].groupPath : []
                if (dragFolderPath) {
                  const dragged = dragFolderPath
                  setDragFolderPath(null)
                  moveFolderTo(dragged, topPath)
                  return
                }
                const src = dragLayerIdx
                setDragLayerIdx(null)
                if (src === null) return
                const srcLayer = layers[src]
                if (srcLayer) reorderLayer(srcLayer.obj, 0, topPath)
              }}
              style={{
                height: dragOverIdx === -1 ? 16 : 8,
                position: "relative",
                transition: "height 140ms cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              {dragOverIdx === -1 && (
                <div style={{
                  position: "absolute", left: 8, right: 8, top: "50%", transform: "translateY(-50%)",
                  height: 3, borderRadius: 2, background: accentColor,
                  boxShadow: `0 0 8px ${accentRgba(0.9)}, 0 0 14px ${accentRgba(0.6)}`,
                  pointerEvents: "none",
                }} />
              )}
            </div>
          )}
          {layers.map((layer, i) => {
            const m = ((layers as any).__rowMeta ?? [])[i] ?? { headers: [], indent: 0, hidden: false }
            const headers = m.headers
            const indent = m.indent
            const hiddenByCollapse = m.hidden
            // Folder placeholder: renderiza headers (com onDrop/onDragOver normais
            // pra aceitar arrasto de layers reais pra dentro). A row em si vira
            // invisivel via flag isPlaceholder usado no return da row pra display:none.
            const isPlaceholder = (layer as any).isPlaceholder === true
            // Highlight verde: layer ativo OU membro de ActiveSelection (multi-
            // select via Shift+click). Sem o ramo do ActiveSelection, multi-
            // select selecionava os objetos no canvas mas o painel nao mostrava
            // visualmente quais estavam no grupo.
            const isSel = (() => {
              if (!selected) return false
              if (selected === layer.obj) return true
              if ((selected as any)?.type === "activeselection") {
                const objs = (selected as any).getObjects?.() ?? (selected as any)._objects ?? []
                return objs.includes(layer.obj)
              }
              return false
            })()
            const layerAssetId = layer.obj?.__assetId
            const isEditingThis = editingLayerAssetId && layerAssetId === editingLayerAssetId
            const maskData = (layer.obj as any)?.__maskData
            const hasMask = !!maskData
            const isHidden = layer.hidden === true
            const isLocked = layer.locked === true
            // GAP-BASED magnify: detecta qual GAP entre rows esta sendo alvo
            // (Photoshop-style: linha entre layers). Os 2 rows ADJACENTES ao
            // gap recebem magnify pra ABRIR ESPACO visualmente, deixando claro
            // onde o item vai cair. Diferente do row-target classico (em cima
            // de um), aqui o feedback eh "vai cair AQUI entre A e B".
            //
            // Mapeamento gap → rows afetados:
            //   dropPosition="before" e dragOverIdx=i → gap entre (i-1) e i
            //     → magnify em (i-1) com glow embaixo + i com glow em cima
            //   dropPosition="after" e dragOverIdx=i → gap entre i e (i+1)
            //     → magnify em i com glow embaixo + (i+1) com glow em cima
            const isAnyDrag = dragLayerIdx !== null || dragFolderPath !== null
            // Calcula posicoes do gap ativo (top index do gap = row acima, bot index = row abaixo)
            let gapTop = -1, gapBot = -1
            if (isAnyDrag && dragOverIdx !== null && dropPosition !== null) {
              if (dropPosition === "before") { gapTop = dragOverIdx - 1; gapBot = dragOverIdx }
              else { gapTop = dragOverIdx; gapBot = dragOverIdx + 1 }
            }
            const isAboveGap = i === gapTop
            const isBelowGap = i === gapBot
            const isAdjacentToGap = isAboveGap || isBelowGap
            // Distancia ate o gap pra magnify suave dos vizinhos mais distantes
            const distToGap = (gapTop < 0) ? 999 : Math.min(
              Math.abs(i - gapTop),
              Math.abs(i - gapBot),
            )
            const magnifyScale = isAdjacentToGap ? 1.04 : distToGap === 1 ? 1.015 : 1
            const magnifyShadow = isAdjacentToGap
              ? (isAboveGap
                  ? `0 4px 14px ${accentRgba(0.35)}, inset 0 -2px 0 ${accentRgba(0.9)}`
                  : `0 -4px 14px ${accentRgba(0.35)}, inset 0 2px 0 ${accentRgba(0.9)}`)
              : distToGap === 1 ? `0 2px 6px ${accentRgba(0.12)}` : "none"
            const magnifyZ = isAdjacentToGap ? 3 : distToGap === 1 ? 2 : 1
            // Margin extra no rows adjacentes pra ABRIR ESPACO entre eles —
            // efeito Photoshop "vai cair AQUI". Adicionamos no lado que toca
            // o gap (top do row de baixo, bottom do row de cima).
            const gapMarginTop = isBelowGap ? 6 : 0
            const gapMarginBottom = isAboveGap ? 6 : 0
            // Background pulse mais sutil nos rows adjacentes.
            // SELECAO: tint forte (22%) pra ser visivel em qualquer brand color
            // — antes (8%) ficava invisivel quando o brand era claro/desaturado.
            const dropBg = isAdjacentToGap ? accentRgba(0.10) : isSel ? accentRgba(0.22) : "transparent"
            // Linhas legadas (mantidas pra back-compat, mas com fallback p/ gap)
            const dragLineTop = false
            const dragLineBottom = false
            return (
              <React.Fragment key={`row-${i}`}>
                {/* Folder headers novos pra esta linha (entradas em pastas) */}
                {headers.map((h: { key: string; name: string; depth: number; collapsed: boolean }) => {
                  // Path completo deste folder pra calculo de visibility/lock em massa
                  // + drop target. Reconstroi do path do layer corrente.
                  const path: string[] = (Array.isArray(layer.groupPath) ? layer.groupPath : []).slice(0, h.depth + 1)
                  const folderHidden = isGroupHidden(path)
                  const folderLocked = isGroupLocked(path)
                  return (
                  <div key={`folder-${h.key}-${i}`}
                    data-folder-key={h.key}
                    draggable
                    onDragStart={e => {
                      // Drag de FOLDER inteiro: marca o path. onDrop em outro
                      // folder/layer move o folder completo (com subfolders).
                      setDragFolderPath(path)
                      e.dataTransfer.effectAllowed = "move"
                      e.dataTransfer.setData("text/plain", `folder:${path.join("›")}`)
                      e.stopPropagation()
                    }}
                    onDragEnd={() => { setDragFolderPath(null); setDragOverFolderKey(null); setDropPosition(null) }}
                    onClick={() => {
                      // Click no header: SELECIONA todos os layers do folder no canvas
                      // (Photoshop-style — manipular o grupo move/escala/rotaciona
                      // todos juntos). Toggle do expand/collapse foi separado pro
                      // proprio triangulo abaixo. Sem isso, nao tinha como
                      // manipular o folder como composite.
                      if (!renamingFolderKey) selectFolderInCanvas(path)
                    }}
                    onDoubleClick={e => {
                      e.stopPropagation()
                      setRenamingFolderKey(h.key)
                    }}
                    onDragOver={e => {
                      // Aceita drop de layer OU de outro folder pra aninhar.
                      if (dragLayerIdx === null && !dragFolderPath) return
                      // Nao aceita drop de si mesmo ou descendente
                      if (dragFolderPath) {
                        const drag = dragFolderPath.join("›")
                        const cur = path.join("›")
                        if (drag === cur || cur.startsWith(drag + "›")) return
                      }
                      e.preventDefault()
                      e.dataTransfer.dropEffect = "move"
                      if (dragOverFolderKey !== h.key) setDragOverFolderKey(h.key)
                    }}
                    onDragLeave={() => { if (dragOverFolderKey === h.key) setDragOverFolderKey(null) }}
                    onDrop={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragOverFolderKey(null)
                      // Caso 1: dropping FOLDER em outro folder = nest (sub-folder)
                      if (dragFolderPath) {
                        const dragged = dragFolderPath
                        setDragFolderPath(null)
                        // Move dragged pra DENTRO do folder atual (vira sub-folder)
                        moveFolderTo(dragged, path)
                        return
                      }
                      // Caso 2: dropping LAYER em folder = mover layer pra dentro
                      const src = dragLayerIdx
                      setDragLayerIdx(null); setDragOverIdx(null)
                      if (src === null) return
                      const srcLayer = layers[src]
                      if (!srcLayer) return
                      reorderLayer(srcLayer.obj, i, path)
                    }}
                    style={(() => {
                      const isDraggedSelf = !!(dragFolderPath && dragFolderPath.join("›") === path.join("›"))
                      const isDropHere = dragOverFolderKey === h.key
                      return {
                        display: "flex", alignItems: "center", gap: 4,
                        padding: `6px 8px 6px ${12 + h.depth * 12}px`,
                        // pointer (mao pequena) > grab (mao gigante do macOS).
                        // Browser ativa grabbing automaticamente durante o drag HTML5.
                        cursor: "pointer",
                        fontSize: 10, fontWeight: 700,
                        textTransform: "uppercase", letterSpacing: "0.5px",
                        color: isDropHere ? "#fff" : "#888",
                        background: isDropHere
                          ? accentRgba(0.20)
                          : "rgba(255,255,255,0.02)",
                        borderTop: "1px solid #222",
                        opacity: isDraggedSelf ? 0.3 : 1,
                        transform: isDropHere ? "scale(1.05)" : "scale(1)",
                        transformOrigin: "left center",
                        boxShadow: isDropHere
                          ? `0 4px 16px ${accentRgba(0.45)}, 0 0 0 2px ${accentRgba(0.85)}, inset 0 0 0 1px ${accentRgba(0.3)}`
                          : "none",
                        borderRadius: isDropHere ? 4 : 0,
                        zIndex: isDropHere ? 4 : 1,
                        position: "relative",
                        transition: "transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 120ms ease, background 100ms ease, color 100ms ease, border-radius 120ms ease",
                        willChange: dragLayerIdx !== null || dragFolderPath ? "transform" : "auto",
                      }
                    })()}
                    title={`Click: selecionar todos os layers do grupo · arraste pra mover/aninhar · duplo-clique pra renomear`}>
                    <span
                      onClick={e => { e.stopPropagation(); toggleFolder(h.key) }}
                      title={h.collapsed ? "Expandir" : "Recolher"}
                      style={{ width: 14, display: "inline-flex", justifyContent: "center", cursor: "pointer" }}
                    >{h.collapsed ? "▶" : "▼"}</span>
                    {/* Olho do folder — toggle em massa pros filhos */}
                    <button
                      onClick={e => { e.stopPropagation(); setGroupAttribute(path, "__hidden", !folderHidden) }}
                      title={folderHidden ? "Mostrar todos os layers da pasta" : "Esconder todos os layers da pasta"}
                      style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 2px", display: "flex", alignItems: "center", color: folderHidden ? "#444" : "#bbb" }}>
                      {folderHidden ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                    {/* Cadeado do folder — toggle em massa pros filhos */}
                    <button
                      onClick={e => { e.stopPropagation(); setGroupAttribute(path, "__locked", !folderLocked) }}
                      title={folderLocked ? "Destravar pasta" : "Travar pasta"}
                      style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 2px", display: "flex", alignItems: "center", color: folderLocked ? "#F5C400" : "#444" }}>
                      {folderLocked ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      ) : (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                        </svg>
                      )}
                    </button>
                    {renamingFolderKey === h.key ? (
                      <input
                        autoFocus
                        defaultValue={h.name}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            const v = (e.currentTarget as HTMLInputElement).value
                            if (v && v !== h.name) renameFolder(path, v)
                            setRenamingFolderKey(null)
                          } else if (e.key === "Escape") {
                            setRenamingFolderKey(null)
                          }
                        }}
                        onBlur={e => {
                          const v = e.currentTarget.value
                          if (v && v !== h.name) renameFolder(path, v)
                          setRenamingFolderKey(null)
                        }}
                        style={{
                          flex: 1, fontSize: 10, fontWeight: 700,
                          textTransform: "uppercase", letterSpacing: "0.5px",
                          background: "#0a0a0a", color: "#fff",
                          border: "1px solid #F5C400", borderRadius: 3,
                          padding: "1px 4px", outline: "none",
                          minWidth: 0,
                        }}
                      />
                    ) : (
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                    )}
                    {/* Botao + sub-folder: cria um folder filho dentro deste */}
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        const name = window.prompt(`Nome do sub-folder dentro de "${h.name}":`)
                        if (name) createFolder(name, path)
                      }}
                      title="Adicionar sub-folder (move selecao pra ele)"
                      style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 2px", color: "#666", fontSize: 11, lineHeight: 1 }}>
                      +
                    </button>
                    {/* Botao deletar folder: move filhos pra parent (Alt+click apaga conteudo). */}
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        const altClick = (e as any).altKey === true
                        if (altClick) {
                          if (!confirm(`Apagar folder "${h.name}" E TODOS seus layers do canvas?`)) return
                          deleteFolder(path, true)
                        } else {
                          if (!confirm(`Apagar folder "${h.name}"? Os layers serao movidos pra pasta pai.`)) return
                          deleteFolder(path, false)
                        }
                      }}
                      title="Apagar folder (filhos vao pra parent) · Alt+click pra apagar tudo"
                      style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 2px", color: "#555", fontSize: 11, lineHeight: 1 }}>
                      ×
                    </button>
                  </div>
                  )
                })}
                {/* Layer row (escondido se algum ancestral estiver collapsed) */}
                {!hiddenByCollapse && (
              <div
                draggable={!isEditingThis && !layer.isBg}
                onDragStart={e => {
                  if (isEditingThis || layer.isBg) { e.preventDefault(); return }
                  setDragLayerIdx(i)
                  e.dataTransfer.effectAllowed = "move"
                  // Firefox precisa de dataTransfer.setData pra ativar drag
                  e.dataTransfer.setData("text/plain", String(i))
                }}
                onDragEnd={() => { setDragLayerIdx(null); setDragOverIdx(null); setDragOverFolderKey(null); setDropPosition(null) }}
                onDragOver={e => {
                  // Aceita drop de layer ou de folder
                  if (dragLayerIdx === null && !dragFolderPath) return
                  if (dragLayerIdx === i) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = "move"
                  if (dragOverIdx !== i) setDragOverIdx(i)
                  // Detecta GAP: top half do row = drop ENTRE i-1 e i (before),
                  // bottom half = drop ENTRE i e i+1 (after). Photoshop usa
                  // linha azul fina; aqui usamos magnify dos 2 vizinhos pra
                  // abrir espaco visualmente claro.
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const y = e.clientY - rect.top
                  const pos: "before" | "after" = y < rect.height / 2 ? "before" : "after"
                  if (dropPosition !== pos) setDropPosition(pos)
                }}
                onDragLeave={() => { if (dragOverIdx === i) { setDragOverIdx(null); setDropPosition(null) } }}
                onDrop={e => {
                  e.preventDefault()
                  const pos = dropPosition
                  setDropPosition(null)
                  // Caso folder→layer: move folder pra mesma pasta do layer alvo
                  if (dragFolderPath) {
                    const dragged = dragFolderPath
                    setDragFolderPath(null); setDragOverIdx(null)
                    const targetParent: string[] = Array.isArray(layer.groupPath) ? layer.groupPath : []
                    moveFolderTo(dragged, targetParent)
                    return
                  }
                  const src = dragLayerIdx
                  setDragLayerIdx(null); setDragOverIdx(null)
                  if (src === null || src === i) return
                  const srcLayer = layers[src]
                  const targetPath: string[] = Array.isArray(layer.groupPath) ? layer.groupPath : []
                  // Ajusta o index visual baseado em "before/after": "after" = +1
                  // (cai abaixo do alvo), "before" = o proprio i. reorderLayer
                  // posiciona o src exatamente no targetVisualIndex.
                  const insertAt = pos === "after" ? i + 1 : i
                  if (srcLayer) reorderLayer(srcLayer.obj, insertAt, targetPath)
                }}
                onClick={async (e) => {
                  if (isEditingThis) return
                  const fc = fabricRef.current
                  if (!fc) return
                  // Multi-select estilo Photoshop/Figma:
                  //  - Shift+click: toggle do layer atual na selecao (acrescenta/remove).
                  //  - Click puro: substitui selecao por este unico layer.
                  // Sem isso, so dava pra selecionar multiplos via marquee no canvas
                  // — painel sempre selecionava um.
                  const additive = e.shiftKey || (e as any).metaKey || (e as any).ctrlKey
                  const target = layer.obj
                  if ((target as any).__isBg || (target as any).__isBleedOverlay) {
                    fc.setActiveObject(target)
                    fc.renderAll()
                    setSelected(target)
                    return
                  }
                  if (!additive) {
                    fc.discardActiveObject()
                    fc.setActiveObject(target)
                    fc.renderAll()
                    setSelected(target)
                    return
                  }
                  const fabricMod = await import("fabric") as any
                  const ActiveSelection = fabricMod.ActiveSelection
                  const active = fc.getActiveObject() as any
                  const currentObjs: any[] = active?.type === "activeselection"
                    ? [...(active.getObjects?.() ?? active._objects ?? [])]
                    : (active && active !== target ? [active] : [])
                  // Se ja existe nessa selecao, toggle off (remove). Senao, adiciona.
                  const exists = currentObjs.includes(target)
                  const next = exists
                    ? currentObjs.filter(o => o !== target)
                    : [...currentObjs, target]
                  fc.discardActiveObject()
                  if (next.length === 0) {
                    setSelected(null)
                  } else if (next.length === 1) {
                    fc.setActiveObject(next[0])
                    setSelected(next[0])
                  } else {
                    const sel = new ActiveSelection(next, { canvas: fc })
                    fc.setActiveObject(sel)
                    setSelected(sel)
                  }
                  fc.requestRenderAll?.()
                }}
                data-layer-row={i}
                data-layer-selected={isSel ? "1" : "0"}
                // Key muda a cada novo select pra reiniciar a CSS animation
                key={isSel ? `row-${i}-pulse-${layerPulseKey}` : `row-${i}`}
                style={{
                  // Placeholder de folder vazio: row invisivel. Headers do folder
                  // (acima nesta mesma row) continuam renderizando com onDrop normal.
                  display: isPlaceholder ? "none" : "flex",
                  alignItems: "center", gap: 4,
                  padding: `8px 8px 8px ${12 + indent}px`,
                  cursor: "default",
                  // Selecionado: borda 3px pra reforcar com qualquer brand color
                  // (ex: dark green sobre #1a1a1a). Inset shadow tambem aplicado
                  // abaixo via merge com magnifyShadow (evita clobber).
                  borderLeft: isSel ? `3px solid ${accentColor}` : "3px solid transparent",
                  background: dropBg,
                  opacity: dragLayerIdx === i ? 0.3 : 1,
                  borderTop: dragLineTop ? `3px solid ${accentColor}` : "2px solid transparent",
                  borderBottom: dragLineBottom ? `3px solid ${accentColor}` : "2px solid transparent",
                  // CSS variables pra animation pulse (declaradas na <style> global do componente)
                  ["--zzosy-accent" as any]: accentColor,
                  ["--zzosy-accent-strong" as any]: accentRgba(0.55),
                  ["--zzosy-accent-soft" as any]: accentRgba(0.18),
                  ["--zzosy-accent-faint" as any]: accentRgba(0.08),
                  // Animation: dispara so quando isSel (key muda a cada selecao reinicia)
                  animation: isSel ? "zzosy-layer-pulse 1200ms ease-out" : undefined,
                  // Magnify dock-style: scale + shadow + z-index. Gap-based:
                  // rows adjacentes ao GAP target abrem espaco via marginTop/Bottom,
                  // ficando claro "vai cair NO MEIO desses dois".
                  transform: `scale(${magnifyScale})`,
                  transformOrigin: "left center",
                  // Combina magnify shadow + selection inset glow (accent color)
                  // pra que selecao seja visivel sob qualquer brand color.
                  boxShadow: isSel
                    ? `inset 0 0 0 1px ${accentRgba(0.45)}${magnifyShadow ? `, ${magnifyShadow}` : ""}`
                    : magnifyShadow,
                  zIndex: magnifyZ,
                  position: "relative",
                  borderRadius: isAdjacentToGap ? 4 : 0,
                  marginTop: gapMarginTop,
                  marginBottom: gapMarginBottom,
                  transition: "transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 140ms ease, background 100ms ease, border-radius 140ms ease, margin 140ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                  willChange: isAnyDrag ? "transform, margin" : "auto",
                }}
              >
                {/* Drop indicator: barra amarela com glow no GAP aberto entre
                    os dois rows adjacentes. Aparece SOMENTE no row de cima do
                    gap (isAboveGap), posicionada no bottom: -8px pra cair no
                    espaco aberto pelo marginBottom: 6px. */}
                {isAboveGap && (
                  <div style={{
                    position: "absolute",
                    left: 4 + indent,
                    right: 4,
                    bottom: -7,
                    height: 3,
                    borderRadius: 2,
                    background: accentColor,
                    boxShadow: `0 0 8px ${accentRgba(0.9)}, 0 0 14px ${accentRgba(0.6)}`,
                    pointerEvents: "none",
                    zIndex: 5,
                  }} />
                )}
                {/* Drag handle: 3 tracos horizontais (hamburger). Cursor grab
                    so neste icone, nao no row inteiro — antes o cursor de mao
                    aberta aparecia em todo o row (ficava grande, atrapalhando
                    leitura). Visual fica discreto mas claro como o que arrastar. */}
                {!layer.isBg && !isEditingThis && (
                  <div
                    title="Arraste pra reordenar"
                    style={{
                      display: "flex", flexDirection: "column", justifyContent: "center",
                      // pointer pequeno e preciso > grab grande do macOS.
                      gap: 2, padding: "0 4px", cursor: "pointer",
                      color: dragLayerIdx === i ? accentColor : "#444",
                      flexShrink: 0,
                    }}
                    onMouseDown={e => e.stopPropagation()}
                  >
                    <span style={{ width: 10, height: 1.5, background: "currentColor", borderRadius: 1 }} />
                    <span style={{ width: 10, height: 1.5, background: "currentColor", borderRadius: 1 }} />
                    <span style={{ width: 10, height: 1.5, background: "currentColor", borderRadius: 1 }} />
                  </div>
                )}
                {/* Visibilidade (olho) — primeiro da row, igual Photoshop */}
                <button
                  title={isHidden ? "Mostrar layer" : "Esconder layer"}
                  onClick={e => { e.stopPropagation(); toggleLayerVisibility(layer.obj) }}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: "2px 4px", lineHeight: 1, width: 22, height: 22, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: isHidden ? "#444" : "#bbb",
                  }}
                >
                  {isHidden ? (
                    // Olho fechado (Photoshop: hidden)
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    // Olho aberto (Photoshop: visible)
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
                {/* Cadeado */}
                <button
                  title={isLocked ? "Destravar layer" : "Travar layer"}
                  onClick={e => { e.stopPropagation(); toggleLayerLock(layer.obj) }}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: "2px 4px", lineHeight: 1, width: 22, height: 22, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: isLocked ? "#F5C400" : "#444",
                  }}
                >
                  {isLocked ? (
                    // Cadeado fechado
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  ) : (
                    // Cadeado aberto
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                    </svg>
                  )}
                </button>
                {/* Thumb do layer (cor por tipo) */}
                <div style={{ width: 7, height: 7, borderRadius: 2, background: layer.type === "textbox" ? "#F5C400" : "#86efac", flexShrink: 0 }} />
                {/* Bolinha DS link status (so pra textboxes vinculados a preset
                    do Design System). Verde = mesmo do DS; Vermelha = customizado.
                    User customiza via Properties Panel; scale/posicao NAO quebram. */}
                {(layer.type === "textbox" || layer.type === "i-text") && (() => {
                  const obj: any = layer.obj
                  // So mostra a bolinha pra layers que tem assetId com brandPresetKey.
                  // Sem isso, qualquer texto teria bolinha — confunde o user (texto
                  // criado fora dos presets nao tem "link" pra DS pra checar).
                  const assetId = obj.__assetId
                  if (!assetId) return null
                  const asset = (campaign?.assets ?? []).find(a => a.id === assetId)
                  const lo: any = (asset as any)?.lastOverride
                  if (!lo?.brandPresetKey) return null
                  const linked = obj.__dsLinked !== false
                  return (
                    <div
                      title={linked ? "Sincronizado com o Design System" : "Customizado — diverge do Design System"}
                      style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: linked ? "#22c55e" : "#ef4444",
                        flexShrink: 0,
                        marginLeft: 2,
                        boxShadow: linked ? "0 0 4px rgba(34,197,94,0.5)" : "0 0 4px rgba(239,68,68,0.5)",
                      }}
                    />
                  )
                })()}
                {/* Thumb da mascara (so aparece quando ha mascara). Igual Photoshop: */}
                {/* clique = seleciona; Shift+clique = toggle enabled; Alt+clique = invert. */}
                {/* Botao direito (oncontextmenu) = remover. */}
                {hasMask && (
                  <div
                    title={`${maskData.type} mask · clique-toggle · Shift+clique disable · Alt+clique invert · botão direito remove`}
                    onClick={e => {
                      e.stopPropagation()
                      if (e.shiftKey) {
                        // Toggle enabled (Photoshop: Shift+clique no mask thumb)
                        ;(async () => {
                          const m = { ...maskData, enabled: !maskData.enabled }
                          ;(layer.obj as any).__maskData = m
                          const { Image: FabImage, Path } = await import("fabric")
                          ;(layer.obj as any).clipPath = null
                          await applyMaskToFabricObject({ Image: FabImage, Path }, layer.obj, m)
                          fabricRef.current?.requestRenderAll()
                          refreshLayers(fabricRef.current!)
                          doSave()
                        })()
                      } else if (e.altKey && maskData.type !== "clipping") {
                        // Alt+clique: invert
                        ;(async () => {
                          const m = { ...maskData, inverted: !maskData.inverted }
                          ;(layer.obj as any).__maskData = m
                          const { Image: FabImage, Path } = await import("fabric")
                          ;(layer.obj as any).clipPath = null
                          await applyMaskToFabricObject({ Image: FabImage, Path }, layer.obj, m)
                          fabricRef.current?.requestRenderAll()
                          refreshLayers(fabricRef.current!)
                          doSave()
                        })()
                      } else {
                        // Clique normal: seleciona o layer (no PS seleciona a mascara
                        // pra editar; aqui apenas selecionamos por enquanto).
                        fabricRef.current?.setActiveObject(layer.obj)
                        setSelected(layer.obj)
                      }
                    }}
                    onContextMenu={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      // Photoshop-style: botao direito no thumb da mascara remove direto.
                      // Sem confirm — destrutivo intencional, e undo (em breve) reverte.
                      ;(async () => {
                        delete (layer.obj as any).__maskData
                        ;(layer.obj as any).clipPath = null
                        ;(layer.obj as any).dirty = true
                        fabricRef.current?.requestRenderAll()
                        refreshLayers(fabricRef.current!)
                        doSave()
                      })()
                    }}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 2,
                      flexShrink: 0,
                      border: maskData.enabled ? "1.5px solid #F5C400" : "1.5px solid #555",
                      background: maskData.enabled ? "#1a1a1a" : "#0d0d0d",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: maskData.enabled ? "#F5C400" : "#555",
                      cursor: "pointer",
                      position: "relative",
                    }}
                  >
                    {maskData.type === "raster" ? "▦" : maskData.type === "vector" ? "▭" : "⌐"}
                    {!maskData.enabled && (
                      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#d33", pointerEvents: "none" }}>⊘</span>
                    )}
                  </div>
                )}
                {isEditingThis ? (
                  <input
                    autoFocus
                    defaultValue={layer.label}
                    onClick={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                    onBlur={async e => {
                      const el = e.currentTarget
                      if (!el || (el as any).__renameCommitted) return
                      ;(el as any).__renameCommitted = true
                      const v = (el.value ?? "").trim()
                      if (v && v !== layer.label) await renameLayer(layer.obj, v)
                      setEditingLayerAssetId(null)
                    }}
                    onKeyDown={async e => {
                      e.stopPropagation()
                      if (e.key === "Enter") {
                        e.preventDefault()
                        const el = e.currentTarget
                        ;(el as any).__renameCommitted = true
                        const v = (el.value ?? "").trim()
                        if (v && v !== layer.label) await renameLayer(layer.obj, v)
                        setEditingLayerAssetId(null)
                      } else if (e.key === "Escape") {
                        e.preventDefault()
                        ;(e.currentTarget as any).__renameCommitted = true
                        setEditingLayerAssetId(null)
                      }
                    }}
                    style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#fff", background: "#0d0d0d", border: "1px solid #F5C400", borderRadius: 3, padding: "2px 6px", outline: "none", fontFamily: "inherit" }}
                  />
                ) : (
                  <span
                    title="Duplo clique para renomear"
                    onDoubleClick={e => { e.stopPropagation(); if (layerAssetId) setEditingLayerAssetId(layerAssetId) }}
                    style={{ fontSize: 12, color: isSel ? "#fff" : "#888", fontWeight: isSel ? 700 : 400, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}
                  >{layer.label}</span>
                )}
                {/* Alpha channel thumbnail (Photoshop layer panel style) — so renderiza
                    quando o layer tem mask. Click ativa mask edit mode (overlay + brush). */}
                {(layer.obj as any)?.__maskData && (
                  <MaskThumb
                    mask={(layer.obj as any).__maskData}
                    obj={layer.obj}
                    fc={fabricRef.current}
                    focused={maskFocusAssetId === layerAssetId}
                    onFocus={() => {
                      setMaskFocusAssetId(prev => prev === layerAssetId ? null : layerAssetId)
                    }}
                  />
                )}
                {!layer.isBg && (
                  <button title="Remover" onClick={e => { e.stopPropagation(); fabricRef.current?.remove(layer.obj); fabricRef.current?.renderAll(); setSelected(null); doSave() }}
                    style={{ color: "#555", background: "transparent", border: "none", cursor: "pointer", fontSize: 12, padding: "2px 4px", lineHeight: 1 }}>✕</button>
                )}
              </div>
            )}
            </React.Fragment>
            )
          })}
          {/* DROP ZONE FUNDO: permite colocar layer ABAIXO do ultimo (zIndex min).
              Mesma logica do topo, mas posicao = layers.length. */}
          {(dragLayerIdx !== null || dragFolderPath !== null) && layers.length > 0 && (
            <div
              onDragOver={e => {
                if (dragLayerIdx === null && !dragFolderPath) return
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
                if (dragOverIdx !== -2 || dropPosition !== "after") {
                  setDragOverIdx(-2)
                  setDropPosition("after")
                }
              }}
              onDragLeave={() => { if (dragOverIdx === -2) { setDragOverIdx(null); setDropPosition(null) } }}
              onDrop={e => {
                e.preventDefault()
                setDragOverIdx(null); setDropPosition(null)
                const lastIdx = layers.length - 1
                const bottomPath: string[] = Array.isArray(layers[lastIdx]?.groupPath) ? layers[lastIdx].groupPath : []
                if (dragFolderPath) {
                  const dragged = dragFolderPath
                  setDragFolderPath(null)
                  moveFolderTo(dragged, bottomPath)
                  return
                }
                const src = dragLayerIdx
                setDragLayerIdx(null)
                if (src === null) return
                const srcLayer = layers[src]
                if (srcLayer) reorderLayer(srcLayer.obj, layers.length - 1, bottomPath)
              }}
              style={{
                height: dragOverIdx === -2 ? 16 : 8,
                position: "relative",
                transition: "height 140ms cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              {dragOverIdx === -2 && (
                <div style={{
                  position: "absolute", left: 8, right: 8, top: "50%", transform: "translateY(-50%)",
                  height: 3, borderRadius: 2, background: accentColor,
                  boxShadow: `0 0 8px ${accentRgba(0.9)}, 0 0 14px ${accentRgba(0.6)}`,
                  pointerEvents: "none",
                }} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* MASK EDIT MODE banner — fica fixo no topo do canvas quando user
          ativou edit de uma mask via click no MaskThumb. Indica modo + da
          opcao de sair. Brush real (pintar branco/preto sobre mask raster)
          eh Fase C — proxima iteracao com mouse handlers customizados. */}
      {maskFocusAssetId && (
        <div style={{
          position: "fixed", top: TH + 8, left: "50%", transform: "translateX(-50%)",
          background: "#F5C400", color: "#000", padding: "8px 14px",
          borderRadius: 6, fontSize: 12, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 12,
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)", zIndex: 200,
        }}>
          <span>EDITANDO MASCARA</span>
          <button onClick={() => setMaskFocusAssetId(null)}
            style={{
              background: "#000", color: "#F5C400", padding: "4px 10px",
              border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11, fontWeight: 700,
              fontFamily: "inherit",
            }}>Sair</button>
        </div>
      )}
      <div style={{ ...pS, right: 0, width: propsPanelWidth, borderLeft: "1px solid #2a2a2a", paddingTop: TH }}>
        {/* Drag handle de resize do painel Properties — borda ESQUERDA. Mesmo
            padrao do layersPanelWidth (mirrored). */}
        <div
          onMouseDown={e => {
            e.preventDefault()
            propsResizeRef.current = { startX: e.clientX, startW: propsPanelWidth }
            const onMove = (ev: MouseEvent) => {
              const st = propsResizeRef.current
              if (!st) return
              const dx = ev.clientX - st.startX
              // INVERSE: arrastando pra ESQUERDA aumenta a largura (borda esquerda)
              const next = Math.max(PW_MIN, Math.min(PW_MAX, st.startW - dx))
              setPropsPanelWidth(next)
            }
            const onUp = () => {
              propsResizeRef.current = null
              window.removeEventListener("mousemove", onMove)
              window.removeEventListener("mouseup", onUp)
              document.body.style.cursor = ""
              document.body.style.userSelect = ""
            }
            window.addEventListener("mousemove", onMove)
            window.addEventListener("mouseup", onUp)
            document.body.style.cursor = "ew-resize"
            document.body.style.userSelect = "none"
          }}
          onDoubleClick={() => setPropsPanelWidth(PW)}
          title="Arraste pra redimensionar · duplo-clique pra resetar"
          style={{
            position: "absolute",
            top: 0, left: -3, bottom: 0,
            width: 6,
            cursor: "ew-resize",
            zIndex: 110,
          }}
        />
        <div style={{ padding: "12px 16px", ...secS, borderBottom: "1px solid #2a2a2a", marginBottom: 0 }}>Propriedades</div>
        {/* Atalho Assets — botao DIFERENCIAL do ZZOSY (sem analogo direto em
            outros softwares de design). Stroke roxo + fill transparente +
            UPPERCASE pra destaque visual maximo no topo do Properties Panel.
            User pediu 2026-05-22: "Ele e um botao diferencial se relacionado
            aos outros softwares.. Entao vamos dar super destaque para ele". */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a2a2a" }}>
          <button onClick={() => {
            const go = () => router.push(`/campaigns/${campaignId}/assets`)
            if (isDirtyRef.current) setConfirmExit(() => go)
            else go()
          }}
            onMouseEnter={(e) => { (e.currentTarget.style.background = "rgba(168,85,247,0.12)") }}
            onMouseLeave={(e) => { (e.currentTarget.style.background = "transparent") }}
            style={{
              width: "100%",
              background: "transparent",
              border: "1px solid #a855f7",
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              color: "#aaa",
              textTransform: "uppercase",
              letterSpacing: "1.5px",
              textAlign: "center",
              transition: "background 0.15s ease",
            }}
            title="Ir para a pagina de assets desta campanha">
            Assets
          </button>
        </div>
        {(!selected || (selected as any).__isBg) ? (
          <div style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ ...secS, color: "#F5C400" }}>
                {(selected as any)?.__isBg && typeof (selected as any).__bgIdx === "number" && (selected as any).__bgIdx > 0
                  ? `Background ${((selected as any).__bgIdx as number) + 1}`
                  : "Background"}
                {bgLayersRef.current.length > 1 && (
                  <span style={{ color: "#555", marginLeft: 6, fontWeight: 400 }}>
                    ({((selected as any)?.__isBg && typeof (selected as any).__bgIdx === "number" ? (selected as any).__bgIdx : 0) + 1}/{bgLayersRef.current.length})
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button title="Adicionar BG layer" onClick={() => addBgLayer()}
                  style={{ width: 22, height: 22, borderRadius: 4, background: "#1a1a1a", border: "1px solid #333", color: "#bbb", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>+</button>
                {bgLayersRef.current.length > 1 && (selected as any)?.__isBg && (
                  <button title="Remover este BG" onClick={() => removeBgLayer((selected as any).__bgIdx ?? 0)}
                    style={{ width: 22, height: 22, borderRadius: 4, background: "#1a1a1a", border: "1px solid #333", color: "#bbb", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 }}>✕</button>
                )}
              </div>
            </div>
            {/* Tipo do BG: Sólido / Gradiente Linear / Gradiente Radial */}
            {(() => {
              const layer = bgLayersRef.current[currentBgIdx()]
              const kind = layer?.kind ?? "solid"
              const gType = layer?.kind === "gradient" ? layer.gradientType : null
              const btnS = (active: boolean) => ({
                flex: 1, padding: "6px 8px", fontSize: 11,
                background: active ? "#F5C400" : "#1a1a1a",
                color: active ? "#000" : "#888",
                border: "1px solid " + (active ? "#F5C400" : "#333"),
                borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
                textTransform: "uppercase" as const, letterSpacing: "0.5px",
              })
              return (
                <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
                  <button style={btnS(kind === "solid")} onClick={() => changeBgKind("solid")}>Sólido</button>
                  <button style={btnS(kind === "gradient" && gType === "linear")} onClick={() => changeBgKind("gradient", { gradientType: "linear" })}>Linear</button>
                  <button style={btnS(kind === "gradient" && gType === "radial")} onClick={() => changeBgKind("gradient", { gradientType: "radial" })}>Radial</button>
                  <button style={btnS(kind === "image")} onClick={() => {
                    // Se ja eh image, mantem; senao pede upload imediato
                    const layer = bgLayersRef.current[currentBgIdx()]
                    if (layer?.kind === "image" && layer.imageDataUrl) {
                      changeBgKind("image")
                    } else {
                      // dispara file picker programaticamente
                      const input = document.createElement("input")
                      input.type = "file"
                      input.accept = "image/*"
                      input.onchange = () => {
                        const f = input.files?.[0]
                        if (f) uploadBgImage(f)
                      }
                      input.click()
                    }
                  }}>Imagem</button>
                </div>
              )
            })()}
            {/* SOLID: ColorSwatchPicker (Figma-style — swatch + popup) */}
            {(() => {
              const layer = bgLayersRef.current[currentBgIdx()]
              if (layer?.kind !== "solid") return null
              const bgStr = typeof bgColor === "string" ? bgColor : "#ffffff"
              const activeBrand = layer?.colorBrandIdx
              return (
                <div style={{ marginBottom: 14 }}>
                  <ColorSwatchPicker
                    value={bgStr}
                    onChange={(hex, brandIdx) => changeBg(hex, brandIdx)}
                    brandColors={brandColors as any}
                    defaultSwatches={SWATCHES}
                    activeBrandIdx={typeof activeBrand === "number" ? activeBrand : undefined}
                    opacity={(bgOpacity ?? 1) * 100}
                    onOpacityChange={pct => changeBgOpacity(pct / 100)}
                  />
                </div>
              )
            })()}
            {/* GRADIENT: stops + angulo (se linear) */}
            {(() => {
              const layer = bgLayersRef.current[currentBgIdx()]
              if (layer?.kind !== "gradient") return null
              const stops = layer.stops
              return (
                <>
                  {/* Preview do gradient */}
                  <div style={{
                    height: 24, borderRadius: 4, border: "1px solid #333", marginBottom: 10,
                    background: layer.gradientType === "linear"
                      ? `linear-gradient(${layer.angle + 90}deg, ${stops.map(s => `${s.color} ${s.offset * 100}%`).join(", ")})`
                      : `radial-gradient(circle, ${stops.map(s => `${s.color} ${s.offset * 100}%`).join(", ")})`,
                  }} />
                  {/* Stops */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>Stops</span>
                      <button onClick={() => addBgGradientStop()}
                        style={{ background: "#1a1a1a", border: "1px solid #333", color: "#bbb", cursor: "pointer", fontSize: 11, padding: "2px 8px", borderRadius: 3 }}>+ Stop</button>
                    </div>
                    {stops.map((s, si) => (
                      <div key={si} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                        <label style={{ width: 24, height: 24, borderRadius: 4, background: s.color, border: "1px solid #333", flexShrink: 0, cursor: "pointer", position: "relative", overflow: "hidden" }}>
                          <input type="color"
                            value={/^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : "#ffffff"}
                            onChange={e => changeBgGradientStop(si, { color: e.target.value })}
                            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", border: 0 }} />
                        </label>
                        <input type="range" min={0} max={100} step={1}
                          value={Math.round(s.offset * 100)}
                          onChange={e => changeBgGradientStop(si, { offset: Number(e.target.value) / 100 })}
                          style={{ flex: 1 }} />
                        <span style={{ width: 32, textAlign: "right", color: "#bbb", fontFamily: "monospace", fontSize: 11 }}>{Math.round(s.offset * 100)}%</span>
                        {stops.length > 2 && (
                          <button title="Remover stop" onClick={() => removeBgGradientStop(si)}
                            style={{ width: 18, height: 18, borderRadius: 3, background: "transparent", border: "none", color: "#555", cursor: "pointer", fontSize: 11, padding: 0, lineHeight: 1 }}>✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Angulo (so linear) */}
                  {layer.gradientType === "linear" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#888", marginBottom: 14 }}>
                      <span style={{ width: 56, textTransform: "uppercase", letterSpacing: "0.5px" }}>Ângulo</span>
                      <input type="range" min={0} max={360} step={1}
                        value={Math.round(layer.angle)}
                        onChange={e => changeBgGradientAngle(Number(e.target.value))}
                        style={{ flex: 1 }} />
                      <span style={{ width: 36, textAlign: "right", color: "#bbb", fontFamily: "monospace" }}>{Math.round(layer.angle)}°</span>
                    </div>
                  )}
                </>
              )
            })()}
            {/* IMAGE: preview + upload + fit */}
            {(() => {
              const layer = bgLayersRef.current[currentBgIdx()]
              if (layer?.kind !== "image") return null
              const fitBtn = (f: BgImageFit, label: string) => (
                <button key={f} onClick={() => changeBgImageFit(f)}
                  style={{ flex: 1, padding: "5px 4px", fontSize: 10, borderRadius: 3, cursor: "pointer",
                    background: layer.fit === f ? "#F5C400" : "#1a1a1a",
                    color: layer.fit === f ? "#000" : "#888",
                    border: "1px solid " + (layer.fit === f ? "#F5C400" : "#333"),
                    fontFamily: "inherit", textTransform: "uppercase" as const, letterSpacing: "0.4px",
                  }}>{label}</button>
              )
              return (
                <>
                  {layer.imageDataUrl ? (
                    <div style={{
                      width: "100%", height: 120, borderRadius: 4, border: "1px solid #333",
                      marginBottom: 8, overflow: "hidden",
                      backgroundImage: `url(${layer.imageDataUrl})`,
                      backgroundSize: layer.fit === "tile" ? "auto" : (layer.fit === "fill" ? "100% 100%" : layer.fit),
                      backgroundRepeat: layer.fit === "tile" ? "repeat" : "no-repeat",
                      backgroundPosition: "center",
                      backgroundColor: "#0d0d0d",
                    }} />
                  ) : (
                    <div style={{ width: "100%", height: 120, borderRadius: 4, border: "1px dashed #444",
                      marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#555", fontSize: 11 }}>Sem imagem</div>
                  )}
                  <button onClick={() => {
                    const input = document.createElement("input")
                    input.type = "file"
                    input.accept = "image/*"
                    input.onchange = () => {
                      const f = input.files?.[0]
                      if (f) uploadBgImage(f, layer.fit)
                    }
                    input.click()
                  }}
                    style={{ width: "100%", padding: "6px 8px", fontSize: 11, marginBottom: 10,
                      background: "#1a1a1a", color: "#bbb", border: "1px solid #333",
                      borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
                      textTransform: "uppercase", letterSpacing: "0.5px",
                    }}>{layer.imageDataUrl ? "Substituir imagem" : "Selecionar imagem"}</button>
                  <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Encaixe</div>
                  <div style={{ display: "flex", gap: 3, marginBottom: 14 }}>
                    {fitBtn("cover", "Cover")}
                    {fitBtn("contain", "Contain")}
                    {fitBtn("fill", "Fill")}
                    {fitBtn("tile", "Tile")}
                  </div>
                </>
              )
            })()}
            {/* Opacity agora vive INLINE na linha do ColorSwatchPicker (Figma-style).
                Slider standalone removido. */}
            {/* BlendMode + Mask (BG-5) — controles avancados de PSD pro layer de BG */}
            {(() => {
              const layer = bgLayersRef.current[currentBgIdx()]
              if (!layer) return null
              const blend = layer.blendMode ?? "source-over"
              return (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#888", marginBottom: 10 }}>
                    <span style={{ width: 56, textTransform: "uppercase", letterSpacing: "0.5px" }}>Blend</span>
                    <select value={blend}
                      onChange={e => changeBgBlendMode(e.target.value as BgBlendMode)}
                      style={{ flex: 1, padding: "4px 6px", fontSize: 11, background: "#0d0d0d",
                        color: "#bbb", border: "1px solid #333", borderRadius: 3,
                        fontFamily: "inherit", outline: "none" }}>
                      <option value="source-over">Normal</option>
                      <option value="multiply">Multiply</option>
                      <option value="screen">Screen</option>
                      <option value="overlay">Overlay</option>
                      <option value="darken">Darken</option>
                      <option value="lighten">Lighten</option>
                      <option value="color-dodge">Color Dodge</option>
                      <option value="color-burn">Color Burn</option>
                      <option value="hard-light">Hard Light</option>
                      <option value="soft-light">Soft Light</option>
                      <option value="difference">Difference</option>
                      <option value="exclusion">Exclusion</option>
                      <option value="hue">Hue</option>
                      <option value="saturation">Saturation</option>
                      <option value="color">Color</option>
                      <option value="luminosity">Luminosity</option>
                    </select>
                  </div>
                  {/* Mask */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#888" }}>
                    <span style={{ width: 56, textTransform: "uppercase", letterSpacing: "0.5px" }}>Mask</span>
                    {layer.mask ? (
                      <div style={{ flex: 1, display: "flex", gap: 4 }}>
                        <button onClick={() => toggleBgMaskEnabled()}
                          title={layer.mask.enabled ? "Desativar mascara" : "Ativar mascara"}
                          style={{ flex: 1, padding: "4px 6px", fontSize: 11, background: layer.mask.enabled ? "#1a1a1a" : "#0d0d0d",
                            color: layer.mask.enabled ? "#F5C400" : "#666", border: "1px solid #333", borderRadius: 3, cursor: "pointer", fontFamily: "inherit" }}>
                          {layer.mask.enabled ? "Ativa" : "Desativada"}
                        </button>
                        <button onClick={() => removeBgMask()} title="Remover mascara"
                          style={{ padding: "4px 8px", fontSize: 11, background: "#1a1a1a", color: "#bbb", border: "1px solid #333", borderRadius: 3, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setBgMaskDefault()}
                        style={{ flex: 1, padding: "4px 6px", fontSize: 11, background: "#1a1a1a", color: "#bbb", border: "1px solid #333", borderRadius: 3, cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        + Adicionar
                      </button>
                    )}
                  </div>
                </>
              )
            })()}
          </div>
        ) : isText ? (
          (() => {
            // Quando ha selecao parcial dentro do textbox em modo edicao, le os estilos
            // do caractere onde o cursor esta — nao do objeto inteiro. Garante que o
            // painel reflete a fonte aplicada na selecao quando o texto tem partes em
            // pesos/fontes diferentes (ex: parte Helvetica Bold, parte Helvetica Regular).
            const isEditingText = (selected as any).isEditing
            const selStart = (selected as any).selectionStart ?? 0
            const selEnd = (selected as any).selectionEnd ?? 0
            const hasInlineSelection = isEditingText && selStart !== selEnd
            const isText = selected.type === "textbox" || selected.type === "i-text"
            let effectiveFontFamily = selected.fontFamily ?? "Arial"
            let effectiveFontSize = selected.fontSize ?? 80
            let effectiveFill = selected.fill ?? "#111111"
            // fontWeight efetivo: pra Google Fonts (e custom uploadadas), o
            // peso vive aqui (numero CSS 100-900), nao no nome do fontFamily.
            // WeightPicker usa pra mostrar peso correto e trocar via onPickWeight.
            let effectiveFontWeight: string | number = (selected as any).fontWeight ?? "normal"
            // Detector de "valor misto" — quando o texto tem partes com fontes/tamanhos/cores
            // diferentes, painel mostra placeholder em vez de um valor incorreto.
            let mixedFontFamily = false
            let mixedFontSize = false
            let mixedFill = false
            // lineHeight e textAlign sao propriedades do textbox inteiro (Fabric nao suporta
            // per-char nelas), entao nao tentam ler de getSelectionStyles.
            const effectiveLineHeight: number = (selected as any).lineHeight ?? 1.0
            const effectiveTextAlign: string = (selected as any).textAlign ?? "left"
            // Photoshop-style leading em pt:
            // - Se leadingPt foi definido: usa direto
            // - Senao: "Auto" = lineHeight × fontSize (calculo, mostrado em cinza)
            const leadingPtRaw: number | undefined = (selected as any).leadingPt
            const isLeadingAuto = leadingPtRaw === undefined || leadingPtRaw === null
            const effectiveLeadingPt: number = isLeadingAuto
              ? Math.round(effectiveLineHeight * effectiveFontSize)
              : leadingPtRaw

            // Helper: le estilo "efetivo" de uma faixa de caracteres respeitando overrides
            // per-char. Retorna { fontFamily, fontSize, fill } e flags de mistura.
            // Adobe/Photoshop-style: estilo do caractere = override per-char OU default do box.
            function readRange(start: number, end: number) {
              if (!isText || !(selected as any).getSelectionStyles) return null
              try {
                const styles = (selected as any).getSelectionStyles(start, end) || []
                if (styles.length === 0) return null
                const boxFont = (selected as any).fontFamily
                const boxSize = (selected as any).fontSize
                const boxFill = (selected as any).fill
                const boxWeight = (selected as any).fontWeight
                const fams = new Set<string>()
                const sizes = new Set<number>()
                const fills = new Set<string>()
                const weights = new Set<string | number>()
                for (const s of styles) {
                  fams.add(s.fontFamily ?? boxFont)
                  sizes.add(s.fontSize ?? boxSize)
                  fills.add(s.fill ?? boxFill)
                  weights.add(s.fontWeight ?? boxWeight ?? "normal")
                }
                return {
                  fontFamily: fams.size === 1 ? [...fams][0] : null,
                  fontSize: sizes.size === 1 ? [...sizes][0] : null,
                  fill: fills.size === 1 ? [...fills][0] : null,
                  fontWeight: weights.size === 1 ? [...weights][0] : null,
                  mixedFamily: fams.size > 1,
                  mixedSize: sizes.size > 1,
                  mixedFill: fills.size > 1,
                  mixedWeight: weights.size > 1,
                }
              } catch { return null }
            }

            if (hasInlineSelection) {
              // Edit mode + range: le estilo do range (pode ser misto)
              const r = readRange(selStart, selEnd)
              if (r) {
                if (r.fontFamily !== null) effectiveFontFamily = r.fontFamily
                else mixedFontFamily = true
                if (r.fontSize !== null) effectiveFontSize = r.fontSize
                else mixedFontSize = true
                if (r.fill !== null) effectiveFill = r.fill
                else mixedFill = true
                if (r.fontWeight !== null) effectiveFontWeight = r.fontWeight
              }
            } else if (isEditingText && isText) {
              // Edit mode + cursor (sem range): le do caractere atual (do anterior se cursor no fim)
              const text: string = (selected as any).text ?? ""
              const charIdx = selStart > 0 ? selStart - 1 : 0
              if (charIdx < text.length) {
                const r = readRange(charIdx, charIdx + 1)
                if (r) {
                  if (r.fontFamily !== null) effectiveFontFamily = r.fontFamily
                  if (r.fontSize !== null) effectiveFontSize = r.fontSize
                  if (r.fill !== null) effectiveFill = r.fill
                  if (r.fontWeight !== null) effectiveFontWeight = r.fontWeight
                }
              }
            } else if (isText) {
              // Caixa selecionada (sem edit mode): mostra estilo dominante do TEXTO INTEIRO,
              // nao o default do textbox. Adobe-style: se tem caracteres em "Exo 2", mostra
              // "Exo 2", nao "Arial" (default fictício do box).
              const text: string = (selected as any).text ?? ""
              if (text.length > 0) {
                const r = readRange(0, text.length)
                if (r) {
                  if (r.fontFamily !== null) effectiveFontFamily = r.fontFamily
                  else mixedFontFamily = true
                  if (r.fontSize !== null) effectiveFontSize = r.fontSize
                  else mixedFontSize = true
                  if (r.fill !== null) effectiveFill = r.fill
                  else mixedFill = true
                  if (r.fontWeight !== null) effectiveFontWeight = r.fontWeight
                }
              }
            }
            return (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            {/* CAMADA — blend mode + opacidade. PSD-style: cada layer pode ter
                multiply/screen/overlay/etc e opacidade. Aplicado a todos os tipos
                (texto/imagem/embedded). Round-trip: persistido no save. */}
            <div>
              <div style={secS}>Camada</div>
              <div style={numFieldGrid}>
                <select
                  value={(selected as any).globalCompositeOperation ?? "source-over"}
                  onChange={e => changeObjectBlendMode(e.target.value)}
                  style={{ ...inpS, cursor: "pointer", appearance: "none", paddingRight: 20 }}
                  title="Modo de mistura do layer (Photoshop-style)"
                >
                  <option value="source-over">Normal</option>
                  <option value="multiply">Multiply</option>
                  <option value="screen">Screen</option>
                  <option value="overlay">Overlay</option>
                  <option value="darken">Darken</option>
                  <option value="lighten">Lighten</option>
                  <option value="color-dodge">Color Dodge</option>
                  <option value="color-burn">Color Burn</option>
                  <option value="hard-light">Hard Light</option>
                  <option value="soft-light">Soft Light</option>
                  <option value="difference">Difference</option>
                  <option value="exclusion">Exclusion</option>
                  <option value="hue">Hue</option>
                  <option value="saturation">Saturation</option>
                  <option value="color">Color</option>
                  <option value="luminosity">Luminosity</option>
                  <option value="lighter">Linear Dodge</option>
                </select>
                <div style={numFieldRight}>
                  <input
                    type="number" min={0} max={100} step={1}
                    value={Math.round(((selected as any).opacity ?? 1) * 100)}
                    onChange={e => changeObjectOpacity((Number(e.target.value) || 0) / 100)}
                    title="Opacidade (0-100%)"
                    style={numInpS}
                  />
                  <span style={numFieldUnit}>%</span>
                </div>
              </div>
            </div>
            <div>
              <div style={secS}>Trocar asset</div>
              <select
                value={(selected as any).__assetId ?? ""}
                onChange={e => {
                  const newAsset = (campaign?.assets ?? []).find(a => a.id === e.target.value)
                  if (newAsset) {
                    const currentObj = fabricRef.current?.getActiveObject() ?? selected
                    swapAsset(currentObj, newAsset)
                  }
                }}
                style={{ ...inpS, cursor: "pointer", appearance: "none", paddingRight: 24 }}
              >
                {(() => {
                  // Regra: nao listar assets TEXT que ja estao em outros layers (cada
                  // asset texto so pode aparecer 1x no canvas). Mas SEMPRE incluir o
                  // asset atual (o selecionado), senao o swap perde a referencia visual.
                  const fc = fabricRef.current
                  const objs = fc ? fc.getObjects() : []
                  const usedIds = new Set(objs.map((o: any) => o.__assetId).filter(Boolean))
                  const currentId = (selected as any).__assetId
                  return (campaign?.assets ?? [])
                    .filter(a => a.type === "TEXT")
                    .filter(a => a.id === currentId || !usedIds.has(a.id))
                    .map(a => (
                      <option key={a.id} value={a.id}>{a.label || a.value || "Sem nome"}</option>
                    ))
                })()}
              </select>
            </div>
            <div>
              <div style={secS}>Fonte {mixedFontFamily && <span style={{ color: "#888", fontWeight: 400, fontStyle: "italic" }}>(múltiplas)</span>}</div>
              <FontPicker
                value={mixedFontFamily ? "" : effectiveFontFamily}
                onChange={(f) => applyStyle("fontFamily", f)}
                brandFont={campaignRef.current?.client?.brandFont ?? null}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={secS}>Tamanho {mixedFontSize && <span style={{ color: "#888", fontWeight: 400, fontStyle: "italic" }}>(múlt.)</span>}</div>
                <input
                  key={`fs-${(selected as any).__assetId ?? "x"}`}
                  type="number"
                  value={mixedFontSize ? "" : fontSizeInput}
                  placeholder={mixedFontSize ? "—" : ""}
                  onFocus={() => { numericInputFocusedRef.current = true }}
                  onBlur={() => { numericInputFocusedRef.current = false }}
                  // CRITICO pra char-level edit: captura a seleção do textbox
                  // ANTES do click no input remover o foco (saindo do edit mode).
                  // Sem isso, applyStyle vê isEditing=false e savedTextSelection
                  // pode estar stale (polling roda só a cada 100ms — clique rápido
                  // perde a seleção).
                  onMouseDown={() => {
                    const fc = fabricRef.current
                    const active = fc?.getActiveObject() as any
                    if (active?.isEditing && active.selectionStart !== active.selectionEnd) {
                      savedTextSelection.current = { obj: active, start: active.selectionStart, end: active.selectionEnd }
                    }
                  }}
                  onChange={e => {
                    const raw = e.target.value
                    setFontSizeInput(raw)
                    const n = Number(raw)
                    if (Number.isFinite(n) && n > 0) applyStyle("fontSize", n)
                  }}
                  onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                  style={inpS}
                />
              </div>
              <div>
                <div style={secS}>Peso</div>
                {/* WeightPicker tem dois modos:
                    - Sistema (Helvetica Neue Bold, Avenir Light): troca fontFamily.
                    - Google/custom (Exo 2, Manrope, fontes do cliente): mesma
                      familia, muda fontWeight numerico CSS via onPickWeight.
                    Decisao acontece dentro do WeightPicker baseado na presenca
                    da familia na lista de variantes do sistema. */}
                <WeightPicker
                  value={effectiveFontFamily}
                  fontWeight={effectiveFontWeight}
                  onChange={(f) => applyStyle("fontFamily", f)}
                  onPickWeight={(w) => applyStyle("fontWeight", w)}
                />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                {[0.2, 0.4, 0.6, 0.8].map(pct => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => scaleLayerToCanvas(pct)}
                    title={`Escala o layer pra ${Math.round(pct * 100)}% do canvas (centralizado)`}
                    style={{ background: "#222", border: "1px solid #2a2a2a", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#aaa" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.color = "#fff" }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.color = "#aaa" }}
                  >
                    {Math.round(pct * 100)}%
                  </button>
                ))}
              </div>
              <button onClick={fitLayerToCanvas}
                style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#111" }}
                title="Escala e centraliza o layer dentro da peça (100%)">
                Encaixar no canvas
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={secS}>Entrelinhas</div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input
                    key={`lh-${(selected as any).__assetId ?? "x"}`}
                    type="number"
                    step="1"
                    value={leadingInput}
                    onFocus={() => { numericInputFocusedRef.current = true }}
                    onBlur={() => { numericInputFocusedRef.current = false }}
                    onMouseDown={() => {
                      const fc = fabricRef.current
                      const active = fc?.getActiveObject() as any
                      if (active?.isEditing && active.selectionStart !== active.selectionEnd) {
                        savedTextSelection.current = { obj: active, start: active.selectionStart, end: active.selectionEnd }
                      }
                    }}
                    onChange={e => {
                      const raw = e.target.value
                      setLeadingInput(raw)
                      const n = Number(raw)
                      if (Number.isFinite(n) && n > 0) setLeading(n)
                    }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                    title={isLeadingAuto ? `Auto (${Math.round(effectiveLeadingPt)}pt) — Option+↑/↓ ajusta` : "Option+↑/↓ ajusta (Shift = 10pt)"}
                    style={{ ...inpS, color: isLeadingAuto ? "#888" : "white" }}
                  />
                  <button type="button"
                    onClick={() => setLeading(null)}
                    disabled={isLeadingAuto}
                    title="Resetar pra Auto"
                    style={{
                      width: 28, height: 28, fontSize: 11,
                      background: isLeadingAuto ? "#1a1a1a" : "#111",
                      border: "1px solid #2a2a2a", color: isLeadingAuto ? "#444" : "#888",
                      borderRadius: 4, cursor: isLeadingAuto ? "default" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                    A
                  </button>
                </div>
              </div>
              <div>
                <div style={secS}>Alinhamento</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {[
                    { v: "left", icon: "⫷", title: "Esquerda (Cmd+Shift+L)" },
                    { v: "center", icon: "≡", title: "Centro (Cmd+Shift+C)" },
                    { v: "right", icon: "⫸", title: "Direita (Cmd+Shift+R)" },
                    { v: "justify", icon: "☰", title: "Justificar (Cmd+Shift+J)" },
                  ].map(a => {
                    const active = effectiveTextAlign === a.v
                    return (
                      <button key={a.v} type="button"
                        onClick={() => applyTextboxStyle("textAlign", a.v)}
                        title={a.title}
                        style={{
                          flex: 1, height: 28,
                          background: active ? "#F5C400" : "#111",
                          border: active ? "none" : "1px solid #2a2a2a",
                          color: active ? "#111" : "white",
                          borderRadius: 4, cursor: "pointer",
                          fontSize: 14, fontWeight: 700,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                        {a.icon}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            <div>
              <div style={secS}>Cor {mixedFill && <span style={{ color: "#888", fontWeight: 400, fontStyle: "italic" }}>(múltiplas)</span>}</div>
              <ColorSwatchPicker
                value={mixedFill ? "" : (effectiveFill || "")}
                onChange={(hex, brandIdx) => applyStyle("fill", hex, brandIdx)}
                brandColors={brandColors as any}
                defaultSwatches={SWATCHES}
                activeBrandIdx={typeof (selected as any).__fillBrandIdx === "number" ? (selected as any).__fillBrandIdx : undefined}
                opacity={((selected as any).opacity ?? 1) * 100}
                onOpacityChange={pct => changeObjectOpacity(pct / 100)}
                // CRITICO per-char: captura selection ANTES do click roubar
                // foco do textbox. Sem isso, applyStyle ve isEditing=false +
                // savedTextSelection stale → aplica fill no textbox INTEIRO
                // (perde colors per-char). Mesmo pattern do fontSize input
                // (linha ~9602).
                onMouseDownCapture={() => {
                  const fc = fabricRef.current
                  const active = fc?.getActiveObject() as any
                  if (active?.isEditing && active.selectionStart !== active.selectionEnd) {
                    savedTextSelection.current = { obj: active, start: active.selectionStart, end: active.selectionEnd }
                  }
                }}
              />
            </div>

            {/* ===== MÁSCARA (Photoshop-style) ===== */}
            <MaskPanel
              selected={selected}
              onAddClipping={addClippingMaskToSelected}
              onAddRectVector={(reveal) => addRectVectorMaskToSelected(reveal)}
              onAddEllipseVector={(reveal) => addEllipseVectorMaskToSelected(reveal)}
              onToggleEnabled={() => toggleMaskEnabled(selected)}
              onToggleInverted={() => toggleMaskInverted(selected)}
              onRemove={() => removeMaskFromObject(selected)}
              secS={secS}
            />
          </div>
            )
          })()
        ) : ((selected as any).__isShape === true || selected.type === "path" || selected.type === "Path") ? (
          /* SHAPE editor (Fabric.Path) — fill + stroke + stroke-width editaveis.
             Mantem o path vetorial vivo (sem rasterizar), preservando edicao
             Photoshop-like. Sincroniza com Fabric via .set + renderAll.

             Fill/Stroke OPACITIES sao INDEPENDENTES (Figma-style): codificadas
             no proprio color string como rgba(r,g,b,a). A opacity da CAMADA
             (objeto inteiro) multiplica ambas. Isso evita o bug "stroke=0
             apaga o fill" que tinha quando ambas amarravam a obj.opacity. */
          (() => {
            const fc = fabricRef.current
            // Color helpers — parse e (re)emite rgba/hex pra preservar alpha.
            function parseColor(c: string): { hex: string; alpha: number } {
              if (typeof c !== "string" || !c) return { hex: "", alpha: 1 }
              const hexM = /^#([0-9a-fA-F]{6})$/.exec(c.trim())
              if (hexM) return { hex: `#${hexM[1].toLowerCase()}`, alpha: 1 }
              const hex8 = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/.exec(c.trim())
              if (hex8) return { hex: `#${hex8[1].toLowerCase()}`, alpha: Math.round((parseInt(hex8[2], 16) / 255) * 1000) / 1000 }
              const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(c.trim())
              if (rgba) {
                const r = parseInt(rgba[1], 10), g = parseInt(rgba[2], 10), b = parseInt(rgba[3], 10)
                const a = rgba[4] ? parseFloat(rgba[4]) : 1
                const hex = `#${[r, g, b].map(n => n.toString(16).padStart(2, "0")).join("")}`
                return { hex, alpha: a }
              }
              return { hex: c, alpha: 1 }
            }
            function combineHexAlpha(hex: string, alpha: number): string {
              if (!hex) return ""
              const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
              if (!m) return hex
              if (alpha >= 0.999) return `#${m[1].toLowerCase()}`
              const n = parseInt(m[1], 16)
              const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff
              return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`
            }
            const fillParsed = parseColor(selected.fill ?? "")
            const strokeParsed = parseColor(selected.stroke ?? "")
            const currentFillHex = fillParsed.hex || "#000000"
            const currentFillAlpha = fillParsed.alpha
            const currentStrokeHex = strokeParsed.hex || ""
            const currentStrokeAlpha = strokeParsed.alpha
            const currentStrokeWidth = (selected as any).strokeWidth ?? 0
            const shapeKind = (selected as any).__shapeKind as ("rectangle"|"roundedRect"|"ellipse"|undefined)
            const currentCornerRadius = (selected as any).__cornerRadius ?? 20
            // Dimensoes do shape: PRIORIDADE pro path interno (__pathBbox).
            // Antes usavamos so __pathBbox que ficava stale apos scaling. Agora
            // verificamos tambem obj.width/height (live Fabric path dims).
            const pathBboxRaw = (selected as any).__pathBbox ?? { left: 0, top: 0, right: 400, bottom: 300 }
            const bboxW = Math.max(1, (selected as any).width ?? ((pathBboxRaw.right ?? 400) - (pathBboxRaw.left ?? 0)))
            const bboxH = Math.max(1, (selected as any).height ?? ((pathBboxRaw.bottom ?? 300) - (pathBboxRaw.top ?? 0)))
            const maxRadius = Math.floor(Math.min(bboxW, bboxH) / 2)
            function setCornerRadius(r: number) {
              if (!fc || !selected) return
              // Clamp HARD pra evitar shape degenerado (circulo quando r >= min/2).
              // O input HTML max eh "soft" — user pode digitar valor maior.
              const clamped = Math.max(0, Math.min(r, maxRadius))
              const newPath = buildShapePath("roundedRect", bboxW, bboxH, clamped)
              applyShapePathInPlace(selected, newPath)
              ;(selected as any).__cornerRadius = clamped
              fc.requestRenderAll()
              setSelectedTick(t => t + 1)
              isDirtyRef.current = true
              setIsDirty(true)
              if (isInitialized.current && !isApplyingHistory.current) pushHistory()
              doSave()
            }
            function setShapeProp(key: "fill" | "stroke" | "strokeWidth", val: any) {
              if (!fc || !selected) return
              // Compensacao Photoshop-center: ao mudar strokeWidth, ajusta
              // left/top pra metade do delta em cada lado. Sem isso, Fabric
              // mantem o anchor top-left fixo e o bbox cresce pra direita+
              // baixo (path inside shifta visualmente). Com compensacao, o
              // path stays no mesmo lugar visual — comportamento Adobe-fiel.
              if (key === "strokeWidth") {
                const oldW = (selected as any).strokeWidth ?? 0
                const newW = Number(val) || 0
                const delta = (newW - oldW) / 2
                if (delta !== 0) {
                  ;(selected as any).set({
                    left: ((selected as any).left ?? 0) - delta,
                    top: ((selected as any).top ?? 0) - delta,
                  })
                }
              }
              ;(selected as any).set(key, val)
              // strokeUniform: true mantem espessura constante em qualquer
              // zoom/scale (comportamento PSD). Sem isso, stroke escala com
              // a transformacao da layer — quebrar ao redimensionar.
              if (key === "strokeWidth" || key === "stroke") {
                ;(selected as any).set("strokeUniform", true)
              }
              ;(selected as any).setCoords?.() // recalc bbox + handles
              ;(selected as any).dirty = true
              fc.requestRenderAll()
              setSelectedTick(t => t + 1)
              isDirtyRef.current = true
              setIsDirty(true)
              if (isInitialized.current && !isApplyingHistory.current) pushHistory()
              doSave()
            }
            // Setters INDEPENDENTES: combinam hex novo com alpha atual (e vice-versa).
            const setFillHex = (hex: string) => setShapeProp("fill", combineHexAlpha(hex, currentFillAlpha))
            const setFillAlpha = (pct: number) => setShapeProp("fill", combineHexAlpha(currentFillHex, Math.max(0, Math.min(1, pct / 100))))
            const setStrokeHex = (hex: string) => setShapeProp("stroke", combineHexAlpha(hex, currentStrokeAlpha))
            const setStrokeAlpha = (pct: number) => setShapeProp("stroke", combineHexAlpha(currentStrokeHex, Math.max(0, Math.min(1, pct / 100))))
            return (
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Label do layer removido (2026-05-22) — redundante com o
                    painel Layers que ja destaca o ativo. */}

                {/* CAMADA — blend + opacidade (paridade com outros tipos). */}
                <div>
                  <div style={secS}>Camada</div>
                  <div style={numFieldGrid}>
                    <select
                      value={(selected as any).globalCompositeOperation ?? "source-over"}
                      onChange={e => changeObjectBlendMode(e.target.value)}
                      style={{ ...inpS, cursor: "pointer", appearance: "none", paddingRight: 20 }}
                    >
                      <option value="source-over">Normal</option>
                      <option value="multiply">Multiply</option>
                      <option value="screen">Screen</option>
                      <option value="overlay">Overlay</option>
                      <option value="darken">Darken</option>
                      <option value="lighten">Lighten</option>
                    </select>
                    <div style={numFieldRight}>
                      <input type="number" min={0} max={100} step={1}
                        value={Math.round(((selected as any).opacity ?? 1) * 100)}
                        onChange={e => changeObjectOpacity((Number(e.target.value) || 0) / 100)}
                        style={numInpS} />
                      <span style={numFieldUnit}>%</span>
                    </div>
                  </div>
                </div>

                {/* FILL — ColorSwatchPicker Figma-style. Opacity INDEPENDENTE
                    (encodada em rgba do fill). */}
                <div>
                  <div style={secS}>Preenchimento</div>
                  <ColorSwatchPicker
                    value={currentFillHex}
                    onChange={(hex) => setFillHex(hex)}
                    brandColors={brandColors as any}
                    defaultSwatches={SWATCHES}
                    allowEmpty
                    opacity={Math.round(currentFillAlpha * 100)}
                    onOpacityChange={pct => setFillAlpha(pct)}
                  />
                </div>

                {/* STROKE — cor (ColorSwatchPicker com opacity inline, mesmo
                    padrao Figma do FILL) + espessura abaixo. Opacity INDEPENDENTE
                    da fill — antes amarrava obj.opacity e zerar stroke escondia
                    tudo (bug reportado 2026-05-22). */}
                <div>
                  <div style={secS}>Stroke</div>
                  <ColorSwatchPicker
                    value={currentStrokeHex}
                    onChange={(hex) => {
                      setStrokeHex(hex)
                      // Setar stroke com width=0 deixa ele invisivel — auto-applica 1px
                      // pra user ver o stroke imediatamente.
                      if (hex && currentStrokeWidth === 0) setShapeProp("strokeWidth", 1)
                      // Limpar stroke (∅) zera width tambem.
                      if (!hex) setShapeProp("strokeWidth", 0)
                    }}
                    brandColors={brandColors as any}
                    defaultSwatches={SWATCHES}
                    allowEmpty
                    opacity={Math.round(currentStrokeAlpha * 100)}
                    onOpacityChange={pct => setStrokeAlpha(pct)}
                  />
                  {/* Espessura — slider + numero. Grid `1fr 92px` + gap 6 padronizado
                      com CAMADA pra alinhamento visual consistente do right column. */}
                  <div style={{ ...numFieldGrid, marginTop: 8 }}>
                    <input type="range" min={0} max={50} step={1}
                      value={currentStrokeWidth}
                      onChange={e => setShapeProp("strokeWidth", Number(e.target.value))}
                      style={{ width: "100%" }} />
                    <div style={numFieldRight}>
                      <input type="number" min={0} max={500} step={1}
                        value={currentStrokeWidth}
                        onChange={e => setShapeProp("strokeWidth", Number(e.target.value) || 0)}
                        style={numInpS} />
                      <span style={numFieldUnit}>px</span>
                    </div>
                  </div>
                </div>

                {/* CANTO ARREDONDADO — so renderiza pra shapes do tipo roundedRect.
                    Recomputa o path SVG mantendo a bbox original, ajustando os
                    bezier dos 4 cantos com novo raio. Mesmo grid pattern. */}
                {shapeKind === "roundedRect" && (
                  <div>
                    <div style={secS}>Raio do canto</div>
                    <div style={numFieldGrid}>
                      <input type="range"
                        min={0} max={maxRadius} step={1}
                        value={Math.min(currentCornerRadius, maxRadius)}
                        onChange={e => setCornerRadius(Number(e.target.value))}
                        style={{ width: "100%" }} />
                      <div style={numFieldRight}>
                        <input type="number"
                          min={0} max={maxRadius} step={1}
                          value={Math.min(currentCornerRadius, maxRadius)}
                          onChange={e => setCornerRadius(Number(e.target.value) || 0)}
                          style={numInpS} />
                        <span style={numFieldUnit}>px</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })()
        ) : (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Label do layer removido (2026-05-22) — painel Layers ja indica
                qual layer esta ativo, sem duplicar info aqui. */}
            {/* CAMADA — blend mode + opacidade (mesmo controle do painel de texto).
                PSD-style: imagens, shapes e embedded layers tb suportam multiply/etc. */}
            <div>
              <div style={secS}>Camada</div>
              <div style={numFieldGrid}>
                <select
                  value={(selected as any).globalCompositeOperation ?? "source-over"}
                  onChange={e => changeObjectBlendMode(e.target.value)}
                  style={{ ...inpS, cursor: "pointer", appearance: "none", paddingRight: 20 }}
                  title="Modo de mistura do layer (Photoshop-style)"
                >
                  <option value="source-over">Normal</option>
                  <option value="multiply">Multiply</option>
                  <option value="screen">Screen</option>
                  <option value="overlay">Overlay</option>
                  <option value="darken">Darken</option>
                  <option value="lighten">Lighten</option>
                  <option value="color-dodge">Color Dodge</option>
                  <option value="color-burn">Color Burn</option>
                  <option value="hard-light">Hard Light</option>
                  <option value="soft-light">Soft Light</option>
                  <option value="difference">Difference</option>
                  <option value="exclusion">Exclusion</option>
                  <option value="hue">Hue</option>
                  <option value="saturation">Saturation</option>
                  <option value="color">Color</option>
                  <option value="luminosity">Luminosity</option>
                  <option value="lighter">Linear Dodge</option>
                </select>
                <div style={numFieldRight}>
                  <input
                    type="number" min={0} max={100} step={1}
                    value={Math.round(((selected as any).opacity ?? 1) * 100)}
                    onChange={e => changeObjectOpacity((Number(e.target.value) || 0) / 100)}
                    title="Opacidade (0-100%)"
                    style={numInpS}
                  />
                  <span style={numFieldUnit}>%</span>
                </div>
              </div>
            </div>
            <div>
              <div style={secS}>Trocar asset</div>
              <select
                value={(selected as any).__assetId ?? ""}
                onChange={e => {
                  const newAsset = (campaign?.assets ?? []).find(a => a.id === e.target.value)
                  if (newAsset) {
                    const currentObj = fabricRef.current?.getActiveObject() ?? selected
                    swapAsset(currentObj, newAsset)
                  }
                }}
                style={{ ...inpS, cursor: "pointer", appearance: "none", paddingRight: 24 }}
              >
                {(campaign?.assets ?? [])
                  .filter(a => a.type === "IMAGE")
                  .map(a => (
                    <option key={a.id} value={a.id}>{a.label || "Sem nome"}</option>
                  ))
                }
              </select>
            </div>
            <div style={{ color: "#444", fontSize: 11 }}>Mova e redimensione no canvas.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
              {[0.2, 0.4, 0.6, 0.8].map(pct => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => scaleLayerToCanvas(pct)}
                  title={`Escala o layer pra ${Math.round(pct * 100)}% do canvas (centralizado)`}
                  style={{ background: "#222", border: "1px solid #2a2a2a", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#aaa" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.color = "#fff" }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.color = "#aaa" }}
                >
                  {Math.round(pct * 100)}%
                </button>
              ))}
            </div>
            <button onClick={fitLayerToCanvas}
              style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#111" }}
              title="Escala e centraliza o layer dentro da peça (100%)">
              Encaixar no canvas
            </button>

            {/* ===== MÁSCARA (Photoshop-style) ===== */}
            <MaskPanel
              selected={selected}
              onAddClipping={addClippingMaskToSelected}
              onAddRectVector={(reveal) => addRectVectorMaskToSelected(reveal)}
              onAddEllipseVector={(reveal) => addEllipseVectorMaskToSelected(reveal)}
              onToggleEnabled={() => toggleMaskEnabled(selected)}
              onToggleInverted={() => toggleMaskInverted(selected)}
              onRemove={() => removeMaskFromObject(selected)}
              secS={secS}
            />
          </div>
        )}
      </div>

      {confirmExit && (() => {
        // Adapta texto/botoes ao estado: dirty mostra 3 opcoes (Cancelar/Descartar/
        // Salvar e sair); limpo mostra 2 (Cancelar/Voltar). Sempre pergunta pra
        // que o user nao saia por engano — pedido do user pra ser consistente.
        const dirty = isDirtyRef.current || isDirty
        return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#1a1a1a", borderRadius: 10, padding: 24, width: 420, border: "1px solid #333" }}>
            <div style={{ color: "white", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              {dirty ? "Salvar alterações?" : "Voltar para a campanha?"}
            </div>
            <div style={{ color: "#888", fontSize: 13, marginBottom: 18 }}>
              {dirty
                ? "Você tem mudanças não salvas. O que deseja fazer?"
                : "Tudo salvo. Deseja sair do editor?"}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmExit(null)}
                style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "8px 14px", color: "#888", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
              {dirty && (
                <button onClick={() => {
                  const go = confirmExit
                  setConfirmExit(null)
                  // Reseta isDirty ANTES de navegar pra que o beforeunload
                  // listener do browser nao dispare o "Leave site?" nativo
                  // (user ja decidiu via nosso dialog).
                  isDirtyRef.current = false
                  setIsDirty(false)
                  if (go) go()
                }}
                  style={{ background: "transparent", border: "1px solid #d33", borderRadius: 6, padding: "8px 14px", color: "#d33", fontSize: 13, cursor: "pointer" }}>Descartar</button>
              )}
              <button onClick={async () => {
                const go = confirmExit
                setConfirmExit(null)
                if (dirty) {
                  try {
                    await saveNow()
                    console.log("[ConfirmExit] save completo, navegando…")
                  } catch (e) {
                    console.warn("[ConfirmExit] saveNow falhou:", e)
                  }
                }
                if (go) {
                  try { go() } catch (e) { console.warn("[ConfirmExit] go() falhou:", e) }
                }
              }}
                style={{ background: accentColor, border: "none", borderRadius: 6, padding: "8px 14px", color: "#111", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {dirty ? "Salvar" : "Sair"}
              </button>
            </div>
          </div>
        </div>
        )
      })()}

      {exportOpen && exportPieces.length > 0 && (
        <ExportDialog
          pieces={exportPieces}
          campaignName={(campaign as any)?.title ?? (campaign as any)?.name}
          onClose={() => { setExportOpen(false); setExportPieces([]) }}
        />
      )}

      {modal && <GeneratePiecesModal campaignId={campaignId} fabricRef={fabricRef} onClose={() => setModal(false)} onGenerated={() => { setModal(false); router.push(`/pieces?campaignId=${campaignId}`) }} />}

      {/* PsdImporter renderizado escondido — usado pelo botao "Importar PSD"
          da topbar via ref.importFile(file). Sem isso, teriamos que duplicar
          toda a logica de upload + assets + smart objects do PsdImporter. */}
      <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", visibility: "hidden", pointerEvents: "none" }}>
        <PsdImporter
          ref={psdImporterRef}
          campaignId={campaignId}
          onImported={() => {
            // Recarrega o editor com a nova KV. window.location forca full reload
            // (App Router fetch revalida o `/api/campaigns/:id` + KV).
            if (typeof window !== "undefined") window.location.reload()
          }}
        />
      </div>

      {/* Banner de fontes ausentes — aparece quando uma fonte usada por algum
          asset NAO esta disponivel no browser (Google Fonts 404 silencioso ou
          fonte custom nunca uploadada). Sintoma sem este banner: preview do KV
          (raster PSD) vem perfeito, mas Textbox cai em Arial sem o user saber.
          Botao "Subir fonte" usa o mesmo fluxo do PsdImporter modal — file
          picker .ttf/.otf, salva em customFontFiles do cliente, recarrega a
          familia in-tab. */}
      {missingFonts.length > 0 && (
        <div style={{
          position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)",
          maxWidth: 720, width: "calc(100% - 32px)",
          background: "#1a1a1a", border: "1px solid #facc15", borderLeft: "4px solid #facc15",
          borderRadius: 8, padding: "12px 16px", zIndex: 9000,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#facc15", marginBottom: 2 }}>
              Fontes não encontradas — {missingFonts.length} variante{missingFonts.length > 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: 12, color: "#ccc", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {missingFonts.slice(0, 3).map(f => f.label).join(", ")}{missingFonts.length > 3 ? `, +${missingFonts.length - 3}` : ""}
            </div>
          </div>
          <button
            onClick={() => setFontsModalOpen(true)}
            disabled={!campaign?.client?.id}
            title={campaign?.client?.id ? "Abrir gerenciador de fontes ausentes" : "Cliente nao identificado"}
            style={{
              background: campaign?.client?.id ? "#facc15" : "#333",
              color: campaign?.client?.id ? "#000" : "#666",
              border: "none", borderRadius: 6,
              padding: "8px 14px", fontSize: 12, fontWeight: 700,
              cursor: campaign?.client?.id ? "pointer" : "not-allowed", flexShrink: 0,
            }}
          >
            Resolver fontes
          </button>
          <button
            onClick={() => setMissingFonts([])}
            title="Fechar aviso (nao resolve, apenas oculta)"
            style={{
              background: "transparent", border: "none", color: "#666",
              fontSize: 18, cursor: "pointer", padding: "0 4px", lineHeight: 1, flexShrink: 0,
            }}
          >×</button>
        </div>
      )}

      {/* Modal de gerenciamento de fontes ausentes — estilo Adobe "Find Font".
          Pra cada variante missing: nome + dropdown "Substituir por..." +
          botao de upload do arquivo .ttf/.otf. Substituir aplica imediato no
          canvas; upload registra como customFontFile do cliente. */}
      {fontsModalOpen && missingFonts.length > 0 && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setFontsModalOpen(false) }}
          style={{
            position: "fixed", inset: 0, zIndex: 9500,
            background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
        >
          <div style={{
            background: "#1a1a1a", color: "#fff",
            borderRadius: 12, border: "1px solid #333",
            width: "100%", maxWidth: 760, maxHeight: "85vh",
            display: "flex", flexDirection: "column",
            boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          }}>
            <div style={{ padding: "18px 20px", borderBottom: "1px solid #2a2a2a" }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                Fontes ausentes
              </div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.5 }}>
                Cada variante do PSD que não está disponível no browser. Substitua por
                uma fonte já instalada ou suba o arquivo <code style={{ background: "#0f0f0f", padding: "1px 5px", borderRadius: 3 }}>.ttf</code>/<code style={{ background: "#0f0f0f", padding: "1px 5px", borderRadius: 3 }}>.otf</code> exato.
                Substituição afeta só os textos que usam essa variante específica.
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
              {/* Sub-header das colunas — Adobe-style alinhamento visual */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 170px 130px 100px 100px",
                gap: 8, alignItems: "center",
                padding: "6px 8px",
                fontSize: 9, color: "#666", fontWeight: 700,
                textTransform: "uppercase", letterSpacing: 0.6,
              }}>
                <div>Fonte ausente</div>
                <div>Substituir família</div>
                <div>Peso / estilo</div>
                <div></div>
                <div></div>
              </div>
              {missingFonts.map((mf, idx) => {
                const familyOptions: Array<{ value: string; label: string; group: string }> = []
                const brandFont = campaign?.client?.brandFont
                if (typeof brandFont === "string" && brandFont.trim()) {
                  familyOptions.push({ value: brandFont, label: brandFont, group: "Marca" })
                }
                const SYSTEM = ["Arial", "Helvetica", "Times New Roman", "Georgia", "Verdana", "Tahoma", "Courier New"]
                for (const s of SYSTEM) {
                  if (s !== brandFont) familyOptions.push({ value: s, label: s, group: "Sistema" })
                }
                for (const g of GOOGLE_FONTS) {
                  if (g.name !== brandFont) familyOptions.push({ value: g.name, label: g.name, group: "Google Fonts" })
                }
                const groups = ["Marca", "Sistema", "Google Fonts"] as const
                // 9 pesos × 2 estilos. Label legivel mantem a paridade com Adobe.
                const WEIGHT_STYLE_OPTIONS: Array<{ value: string; label: string }> = [
                  { value: "100|normal", label: "Thin" },
                  { value: "100|italic", label: "Thin Italic" },
                  { value: "200|normal", label: "ExtraLight" },
                  { value: "200|italic", label: "ExtraLight Italic" },
                  { value: "300|normal", label: "Light" },
                  { value: "300|italic", label: "Light Italic" },
                  { value: "400|normal", label: "Regular" },
                  { value: "400|italic", label: "Italic" },
                  { value: "500|normal", label: "Medium" },
                  { value: "500|italic", label: "Medium Italic" },
                  { value: "600|normal", label: "SemiBold" },
                  { value: "600|italic", label: "SemiBold Italic" },
                  { value: "700|normal", label: "Bold" },
                  { value: "700|italic", label: "Bold Italic" },
                  { value: "800|normal", label: "ExtraBold" },
                  { value: "800|italic", label: "ExtraBold Italic" },
                  { value: "900|normal", label: "Black" },
                  { value: "900|italic", label: "Black Italic" },
                ]
                const choice = replacementChoices[mf.label] ?? {}
                // Default do dropdown de peso: peso da fonte missing (Adobe-style:
                // se voce esta substituindo Bold Italic, comeca em Bold Italic).
                const effectiveWeight = choice.weight ?? mf.weight
                const effectiveStyle = choice.style ?? mf.style
                const currentWeightValue = `${effectiveWeight}|${effectiveStyle}`
                const canApply = !!choice.family

                async function applySubstitution(family: string, weight: number, style: "normal" | "italic") {
                  try {
                    const { loadGoogleFont, forceLoadFontFaces } = await import("@/lib/google-fonts")
                    const isGoogle = GOOGLE_FONTS.some(g => g.name === family)
                    if (isGoogle) {
                      loadGoogleFont(family)
                      await forceLoadFontFaces([family], 4000)
                    }
                  } catch {}
                  // Aplica trocando a familia E sincronizando weight+style nos
                  // textos afetados — Photoshop-style "replace with this weight".
                  const fc = fabricRef.current
                  if (fc) {
                    const weightToNum = (w: any): number => {
                      if (typeof w === "number") return w
                      if (typeof w === "string") {
                        const lower = w.trim().toLowerCase()
                        if (lower === "bold") return 700
                        if (lower === "normal" || lower === "regular") return 400
                        const n = Number(lower)
                        if (Number.isFinite(n) && n > 0) return n
                      }
                      return 400
                    }
                    const styleToCanon = (s: any): "normal" | "italic" =>
                      typeof s === "string" && /italic|oblique/i.test(s) ? "italic" : "normal"
                    let touched = 0
                    for (const o of fc.getObjects()) {
                      if (o.type !== "textbox" && o.type !== "i-text") continue
                      const tb = o as any
                      // Snapshot defaults antes de mexer — fallback per-char tem
                      // que comparar contra valor original, nao o ja substituido.
                      const origFamily = tb.fontFamily
                      const origWeight = tb.fontWeight
                      const origStyle = tb.fontStyle
                      const matchesDefault = origFamily === mf.family
                        && weightToNum(origWeight) === mf.weight
                        && styleToCanon(origStyle) === mf.style
                      if (matchesDefault) {
                        tb.set("fontFamily", family)
                        tb.set("fontWeight", weight)
                        tb.set("fontStyle", style)
                        touched++
                      }
                      const styles = tb.styles
                      if (styles && typeof styles === "object") {
                        for (const lineKey of Object.keys(styles)) {
                          const line = styles[lineKey]
                          if (!line || typeof line !== "object") continue
                          for (const colKey of Object.keys(line)) {
                            const cs = line[colKey]
                            if (!cs) continue
                            const charFamily = cs.fontFamily ?? origFamily
                            const charWeight = weightToNum(cs.fontWeight ?? origWeight)
                            const charStyle = styleToCanon(cs.fontStyle ?? origStyle)
                            if (charFamily === mf.family && charWeight === mf.weight && charStyle === mf.style) {
                              cs.fontFamily = family
                              cs.fontWeight = weight
                              cs.fontStyle = style
                              touched++
                            }
                          }
                        }
                      }
                      if ((tb as any).initDimensions) (tb as any).initDimensions()
                      tb.setCoords()
                    }
                    if (touched > 0) {
                      fc.requestRenderAll()
                      isDirtyRef.current = true
                      setIsDirty(true)
                      if (isInitialized.current && !isApplyingHistory.current) pushHistory()
                      doSave()
                    }
                    console.log("[font-substitute]", mf.label, "→", `${family} ${weight} ${style}`, `(${touched} alvos)`)
                  }

                  // Propagacao no banco: substituicao deve persistir em
                  // asset.content (spans) E asset.lastOverride pra que ao
                  // reabrir o editor, o detection nao volte a reportar a
                  // mesma fonte como missing. Sem isso, o save do canvas
                  // atualizava so o layer.overrides do KV/Piece, mas as
                  // spans do asset (fonte da verdade dos chars) continuavam
                  // referenciando a familia missing.
                  try {
                    const weightToNumOuter = (w: any): number => {
                      if (typeof w === "number") return w
                      if (typeof w === "string") {
                        const lower = w.trim().toLowerCase()
                        if (lower === "bold") return 700
                        if (lower === "normal" || lower === "regular") return 400
                        const n = Number(lower)
                        if (Number.isFinite(n) && n > 0) return n
                      }
                      return 400
                    }
                    const styleToCanonOuter = (s: any): "normal" | "italic" =>
                      typeof s === "string" && /italic|oblique/i.test(s) ? "italic" : "normal"
                    const matchesVariant = (entry: any): boolean => {
                      if (!entry || typeof entry !== "object") return false
                      const f = entry.fontFamily
                      if (typeof f !== "string" || f !== mf.family) return false
                      return weightToNumOuter(entry.fontWeight) === mf.weight
                        && styleToCanonOuter(entry.fontStyle) === mf.style
                    }
                    const replaceFields = (entry: any) => {
                      entry.fontFamily = family
                      entry.fontWeight = weight
                      entry.fontStyle = style
                    }
                    const assetsToPatch: Array<{ id: string; content: any; lastOverride: any }> = []
                    for (const a of (campaign?.assets ?? [])) {
                      if (a.type !== "TEXT") continue
                      let assetDirty = false
                      // 1) Spans em content
                      const spansRaw: any = typeof a.content === "string"
                        ? (() => { try { return JSON.parse(a.content as any) } catch { return [] } })()
                        : a.content
                      let newContent: any = spansRaw
                      if (Array.isArray(spansRaw)) {
                        const newSpans = spansRaw.map((s: any) => {
                          if (matchesVariant(s?.style)) {
                            const ns = { ...s.style }
                            replaceFields(ns)
                            assetDirty = true
                            return { ...s, style: ns }
                          }
                          return s
                        })
                        newContent = newSpans
                      }
                      // 2) lastOverride: default + styles per-char.
                      // CRITICO: o matchesVariant per-char usa `lo` (original)
                      // como fallback pros campos nao setados, NAO `newLO` (que
                      // ja foi atualizado se default match). Senao chars sem
                      // fontFamily explicito (herdam do default original) deixam
                      // de bater apos o default ja ter sido reescrito.
                      const lo: any = (a as any).lastOverride
                      let newLO: any = lo
                      if (lo && typeof lo === "object") {
                        newLO = { ...lo }
                        const defaultMatched = matchesVariant(lo)
                        if (defaultMatched) {
                          replaceFields(newLO)
                          assetDirty = true
                        }
                        if (lo.styles && typeof lo.styles === "object") {
                          const newStyles: any = {}
                          let stylesDirty = false
                          for (const lineKey of Object.keys(lo.styles)) {
                            const line = lo.styles[lineKey]
                            if (!line || typeof line !== "object") {
                              newStyles[lineKey] = line
                              continue
                            }
                            const newLine: any = {}
                            for (const colKey of Object.keys(line)) {
                              const cs = line[colKey]
                              if (cs && matchesVariant({
                                fontFamily: cs.fontFamily ?? lo.fontFamily,
                                fontWeight: cs.fontWeight ?? lo.fontWeight,
                                fontStyle: cs.fontStyle ?? lo.fontStyle,
                              })) {
                                const nc = { ...cs }
                                replaceFields(nc)
                                newLine[colKey] = nc
                                stylesDirty = true
                              } else {
                                newLine[colKey] = cs
                              }
                            }
                            newStyles[lineKey] = newLine
                          }
                          if (stylesDirty) {
                            newLO.styles = newStyles
                            assetDirty = true
                          }
                        }
                      }
                      if (assetDirty) {
                        assetsToPatch.push({ id: a.id, content: newContent, lastOverride: newLO })
                      }
                    }
                    if (assetsToPatch.length > 0) {
                      // PATCH em paralelo (asset endpoint aceita content e lastOverride
                      // via PATCH simples — sem migrate de overrides do KV/Piece pois
                      // estes ja foram atualizados pelo doSave do canvas).
                      await Promise.all(assetsToPatch.map(p =>
                        fetch(`/api/campaigns/${campaignId}/assets/${p.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            content: typeof p.content === "string" ? p.content : JSON.stringify(p.content),
                            lastOverride: p.lastOverride,
                          }),
                        }).catch(err => console.warn("[font-substitute] PATCH asset falhou:", p.id, err))
                      ))
                      // Atualiza campaignRef em-memoria pra o proximo detection
                      // dentro da MESMA sessao nao re-reportar a fonte velha.
                      if (campaignRef.current && Array.isArray(campaignRef.current.assets)) {
                        const patchedMap = new Map(assetsToPatch.map(p => [p.id, p]))
                        campaignRef.current = {
                          ...campaignRef.current,
                          assets: campaignRef.current.assets.map((a: any) => {
                            const p = patchedMap.get(a.id)
                            if (!p) return a
                            return { ...a, content: p.content, lastOverride: p.lastOverride }
                          }),
                        }
                      }
                      console.log("[font-substitute] PATCH em", assetsToPatch.length, "assets")
                    }
                  } catch (e) {
                    console.warn("[font-substitute] propagacao no banco falhou:", e)
                  }

                  setMissingFonts(prev => prev.filter(x => x.label !== mf.label))
                  setReplacementChoices(prev => { const c = { ...prev }; delete c[mf.label]; return c })
                }

                return (
                  <div key={mf.label}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 170px 130px 100px 100px",
                      gap: 8, alignItems: "center",
                      padding: "10px 8px",
                      borderTop: idx === 0 ? "none" : "1px solid #232323",
                    }}>
                    {/* Coluna 1: nome + indicador */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, color: "#fff", fontWeight: 600,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {mf.label}
                      </div>
                      <div style={{ fontSize: 10, color: "#f87171", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#f87171" }} />
                        Ausente · cai em fallback
                      </div>
                    </div>
                    {/* Coluna 2: dropdown FAMILIA */}
                    <select
                      value={choice.family ?? ""}
                      onChange={(e) => {
                        const val = e.target.value
                        setReplacementChoices(prev => ({
                          ...prev,
                          [mf.label]: { ...prev[mf.label], family: val || undefined },
                        }))
                      }}
                      style={{
                        background: "#0f0f0f", color: "#fff",
                        border: "1px solid #333", borderRadius: 6,
                        padding: "7px 8px", fontSize: 12, cursor: "pointer",
                        outline: "none", fontFamily: "inherit", minWidth: 0,
                      }}
                    >
                      <option value="">Família…</option>
                      {groups.map(g => {
                        const inGroup = familyOptions.filter(o => o.group === g)
                        if (inGroup.length === 0) return null
                        return (
                          <optgroup key={g} label={g}>
                            {inGroup.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </optgroup>
                        )
                      })}
                    </select>
                    {/* Coluna 3: dropdown PESO/ESTILO. Default = peso da fonte
                        missing (Bold Italic substituido por outra fonte comeca
                        em Bold Italic). User pode mudar livremente. */}
                    <select
                      value={currentWeightValue}
                      onChange={(e) => {
                        const [wStr, sStr] = e.target.value.split("|")
                        const weight = Number(wStr)
                        const style: "normal" | "italic" = sStr === "italic" ? "italic" : "normal"
                        setReplacementChoices(prev => ({
                          ...prev,
                          [mf.label]: { ...prev[mf.label], weight, style },
                        }))
                      }}
                      style={{
                        background: "#0f0f0f", color: "#fff",
                        border: "1px solid #333", borderRadius: 6,
                        padding: "7px 8px", fontSize: 12, cursor: "pointer",
                        outline: "none", fontFamily: "inherit",
                      }}
                    >
                      {WEIGHT_STYLE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {/* Coluna 4: botao APLICAR substituicao */}
                    <button
                      onClick={() => {
                        if (!choice.family) return
                        applySubstitution(choice.family, effectiveWeight, effectiveStyle)
                      }}
                      disabled={!canApply}
                      title={canApply ? `Substituir ${mf.label} por ${choice.family} ${effectiveWeight} ${effectiveStyle === "italic" ? "Italic" : ""}` : "Escolha a familia primeiro"}
                      style={{
                        background: canApply ? "#facc15" : "#2a2a2a",
                        color: canApply ? "#000" : "#555",
                        border: "none", borderRadius: 6,
                        padding: "8px 10px", fontSize: 11, fontWeight: 700,
                        cursor: canApply ? "pointer" : "not-allowed",
                      }}
                    >
                      Aplicar
                    </button>
                    {/* Coluna 5: botao SUBIR ARQUIVO */}
                    <button
                      onClick={() => {
                        pendingFontUpload.current = mf
                        fontUploadInputRef.current?.click()
                      }}
                      title={`Subir arquivo .ttf/.otf de "${mf.label}"`}
                      style={{
                        background: "transparent", color: "#facc15",
                        border: "1px solid #facc15", borderRadius: 6,
                        padding: "8px 10px", fontSize: 11, fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Subir
                    </button>
                  </div>
                )
              })}
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid #2a2a2a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 11, color: "#666" }}>
                Substituições e uploads salvam no cliente — disponíveis em futuras campanhas.
              </div>
              <button
                onClick={() => setFontsModalOpen(false)}
                style={{
                  background: "#facc15", color: "#000",
                  border: "none", borderRadius: 6,
                  padding: "8px 18px", fontSize: 12, fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
      <input
        ref={fontUploadInputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          const pending = pendingFontUpload.current
          pendingFontUpload.current = null
          const clientId = campaign?.client?.id
          if (!file || !pending || !clientId) return
          try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const r = new FileReader()
              r.onload = () => resolve(r.result as string)
              r.onerror = () => reject(new Error("read fail"))
              r.readAsDataURL(file)
            })
            const { detectFontMetadata, loadCustomFontFamily } = await import("@/lib/google-fonts")
            const meta = detectFontMetadata(file.name)
            // Usa o family puro (sem peso/estilo) do missing — o arquivo carrega
            // com weight/style detectados do filename. loadCustomFontFamily
            // registra varios @font-face com aliases pra cobrir o nome PSD.
            const family = pending.family
            const cRes = await fetch(`/api/clients/${clientId}`)
            const cData = await cRes.json()
            const existingFiles: any[] = Array.isArray(cData.customFontFiles) ? cData.customFontFiles : []
            const newFile = { url: dataUrl, weight: meta.weight, style: meta.style, fileName: file.name }
            const updatedFiles = [...existingFiles, newFile]
            const patchBody: any = { customFontFiles: updatedFiles }
            if (!cData.brandFont || cData.brandFont.trim() === "") patchBody.brandFont = family
            await fetch(`/api/clients/${clientId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patchBody),
            })
            loadCustomFontFamily(family, updatedFiles)
            // Re-checa via measureText. Cada variante eh testada individualmente —
            // user pode ter subido so a Bold; Italic e SemiBold ainda missing.
            try {
              const probeCanvas = document.createElement("canvas")
              const ctx = probeCanvas.getContext("2d")
              if (ctx) {
                const SAMPLE = "mwiI@#$%MNOQRS 1234567890"
                const FALLBACKS = ["serif", "sans-serif", "monospace"]
                const stillMissing = missingFonts.filter(mf => {
                  const escFamily = mf.family.replace(/"/g, '\\"')
                  for (const fb of FALLBACKS) {
                    ctx.font = `${mf.style} ${mf.weight} 72px ${fb}`
                    const baseW = ctx.measureText(SAMPLE).width
                    ctx.font = `${mf.style} ${mf.weight} 72px "${escFamily}", ${fb}`
                    const testW = ctx.measureText(SAMPLE).width
                    if (Math.abs(testW - baseW) > 0.5) return false // resolvida
                  }
                  return true // ainda missing
                })
                setMissingFonts(stillMissing)
              } else {
                setMissingFonts(prev => prev.filter(mf => mf.label !== pending.label))
              }
            } catch {
              setMissingFonts(prev => prev.filter(mf => mf.label !== pending.label))
            }
            const fc = fabricRef.current
            if (fc) {
              const objs = fc.getObjects()
              for (const o of objs) {
                if ((o.type === "textbox" || o.type === "i-text") && (o as any).initDimensions) {
                  ;(o as any).initDimensions()
                }
              }
              fc.requestRenderAll()
            }
          } catch (err) {
            console.warn("[font-upload] falhou:", err)
            alert("Falha ao subir a fonte. Verifique se eh um arquivo .ttf ou .otf valido.")
          }
        }}
      />
    </div>
  )
}
