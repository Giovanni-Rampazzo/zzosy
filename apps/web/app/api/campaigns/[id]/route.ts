import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

function parseJson(val: any) {
  if (!val) return null
  if (typeof val === "string") { try { return JSON.parse(val) } catch { return null } }
  return val
}

function parseContent(raw: any): any[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

export async function GET(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const { id } = await ctx.params
  const tenantId = (session.user as any).tenantId

  // PERF 2026-05-27: ?lite=true pula keyVision.data + keyVision.layers
  // (que pode ter 98KB+ de raster mask de clipping). Editor passa full,
  // overview/regen passam lite. brandLogoUrl ja foi removido em 2b3f1d21.
  const url = new URL(req.url)
  const lite = url.searchParams.get("lite") === "true"

  const campaign = await prisma.campaign.findFirst({
    where: { id, client: { tenantId } },
    include: {
      client: {
        select: {
          id: true, name: true, tenantId: true, slug: true,
          brandColors: true, brandTypography: true, brandFont: true,
          // REVERT 2026-05-27 (auditoria pos b58caa8d): brandLogoUrl precisa
          // vir aqui — eh consumido por TopNav.tsx, ClientLogoBadge.tsx,
          // KeyVisionEditor.tsx e useBrand.ts. Otimizacao quebrou logos no
          // app inteiro. O ganho de 55KB vale menos que ter logo funcionando.
          // /api/pieces continua sem (duplicacao em N pecas era pior).
          brandLogoUrl: true,
        },
      },
      assets: { orderBy: { order: "asc" }, include: { smartObject: true } },
      keyVision: lite
        ? { select: { id: true, campaignId: true, bgColor: true, width: true, height: true, thumbnailUrl: true, createdAt: true, updatedAt: true } }
        : true,
      _count: { select: { pieces: true } },
    },
  })
  if (!campaign) return apiErrors.notFound()

  return NextResponse.json({
    ...campaign,
    assets: campaign.assets.map(a => ({
      ...a,
      content: parseContent(a.content),
    })),
    keyVision: campaign.keyVision ? {
      ...campaign.keyVision,
      ...(lite ? {} : {
        data: parseJson((campaign.keyVision as any).data),
        layers: parseJson((campaign.keyVision as any).layers),
      }),
    } : null,
  })
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const { id } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const campaign = await prisma.campaign.findFirst({ where: { id, client: { tenantId } } })
  if (!campaign) return apiErrors.notFound()
  const body = await req.json()
  const data: any = {}
  for (const k of ["name", "status", "code"]) {
    if (k in body) data[k] = body[k]
  }
  const updated = await prisma.campaign.update({ where: { id }, data })
  return NextResponse.json(updated)
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const { id } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const campaign = await prisma.campaign.findFirst({ where: { id, client: { tenantId } } })
  if (!campaign) return apiErrors.notFound()
  await prisma.campaign.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
