import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unlink } from "fs/promises"
import path from "path"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId
  const { id } = await ctx.params
  const delivery = await prisma.delivery.findFirst({
    where: { id, campaign: { client: { tenantId } } },
    include: {
      campaign: { include: { client: true } },
      deliveredBy: { select: { id: true, name: true, email: true } },
      pieces: { include: { piece: { select: { id: true, name: true, imageUrl: true, status: true } } } },
    },
  })
  if (!delivery) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(delivery)
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId
  const { id } = await ctx.params
  const delivery = await prisma.delivery.findFirst({ where: { id, campaign: { client: { tenantId } } } })
  if (!delivery) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Apagar arquivo fisico (best-effort)
  if (delivery.zipUrl) {
    try {
      const filePath = path.join(process.cwd(), "public", delivery.zipUrl.replace(/^\//, ""))
      await unlink(filePath)
    } catch (e) { console.warn("Could not delete zip file:", e) }
  }

  await prisma.delivery.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
