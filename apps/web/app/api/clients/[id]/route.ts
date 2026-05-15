import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const client = await prisma.client.findFirst({
    where: { id, tenantId },
    include: {
      campaigns: {
        include: {
          _count: { select: { pieces: true } },
          keyVision: { select: { thumbnailUrl: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  })
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(client)
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const client = await prisma.client.findFirst({ where: { id, tenantId } })
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const body = await req.json()
  const data: any = {}
  for (const k of ["name", "contact", "email", "phone", "address", "logoUrl", "brandFont", "brandColors", "customFontFiles"]) {
    if (k in body) data[k] = body[k]
  }
  const updated = await prisma.client.update({ where: { id }, data })
  return NextResponse.json(updated)
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const client = await prisma.client.findFirst({ where: { id, tenantId } })
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await prisma.client.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
