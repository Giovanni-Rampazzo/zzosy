import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

/**
 * POST /api/pieces/import-psd
 *
 * Cria uma peça avulsa a partir de um PSD importado. Distinto de:
 *  - /api/pieces (criacao via "Gerar Peças": usa MediaFormat + matriz)
 *  - /api/campaigns/[id]/key-vision (importa PSD COMO matriz)
 *
 * Body: { campaignId, name, width, height, data: { layers: [...] } }
 *
 * Layers podem ter:
 *  - __assetId: vinculado a um CampaignAsset existente (match por nome normalizado)
 *  - __embedded: true + conteudo cru (imageDataUrl pra IMAGE, text+styles pra TEXT)
 *
 * status default: STANDBY
 * imageUrl: setado depois via POST /api/pieces/[id]/thumbnail
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { campaignId, name, width, height, data } = body || {}

  if (!campaignId || typeof campaignId !== "string") {
    return NextResponse.json({ error: "campaignId obrigatorio" }, { status: 400 })
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return NextResponse.json({ error: "width/height invalidos" }, { status: 400 })
  }
  if (!data || !Array.isArray(data.layers)) {
    return NextResponse.json({ error: "data.layers obrigatorio" }, { status: 400 })
  }

  // Valida que a campanha existe (RLS pelo tenant ja garantida no fetch)
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } })
  if (!campaign) return NextResponse.json({ error: "Campanha nao encontrada" }, { status: 404 })

  // Grava data como string JSON (schema Piece.data e LongText, nao Json)
  const dataPayload = JSON.stringify({
    ...data,
    width,
    height,
  })

  const piece = await prisma.piece.create({
    data: {
      campaignId,
      name: name || "Peça importada",
      status: "STANDBY",
      data: dataPayload,
      // mediaFormatId fica null — peca avulsa, sem vinculo a formato pre-definido
    },
  })

  return NextResponse.json(piece)
}
