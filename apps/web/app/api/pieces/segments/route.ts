import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"
import { normalizeTaxonomy } from "@/lib/taxonomy"

export const dynamic = "force-dynamic"

/**
 * GET /api/pieces/segments
 * Retorna lista unica de segmentos: source-of-truth = Client.segments
 * (gerenciado em /clients/[id]/edit), com fallback nos segments ja
 * usados em pecas (legacy). User pediu 2026-05-23: segments devem ser
 * default do cliente, sincronizados.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId

  // 1. Segmentos cadastrados na Tenant.taxonomy (source-of-truth — gerenciado
  //    via ClientSettingsCard em /clients/[id]/edit que persiste em
  //    /api/tenant/taxonomy).
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { taxonomy: true },
  })
  const tax = normalizeTaxonomy(tenant?.taxonomy)
  const fromTaxonomy = tax.segments

  // 2. Segmentos usados em pecas (legacy/fallback — peca pode ter segment
  //    nao cadastrado na taxonomia ainda).
  const rows = await prisma.piece.findMany({
    where: {
      campaign: { client: { tenantId } },
      segment: { not: null },
    },
    select: { segment: true },
    distinct: ["segment"],
  })
  const fromPieces = rows
    .map((r: { segment: string | null }) => (r.segment ?? "").trim())
    .filter((s: string) => s.length > 0)

  // Union (Set dedupe), ordenado pt-BR. Taxonomia tem prioridade —
  // segmentos legacy de pieces sao acrescentados pra nao perder nada.
  const segments = Array.from(new Set([...fromTaxonomy, ...fromPieces]))
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
  return NextResponse.json({ segments })
}
