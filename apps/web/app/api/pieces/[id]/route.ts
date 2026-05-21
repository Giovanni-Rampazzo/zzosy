import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { appendToTaxonomy } from "@/lib/taxonomy"
import { PIECE_STATUS_LIST } from "@/lib/pieceStatus"

export const dynamic = "force-dynamic"

// Whitelist de campos aceitos em PATCH. Sem isso, qualquer field do schema
// podia ser sobrescrito (incluindo campaignId, createdAt, etc).
const PIECE_PATCH_FIELDS = new Set([
  "name", "segment", "copy", "status", "data", "imageUrl", "mediaFormatId",
])
const PIECE_STATUS_SET = new Set<string>(PIECE_STATUS_LIST as string[])

type Ctx = { params: Promise<{ id: string }> }

// Verifica que a peça (via campaign → client) pertence ao tenant da sessão.
// Retorna a peça ou null. Usado em GET/PATCH/DELETE pra evitar acesso cross-tenant.
async function findPieceForTenant(id: string, tenantId: string) {
  return prisma.piece.findFirst({
    where: { id, campaign: { client: { tenantId } } },
  })
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId
  const { id } = await ctx.params
  const piece = await findPieceForTenant(id, tenantId)
  if (!piece) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(piece)
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId
  const { id } = await ctx.params
  const existing = await findPieceForTenant(id, tenantId)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const body = await req.json()
  // Whitelist: so deixa passar fields conhecidos. Bloqueia tentativa de
  // mexer em campaignId, createdAt, FKs internas via PATCH.
  const data: any = {}
  for (const k of Object.keys(body ?? {})) {
    if (PIECE_PATCH_FIELDS.has(k)) data[k] = body[k]
  }
  // Validar status contra lista permitida.
  if (data.status !== undefined && !PIECE_STATUS_SET.has(String(data.status))) {
    return NextResponse.json({
      error: "Invalid status",
      allowed: Array.from(PIECE_STATUS_SET),
    }, { status: 400 })
  }
  // Status ENTREGUE eh marcador automatico setado em /api/deliveries POST.
  // Bloqueia mudanca manual pra "ENTREGUE" via PATCH; reverter de ENTREGUE
  // pra outro status (ex: REPROVADO depois de cliente recusar) eh permitido.
  if (data.status === "ENTREGUE") {
    return NextResponse.json({
      error: "Status ENTREGUE eh automatico — use /api/deliveries pra entregar",
    }, { status: 400 })
  }
  const piece = await prisma.piece.update({ where: { id }, data })
  // Auto-merge: quando user grava segment numa peca, append na taxonomia GLOBAL
  // do tenant (sem duplicar). Vira fonte unica de verdade pra autocomplete em
  // TODAS as entidades (pecas, campanhas, clientes, midias) + edicao manual.
  if (typeof body?.segment === "string" && body.segment.trim().length > 0) {
    try {
      const camp = await prisma.campaign.findUnique({
        where: { id: piece.campaignId },
        select: { client: { select: { tenantId: true } } },
      })
      const tenantId = camp?.client?.tenantId
      if (tenantId) {
        await appendToTaxonomy(prisma, tenantId, "segments", body.segment)
      }
    } catch (err) {
      console.warn("[piece PATCH] auto-append segment falhou:", err)
    }
  }
  return NextResponse.json(piece)
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId
  const { id } = await ctx.params
  const existing = await findPieceForTenant(id, tenantId)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await prisma.piece.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
