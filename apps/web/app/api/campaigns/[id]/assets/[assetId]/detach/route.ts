/**
 * GAM — Detach: nulifica libraryAssetId + flag detached=true. CampaignAsset
 * vira independente, edits da library nao propagam mais.
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"
import { buildMigrationOps, spansToText, parseContent } from "@/lib/migrateAssetTextOverrides"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; assetId: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { id: campaignId, assetId } = await ctx.params

  const asset = await prisma.campaignAsset.findFirst({
    where: { id: assetId, campaignId, campaign: { client: { tenantId } } },
    select: { id: true, libraryAssetId: true },
  })
  if (!asset) return apiErrors.notFound()
  if (!asset.libraryAssetId) return NextResponse.json({ error: "Asset is not linked to library" }, { status: 400 })

  const updated = await prisma.campaignAsset.update({
    where: { id: assetId },
    data: {
      libraryAssetDetached: true,
      // Mantemos libraryAssetId/Version pra historico (UI pode mostrar "ex-library").
      // Se quiser hard-detach (limpar referencias), descomentar:
      // libraryAssetId: null,
      // libraryAssetVersion: null,
    },
  })
  return NextResponse.json(updated)
}

/**
 * PUT: "Re-sync" — force-pull do library atual sobreescrevendo content/imageUrl/
 * lastOverride da instancia. Para TEXT: roda migration nas peças (preserva \n +
 * per-char styles via lib/migrateAssetTextOverrides).
 *
 * U1 fix (pos-build review): antes so atualizava libraryAssetVersion (no-op
 * visual). Agora user clica Re-sync e VE conteudo atualizar (caso seja TEXT
 * que mudou no library).
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { id: campaignId, assetId } = await ctx.params

  const asset = await prisma.campaignAsset.findFirst({
    where: { id: assetId, campaignId, campaign: { client: { tenantId } } },
  })
  if (!asset) return apiErrors.notFound()
  if (!asset.libraryAssetId) return NextResponse.json({ error: "Asset is not linked to library" }, { status: 400 })

  const lib = await prisma.clientLibraryAsset.findUnique({
    where: { id: asset.libraryAssetId },
  })
  if (!lib) return NextResponse.json({ error: "Library asset not found" }, { status: 404 })

  // Force-pull: source of truth = library. Sobreescreve campos sincronizaveis.
  const updateData: any = {
    content: lib.content,
    imageUrl: lib.imageUrl,
    lastOverride: lib.lastOverride as any,
    libraryAssetVersion: lib.version,
  }

  // Migration ops pra TEXT: preserva overrides nas peças quando texto muda.
  let migrationOps: any[] = []
  if (asset.type === "TEXT") {
    const oldText = spansToText(parseContent(asset.content))
    const newText = spansToText(parseContent(lib.content))
    if (oldText !== newText && newText.trim().length > 0) {
      migrationOps = await buildMigrationOps(campaignId, assetId, oldText, newText)
    }
  }

  const ops: any[] = [
    prisma.campaignAsset.update({ where: { id: assetId }, data: updateData }),
    ...migrationOps,
  ]
  const results = await prisma.$transaction(ops)
  return NextResponse.json(results[0])
}
