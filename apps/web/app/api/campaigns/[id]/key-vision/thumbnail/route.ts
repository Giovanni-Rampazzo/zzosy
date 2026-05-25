import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"
import { getStorage } from "@/lib/storage"

export const dynamic = "force-dynamic"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { id } = await ctx.params
  // Audit P1.5: scope cross-tenant antes de aceitar upload.
  const ok = await prisma.campaign.findFirst({ where: { id, client: { tenantId } }, select: { id: true } })
  if (!ok) return apiErrors.notFound()

  const formData = await req.formData()
  const file = formData.get("thumbnail") as File | null
  if (!file) return NextResponse.json({ error: "Missing thumbnail" }, { status: 400 })

  const bytes = await file.arrayBuffer()
  const buf = Buffer.from(bytes)

  const mime = file.type || "image/png"
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"
  const key = `campaigns/${id}/kv-thumb-${Date.now()}.${ext}`
  const { url: publicUrl } = await getStorage().put(key, buf, mime)
  // Upsert para criar KV se ainda nao existir (evita 500 silencioso quando matriz nunca foi salva)
  await prisma.keyVision.upsert({
    where: { campaignId: id },
    create: { campaignId: id, thumbnailUrl: publicUrl, data: "{}" },
    update: { thumbnailUrl: publicUrl },
  })
  return NextResponse.json({ thumbnailUrl: publicUrl })
}
