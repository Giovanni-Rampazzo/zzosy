// GET /api/campaigns/[id]/diagnostic
//
// Retorna diagnostico do estado da campanha — auxilia debug de pecas
// vazias/orfaes. Conta assets, layers da matriz, layers das pieces,
// matches/unmatched.
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { id } = await ctx.params
  const campaign = await prisma.campaign.findFirst({
    where: { id, ...(tenantId ? { client: { tenantId } } : {}) },
    include: {
      assets: { select: { id: true, label: true, type: true } },
      keyVision: true,
      pieces: { select: { id: true, name: true, data: true } },
    },
  })
  if (!campaign) return apiErrors.notFound()

  const assetIds = new Set(campaign.assets.map(a => a.id))
  const assetList = campaign.assets.map(a => ({ id: a.id, label: a.label, type: a.type }))

  function analyzeLayers(layers: any[]): { count: number; matched: number; orphan: number; orphanIds: string[] } {
    if (!Array.isArray(layers)) return { count: 0, matched: 0, orphan: 0, orphanIds: [] }
    const orphanIds: string[] = []
    let matched = 0
    for (const l of layers) {
      if (l?.assetId && assetIds.has(l.assetId)) matched++
      else if (l?.assetId) orphanIds.push(l.assetId)
    }
    return { count: layers.length, matched, orphan: orphanIds.length, orphanIds }
  }

  let kvAnalysis: any = null
  if (campaign.keyVision?.data) {
    try {
      const kvData = JSON.parse(campaign.keyVision.data)
      kvAnalysis = analyzeLayers(kvData?.layers ?? [])
    } catch { kvAnalysis = { error: "KV.data malformed" } }
  }

  const piecesAnalysis = campaign.pieces.map(p => {
    let layersAnalysis: any = null
    try {
      const d = p.data ? JSON.parse(p.data) : null
      if (d) layersAnalysis = analyzeLayers(d.layers ?? [])
    } catch { layersAnalysis = { error: "data malformed" } }
    return { id: p.id, name: p.name, ...(layersAnalysis ?? { count: 0, matched: 0, orphan: 0 }) }
  })

  // Coleta TODOS os assetIds referenciados em qualquer lugar (KV + pieces)
  const referencedAssetIds = new Set<string>()
  if (kvAnalysis?.orphanIds) for (const id of kvAnalysis.orphanIds) referencedAssetIds.add(id)
  for (const p of piecesAnalysis) {
    if (Array.isArray(p.orphanIds)) for (const id of p.orphanIds) referencedAssetIds.add(id)
  }

  return NextResponse.json({
    campaignId: id,
    campaignName: campaign.name,
    assetsInCampaign: campaign.assets.length,
    assetList,
    kv: kvAnalysis,
    pieces: piecesAnalysis,
    summary: {
      totalOrphanAssetIds: referencedAssetIds.size,
      sampleOrphanIds: Array.from(referencedAssetIds).slice(0, 5),
    },
  }, { headers: { "Content-Type": "application/json" } })
}
