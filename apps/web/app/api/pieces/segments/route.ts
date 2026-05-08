import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

/**
 * GET /api/pieces/segments
 * Retorna lista unica de segmentos ja usados em pecas do tenant.
 * Usada como sugestoes em datalist nos inputs de segmento.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId

  const rows = await prisma.piece.findMany({
    where: {
      campaign: { client: { tenantId } },
      segment: { not: null },
    },
    select: { segment: true },
    distinct: ["segment"],
  })
  const segments = rows
    .map((r: { segment: string | null }) => (r.segment ?? "").trim())
    .filter((s: string) => s.length > 0)
    .sort((a: string, b: string) => a.localeCompare(b, "pt-BR"))
  return NextResponse.json({ segments })
}
