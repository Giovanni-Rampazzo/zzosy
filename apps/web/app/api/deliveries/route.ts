import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"
import { getStorage } from "@/lib/storage"

export const dynamic = "force-dynamic"

export const runtime = "nodejs"
// Upload de ZIP pode ser grande (PPTX + N PNGs + opcionais PSDs).
// 300s = 5min; default 10s era curto demais — user reportou hang em
// "Salvando entrega no servidor..." pra ZIPs ~50MB.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const { searchParams } = new URL(req.url)
  const campaignId = searchParams.get("campaignId")
  const deliveries = await prisma.delivery.findMany({
    where: campaignId ? { campaignId } : undefined,
    include: {
      campaign: { include: { client: true, keyVision: { select: { thumbnailUrl: true } } } },
      deliveredBy: { select: { id: true, name: true, email: true } },
      pieces: { include: { piece: { select: { id: true, name: true, imageUrl: true } } } },
      _count: { select: { pieces: true } },
    },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(deliveries)
}

// POST recebe FormData: zip (File), campaignId, pieceIds (json array), formats (json array)
// Salva o ZIP no servidor + cria registro Delivery + marca peças como ENTREGUE
export async function POST(req: NextRequest) {
  // STAGE TRACKING 2026-05-27: user reportou alert "Entrega salva localmente,
  // mas falhou ao registrar no servidor: ?" — "?" significa que o response
  // nao trazia error/detail. Causa: chamadas SEM try/catch (storage.put,
  // user lookup, pieceIds validation) viravam Next 500 HTML default em vez
  // de JSON. Agora wrappa tudo + retorna stage no body.
  let stage = "auth"
  let stageData: any = {}
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()

    stage = "parse-formdata"
    const fd = await req.formData()
    const zipFile = fd.get("zip") as File | null
    const campaignId = String(fd.get("campaignId") ?? "")
    const pieceIdsRaw = String(fd.get("pieceIds") ?? "[]")
    const formatsRaw = String(fd.get("formats") ?? "[]")
    const name = String(fd.get("name") ?? "") || null
    stageData = { campaignId, zipSize: zipFile?.size, name }

    if (!zipFile || !campaignId) {
      return NextResponse.json({ error: "Missing zip or campaignId", stageData }, { status: 400 })
    }

    let pieceIds: string[] = []
    try { pieceIds = JSON.parse(pieceIdsRaw) } catch {}
    let formats: string[] = []
    try { formats = JSON.parse(formatsRaw) } catch {}
    stageData.pieceCount = pieceIds.length
    stageData.formats = formats

    stage = "validate-campaign"
    const tenantId = (session.user as any)?.tenantId
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, client: tenantId ? { tenantId } : undefined },
      select: { id: true },
    })
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found or not accessible", stageData }, { status: 404 })
    }

    stage = "validate-pieces"
    if (pieceIds.length > 0) {
      const validPieces = await prisma.piece.findMany({
        where: { id: { in: pieceIds }, campaignId },
        select: { id: true },
      })
      const validSet = new Set(validPieces.map(p => p.id))
      const invalid = pieceIds.filter(id => !validSet.has(id))
      if (invalid.length > 0) {
        return NextResponse.json({
          error: "Some pieceIds dont belong to this campaign",
          invalid,
          stageData,
        }, { status: 400 })
      }
    }

    stage = "resolve-user"
    const user = (session.user as any)?.id ? { id: (session.user as any).id } :
      await prisma.user.findUnique({ where: { email: session.user?.email ?? "" } })

    stage = "storage-put"
    const buf = Buffer.from(await zipFile.arrayBuffer())
    const key = `deliveries/${campaignId}/entrega-${Date.now()}.zip`
    const { url: zipUrl } = await getStorage().put(key, buf, "application/zip")
    stageData.zipUrl = zipUrl

    stage = "build-ops"
    const ops: any[] = []
    ops.push(
      prisma.delivery.create({
        data: {
          campaignId,
          name,
          status: "ENVIADA",
          zipUrl,
          zipSize: buf.byteLength,
          deliveredById: user?.id,
          formats: JSON.stringify(formats),
          pieces: {
            create: pieceIds.map(pid => ({ pieceId: pid })),
          },
        },
        include: {
          deliveredBy: { select: { name: true, email: true } },
          _count: { select: { pieces: true } },
        },
      })
    )
    if (pieceIds.length > 0) {
      ops.push(prisma.piece.updateMany({
        where: { id: { in: pieceIds } },
        data: { status: "ENTREGUE" },
      }))
    }

    stage = "transaction"
    const results = await prisma.$transaction(ops)
    return NextResponse.json(results[0])
  } catch (e: any) {
    console.error(`[POST delivery] ERROR stage=${stage}:`, e?.message ?? e, e?.stack?.split("\n").slice(0, 4).join(" | "))
    return NextResponse.json({
      error: e?.message ?? "Erro desconhecido",
      detail: String(e?.message ?? e),
      stage,
      stageData,
      stack: e?.stack?.split("\n").slice(0, 6).join("\n"),
    }, { status: 500 })
  }
}
