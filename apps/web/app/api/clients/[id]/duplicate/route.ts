import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

/**
 * Duplica uma empresa (Client) — apenas METADATA (nome, contato, cores, fontes).
 * NAO duplica campanhas/peças (cada empresa tem suas proprias). Nome ganha sufixo " (cópia)".
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { id } = await ctx.params

  const original = await prisma.client.findUnique({ where: { id } })
  if (!original || original.tenantId !== tenantId) {
    return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 })
  }

  try {
    const dup = await prisma.client.create({
      data: {
        tenantId,
        name: `${original.name} (cópia)`,
        contact: original.contact,
        email: original.email,
        phone: original.phone,
        address: original.address,
        brandLogoUrl: original.brandLogoUrl,
        brandFont: original.brandFont,
        brandColors: original.brandColors as any,
        brandTypography: original.brandTypography as any,
        customFontFiles: original.customFontFiles as any,
      },
    })
    return NextResponse.json(dup)
  } catch (err: any) {
    console.error("[CLIENT-DUPLICATE] erro:", err?.message, err?.code)
    return NextResponse.json({ error: "Falha ao duplicar", detail: err?.message }, { status: 500 })
  }
}
