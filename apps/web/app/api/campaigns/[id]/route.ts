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

  // PERF 2026-05-27: select especifico do client. Antes incluia brandLogoUrl
  // (PNG base64 55KB) em TODA fetch do campaign, mesmo quando o frontend nao
  // precisava do logo. User reportou "sistema muito lento" — endpoint era
  // 158KB; com esse fix cai pra ~103KB (-35%). Pra usos que precisam do logo
  // (PPTX builder), buscar via /api/clients/[id] separado.
  const campaign = await prisma.campaign.findFirst({
    where: { id, client: { tenantId } },
    include: {
      client: {
        select: {
          id: true, name: true, tenantId: true, slug: true,
          brandColors: true, brandTypography: true, brandFont: true,
          // brandLogoUrl: NAO incluir (PNG base64 ~55KB). PPTX builder busca
          // via /api/clients/[id] separado quando precisa.
        },
      },
      assets: { orderBy: { order: "asc" }, include: { smartObject: true } },
      keyVision: true,
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
      data: parseJson(campaign.keyVision.data),
      layers: parseJson(campaign.keyVision.layers),
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
