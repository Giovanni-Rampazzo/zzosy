import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

// Force dynamic: nunca cache Next.js no server. Sem isso, /api/pieces
// retornava response stale e thumbs nao atualizavam mesmo apos save.
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { searchParams } = new URL(req.url)
  const campaignId = searchParams.get("campaignId")
  // ?withData=true opt-in pra incluir piece.data no payload. Default (false)
  // strippa o data pra reduzir payload em 70-80%. Callers que precisam do
  // data (regeneratePieceThumbsForAsset, server-side filter por uso de asset)
  // passam withData=true. Frontend de listagem nao passa — pega lite.
  const withData = searchParams.get("withData") === "true"
  // PERF 2026-05-27: removido `include: { campaign: { include: { client: true } } }`.
  // Cada piece vinha com campaign.client.brandLogoUrl = PNG base64 (55KB).
  // Em 5 pieces = 275KB de duplicacao desnecessaria na resposta. User reportou
  // "sistema muito lento". Frontend ja tem campaign separado via /api/campaigns/[id].
  // O `where` continua scopando por tenant via relation (Prisma traduz pra JOIN
  // sem precisar do include).
  const pieces = await prisma.piece.findMany({
    where: {
      campaign: { client: { tenantId } },
      ...(campaignId ? { campaignId } : {}),
    },
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
    let stepCount = 1
    // Anti-falhas 2026-05-26: detecta pecas vazias (piece.data.layers=[] e
    // sem steps com layers). Front-end mostra banner "X pecas vazias —
    // recuperar agora" pra direcionar user ao recovery.
    let isEmpty = false
    let hasBackup = !!(p as any).dataBackup
    // DIAG 2026-05-27: conta mascaras na peca pra UI mostrar estado visivel
    // antes de exportar. Se maskCount=0 em todas pecas, user sabe que precisa
    // rodar "Re-aplicar mascaras" antes.
    let maskCount = 0
    // Versionador: timestamp da ultima edicao da peca. Quando muda, navegador
    // re-baixa as imagens (sem mais cache stale).
    const v = new Date(p.updatedAt).getTime()
    const stamp = (url: string | null) => url ? `${url}${url.includes("?") ? "&" : "?"}v=${v}` : null
    try {
      const d = p.data ? JSON.parse(p.data) : null
      if (d) { width = d.width ?? 0; height = d.height ?? 0; format = d.format ?? ""; dpi = d.dpi ?? 72 }
      if (d && Array.isArray(d.steps) && d.steps.length >= 2) {
        stepCount = d.steps.length
        steps = d.steps.map((s: any, i: number) => ({
          index: i,
          thumbnailUrl: stamp(s.thumbnailUrl ?? null),
          imageUrl: stamp(s.imageUrl ?? null),
        }))
      }
      // Detecta empty: TRES casos:
      //   1) piece.data eh null/undefined (peca recem-criada nunca salva,
      //      OU corrompida com piece.data=null no DB)
      //   2) piece.data parseado mas com layers=[] e steps tambem vazios
      //   3) parse falhou (catch externo) — improvavel
      // Edge: peca recem-criada legitimamente vazia mostra banner. OK —
      // banner so promove recovery via matriz, nao apaga nada.
      const rootLayers = Array.isArray(d?.layers) ? d.layers.length : 0
      const stepsHaveLayers = Array.isArray(d?.steps) && d.steps.some((s: any) => Array.isArray(s?.layers) && s.layers.length > 0)
      isEmpty = !d || (rootLayers === 0 && !stepsHaveLayers)
      // Conta layers com mask field (raster/vector/clipping). Inclui steps.
      const countMasks = (arr: any[]) => arr.filter(l => l?.mask && l.mask.enabled !== false).length
      if (Array.isArray(d?.layers)) maskCount += countMasks(d.layers)
      if (Array.isArray(d?.steps)) for (const s of d.steps) {
        if (Array.isArray(s?.layers)) maskCount += countMasks(s.layers)
      }
    } catch {
      // Parse falhou — data corrompido = considera empty
      isEmpty = true
    }

    const mf = p.mediaFormatId ? mfMap.get(p.mediaFormatId) : null
    const media = mf?.vehicle || mf?.media || inferMediaFromName(p.name)
    const mfCategory = mf?.category || "Sem categoria"
    const widthValue = mf?.widthValue ?? width
    const heightValue = mf?.heightValue ?? height
    const widthUnit = mf?.widthUnit ?? "px"
    const heightUnit = mf?.heightUnit ?? "px"
    // Segmento herdado do MediaFormat — fallback quando piece.segment vazio.
    // Frontend usa: piece.segment ?? piece.mediaFormatSegment como display default.
    const mediaFormatSegment = mf?.segment ?? null

    // imageUrl da peca tambem versionado
    const stampedImageUrl = stamp(p.imageUrl as any)
    // PERF: strippa p.data do payload por default. O `data` eh o JSON COMPLETO
    // do Fabric canvas (+ fontes base64) — 50KB+ por peca, 1.5MB+ pra 30 pecas.
    // Lista nunca usa p.data direto, so width/height/steps extraidos acima.
    // Quem precisa do data passa ?withData=true ou faz fetch by-id.
    if (!withData) {
      // Strip data + dataBackup do payload lite — sao gigantes, frontend so
      // precisa dos flags (isEmpty, hasBackup).
      const { data: _stripped, dataBackup: _bk, ...pNoData } = p as any
      return { ...pNoData, imageUrl: stampedImageUrl, width, height, format, dpi, media, mediaFormatCategory: mfCategory, mediaFormatSegment, widthValue, heightValue, widthUnit, heightUnit, steps, stepCount, isEmpty, hasBackup, maskCount }
    }
    return { ...p, imageUrl: stampedImageUrl, width, height, format, dpi, media, mediaFormatCategory: mfCategory, mediaFormatSegment, widthValue, heightValue, widthUnit, heightUnit, steps, stepCount, isEmpty, hasBackup, maskCount }
  })
  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { campaignId, name, mediaFormatId, data, status, segment } = await req.json()
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, client: { tenantId } } })
  if (!campaign) return apiErrors.forbidden()
  // Se o caller nao passou segment explicito mas o MediaFormat tem um,
  // copia pro piece.segment na criacao (user pedido 2026-05-26 — peca
  // deve "vir com" o segmento do formato).
  let effectiveSegment: string | null = typeof segment === "string" ? (segment.trim() || null) : null
  if (!effectiveSegment && mediaFormatId) {
    const mf = await prisma.mediaFormat.findUnique({ where: { id: mediaFormatId }, select: { segment: true } })
    if (mf?.segment) effectiveSegment = mf.segment
  }
  const piece = await prisma.piece.create({
    data: {
      campaignId, name, mediaFormatId,
      data: data ? JSON.stringify(data) : null,
      status: status ?? "STANDBY",
      segment: effectiveSegment,
    }
  })
  return NextResponse.json(piece)
}
