"use client"
/**
 * exportPiecePsd.ts — exportador PSD v2 baseado em fromEditor + writer.
 *
 * Substitui o exportPSDBlob legacy de lib/exportPiece.ts (que usa ag-psd
 * direto em ~1000 linhas misturando montagem + raster + PSD bytes).
 *
 * Caminho novo: piece.data + assets → buildPsdDocumentFromEditor →
 * prepareImageDataAsync (decoda dataUrls em canvases) → writePsdDocument.
 *
 * Vantagens vs legacy:
 *  - Modelo canonical entre import e export (mesma fonte da verdade)
 *  - Effects expressos como dados (round-trip preservado), nao baked em pixels
 *  - Bytes do PSD validados pelos testes (Sicredi 25 layers + fixture sintetica)
 *  - Smart Objects re-embeddados pelo writer com GUID determinstico
 *
 * Limitacoes conhecidas (Fase 8):
 *  - Image data eh fetchado server-side a partir do imageUrl; redes lentas
 *    podem extender o tempo total do export
 *  - Editor styles per-char (overrides.styles) ainda nao 100% mapeados pra
 *    styleRuns — texts uniformes saem perfeitos; texts com cor/peso mixed
 *    caem no defaultStyle do span dominante (TODO Fase 9)
 *  - Background bgLayers nao saem como layer separado (placeholder)
 *
 * Wire-up: lib/exportPiece.ts:exportPSDBlob checa
 * localStorage["zzosy:psdExport"] === "v2" e delega aqui. Default ainda eh
 * legacy ate dogfooding completo.
 */
import { buildPsdDocumentFromEditor, type EditorBuildInput, type EditorAsset, type EditorLayer } from "./fromEditor"
import { writePsdDocument, prepareImageDataAsync } from "./writer"
import type { PsdDocument } from "./types"

export interface ExportPiecePsdInput {
  piece: { id?: string; name: string; data: any; width: number; height: number }
  assets: any[] // CampaignAsset[] do banco com smartObject populado
}

export interface ExportPiecePsdResult {
  blob: Blob
  warnings: { kind: string; layerName: string; message: string }[]
  /** Tamanho do PSD gerado em bytes. */
  byteLength: number
}

/**
 * Constroi o PSD a partir do estado do editor. Async porque IMAGE layers
 * com dataUrl precisam ser decodadas em canvases antes do write.
 */
export async function exportPiecePsdV2(input: ExportPiecePsdInput): Promise<ExportPiecePsdResult> {
  const { piece, assets } = input
  const data = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
  const W = data?.width ?? piece.width
  const H = data?.height ?? piece.height
  const dpi = Math.round(Number(data?.dpi)) || 72

  const editorAssets: EditorAsset[] = assets.map(normalizeAssetForEditor)
  const editorLayers: EditorLayer[] = Array.isArray(data?.layers)
    ? data.layers.map(normalizeLayerForEditor)
    : []

  const buildInput: EditorBuildInput = {
    width: W,
    height: H,
    dpi,
    assets: editorAssets,
    layers: editorLayers,
  }

  const doc: PsdDocument = buildPsdDocumentFromEditor(buildInput)
  await prepareImageDataAsync(doc)
  const { bytes, warnings } = writePsdDocument(doc, { generateThumbnail: false, invalidateTextLayers: true })

  return {
    blob: new Blob([bytes as ArrayBuffer], { type: "image/vnd.adobe.photoshop" }),
    warnings,
    byteLength: bytes.byteLength,
  }
}

function normalizeAssetForEditor(a: any): EditorAsset {
  return {
    id: a.id,
    type: a.type,
    label: a.label,
    value: a.value ?? null,
    imageUrl: a.imageUrl ?? null,
    content: a.content ?? null,
    smartObject: a.smartObject ? {
      guid: a.smartObject.guid,
      width: a.smartObject.width ?? null,
      height: a.smartObject.height ?? null,
      filePath: a.smartObject.filePath,
      format: detectSmartObjectFormatFromMime(a.smartObject.mime),
    } : null,
  }
}

function normalizeLayerForEditor(l: any): EditorLayer {
  return {
    assetId: l.assetId,
    posX: l.posX ?? 0,
    posY: l.posY ?? 0,
    scaleX: l.scaleX ?? 1,
    scaleY: l.scaleY ?? 1,
    rotation: l.rotation ?? 0,
    width: l.width,
    height: l.height,
    zIndex: l.zIndex ?? 0,
    hidden: l.hidden === true,
    opacity: typeof l.opacity === "number" ? l.opacity : 1,
    blendMode: l.blendMode,
    effects: l.effects ?? null,
    overrides: l.overrides ?? {},
  }
}

type EmbeddedFormat = "psb" | "psd" | "png" | "jpg" | "pdf" | "ai" | "unknown"

function detectSmartObjectFormatFromMime(mime: string | null | undefined): EmbeddedFormat {
  if (!mime) return "unknown"
  if (mime.includes("photoshop")) return "psb"
  if (mime === "image/svg+xml") return "ai" // ag-psd trata SVG como vector source
  if (mime === "image/png") return "png"
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg"
  if (mime === "application/pdf") return "pdf"
  return "unknown"
}
