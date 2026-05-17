import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET /api/debug/kv-inspect?campaignId=X — inspeção profunda do KV
// pra debugar PSD imports. Mostra assets + layers do KV cruzados.
export async function GET(req: NextRequest) {
  const cid = req.nextUrl.searchParams.get("campaignId")
  if (!cid) return NextResponse.json({ error: "campaignId obrigatorio" }, { status: 400 })
  const camp = await prisma.campaign.findUnique({
    where: { id: cid },
    include: { keyVision: true, assets: true },
  })
  if (!camp) return NextResponse.json({ error: "not found" }, { status: 404 })

  function parse(x: any) {
    if (!x) return null
    if (typeof x === "string") { try { return JSON.parse(x) } catch { return null } }
    return x
  }
  const kvLayers: any[] = parse(camp.keyVision?.layers) ?? []
  const kvData = parse(camp.keyVision?.data) ?? {}

  const assetById: Record<string, any> = {}
  for (const a of camp.assets) {
    assetById[a.id] = {
      label: a.label,
      type: a.type,
      hasImageUrl: !!a.imageUrl,
      imageUrl: a.imageUrl?.slice(0, 80),
      contentPreview: typeof a.content === "string" ? a.content.slice(0, 100) : a.content ? JSON.stringify(a.content).slice(0, 100) : null,
      hasMask: !!(a as any).mask,
      hasSmartObject: !!(a as any).smartObject,
      fullImageUrl: a.imageUrl,
    }
  }

  const layerReport = kvLayers.map((l, i) => {
    const a = l.assetId ? assetById[l.assetId] : null
    return {
      idx: i,
      assetId: l.assetId,
      assetLabel: a?.label ?? "(asset não achado)",
      assetType: a?.type,
      hasAssetImage: a?.hasImageUrl,
      posX: l.posX, posY: l.posY,
      width: l.width, height: l.height,
      scaleX: l.scaleX, scaleY: l.scaleY,
      zIndex: l.zIndex,
      hasMask: !!l.mask,
      maskType: l.mask?.type,
      maskEnabled: l.mask?.enabled,
      maskDetails: l.mask ? {
        type: l.mask.type,
        enabled: l.mask.enabled,
        inverted: l.mask.inverted,
        raster: l.mask.raster ? { posX: l.mask.raster.posX, posY: l.mask.raster.posY, width: l.mask.raster.width, height: l.mask.raster.height, dataUrlLen: l.mask.raster.dataUrl?.length ?? 0 } : null,
        vector: l.mask.vector ? { posX: l.mask.vector.posX, posY: l.mask.vector.posY, width: l.mask.vector.width, height: l.mask.vector.height, path: l.mask.vector.path?.slice(0, 80) } : null,
        clipping: l.mask.clipping,
      } : null,
      hidden: l.hidden, locked: l.locked,
      hasOverrides: !!l.overrides && Object.keys(l.overrides).length > 0,
      overrideKeys: l.overrides ? Object.keys(l.overrides) : [],
    }
  })

  return NextResponse.json({
    assetsDetail: assetById,
    campaign: { id: camp.id, name: camp.name, psdUrl: (camp as any).psdUrl, psdName: (camp as any).psdName },
    kv: {
      width: camp.keyVision?.width,
      height: camp.keyVision?.height,
      bgColor: camp.keyVision?.bgColor,
      layersCount: kvLayers.length,
      hasData: !!camp.keyVision?.data,
      dataKeys: kvData ? Object.keys(kvData) : [],
    },
    assetsCount: camp.assets.length,
    assetsByType: camp.assets.reduce((acc: any, a) => { acc[a.type] = (acc[a.type] ?? 0) + 1; return acc }, {}),
    layerReport,
    assetsWithoutLayer: camp.assets
      .filter(a => !kvLayers.some(l => l.assetId === a.id))
      .map(a => ({ id: a.id, label: a.label, type: a.type, hasImageUrl: !!a.imageUrl })),
  })
}
