/**
 * GAM — Library asset por ID. PATCH (metadata), PUT (content + bump version
 * + propaga pra instances), DELETE.
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"
import { buildMigrationOps, spansToText, parseContent } from "@/lib/migrateAssetTextOverrides"
import { assertSlotKeyUnique } from "@/lib/libraryValidation"
import { checkBodySizes, isImageUrlSafe } from "@/lib/sizeGuards"

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
  const sizeErr = checkBodySizes(body, ["name", "slotKey", "tags", "meta", "notes"])
  if (sizeErr) return NextResponse.json({ error: sizeErr }, { status: 413 })
  if (body.thumbnailUrl && !isImageUrlSafe(body.thumbnailUrl)) {
    return NextResponse.json({ error: "thumbnailUrl invalido" }, { status: 400 })
  }

  const data: any = {}
  for (const k of ["name", "slotKey", "thumbnailUrl", "notes"]) {
    if (k in body) data[k] = body[k]
  }
  if ("tags" in body) data.tags = body.tags ?? []
  if ("meta" in body) data.meta = body.meta ?? {}

  // M3: valida slotKey unique (exclui o proprio asset do check).
  if ("slotKey" in body) {
    const conflict = await assertSlotKeyUnique(clientId, body.slotKey, assetId)
    if (conflict) return conflict
  }

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
  const sizeErr = checkBodySizes(body, ["content", "lastOverride"])
  if (sizeErr) return NextResponse.json({ error: sizeErr }, { status: 413 })
  if (body.imageUrl && !isImageUrlSafe(body.imageUrl)) {
    return NextResponse.json({ error: "imageUrl invalido" }, { status: 400 })
  }

  const data: any = { version: { increment: 1 } }
  if ("content" in body) {
    data.content = typeof body.content === "string" ? body.content
                  : body.content ? JSON.stringify(body.content) : null
  }
  if ("lastOverride" in body) data.lastOverride = body.lastOverride ?? null
  if ("imageUrl" in body) data.imageUrl = body.imageUrl ?? null
  if ("smartObjectId" in body) data.smartObjectId = body.smartObjectId ?? null

  // B2 fix (pos-build review critico): para TEXT assets, library PUT precisa
  // migrar overrides.text/styles das pecas — espelhando o que o endpoint
  // /api/campaigns/[id]/assets/[assetId] ja faz. Sem isso, peças que tinham
  // \n nos overrides + per-char styles ficavam com indices broken.
  //
  // Estrategia: PRE-buscar todas instances ativas, calcular migration ops
  // por campanha (cada instance pode estar em campanha diferente), depois
  // executar TUDO numa transaction unica.
  const isTextWithContent = asset.type === "TEXT" && "content" in body
  let migrationOps: any[] = []
  if (isTextWithContent) {
    const oldText = spansToText(parseContent(asset.content))
    const newText = spansToText(parseContent(data.content))
    if (oldText !== newText && newText.trim().length > 0) {
      const instances = await prisma.campaignAsset.findMany({
        where: { libraryAssetId: assetId, libraryAssetDetached: false },
        select: { id: true, campaignId: true },
      })
      // Para cada instance, builda ops da campanha (KV + pieces). Cada instance
      // vive em uma campanha distinta — chamamos buildMigrationOps por instance.
      for (const inst of instances) {
        const ops = await buildMigrationOps(inst.campaignId, inst.id, oldText, newText)
        migrationOps.push(...ops)
      }
    }
  }

  // Propagacao asset-level: atualiza content/imageUrl/lastOverride das instancias NAO-detached.
  const propData: any = {}
  if ("content" in body) propData.content = data.content
  if ("lastOverride" in body) propData.lastOverride = data.lastOverride
  if ("imageUrl" in body) propData.imageUrl = data.imageUrl
  if ("smartObjectId" in body) propData.smartObjectId = data.smartObjectId

  const ops: any[] = [
    prisma.clientLibraryAsset.update({ where: { id: assetId }, data }),
  ]
  if (Object.keys(propData).length > 0) {
    ops.push(prisma.campaignAsset.updateMany({
      where: { libraryAssetId: assetId, libraryAssetDetached: false },
      data: propData,
    }))
  }
  ops.push(...migrationOps)

  const results = await prisma.$transaction(ops)
  return NextResponse.json(results[0])
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const { id: clientId, assetId } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const asset = await getOwned(clientId, assetId, tenantId)
  if (!asset) return apiErrors.notFound()

  // U2 fix (pos-build review): cascade SetNull zeraria libraryAssetId mas
  // libraryAssetDetached ficaria false → badge "LIBRARY" sumiria sem o
  // "ex-library" aparecer. Pre-marca instances ativas como Detached primeiro,
  // preservando o estado "ja foi library, agora orfa" pra UI.
  // Transaction: pre-mark + delete (que cascade SetNull em ambas).
  const detachedInstances = await prisma.campaignAsset.count({
    where: { libraryAssetId: assetId, libraryAssetDetached: false },
  })

  await prisma.$transaction([
    prisma.campaignAsset.updateMany({
      where: { libraryAssetId: assetId, libraryAssetDetached: false },
      data: { libraryAssetDetached: true },
    }),
    prisma.clientLibraryAsset.delete({ where: { id: assetId } }),
  ])

  return NextResponse.json({ ok: true, detachedInstances })
}

function safeParse(s: string): any { try { return JSON.parse(s) } catch { return null } }
