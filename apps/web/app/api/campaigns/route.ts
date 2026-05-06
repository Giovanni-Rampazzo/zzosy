import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId
  const { name, clientId } = await req.json()
  if (!name || !clientId) return NextResponse.json({ error: "name e clientId obrigatórios" }, { status: 400 })
  const client = await prisma.client.findFirst({ where: { id: clientId, tenantId } })
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 })
  const campaign = await prisma.campaign.create({
    data: { name, clientId },
    include: { assets: true }
  })
  return NextResponse.json(campaign)
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId
  const campaigns = await prisma.campaign.findMany({
    where: { client: { tenantId } },
    include: {
      client: true,
      _count: { select: { pieces: true, assets: true } },
      keyVision: { select: { thumbnailUrl: true, width: true, height: true, bgColor: true } },
    },
    orderBy: { createdAt: "desc" }
  })
  return NextResponse.json(campaigns)
}
