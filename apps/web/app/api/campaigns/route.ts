import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any).tenantId
    const { name, clientId, code } = await req.json()
    // Loga so IDs — userEmail/name eram PII (audit L3).
    console.log("[CAMPAIGN-CREATE] start", { tenantId, clientId })

    if (!name || !clientId) return NextResponse.json({ error: "name e clientId obrigatórios" }, { status: 400 })

    // Valida que o tenant da sessao realmente existe (sessao velha pode apontar pra tenant deletado)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!tenant) {
      console.error("[CAMPAIGN-CREATE] tenant da sessao nao existe mais. tenantId:", tenantId)
      return NextResponse.json({ error: "Sua sessão é inválida. Faça logout e login de novo.", code: "STALE_SESSION" }, { status: 401 })
    }

    const client = await prisma.client.findFirst({ where: { id: clientId, tenantId } })
    if (!client) {
      console.error("[CAMPAIGN-CREATE] cliente nao encontrado", { clientId, tenantId })
      return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 })
    }

    const campaign = await prisma.campaign.create({
      data: { name, clientId, code: (typeof code === "string" && code.trim()) ? code.trim() : null },
      include: { assets: true }
    })
    console.log("[CAMPAIGN-CREATE] sucesso", { id: campaign.id })
    return NextResponse.json(campaign)
  } catch (err: any) {
    console.error("[CAMPAIGN-CREATE] erro nao esperado:", err?.message ?? err, err?.code, err?.meta)
    return NextResponse.json({ error: err?.message ?? "Erro interno", code: err?.code }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
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
