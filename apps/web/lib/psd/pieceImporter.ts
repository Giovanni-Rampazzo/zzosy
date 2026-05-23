"use client"
/**
 * pieceImporter.ts — importa PSD como PEÇA (não como matriz).
 *
 * Distinto de lib/psd/importer.ts (que popula a MATRIZ). Aqui:
 *  - Le PSD via readPsdDocument (modelo canonical)
 *  - Faz MATCH NORMALIZADO de cada layer.name contra campaignAssets
 *    existentes (TEXT/IMAGE/SHAPE)
 *  - Layers com match: viram layers da peca linkados ao asset
 *  - Layers sem match: TEXT vira novo asset criado pelo endpoint,
 *    IMAGE vira embedded com dataUrl inline
 *  - POST /api/pieces/import-psd com piece.data + newTextAssets
 *  - Upload do composite raster como thumbnail inicial
 *
 * Fase 10: substitui ~300 linhas de parsing duplicado do PsdPieceImporter
 * legacy (text scale, leading, font normalize, etc) — agora tudo vem
 * normalizado pelo reader compartilhado.
 */
import { readPsdDocument } from "./reader"
import { resolveClippingChains } from "./reader"
import { detectWrapperSmartObjects } from "./postProcess"
import { resolveAllClippingChains } from "./clipping"
import { propagateFolderMasks } from "./folderMasks"
import type { PsdDocument, PsdLayer, PsdTextLayer, PsdImageLayer } from "./types"
import { normalizeName } from "@/lib/normalize"

export interface PieceImportAsset {
  id: string
  label: string | null
  type: string
  imageUrl?: string | null
}

export interface PieceImportOptions {
  /** Callback de progresso pra UI. */
  onProgress?: (msg: string) => void
  /** Callback pra warnings nao fatais. */
  onWarning?: (w: { kind: string; layerName: string; message: string }) => void
}

export interface PieceImportResult {
  ok: boolean
  error?: string
  /** ID da peca criada. */
  pieceId?: string
  /** Stats pra UI. */
  stats?: {
    linked: number
    newTextAssets: number
    embedded: number
    skipped: number
    durationMs: number
  }
  /** Fontes referenciadas pelos texts — caller checa contra document.fonts. */
  requiredFonts: string[]
}

export async function importPsdAsPiece(
  file: File,
  campaignId: string,
  campaignAssets: PieceImportAsset[],
  opts: PieceImportOptions = {},
): Promise<PieceImportResult> {
  const t0 = Date.now()
  const { onProgress, onWarning } = opts
  try {
    onProgress?.(`Lendo ${file.name}…`)
    const buffer = await file.arrayBuffer()
    const { document: doc, warnings } = readPsdDocument(buffer, {
      includeImageData: true,
      includeComposite: true,
    })
    for (const w of warnings) onWarning?.(w as any)

    // Mesma pipeline da matriz: resolve clipping → wrapper detect → folder masks.
    resolveClippingChains(doc)
    detectWrapperSmartObjects(doc)
    await resolveAllClippingChains(doc)
    propagateFolderMasks(doc)

    onProgress?.("Mapeando contra assets da campanha…")
    // Index de match: normalizedName → asset
    const assetIndex = new Map<string, PieceImportAsset>()
    for (const a of campaignAssets) {
      const key = normalizeName(a.label)
      if (key) assetIndex.set(key, a)
    }

    const { dataLayers, newTextAssets, requiredFonts, stats } = await mapLayersToPiece(doc, assetIndex)
    if (dataLayers.length === 0) {
      return { ok: false, error: `Nenhum layer extraido de ${file.name}`, requiredFonts: [] }
    }

    onProgress?.(`Criando peca (${stats.linked} linkados, ${stats.newTextAssets} novos, ${stats.embedded} embedded)…`)

    const pieceRes = await fetch("/api/pieces/import-psd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        name: file.name.replace(/\.psd$/i, ""),
        width: doc.width,
        height: doc.height,
        data: { layers: dataLayers, width: doc.width, height: doc.height },
        newTextAssets,
      }),
    })
    if (!pieceRes.ok) {
      const msg = await pieceRes.text().catch(() => "")
      return { ok: false, error: `Falha ao criar peca: ${msg || pieceRes.status}`, requiredFonts: [] }
    }
    const piece = await pieceRes.json()

    // Thumb composite — usa doc.composite que ja foi decodado pelo reader.
    if (doc.composite && typeof document !== "undefined") {
      try {
        const compCanvas = await imageDataToCanvas(doc.composite)
        if (compCanvas) {
          const blob = await canvasToBlob(compCanvas, "image/png")
          if (blob) {
            const fd = new FormData()
            fd.append("thumbnail", blob, "thumb.png")
            await fetch(`/api/pieces/${piece.id}/thumbnail`, { method: "POST", body: fd })
          }
        }
      } catch (e) { console.warn("[import-piece-psd] thumb falhou:", e) }
    }

    return {
      ok: true,
      pieceId: piece.id,
      stats: { ...stats, durationMs: Date.now() - t0 },
      requiredFonts: Array.from(requiredFonts),
    }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e), requiredFonts: [] }
  }
}

// ────────────────────────────────────────────────────────────────────
// Layer mapping
// ────────────────────────────────────────────────────────────────────

async function mapLayersToPiece(doc: PsdDocument, assetIndex: Map<string, PieceImportAsset>) {
  const dataLayers: any[] = []
  const newTextAssets: any[] = []
  const requiredFonts = new Set<string>()
  let linked = 0, newTextAssetsCount = 0, embedded = 0, skipped = 0, zIndex = 0

  // Walk recursivo: o modelo canonical mantem folders, mas a peca eh flat.
  // Promovemos cada layer-folha pra dataLayer com groupPath preservado.
  async function walk(layers: PsdLayer[], groupPath: string[]) {
    for (const layer of layers) {
      if (!layer.visible) { zIndex++; continue }
      if (layer.type === "group") {
        await walk(layer.children, [...groupPath, layer.name])
        continue
      }
      const layerName = (layer.name ?? "").trim()
      if (!layerName || layerName === "Background") { zIndex++; continue }

      const matchKey = normalizeName(layerName)
      let matchedAsset: PieceImportAsset | null = matchKey ? (assetIndex.get(matchKey) ?? null) : null
      if (!matchedAsset && groupPath.length > 0) {
        const folderSuffix = ` (${groupPath.join("/")})`
        const altKey = normalizeName(layerName + folderSuffix)
        matchedAsset = altKey ? (assetIndex.get(altKey) ?? null) : null
      }

      if (layer.type === "text") {
        const r = mapTextLayer(layer, matchedAsset, zIndex, groupPath, newTextAssets, requiredFonts)
        dataLayers.push(r.layerData)
        if (r.linked) linked++
        else newTextAssetsCount++
      } else if (layer.type === "image") {
        const r = await mapImageLayer(layer, matchedAsset, zIndex, groupPath)
        if (r) {
          dataLayers.push(r.layerData)
          if (r.linked) linked++
          else embedded++
        } else {
          skipped++
        }
      } else if (layer.type === "smartObject") {
        // Smart objects sem pixel raster proprio mas com match pra asset IMAGE
        // sao linkados (sem precisar do pixel). Sem match: skip por enquanto
        // (PSD round-trip preserva os bytes embedded; export futuro vai usar isso).
        if (matchedAsset && matchedAsset.type === "IMAGE") {
          dataLayers.push({
            type: "IMAGE",
            posX: layer.bbox.left,
            posY: layer.bbox.top,
            width: layer.bbox.right - layer.bbox.left,
            height: layer.bbox.bottom - layer.bbox.top,
            zIndex,
            assetId: matchedAsset.id,
            ...(groupPath.length > 0 ? { groupPath } : {}),
            ...(layer.opacity < 1 ? { opacity: layer.opacity } : {}),
            // Note: visible=false ja filtrado no walk; nao precisa propagar hidden
          })
          linked++
        } else {
          skipped++
        }
      } else if (layer.type === "shape") {
        // SHAPE sem match: skip por enquanto. Com match: linka.
        if (matchedAsset && matchedAsset.type === "SHAPE") {
          dataLayers.push({
            type: "SHAPE",
            posX: layer.bbox.left,
            posY: layer.bbox.top,
            width: layer.bbox.right - layer.bbox.left,
            height: layer.bbox.bottom - layer.bbox.top,
            zIndex,
            assetId: matchedAsset.id,
            ...(groupPath.length > 0 ? { groupPath } : {}),
          })
          linked++
        } else {
          skipped++
        }
      }
      zIndex++
    }
  }
  await walk(doc.layers, [])

  return {
    dataLayers,
    newTextAssets,
    requiredFonts,
    stats: { linked, newTextAssets: newTextAssetsCount, embedded, skipped },
  }
}

function mapTextLayer(
  layer: PsdTextLayer,
  matchedAsset: PieceImportAsset | null,
  zIndex: number,
  groupPath: string[],
  newTextAssets: any[],
  requiredFonts: Set<string>,
) {
  const def = layer.defaultStyle
  requiredFonts.add(def.fontFamily)
  for (const run of layer.styleRuns) {
    if (run.style.fontFamily) requiredFonts.add(run.style.fontFamily)
  }

  // Converte styleRuns canonical → spans Fabric pra newTextAsset.content.
  const spans: any[] = buildSpansFromStyleRuns(layer.text, layer.defaultStyle, layer.styleRuns)
  const styles: any = buildStylesMapFromSpans(spans)

  const overrides: any = {
    fill: def.color,
    fontSize: def.fontSize,
    fontFamily: def.fontFamily,
    fontWeight: def.fontWeight,
    fontStyle: def.fontStyle,
    textAlign: layer.paragraph.align,
    charSpacing: def.tracking,
    // Auto leading default 0.9x (padrao ZZOSY tight). Antes era 1.2x Adobe.
    leadingPt: def.leading ?? Math.round(def.fontSize * 0.9),
    lineHeight: def.fontSize > 0 ? (def.leading ?? def.fontSize * 0.9) / def.fontSize : 1.0,
  }
  if (Object.keys(styles).length > 0) overrides.styles = styles

  const layerData: any = {
    posX: layer.bbox.left,
    posY: layer.bbox.top,
    width: layer.bbox.right - layer.bbox.left,
    height: layer.bbox.bottom - layer.bbox.top,
    zIndex,
    overrides,
    ...(groupPath.length > 0 ? { groupPath } : {}),
    ...(layer.opacity < 1 ? { opacity: layer.opacity } : {}),
  }

  if (matchedAsset && matchedAsset.type === "TEXT") {
    layerData.assetId = matchedAsset.id
    return { layerData, linked: true }
  }
  const assetKey = `new-text-${newTextAssets.length}`
  newTextAssets.push({
    label: layer.name,
    type: "TEXT",
    content: spans,
    layerKeysToLink: [assetKey],
  })
  layerData.__pendingNewAssetKey = assetKey
  return { layerData, linked: false }
}

async function mapImageLayer(
  layer: PsdImageLayer,
  matchedAsset: PieceImportAsset | null,
  zIndex: number,
  groupPath: string[],
): Promise<{ layerData: any; linked: boolean } | null> {
  const w = Math.max(1, layer.bbox.right - layer.bbox.left)
  const h = Math.max(1, layer.bbox.bottom - layer.bbox.top)
  const layerData: any = {
    type: "IMAGE",
    posX: layer.bbox.left,
    posY: layer.bbox.top,
    width: w,
    height: h,
    zIndex,
    ...(groupPath.length > 0 ? { groupPath } : {}),
    ...(layer.opacity < 1 ? { opacity: layer.opacity } : {}),
  }
  if (matchedAsset && matchedAsset.type === "IMAGE") {
    layerData.assetId = matchedAsset.id
    return { layerData, linked: true }
  }
  // Embedded: precisa do dataUrl pra gravar inline na peca.
  const dataUrl = await imageDataToDataUrl(layer.imageData)
  if (!dataUrl) return null
  layerData.__embedded = true
  layerData.imageDataUrl = dataUrl
  return { layerData, linked: false }
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function buildSpansFromStyleRuns(text: string, def: any, runs: { start: number; length: number; style: any }[]): any[] {
  if (runs.length === 0) {
    return [{ text, style: { color: def.color, fontSize: def.fontSize, fontWeight: def.fontWeight, fontStyle: def.fontStyle, fontFamily: def.fontFamily } }]
  }
  const sortedRuns = [...runs].sort((a, b) => a.start - b.start)
  const spans: any[] = []
  let cursor = 0
  for (const run of sortedRuns) {
    if (run.start > cursor) {
      spans.push({ text: text.slice(cursor, run.start), style: { color: def.color, fontSize: def.fontSize, fontWeight: def.fontWeight, fontStyle: def.fontStyle, fontFamily: def.fontFamily } })
    }
    const segment = text.slice(run.start, run.start + run.length)
    spans.push({
      text: segment,
      style: {
        color: run.style.color ?? def.color,
        fontSize: run.style.fontSize ?? def.fontSize,
        fontWeight: run.style.fontWeight ?? def.fontWeight,
        fontStyle: run.style.fontStyle ?? def.fontStyle,
        fontFamily: run.style.fontFamily ?? def.fontFamily,
      },
    })
    cursor = run.start + run.length
  }
  if (cursor < text.length) {
    spans.push({ text: text.slice(cursor), style: { color: def.color, fontSize: def.fontSize, fontWeight: def.fontWeight, fontStyle: def.fontStyle, fontFamily: def.fontFamily } })
  }
  return spans
}

function buildStylesMapFromSpans(spans: any[]): any {
  if (spans.length <= 1) return {}
  const styles: any = {}
  let lineIdx = 0
  let colIdx = 0
  for (const span of spans) {
    for (const ch of (span.text ?? "")) {
      if (ch === "\n") { lineIdx++; colIdx = 0; continue }
      if (!styles[lineIdx]) styles[lineIdx] = {}
      styles[lineIdx][String(colIdx)] = {
        fill: span.style.color,
        fontSize: span.style.fontSize,
        fontFamily: span.style.fontFamily,
        fontWeight: span.style.fontWeight,
        fontStyle: span.style.fontStyle,
      }
      colIdx++
    }
  }
  return styles
}

async function imageDataToDataUrl(img: { data: any; width: number; height: number; format: string }): Promise<string | null> {
  if (typeof document === "undefined") return null
  if (img.format === "dataUrl" && typeof img.data === "string") return img.data
  if (img.data instanceof HTMLCanvasElement) return img.data.toDataURL("image/png")
  // Raw bytes Uint8ClampedArray → canvas → dataUrl.
  if (img.data instanceof Uint8ClampedArray) {
    const c = document.createElement("canvas")
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext("2d")
    if (!ctx) return null
    // ImageData ctor exige ArrayBuffer (nao ArrayBufferLike) entre versoes de
    // lib.dom; copy via Uint8ClampedArray sobre ArrayBuffer concreto resolve.
    const copy = new Uint8ClampedArray(new ArrayBuffer(img.data.byteLength))
    copy.set(img.data as Uint8ClampedArray)
    const id = new ImageData(copy, img.width, img.height)
    ctx.putImageData(id, 0, 0)
    return c.toDataURL("image/png")
  }
  return null
}

async function imageDataToCanvas(img: { data: any; width: number; height: number; format: string }): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null
  if (img.data instanceof HTMLCanvasElement) return img.data
  if (img.format === "dataUrl" && typeof img.data === "string") {
    return new Promise(resolve => {
      const el = new Image()
      el.onload = () => {
        const c = document.createElement("canvas")
        c.width = el.naturalWidth
        c.height = el.naturalHeight
        const ctx = c.getContext("2d")
        if (ctx) ctx.drawImage(el, 0, 0)
        resolve(c)
      }
      el.onerror = () => resolve(null)
      el.src = img.data as string
    })
  }
  return null
}

function canvasToBlob(canvas: HTMLCanvasElement, mime = "image/png"): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), mime))
}
