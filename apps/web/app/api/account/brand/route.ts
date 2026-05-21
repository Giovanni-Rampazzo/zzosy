import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * White-label do tenant: nome, logos, cor primaria e footer text que
 * substituem os defaults (ZZOSY, SUNO/UNITED CREATORS, amarelo, "Classificacao
 * da informacao: Uso Interno") na TopNav, apresentacao web e PPTX exportado.
 * Qualquer user do tenant pode ler e editar.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId
  if (!tenantId) return NextResponse.json({ error: "No tenant" }, { status: 400 })
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      brandName: true,
      brandLogoUrl: true,
      brandSecondaryLogoUrl: true,
      brandPrimaryColor: true,
      brandFooterText: true,
    },
  })
  return NextResponse.json(t ?? {})
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId
  if (!tenantId) return NextResponse.json({ error: "No tenant" }, { status: 400 })
  const body = await req.json()
  const data: any = {}
  for (const k of ["brandName", "brandLogoUrl", "brandSecondaryLogoUrl", "brandPrimaryColor", "brandFooterText"]) {
    if (k in body) data[k] = body[k] === "" ? null : body[k]
  }
  const t = await prisma.tenant.update({
    where: { id: tenantId },
    data,
    select: {
      brandName: true,
      brandLogoUrl: true,
      brandSecondaryLogoUrl: true,
      brandPrimaryColor: true,
      brandFooterText: true,
    },
  })
  return NextResponse.json(t)
}
