import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"

// Whitelist de fields aceitos no POST. Antes era spread raw — qualquer field
// passava (incluindo FK arbitraria, contadores, IDs internos). Audit P1.9.
const CLIENT_CREATE_FIELDS = new Set([
  "name", "contact", "email", "phone", "address", "brandLogoUrl",
  "brandFont", "brandColors", "brandTypography", "customFontFiles",
])

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId

  // Inclui contagem de pieces via aggregation de campaigns. Pieces nao tem
  // FK direta pro Client (estao em Campaign), entao agregamos cliente a
  // cliente. Pra tenants com volume gigante, otimizar com groupBy.
  const clients = await prisma.client.findMany({
    where: { tenantId },
    include: {
      _count: { select: { campaigns: true } },
      campaigns: { select: { _count: { select: { pieces: true } } } },
    },
    orderBy: { createdAt: "desc" },
  })
  const enriched = clients.map(c => {
    const pieces = c.campaigns.reduce((sum: number, cam: any) => sum + (cam._count?.pieces ?? 0), 0)
    const { campaigns, ...rest } = c
    return {
      ...rest,
      _count: { campaigns: c._count.campaigns, pieces },
    }
  })
  return NextResponse.json(enriched)
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
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
