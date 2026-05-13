import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId
  const { searchParams } = new URL(req.url)
  const campaignId = searchParams.get("campaignId")
  const pieces = await prisma.piece.findMany({
    where: {
      campaign: { client: { tenantId } },
      ...(campaignId ? { campaignId } : {}),
    },
    include: { campaign: { include: { client: true } } },
    orderBy: { createdAt: "desc" },
  })

  // Carregar mediaFormat dos ids referenciados (se houver)
  const mfIds = Array.from(new Set(pieces.map(p => p.mediaFormatId).filter(Boolean) as string[]))
  const mfMap = new Map<string, any>()
  if (mfIds.length > 0) {
    const mfs = await prisma.mediaFormat.findMany({ where: { id: { in: mfIds } } })
    for (const mf of mfs) mfMap.set(mf.id, mf)
  }

  // Heuristica de fallback: extrair "media" do nome da peça (parte antes de "—" ou "-")
  function inferMediaFromName(name: string | null): string {
    if (!name) return "Outros"
    // "Instagram — Stories" / "Facebook - Feed" / "Instagram_Stories"
    const m = name.match(/^([^—\-_]+)/)
    return m ? m[1].trim() : "Outros"
  }

  const enriched = pieces.map(p => {
    let width = 0, height = 0, format = "", dpi = 72
    let steps: any[] | null = null
    try {
      const d = p.data ? JSON.parse(p.data) : null
      if (d) { width = d.width ?? 0; height = d.height ?? 0; format = d.format ?? ""; dpi = d.dpi ?? 72 }
      // Steps: array de {layers, bgColor, thumbnailUrl?, imageUrl?} no piece.data.
      // Quando >= 2 steps, presentation/export sabem que eh carrossel.
      if (d && Array.isArray(d.steps) && d.steps.length >= 2) {
        steps = d.steps.map((s: any, i: number) => ({
          index: i,
          thumbnailUrl: s.thumbnailUrl ?? null,
          imageUrl: s.imageUrl ?? null,
        }))
      }
    } catch {}

    const mf = p.mediaFormatId ? mfMap.get(p.mediaFormatId) : null
    const media = mf?.vehicle || mf?.media || inferMediaFromName(p.name)
    // Categoria vem do MediaFormat associado. Pecas sem mediaFormat caem em "Sem categoria".
    const mfCategory = mf?.category || "Sem categoria"
    // Unidade original da pe\u00e7a: vem do MediaFormat. Pe\u00e7as sem MF (importadas
    // via PSD por exemplo) caem em px.
    const widthValue = mf?.widthValue ?? width
    const heightValue = mf?.heightValue ?? height
    const widthUnit = mf?.widthUnit ?? "px"
    const heightUnit = mf?.heightUnit ?? "px"

    return { ...p, width, height, format, dpi, media, mediaFormatCategory: mfCategory, widthValue, heightValue, widthUnit, heightUnit, steps }
  })
  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId
  const { campaignId, name, mediaFormatId, data, status } = await req.json()
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, client: { tenantId } } })
  if (!campaign) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const piece = await prisma.piece.create({
    data: {
      campaignId, name, mediaFormatId,
      data: data ? JSON.stringify(data) : null,
      status: status ?? "STANDBY",
    }
  })
  return NextResponse.json(piece)
}
