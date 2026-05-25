/**
 * GAM — Detach: nulifica libraryAssetId + flag detached=true. CampaignAsset
 * vira independente, edits da library nao propagam mais.
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

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
 * PUT: "Update" — instancia consolida com versao atual da library. Limpa o
 * badge "Update available". Reusa content/lastOverride atual (que ja foi
 * propagado no PUT da library; aqui so atualiza o version snapshot).
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
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

  const lib = await prisma.clientLibraryAsset.findUnique({
    where: { id: asset.libraryAssetId },
    select: { version: true },
  })
  if (!lib) return NextResponse.json({ error: "Library asset not found" }, { status: 404 })

  const updated = await prisma.campaignAsset.update({
    where: { id: assetId },
    data: { libraryAssetVersion: lib.version },
  })
  return NextResponse.json(updated)
}
