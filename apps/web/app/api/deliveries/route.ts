import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { writeFile, mkdir } from "fs/promises"
import path from "path"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const campaignId = searchParams.get("campaignId")
  const deliveries = await prisma.delivery.findMany({
    where: campaignId ? { campaignId } : undefined,
    include: {
      campaign: { include: { client: true } },
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
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const fd = await req.formData()
  const zipFile = fd.get("zip") as File | null
  const campaignId = String(fd.get("campaignId") ?? "")
  const pieceIdsRaw = String(fd.get("pieceIds") ?? "[]")
  const formatsRaw = String(fd.get("formats") ?? "[]")
  const name = String(fd.get("name") ?? "") || null

  if (!zipFile || !campaignId) {
    return NextResponse.json({ error: "Missing zip or campaignId" }, { status: 400 })
  }

  let pieceIds: string[] = []
  try { pieceIds = JSON.parse(pieceIdsRaw) } catch {}
  let formats: string[] = []
  try { formats = JSON.parse(formatsRaw) } catch {}

  // Resolver user atual
  const user = (session.user as any)?.id ? { id: (session.user as any).id } :
    await prisma.user.findUnique({ where: { email: session.user?.email ?? "" } })

  // Salvar ZIP fisico
  const buf = Buffer.from(await zipFile.arrayBuffer())
  const dir = path.join(process.cwd(), "public", "uploads", "deliveries", campaignId)
  await mkdir(dir, { recursive: true })
  const fname = `entrega-${Date.now()}.zip`
  await writeFile(path.join(dir, fname), buf)
  const zipUrl = `/uploads/deliveries/${campaignId}/${fname}`

  // Transacao: criar Delivery + DeliveryPiece + atualizar status das peças
  const ops: any[] = []
  ops.push(
    prisma.delivery.create({
      data: {
        campaignId,
        name,
        status: "SENT",
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
  // Marcar peças como ENTREGUE
  if (pieceIds.length > 0) {
    ops.push(prisma.piece.updateMany({
      where: { id: { in: pieceIds } },
      data: { status: "ENTREGUE" },
    }))
  }

  try {
    const results = await prisma.$transaction(ops)
    return NextResponse.json(results[0])
  } catch (e: any) {
    console.error("[POST delivery] transaction failed:", e?.message ?? e)
    return NextResponse.json({ error: "Failed to save delivery", detail: String(e?.message ?? e) }, { status: 500 })
  }
}
