import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId

  const clients = await prisma.client.findMany({
    where: { tenantId },
    include: { _count: { select: { campaigns: true } } },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(clients)
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const tenantId = (session.user as any).tenantId

    // Valida que o tenant existe (sessao velha aponta pra tenant deletado)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!tenant) {
      console.error("[CLIENT-CREATE] tenant da sessao nao existe. tenantId:", tenantId)
      return NextResponse.json({ error: "Sua sessão é inválida. Faça logout e login de novo.", code: "STALE_SESSION" }, { status: 401 })
    }

    const body = await req.json()
    const client = await prisma.client.create({
      data: { ...body, tenantId }
    })
    return NextResponse.json(client)
  } catch (err: any) {
    console.error("[CLIENT-CREATE] erro:", err?.message, err?.code)
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 })
  }
}
