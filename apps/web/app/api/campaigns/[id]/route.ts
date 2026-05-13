import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

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
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  const tenantId = (session.user as any).tenantId

  const campaign = await prisma.campaign.findFirst({
    where: { id, client: { tenantId } },
    include: {
      client: true,
      assets: { orderBy: { order: "asc" }, include: { smartObject: true } },
      keyVision: true,
    },
  })
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 })

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
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const campaign = await prisma.campaign.findFirst({ where: { id, client: { tenantId } } })
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 })
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
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const campaign = await prisma.campaign.findFirst({ where: { id, client: { tenantId } } })
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await prisma.campaign.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
