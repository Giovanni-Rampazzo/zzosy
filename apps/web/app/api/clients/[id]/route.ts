import { NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { normalizeTypography } from "@/lib/brandTypography"
import { propagateBrandTypography } from "@/lib/brandTypographyPropagate"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const client = await prisma.client.findFirst({
    where: { id, tenantId },
    include: {
      campaigns: {
        include: {
          _count: { select: { pieces: true } },
          keyVision: { select: { thumbnailUrl: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  })
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(client)
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const client = await prisma.client.findFirst({ where: { id, tenantId } })
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const body = await req.json()
  const data: any = {}
  for (const k of ["name", "contact", "email", "phone", "address", "logoUrl", "brandFont", "brandColors", "brandTypography", "customFontFiles"]) {
    if (k in body) data[k] = body[k]
  }
  // Propagacao automatica de tipografia + fonte da marca pra TODOS os assets,
  // KVs e peças do cliente. Filosofia ZZOSY: o "manual da marca" e a fonte da
  // verdade — mudar la atualiza em tudo que nao foi customizado.
  //   - Mudou brandTypography: atualiza presets (titulo/subtitulo/body/legenda)
  //     em layers com brandPresetKey + ainda no snapshot original.
  //   - Mudou brandFont: atualiza fontFamily em QUALQUER layer/asset cujo
  //     fontFamily === fonte antiga. Cobre tambem PSD imports (sem brandPresetKey).
  // Propagacao roda APOS o response (after() do Next 15+) pra nao bloquear o
  // PATCH. Em clientes com muitos assets/peças, propagar em série dentro do
  // request causa timeout no edge (audit C4). Trade-off: cliente perde o
  // contador de "X assets, Y KVs propagados", mas evita timeout.
  const willChangeTypo = "brandTypography" in body
  const willChangeFont = "brandFont" in body && body.brandFont !== client.brandFont
  const updated = await prisma.client.update({ where: { id }, data })
  if (willChangeTypo || willChangeFont) {
    const oldT = normalizeTypography(client.brandTypography ?? {})
    const newT = normalizeTypography(willChangeTypo ? (body.brandTypography ?? {}) : (client.brandTypography ?? {}))
    const oldFont = client.brandFont ?? null
    const newFont = willChangeFont ? (body.brandFont ?? null) : oldFont
    after(async () => {
      try {
        await propagateBrandTypography(prisma, id, oldT, newT, oldFont, newFont)
      } catch (err) {
        console.warn("[brandTypography propagation] failed:", err)
      }
    })
  }
  return NextResponse.json({ ...updated, _propagation: (willChangeTypo || willChangeFont) ? { queued: true } : null })
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  const tenantId = (session.user as any).tenantId
  const client = await prisma.client.findFirst({ where: { id, tenantId } })
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await prisma.client.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
