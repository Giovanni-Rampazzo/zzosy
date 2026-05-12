import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

/**
 * GET /api/debug/piece?id=<pieceId>
 *
 * Rota TEMPORARIA de debug. Retorna toda a estrutura relevante pra
 * diagnosticar pe\u00e7as importadas que abrem vazias no editor:
 *  - data parseado (layers, dimensions, bgColor)
 *  - campaign.assets (com types) pra checar match
 *  - resumo: linkados validos, embedded, orfaos (sem match)
 *
 * REMOVER apos diagnostico.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id obrigatorio" }, { status: 400 })

  const piece = await prisma.piece.findUnique({ where: { id } })
  if (!piece) return NextResponse.json({ error: "piece not found" }, { status: 404 })

  let dataParsed: any = null
  try {
    dataParsed = piece.data ? JSON.parse(piece.data) : null
  } catch (e) {
    dataParsed = { error: "data nao eh JSON valido", raw_preview: piece.data?.slice(0, 200) }
  }

  // Pega assets da campanha pra check de match
  const assets = await prisma.campaignAsset.findMany({
    where: { campaignId: piece.campaignId },
    select: { id: true, type: true, label: true, imageUrl: true },
  })
  const assetMap = new Map(assets.map(a => [a.id, a]))

  // Analisa layers
  const layers = Array.isArray(dataParsed?.layers) ? dataParsed.layers : []
  const summary = {
    total: layers.length,
    linkados_ok: 0,
    linkados_orfaos: 0, // tem assetId mas asset nao existe
    embedded: 0,
    sem_classificacao: 0,
  }
  const layerDetails = layers.map((l: any, idx: number) => {
    const hasAssetId = !!l.assetId
    const hasEmbedded = !!l.__embedded
    const matchedAsset = hasAssetId ? assetMap.get(l.assetId) : null
    let classification = "?"
    if (matchedAsset) { classification = "LINKADO_OK"; summary.linkados_ok++ }
    else if (hasAssetId && !matchedAsset) { classification = "LINKADO_ORFAO"; summary.linkados_orfaos++ }
    else if (hasEmbedded) { classification = "EMBEDDED"; summary.embedded++ }
    else { classification = "SEM_CLASSIFICACAO"; summary.sem_classificacao++ }
    return {
      idx,
      classification,
      type: l.type,
      assetId: l.assetId || null,
      assetType: matchedAsset?.type || null,
      assetLabel: matchedAsset?.label || null,
      __embedded: l.__embedded || false,
      posX: l.posX,
      posY: l.posY,
      width: l.width,
      height: l.height,
      zIndex: l.zIndex,
      hasImageDataUrl: !!l.imageDataUrl,
      imageDataUrlPreview: l.imageDataUrl ? l.imageDataUrl.slice(0, 80) + "..." : null,
      text: l.text?.slice(0, 60) || null,
    }
  })

  return NextResponse.json({
    piece: {
      id: piece.id,
      campaignId: piece.campaignId,
      name: piece.name,
      status: piece.status,
      data_size_bytes: piece.data?.length || 0,
      imageUrl_preview: piece.imageUrl?.slice(0, 80) || null,
      createdAt: piece.createdAt,
      updatedAt: piece.updatedAt,
    },
    data_parsed: {
      version: dataParsed?.version,
      width: dataParsed?.width,
      height: dataParsed?.height,
      bgColor: dataParsed?.bgColor,
      layers_count: layers.length,
    },
    campaign_assets: assets.map(a => ({ id: a.id, type: a.type, label: a.label })),
    summary,
    layer_details: layerDetails,
  })
}
