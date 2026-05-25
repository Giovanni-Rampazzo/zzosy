import { NextResponse, NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"
import { apiErrors } from "@/lib/apiError"
import { getStorage } from "@/lib/storage"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export const maxDuration = 30

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any).tenantId

    const { id } = await ctx.params
    const formData = await req.formData()
    const file = formData.get("thumbnail") as File
    if (!file) return NextResponse.json({ error: "Thumbnail nao enviado" }, { status: 400 })

    // Audit P1.1: scoping de tenant antes de mexer em peca por id raw.
    const piece = await prisma.piece.findFirst({
      where: { id, campaign: { client: { tenantId } } },
    })
    if (!piece) return NextResponse.json({ error: "Peca nao encontrada" }, { status: 404 })

    const buf = Buffer.from(await file.arrayBuffer())
    const mime = file.type || "image/png"
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"
    const key = `campaigns/${piece.campaignId}/pieces/piece-${randomUUID()}.${ext}`
    const { url: imageUrl } = await getStorage().put(key, buf, mime)

    // Schema novo (F5.1): thumbnailUrl e o campo dedicado pra preview. imageUrl
    // segue duplicado por backcompat — UI antiga ainda le imageUrl como preview;
    // remocao desse fallback fica pra refactor proximo.
    await prisma.piece.update({ where: { id }, data: { imageUrl, thumbnailUrl: imageUrl } })
    return NextResponse.json({ ok: true, imageUrl, thumbnailUrl: imageUrl })
  } catch (err: any) {
    console.error("piece thumbnail error:", err)
    return NextResponse.json({ error: err?.message ?? "Erro" }, { status: 500 })
  }
}
