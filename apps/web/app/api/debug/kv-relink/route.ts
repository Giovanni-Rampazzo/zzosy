import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// POST /api/debug/kv-relink?campaignId=X
// Re-linka layers do KV aos assets atuais por LABEL. Usa pra recuperar KVs
// que ficaram apontando pra assetIds antigos (assets foram deletados/recriados
// fora do fluxo import-psd, KV não atualizou).
// Estratégia: pra cada layer com assetId quebrado, procura asset com label
// matching (case-insensitive, trim) na mesma campanha. Se acha, troca o ID.
export async function POST(req: NextRequest) {
  const cid = req.nextUrl.searchParams.get("campaignId")
  if (!cid) return NextResponse.json({ error: "campaignId obrigatorio" }, { status: 400 })

  const camp = await prisma.campaign.findUnique({
    where: { id: cid },
    include: { keyVision: true, assets: true },
  })
  if (!camp) return NextResponse.json({ error: "campanha nao encontrada" }, { status: 404 })
  if (!camp.keyVision) return NextResponse.json({ error: "KV nao existe" }, { status: 404 })

  const validIds = new Set(camp.assets.map(a => a.id))
  const byLabelLower = new Map<string, string>()
  for (const a of camp.assets) {
    const k = (a.label ?? "").trim().toLowerCase()
    if (k && !byLabelLower.has(k)) byLabelLower.set(k, a.id)
  }

  let layers: any[] = []
  try {
    layers = camp.keyVision.layers ? JSON.parse(camp.keyVision.layers) : []
  } catch {
    return NextResponse.json({ error: "KV.layers JSON invalido" }, { status: 500 })
  }
  if (!Array.isArray(layers)) {
    return NextResponse.json({ error: "KV.layers nao eh array" }, { status: 500 })
  }

  let fixed = 0, unmatched = 0, ok = 0
  const unmatchedDetails: any[] = []

  // Antigo->Novo mapping (assetIds quebrados que conseguimos resolver por label).
  // Precisamos do label do asset antigo — não temos. Estrategia alternativa:
  // se o KV tem N layers e os assets atuais são exatamente N na mesma ORDEM
  // do PSD (order field do CampaignAsset), assumimos ordem por zIndex.
  // Mas mais robusto: ler o thumb name ou re-importar.
  // Por ora: só conta o gap e retorna estatísticas. Re-link automático fica
  // pra quando o KV tiver labels redundantes nos layers (futura melhoria).

  // PRIMEIRA TENTATIVA: pelo order. Ordenamos assets por order, layers por zIndex.
  const assetsByOrder = [...camp.assets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const layersByZ = layers
    .map((l, originalIdx) => ({ l, originalIdx, z: l.zIndex ?? 0 }))
    .sort((a, b) => a.z - b.z)

  const newLayers = [...layers]
  for (let i = 0; i < layersByZ.length; i++) {
    const { l, originalIdx } = layersByZ[i]
    if (l.assetId && validIds.has(l.assetId)) { ok++; continue }
    // Tenta pelo INDEX (ordem do PSD = order do asset)
    const target = assetsByOrder[i]
    if (target) {
      newLayers[originalIdx] = { ...l, assetId: target.id }
      fixed++
    } else {
      unmatched++
      unmatchedDetails.push({ layerIdx: originalIdx, oldAssetId: l.assetId })
    }
  }

  if (fixed > 0) {
    await prisma.keyVision.update({
      where: { campaignId: cid },
      data: { layers: JSON.stringify(newLayers) },
    })
  }

  return NextResponse.json({
    totalLayers: layers.length,
    totalAssets: camp.assets.length,
    ok, fixed, unmatched,
    unmatchedDetails: unmatchedDetails.slice(0, 20),
    note: "Linka layers por ORDEM (KV.zIndex ↔ Asset.order). Se algo ficou errado, re-importe o PSD.",
  })
}
