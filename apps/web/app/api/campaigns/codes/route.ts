import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

/**
 * GET /api/campaigns/codes
 * Retorna lista unica de codigos ja usados em campanhas do tenant.
 * Usada como sugestoes em datalist nos inputs de codigo.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId

  const rows = await prisma.campaign.findMany({
    where: { client: { tenantId }, code: { not: null } },
    select: { code: true },
    distinct: ["code"],
  })
  const codes = rows
    .map(r => (r.code ?? "").trim())
    .filter(c => c.length > 0)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
  return NextResponse.json({ codes })
}
