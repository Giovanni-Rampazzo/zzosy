import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

/**
 * GET /api/debug/brand-refs?clientId=<id>
 *
 * Rota TEMPORARIA de diagnostico do sistema de brand refs.
 * Lista TODAS as pieces do cliente + se cada uma tem refs vinculados
 * (fillBrandIdx no texto, colorBrandIdx no BG solid). Mostra tambem o
 * brandColors atual do cliente pra comparar com o que estah salvo.
 *
 * Usado pra diagnosticar caso "mudei a cor da marca mas peca nao atualizou":
 *  - Se refsFound = [] em todas pieces -> __fillBrandIdx nao foi salvo
 *    (problema no editor/save)
 *  - Se refsFound tem itens mas com fill = cor antiga -> cascade nao rodou
 *  - Se refsFound tem itens com fill = cor nova mas peca visualmente errada
 *    -> thumb nao foi regenerado
 */
export async function GET(req: NextRequest) {
  let clientId = req.nextUrl.searchParams.get("clientId")
  const campaignId = req.nextUrl.searchParams.get("campaignId")
  const pieceId = req.nextUrl.searchParams.get("pieceId")
  if (!clientId && campaignId) {
    const camp = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { clientId: true } })
    clientId = camp?.clientId ?? null
  }
  if (!clientId && pieceId) {
    const p = await prisma.piece.findUnique({ where: { id: pieceId }, select: { campaign: { select: { clientId: true } } } })
    clientId = p?.campaign?.clientId ?? null
  }
  if (!clientId) return NextResponse.json({ error: "clientId obrigatorio (ou pieceId/campaignId pra deduzir)" }, { status: 400 })

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { campaigns: { include: { pieces: true, keyVision: true } } },
  })
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 })

  const brandColors = Array.isArray(client.brandColors as any) ? (client.brandColors as any[]) : []

  function collectRefs(block: any, prefix: string): any[] {
    const out: any[] = []
    if (Array.isArray(block?.layers)) {
      block.layers.forEach((l: any, i: number) => {
        if (typeof l?.overrides?.fillBrandIdx === "number") {
          const idx = l.overrides.fillBrandIdx
          const live = brandColors[idx]
          out.push({
            where: `${prefix}layers[${i}]`,
            assetId: l.assetId,
            fillBrandIdx: idx,
            fillStored: l.overrides.fill,
            fillLive: live?.hex ?? null,
            needsUpdate: live?.hex && live.hex.toLowerCase() !== String(l.overrides.fill ?? "").toLowerCase(),
          })
        }
      })
    }
    if (Array.isArray(block?.bgLayers)) {
      block.bgLayers.forEach((b: any, i: number) => {
        if (b?.kind === "solid" && typeof b?.colorBrandIdx === "number") {
          const idx = b.colorBrandIdx
          const live = brandColors[idx]
          out.push({
            where: `${prefix}bgLayers[${i}]`,
            colorBrandIdx: idx,
            colorStored: b.color,
            colorLive: live?.hex ?? null,
            needsUpdate: live?.hex && live.hex.toLowerCase() !== String(b.color ?? "").toLowerCase(),
          })
        }
      })
    }
    return out
  }

  const piecesReport: any[] = []
  for (const camp of client.campaigns) {
    for (const p of camp.pieces) {
      let data: any = null
      try { data = p.data ? JSON.parse(p.data) : null } catch {}
      const refs = data ? collectRefs(data, "") : []
      if (Array.isArray(data?.steps)) {
        data.steps.forEach((s: any, i: number) => refs.push(...collectRefs(s, `steps[${i}].`)))
      }
      piecesReport.push({
        id: p.id,
        name: p.name,
        campaignId: camp.id,
        campaignName: camp.name,
        refs,
      })
    }
  }
  // KV de cada campanha tambem
  const kvReport: any[] = []
  for (const camp of client.campaigns) {
    if (!camp.keyVision) continue
    let layers: any = null
    try { layers = camp.keyVision.layers ? JSON.parse(camp.keyVision.layers) : null } catch {}
    const refs = layers ? collectRefs({ layers }, "") : []
    kvReport.push({
      campaignId: camp.id,
      campaignName: camp.name,
      bgColor: camp.keyVision.bgColor,
      refs,
    })
  }

  return NextResponse.json({
    clientId,
    clientName: client.name,
    brandColors,
    piecesReport,
    kvReport,
    summary: {
      totalPieces: piecesReport.length,
      piecesWithRefs: piecesReport.filter(p => p.refs.length > 0).length,
      piecesNeedingUpdate: piecesReport.filter(p => p.refs.some((r: any) => r.needsUpdate)).length,
      kvsWithRefs: kvReport.filter(k => k.refs.length > 0).length,
    },
  })
}
