import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// Whitelist de fields aceitos no POST. Antes era spread raw — qualquer field
// passava (incluindo FK arbitraria, contadores, IDs internos). Audit P1.9.
const CLIENT_CREATE_FIELDS = new Set([
  "name", "contact", "email", "phone", "address", "brandLogoUrl",
  "brandFont", "brandColors", "brandTypography", "customFontFiles",
])

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
    if (!body?.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name obrigatorio" }, { status: 400 })
    }
    const data: any = { tenantId }
    for (const k of Object.keys(body ?? {})) {
      if (CLIENT_CREATE_FIELDS.has(k)) data[k] = body[k]
    }
    const client = await prisma.client.create({ data })
    return NextResponse.json(client)
  } catch (err: any) {
    console.error("[CLIENT-CREATE] erro:", err?.message, err?.code)
    // Nao retorna e.message (pode leak schema info).
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
