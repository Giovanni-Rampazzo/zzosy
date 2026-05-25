/**
 * Global Asset Management — Library asset CRUD (list + create).
 *
 * Modelo Figma: library asset = main component. CampaignAssets criados dele
 * guardam libraryAssetId FK; editar library propaga pra TODAS instancias
 * preservando per-piece overrides.
 *
 * GET  /api/clients/[id]/library/assets   — listar com filtros (type, tag, q, slot)
 * POST /api/clients/[id]/library/assets   — criar (clone de CampaignAsset OU upload direto)
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"
import { assertSlotKeyUnique } from "@/lib/libraryValidation"
import { checkBodySizes, isImageUrlSafe } from "@/lib/sizeGuards"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

async function assertClientOfTenant(clientId: string, tenantId: string) {
  const c = await prisma.client.findFirst({ where: { id: clientId, tenantId }, select: { id: true } })
  return !!c
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { id: clientId } = await ctx.params
  if (!(await assertClientOfTenant(clientId, tenantId))) return apiErrors.notFound()

  const url = new URL(req.url)
  const type = url.searchParams.get("type") // TEXT|IMAGE|SHAPE|SMART_OBJECT
  const tag = url.searchParams.get("tag")
  const slot = url.searchParams.get("slot")
  const q = url.searchParams.get("q")

  const where: any = { clientId }
  if (type) where.type = type
  if (slot) where.slotKey = slot
  if (q) where.name = { contains: q }
  // tag filter: filtramos em memoria post-query (Json field, sem index util)

  const assetsRaw = await prisma.clientLibraryAsset.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      smartObject: true,
      _count: { select: { instances: true } },
    },
  })

  let assets = assetsRaw
  if (tag) {
    assets = assetsRaw.filter(a => {
      const tags = Array.isArray(a.tags) ? a.tags as string[] : []
      return tags.includes(tag)
    })
  }

  // P6: Cache-Control. Library mudancas via BroadcastChannel (U6) ja invalidam
  // cliente; s-maxage 30s baixo + stale-while-revalidate balanceia tenant load
  // sem stale UI severa. Vary por Authorization (multi-tenant — header de sessao).
  const res = NextResponse.json(assets.map(a => ({
    ...a,
    content: a.content ? safeParse(a.content) : null,
    tags: Array.isArray(a.tags) ? a.tags : [],
    instanceCount: (a as any)._count?.instances ?? 0,
  })))
  res.headers.set("Cache-Control", "private, max-age=10, stale-while-revalidate=60")
  return res
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const userId = (session.user as any).id
  const { id: clientId } = await ctx.params
  if (!(await assertClientOfTenant(clientId, tenantId))) return apiErrors.notFound()

  const body = await req.json()
  // P7+S2: size guards. Body com lastOverride/content/tags/meta gigante = bloat
  // no DB + OOM no parse. Limits em lib/sizeGuards.ts.
  const sizeErr = checkBodySizes(body, ["name", "slotKey", "content", "lastOverride", "tags", "meta", "notes"])
  if (sizeErr) return NextResponse.json({ error: sizeErr }, { status: 413 })
  // S3 fix: bloqueia javascript:/data:/vbscript: em imageUrl/thumbnailUrl.
  if (body.imageUrl && !isImageUrlSafe(body.imageUrl)) {
    return NextResponse.json({ error: "imageUrl invalido (deve ser /uploads/* ou http/https)" }, { status: 400 })
  }
  if (body.thumbnailUrl && !isImageUrlSafe(body.thumbnailUrl)) {
    return NextResponse.json({ error: "thumbnailUrl invalido" }, { status: 400 })
  }

  // Modos: cloneFrom={campaignId, assetId} OU upload direto (name + type + content/imageUrl + ...)
  if (body.cloneFrom?.assetId) {
    return cloneFromCampaignAsset(clientId, userId, body)
  }
  return createDirect(clientId, userId, body)
}

async function cloneFromCampaignAsset(clientId: string, userId: string, body: any) {
  const { campaignId, assetId } = body.cloneFrom
  const src = await prisma.campaignAsset.findFirst({
    where: { id: assetId, campaignId },
    include: { smartObject: true },
  })
  if (!src) return NextResponse.json({ error: "Source asset not found" }, { status: 404 })

  // M3 fix: slotKey unique per client
  const conflict = await assertSlotKeyUnique(clientId, body.slotKey)
  if (conflict) return conflict

  // B5 fix (pos-build review critico): create library asset + LINK o
  // CampaignAsset original (set libraryAssetId no source) numa unica transacao.
  // Antes era 2-step (POST library + PUT separado pra linkar) — se PUT falhasse,
  // library tinha asset mas campanha nao mostrava badge "Library".
  // Clone SmartObjectFile fica FORA da transacao (lifecycle independente, OK
  // se ficar orfao em erro raro).
  let librarySmartObjectId: string | null = null
  if (src.smartObject) {
    const createdSo = await prisma.clientLibrarySmartObjectFile.create({
      data: {
        clientId,
        guid: src.smartObject.guid,
        filePath: src.smartObject.filePath,
        mime: src.smartObject.mime,
        originalName: src.smartObject.originalName,
        sizeBytes: src.smartObject.sizeBytes,
        width: src.smartObject.width,
        height: src.smartObject.height,
      },
    })
    librarySmartObjectId = createdSo.id
  }

  // Interactive transaction: create + link no source CampaignAsset atomicamente.
  // Se o link falhar, rollback do create — evita library asset orfao.
  const created = await prisma.$transaction(async (tx) => {
    const libAsset = await tx.clientLibraryAsset.create({
      data: {
        clientId,
        name: body.name ?? src.label,
        slotKey: body.slotKey ?? null,
        type: src.type,
        content: src.content,
        lastOverride: src.lastOverride as any,
        imageUrl: src.imageUrl,
        thumbnailUrl: body.thumbnailUrl ?? null,
        smartObjectId: librarySmartObjectId,
        tags: body.tags ?? [],
        notes: body.notes ?? null,
        meta: body.meta ?? {},
        version: 1,
        createdBy: userId,
      },
    })
    await tx.campaignAsset.update({
      where: { id: assetId },
      data: {
        libraryAssetId: libAsset.id,
        libraryAssetVersion: libAsset.version,
        libraryAssetDetached: false,
        slotKey: libAsset.slotKey ?? null,
      },
    })
    return libAsset
  })

  return NextResponse.json(created)
}

async function createDirect(clientId: string, userId: string, body: any) {
  if (!body.name || !body.type) {
    return NextResponse.json({ error: "name + type required" }, { status: 400 })
  }
  const conflict = await assertSlotKeyUnique(clientId, body.slotKey)
  if (conflict) return conflict
  const created = await prisma.clientLibraryAsset.create({
    data: {
      clientId,
      name: body.name,
      slotKey: body.slotKey ?? null,
      type: body.type,
      content: typeof body.content === "string" ? body.content
              : body.content ? JSON.stringify(body.content) : null,
      lastOverride: body.lastOverride ?? null,
      imageUrl: body.imageUrl ?? null,
      thumbnailUrl: body.thumbnailUrl ?? null,
      smartObjectId: body.smartObjectId ?? null,
      tags: body.tags ?? [],
      notes: body.notes ?? null,
      meta: body.meta ?? {},
      version: 1,
      createdBy: userId,
    },
  })
  return NextResponse.json(created)
}

function safeParse(s: string): any {
  try { return JSON.parse(s) } catch { return null }
}
