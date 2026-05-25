/**
 * GAM — Library asset por ID. PATCH (metadata), PUT (content + bump version
 * + propaga pra instances), DELETE.
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; assetId: string }> }

async function getOwned(clientId: string, assetId: string, tenantId: string) {
  return prisma.clientLibraryAsset.findFirst({
    where: { id: assetId, clientId, client: { tenantId } },
    include: { smartObject: true },
  })
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const { id: clientId, assetId } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const asset = await getOwned(clientId, assetId, tenantId)
  if (!asset) return apiErrors.notFound()
  return NextResponse.json({
    ...asset,
    content: asset.content ? safeParse(asset.content) : null,
  })
}

/**
 * PATCH: edita SO metadata (name, slotKey, tags, notes, meta, thumbnail).
 * NAO modifica content/lastOverride/imageUrl/smartObjectId — pra esses use PUT
 * (que propaga pra instancias).
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const { id: clientId, assetId } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const asset = await getOwned(clientId, assetId, tenantId)
  if (!asset) return apiErrors.notFound()

  const body = await req.json()
  const data: any = {}
  for (const k of ["name", "slotKey", "thumbnailUrl", "notes"]) {
    if (k in body) data[k] = body[k]
  }
  if ("tags" in body) data.tags = body.tags ?? []
  if ("meta" in body) data.meta = body.meta ?? {}

  const updated = await prisma.clientLibraryAsset.update({
    where: { id: assetId },
    data,
  })
  return NextResponse.json(updated)
}

/**
 * PUT: substitui content/lastOverride/imageUrl (e/ou smartObjectId) — bump
 * version + propaga pra TODAS CampaignAsset com libraryAssetId=X que NAO
 * foram detached. UI da campanha mostra "Update available" ate user clicar Update.
 *
 * Per-piece overrides (text local com \n, cor per-char) PRESERVADOS:
 * propagamos so o ASSET-level content+lastOverride. Pieces guardam overrides
 * em piece.data.layers[].overrides (intactos).
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const { id: clientId, assetId } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const asset = await getOwned(clientId, assetId, tenantId)
  if (!asset) return apiErrors.notFound()

  const body = await req.json()
  const data: any = { version: { increment: 1 } }
  if ("content" in body) {
    data.content = typeof body.content === "string" ? body.content
                  : body.content ? JSON.stringify(body.content) : null
  }
  if ("lastOverride" in body) data.lastOverride = body.lastOverride ?? null
  if ("imageUrl" in body) data.imageUrl = body.imageUrl ?? null
  if ("smartObjectId" in body) data.smartObjectId = body.smartObjectId ?? null

  // Transacao: update library + propaga pra instances ativas.
  const ops: any[] = [
    prisma.clientLibraryAsset.update({ where: { id: assetId }, data }),
  ]
  // Propagacao: atualiza content/imageUrl/lastOverride das instancias NAO-detached.
  // Mantem version stale na instancia ate user clicar "Update" (badge "available").
  const propData: any = {}
  if ("content" in body) propData.content = data.content
  if ("lastOverride" in body) propData.lastOverride = data.lastOverride
  if ("imageUrl" in body) propData.imageUrl = data.imageUrl
  if ("smartObjectId" in body) propData.smartObjectId = data.smartObjectId
  if (Object.keys(propData).length > 0) {
    ops.push(prisma.campaignAsset.updateMany({
      where: { libraryAssetId: assetId, libraryAssetDetached: false },
      data: propData,
    }))
  }

  const [updated] = await prisma.$transaction(ops)
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const { id: clientId, assetId } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const asset = await getOwned(clientId, assetId, tenantId)
  if (!asset) return apiErrors.notFound()

  // Conta instances ativas pra retornar warning ao caller. UI pode mostrar
  // "X campanhas usam — apagar mesmo assim?".
  const instances = await prisma.campaignAsset.count({
    where: { libraryAssetId: assetId, libraryAssetDetached: false },
  })

  await prisma.clientLibraryAsset.delete({ where: { id: assetId } })
  return NextResponse.json({ ok: true, detachedInstances: instances })
}

function safeParse(s: string): any { try { return JSON.parse(s) } catch { return null } }
