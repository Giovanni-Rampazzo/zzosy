import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { normalizeName } from "@/lib/normalize"

export const dynamic = "force-dynamic"

/**
 * POST /api/pieces/import-psd
 *
 * Cria uma peça avulsa a partir de um PSD importado.
 *
 * Body: {
 *   campaignId, name, width, height,
 *   data: { layers: [...] },
 *   newTextAssets?: [{ label, content, type: 'TEXT', layerKeysToLink }]
 *      // assets de TEXT a criar antes da peca; layerKeysToLink lista
 *      // chaves no array de layers que apontam pro asset criado.
 * }
 *
 * Layers podem ter:
 *  - assetId: vinculado a um CampaignAsset existente
 *  - __embedded + imageDataUrl: imagem cru gravada no piece.data
 *  - __pendingNewAssetKey: chave temporaria que aponta pra um newTextAssets
 *    (esses sao TEXTOS sem match — o endpoint cria o asset e troca
 *    __pendingNewAssetKey por assetId)
 *
 * status default: STANDBY
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId

  const body = await req.json().catch(() => ({}))
  const { campaignId, name, width, height, data, newTextAssets } = body || {}

  if (!campaignId || typeof campaignId !== "string") {
    return NextResponse.json({ error: "campaignId obrigatorio" }, { status: 400 })
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return NextResponse.json({ error: "width/height invalidos" }, { status: 400 })
  }
  if (!data || !Array.isArray(data.layers)) {
    return NextResponse.json({ error: "data.layers obrigatorio" }, { status: 400 })
  }

  // Audit P1.6: valida que a campanha pertence ao tenant da sessao. O comentario
  // antigo alegava "RLS garantida" mas findUnique nao filtra por tenant.
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, client: { tenantId } },
  })
  if (!campaign) return NextResponse.json({ error: "Campanha nao encontrada" }, { status: 404 })

  // PASSO 1: cria assets TEXT novos (se houver) e mapeia label normalizado -> assetId.
  // Pode ter sido criado por outra importacao previa — re-checamos no banco.
  const keyToAssetId: Record<string, string> = {}
  if (Array.isArray(newTextAssets) && newTextAssets.length > 0) {
    // Le assets existentes da campanha pra deduplicar pelo label normalizado
    const existing = await prisma.campaignAsset.findMany({
      where: { campaignId, type: "TEXT" },
      select: { id: true, label: true, order: true },
    })
    const existingByKey = new Map<string, string>()
    for (const a of existing) {
      const k = normalizeName(a.label)
      if (k) existingByKey.set(k, a.id)
    }

    // Pega proximo order disponivel (asset novo vai no topo: min - 1)
    const firstOrder = await prisma.campaignAsset.findFirst({
      where: { campaignId }, orderBy: { order: "asc" }, select: { order: true }
    })
    let nextOrder = (firstOrder?.order ?? 0) - 1

    for (const newAsset of newTextAssets) {
      const { label, content, layerKeysToLink } = newAsset || {}
      if (!label || !Array.isArray(layerKeysToLink) || layerKeysToLink.length === 0) continue

      const normKey = normalizeName(label)
      let assetId = existingByKey.get(normKey)

      if (!assetId) {
        // Cria asset novo. content deve ser JSON string (TextSpan[])
        const contentStr = typeof content === "string" ? content : JSON.stringify(content ?? [])
        const created = await prisma.campaignAsset.create({
          data: {
            campaignId,
            type: "TEXT",
            label,
            content: contentStr,
            order: nextOrder--,
          },
        })
        assetId = created.id
        existingByKey.set(normKey, assetId)
      }

      // Mapeia as chaves temporarias dos layers pra esse assetId
      for (const k of layerKeysToLink) {
        keyToAssetId[k] = assetId
      }
    }
  }

  // PASSO 2: substitui __pendingNewAssetKey por assetId nos layers
  const layers = (data.layers as any[]).map((l: any) => {
    if (l.__pendingNewAssetKey && keyToAssetId[l.__pendingNewAssetKey]) {
      const { __pendingNewAssetKey, ...rest } = l
      return { ...rest, assetId: keyToAssetId[__pendingNewAssetKey] }
    }
    return l
  })

  // Grava data como string JSON. CRITICO: precisa version:2 pro editor entender.
  const dataPayload = JSON.stringify({
    ...data,
    layers,
    version: 2,
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
