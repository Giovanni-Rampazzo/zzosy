/**
 * GAM — Clona um ClientLibraryAsset → cria CampaignAsset instanciado
 * (com libraryAssetId FK + libraryAssetVersion snapshot).
 *
 * POST /api/campaigns/[id]/assets/from-library
 * Body: { libraryAssetId: string, posX?: number, posY?: number, width?: number }
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { id: campaignId } = await ctx.params

  // Valida campanha pertence ao tenant
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, client: { tenantId } },
    select: { id: true, clientId: true },
  })
  if (!campaign) return apiErrors.notFound()

  const body = await req.json()
  const { libraryAssetId, posX, posY, width } = body
  if (!libraryAssetId) return NextResponse.json({ error: "libraryAssetId required" }, { status: 400 })

  // Library asset deve ser do MESMO cliente da campanha (escopo de seguranca).
  const libAsset = await prisma.clientLibraryAsset.findFirst({
    where: { id: libraryAssetId, clientId: campaign.clientId },
    include: { smartObject: true },
  })
  if (!libAsset) return NextResponse.json({ error: "Library asset not found OR cross-client" }, { status: 404 })

  // Order: ultimo + 1
  const last = await prisma.campaignAsset.findFirst({
    where: { campaignId },
    orderBy: { order: "desc" },
    select: { order: true },
  })
  const order = (last?.order ?? -1) + 1

  // Se SO: replicamos pra SmartObjectFile da campanha (FK pra rotina existente de export).
  // O ClientLibrarySmartObjectFile.filePath e o mesmo binario — copiamos so o registro
  // de modo que CampaignAsset.smartObjectId aponte pra SmartObjectFile (model usado
  // pelo exportPiece). Sem isso o export PSD nao acharia o binario.
  let smartObjectId: string | null = null
  if (libAsset.smartObject) {
    const so = await prisma.smartObjectFile.create({
      data: {
        campaignId,
        guid: libAsset.smartObject.guid,
        filePath: libAsset.smartObject.filePath,
        mime: libAsset.smartObject.mime,
        originalName: libAsset.smartObject.originalName,
        sizeBytes: libAsset.smartObject.sizeBytes,
        width: libAsset.smartObject.width,
        height: libAsset.smartObject.height,
      },
    })
    smartObjectId = so.id
  }

  const created = await prisma.campaignAsset.create({
    data: {
      campaignId,
      type: libAsset.type,
      label: libAsset.name,
      content: libAsset.content,
      imageUrl: libAsset.imageUrl,
      lastOverride: libAsset.lastOverride as any,
      smartObjectId,
      // GAM Figma model: linkamos ao library com snapshot version.
      libraryAssetId: libAsset.id,
      libraryAssetVersion: libAsset.version,
      libraryAssetDetached: false,
      slotKey: libAsset.slotKey ?? null,
      order,
      posX: typeof posX === "number" ? posX : 100,
      posY: typeof posY === "number" ? posY : 100,
      width: typeof width === "number" ? width : 600,
      visible: true,
    },
  })
  return NextResponse.json(created)
}
