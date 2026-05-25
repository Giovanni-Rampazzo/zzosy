import { NextResponse, NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"
import { maybeSanitizeImage } from "@/lib/svgSanitize"
import { apiErrors } from "@/lib/apiError"
import { getStorage } from "@/lib/storage"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string; assetId: string }> }

export const maxDuration = 30

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any).tenantId

    const { id, assetId } = await ctx.params
    // Verifica que asset pertence ao tenant + matches campaignId (audit P1.4).
    const exists = await prisma.campaignAsset.findFirst({
      where: { id: assetId, campaignId: id, campaign: { client: { tenantId } } },
      select: { id: true },
    })
    if (!exists) return apiErrors.notFound()

    const formData = await req.formData()
    const file = formData.get("image") as File
    if (!file) return NextResponse.json({ error: "Imagem nao enviada" }, { status: 400 })

    let buf: Buffer = Buffer.from(await file.arrayBuffer())
    const ext = (file.name.split(".").pop() || "png").toLowerCase()
    buf = maybeSanitizeImage(buf, ext) as Buffer
    const key = `campaigns/${id}/asset-${randomUUID()}.${ext}`
    const { url: imageUrl } = await getStorage().put(key, buf, file.type || undefined)

    await prisma.campaignAsset.update({
      where: { id: assetId },
      data: { imageUrl }
    })

    return NextResponse.json({ ok: true, imageUrl })
  } catch (err: any) {
    console.error("asset image upload error:", err)
    return NextResponse.json({ error: err?.message ?? "Erro" }, { status: 500 })
  }
}
