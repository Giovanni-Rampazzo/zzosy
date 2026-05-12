/**
 * POST /api/debug/import-psd-server
 *
 * Importa um PSD direto do servidor (sem ag-psd no browser).
 * REPRODUZ a logica do PsdPieceImporter MAS no servidor pra
 * diagnosticar sem precisar de browser.
 *
 * Body: { campaignId, psdPath }
 *
 * REMOVER apos diagnostico.
 */
import { NextRequest, NextResponse } from "next/server"
import { readFile } from "fs/promises"
import { prisma } from "@/lib/prisma"
import { normalizeName } from "@/lib/normalize"

function flattenLayers(layers: any[]): any[] {
  const result: any[] = []
  for (const layer of layers) {
    if (layer.children?.length) result.push(...flattenLayers(layer.children))
    else result.push(layer)
  }
  return result
}

function colorToHex(color: any): string {
  if (!color) return "#000000"
  const rr = color.r > 1 ? Math.round(color.r) : Math.round(color.r * 255)
  const gg = color.g > 1 ? Math.round(color.g) : Math.round(color.g * 255)
  const bb = color.b > 1 ? Math.round(color.b) : Math.round(color.b * 255)
  return "#" + [rr, gg, bb].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { campaignId, psdPath } = body || {}
  if (!campaignId || !psdPath) {
    return NextResponse.json({ error: "campaignId e psdPath obrigatorios" }, { status: 400 })
  }

  // L\u00ea PSD
  let buffer: Buffer
  try { buffer = await readFile(psdPath) }
  catch (e: any) { return NextResponse.json({ error: "falha ler", detail: e?.message }, { status: 400 }) }

  let psd: any
  try {
    const agPsd = await import("ag-psd")
    psd = agPsd.readPsd(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true }
    )
  } catch (e: any) { return NextResponse.json({ error: "falha psd", detail: e?.message }, { status: 500 }) }

  // L\u00ea assets da campanha
  const assets = await prisma.campaignAsset.findMany({ where: { campaignId } })
  const assetIndex = new Map<string, any>()
  for (const a of assets) {
    const k = normalizeName(a.label)
    if (k) assetIndex.set(k, a)
  }

  const allLayers = flattenLayers(psd.children ?? [])
  const trace: any[] = []
  const newTextAssetsList: any[] = []
  const dataLayers: any[] = []
  let zIndex = 0

  for (const layer of allLayers) {
    const layerName = (layer.name ?? "").trim()
    if (!layerName || layerName === "Background") {
      trace.push({ name: layerName, action: "SKIPPED (empty or Background)" })
      zIndex++
      continue
    }

    const left = layer.left ?? 0
    const top = layer.top ?? 0
    const width = Math.max((layer.right ?? left + 200) - left, 10)
    const height = Math.max((layer.bottom ?? top + 50) - top, 10)
    const matchKey = normalizeName(layerName)
    const matchedAsset = matchKey ? assetIndex.get(matchKey) : null

    if (layer.text) {
      const td = layer.text
      const rawText = String(td.text ?? layerName).split("\r\n").join("\n").split("\r").join("\n")
      const defStyle = td.style ?? {}
      const defFontName = defStyle.font?.name ?? "Arial"
      const defFontSize = defStyle.fontSize ?? 48
      const defColor = defStyle.fillColor ? colorToHex(defStyle.fillColor) : "#000000"
      const defWeight = (defStyle.fauxBold || defFontName.toLowerCase().includes("bold")) ? "bold" : "normal"

      const spans = [{ text: rawText, style: { color: defColor, fontSize: Math.round(defFontSize), fontWeight: defWeight, fontFamily: defFontName } }]

      const overrides: any = {
        fill: defColor,
        fontSize: Math.round(defFontSize),
        fontFamily: defFontName,
        fontWeight: defWeight,
        textAlign: "left",
      }

      const layerData: any = { posX: left, posY: top, width, height, zIndex, overrides }

      if (matchedAsset && matchedAsset.type === "TEXT") {
        layerData.assetId = matchedAsset.id
        trace.push({ name: layerName, action: "TEXT linked to existing asset", assetId: matchedAsset.id, assetLabel: matchedAsset.label })
      } else {
        const assetKey = `new-text-${newTextAssetsList.length}`
        newTextAssetsList.push({ label: layerName, type: "TEXT", content: spans, layerKeysToLink: [assetKey] })
        layerData.__pendingNewAssetKey = assetKey
        trace.push({ name: layerName, action: "TEXT new asset will be created", assetKey, matchKey, normalizedAssetKeys: Array.from(assetIndex.keys()) })
      }
      dataLayers.push(layerData)
    } else if (layer.canvas) {
      // Image raster - simplificado: marca embedded sem extrair imagem
      const layerData: any = {
        type: "IMAGE",
        posX: left, posY: top, width, height, zIndex,
        __embedded: true,
        imageDataUrl: "data:image/png;base64,STUB",
      }
      if (matchedAsset && matchedAsset.type === "IMAGE") {
        delete layerData.__embedded
        delete layerData.imageDataUrl
        layerData.assetId = matchedAsset.id
        trace.push({ name: layerName, action: "IMAGE linked to asset", assetId: matchedAsset.id })
      } else {
        trace.push({ name: layerName, action: "IMAGE embedded (no match)" })
      }
      dataLayers.push(layerData)
    } else if (matchedAsset && matchedAsset.type === "IMAGE") {
      // Sem canvas (smart object, vector shape, adjustment) MAS com nome
      // que bate com asset IMAGE existente. Linka pelo nome — nao precisa pixel,
      // o asset ja tem a imagem.
      const layerData: any = {
        type: "IMAGE",
        posX: left, posY: top, width, height, zIndex,
        assetId: matchedAsset.id,
      }
      const reason = layer.placedLayer ? "SMART_OBJECT" : "VECTOR_OR_OTHER"
      trace.push({ name: layerName, action: `${reason} linked to asset`, assetId: matchedAsset.id, assetLabel: matchedAsset.label })
      dataLayers.push(layerData)
    } else {
      trace.push({ name: layerName, action: "IGNORED (no text, no canvas, no asset match)", normalizedKey: matchKey, layerKeys: Object.keys(layer) })
    }
    zIndex++
  }

  return NextResponse.json({
    psd_width: psd.width,
    psd_height: psd.height,
    total_layers_in_psd: allLayers.length,
    total_layers_in_piece: dataLayers.length,
    new_text_assets_to_create: newTextAssetsList.length,
    new_text_assets: newTextAssetsList,
    campaign_text_assets: assets.filter((a: any) => a.type === "TEXT").map((a: any) => ({ id: a.id, label: a.label, normalizedKey: normalizeName(a.label) })),
    trace,
  })
}
