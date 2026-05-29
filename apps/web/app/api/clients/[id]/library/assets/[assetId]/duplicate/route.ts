/**
 * POST /api/clients/[id]/library/assets/[assetId]/duplicate
 *
 * Clona o asset da library do cliente em um novo asset. Mantem content,
 * lastOverride, tags, notes, meta, imageUrl, thumbnailUrl, smartObjectId.
 * Nome do clone: "X (cópia)" — ou "X (cópia 2)" se ja existir.
 * slotKey: limpa (null) — slot eh chave unica, nao pode duplicar.
 *
 * NAO cria instances no campaignAsset (so o clone do asset em si).
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; assetId: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { id: clientId, assetId } = await ctx.params

  const src = await prisma.clientLibraryAsset.findFirst({
    where: { id: assetId, clientId, client: { tenantId } },
  })
  if (!src) return apiErrors.notFound()

  // Procura nome livre: "X (cópia)", "X (cópia 2)", ...
  const baseName = src.name.replace(/\s*\(cópia(?:\s+\d+)?\)$/i, "")
  const siblings = await prisma.clientLibraryAsset.findMany({
    where: { clientId, name: { startsWith: baseName } },
    select: { name: true },
  })
  const used = new Set(siblings.map(s => s.name.toLowerCase()))
  let copyName = `${baseName} (cópia)`
  let n = 2
  while (used.has(copyName.toLowerCase())) {
    copyName = `${baseName} (cópia ${n})`
    n++
  }

  const clone = await prisma.clientLibraryAsset.create({
    data: {
      clientId,
      name: copyName,
      slotKey: null, // slot eh unique — clone nao herda
      type: src.type,
      content: src.content,
      lastOverride: src.lastOverride === null ? undefined : src.lastOverride,
      imageUrl: src.imageUrl,
      thumbnailUrl: src.thumbnailUrl,
      tags: src.tags === null ? undefined : src.tags,
      notes: src.notes,
      meta: src.meta === null ? undefined : src.meta,
      smartObjectId: src.smartObjectId,
      version: 1,
    },
  })

  return NextResponse.json(clone)
}
