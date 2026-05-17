import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// POST /api/debug/piece-relink?campaignId=X
// Re-linka layers de TODAS as peças da campanha aos assets atuais usando
// ordem (Asset.order ↔ layer.zIndex). Mesma estratégia do kv-relink.
// Usar quando peças vieram de um KV antigo cujos assetIds foram regerados.
export async function POST(req: NextRequest) {
  const cid = req.nextUrl.searchParams.get("campaignId")
  if (!cid) return NextResponse.json({ error: "campaignId obrigatorio" }, { status: 400 })

  const camp = await prisma.campaign.findUnique({
    where: { id: cid },
    include: { assets: true, pieces: true },
  })
  if (!camp) return NextResponse.json({ error: "campanha nao encontrada" }, { status: 404 })

  const validIds = new Set(camp.assets.map(a => a.id))
  const assetsByOrder = [...camp.assets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const results: any[] = []

  for (const piece of camp.pieces) {
    if (!piece.data) { results.push({ pieceId: piece.id, name: piece.name, skipped: "no data" }); continue }
    let pdata: any
    try { pdata = JSON.parse(piece.data) } catch { results.push({ pieceId: piece.id, error: "JSON invalido" }); continue }

    let totalOk = 0, totalFixed = 0, totalUnmatched = 0

    function relinkLayers(layers: any[]): any[] {
      if (!Array.isArray(layers)) return layers
      const sorted = layers
        .map((l, i) => ({ l, i, z: l.zIndex ?? 0 }))
        .sort((a, b) => a.z - b.z)
      const newLayers = [...layers]
      let positionalIdx = 0
      for (const { l, i } of sorted) {
        if (l.assetId && validIds.has(l.assetId)) { totalOk++; positionalIdx++; continue }
        if (l.assetId === undefined || l.assetId === null) { positionalIdx++; continue }
        // Não bate: tenta por posição
        const target = assetsByOrder[positionalIdx]
        if (target) {
          newLayers[i] = { ...l, assetId: target.id }
          totalFixed++
        } else {
          totalUnmatched++
        }
        positionalIdx++
      }
      return newLayers
    }

    if (Array.isArray(pdata.layers)) {
      pdata.layers = relinkLayers(pdata.layers)
    }
    if (Array.isArray(pdata.steps)) {
      pdata.steps = pdata.steps.map((s: any) =>
        s && Array.isArray(s.layers) ? { ...s, layers: relinkLayers(s.layers) } : s
      )
    }

    if (totalFixed > 0) {
      await prisma.piece.update({
        where: { id: piece.id },
        data: { data: JSON.stringify(pdata) },
      })
    }

    results.push({ pieceId: piece.id, name: piece.name, ok: totalOk, fixed: totalFixed, unmatched: totalUnmatched })
  }

  return NextResponse.json({
    totalPieces: camp.pieces.length,
    totalAssets: camp.assets.length,
    results,
  })
}
