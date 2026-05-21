/**
 * GET/PATCH da taxonomia GLOBAL do tenant (segments, categories, filters).
 * 3 listas compartilhadas usadas em toda entidade do ZZOSY (clientes,
 * campanhas, pecas, midias). Persistidas em Tenant.taxonomy Json field.
 */
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { normalizeTaxonomy } from "@/lib/taxonomy"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { taxonomy: true },
  })
  return NextResponse.json(normalizeTaxonomy(tenant?.taxonomy))
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const body = await req.json()
  const next = normalizeTaxonomy(body?.taxonomy ?? body)
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { taxonomy: next as any },
  })
  return NextResponse.json(next)
}
