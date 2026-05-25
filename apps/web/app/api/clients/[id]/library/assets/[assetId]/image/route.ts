/**
 * GAM — Library asset image replace (multipart upload).
 *
 * POST /api/clients/[id]/library/assets/[assetId]/image
 *   form-data: image=<File>
 *
 * Atualiza imageUrl + bump version + propaga pra TODAS instances NAO-detached
 * (mesma logica do PUT JSON, mas com upload binario direto sem precisar do user
 * subir pra outro endpoint primeiro e mandar URL).
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"
import { getStorage } from "@/lib/storage"
import { maybeSanitizeImage } from "@/lib/svgSanitize"
import { rateLimit, identifierFromRequest } from "@/lib/rateLimit"
import { randomUUID } from "crypto"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 30

type Ctx = { params: Promise<{ id: string; assetId: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any).tenantId
    const userId = (session.user as any).id
    const rl = await rateLimit.upload.check(identifierFromRequest(req, userId))
    if (!rl.ok) return apiErrors.tooManyRequests(rl.retryAfter)
    const { id: clientId, assetId } = await ctx.params

    const asset = await prisma.clientLibraryAsset.findFirst({
      where: { id: assetId, clientId, client: { tenantId } },
      select: { id: true, type: true },
    })
    if (!asset) return apiErrors.notFound()
    if (asset.type !== "IMAGE") {
      return NextResponse.json(
        { error: `Troca de arquivo so suportada pra IMAGE. Asset eh ${asset.type}.` },
        { status: 400 },
      )
    }

    const formData = await req.formData()
    const file = formData.get("image") as File | null
    if (!file) return NextResponse.json({ error: "Arquivo nao enviado" }, { status: 400 })

    // Cap defensivo (consistente com S2 size guards no codebase).
    const MAX_BYTES = 50 * 1024 * 1024 // 50MB
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `Arquivo > ${Math.round(MAX_BYTES / 1024 / 1024)}MB` }, { status: 413 })
    }

    let buf: Buffer = Buffer.from(await file.arrayBuffer())
    const ext = (file.name.split(".").pop() || "png").toLowerCase()
    buf = maybeSanitizeImage(buf, ext) as Buffer
    const key = `clients/${clientId}/library/images/asset-${randomUUID()}.${ext}`
    const { url: imageUrl } = await getStorage().put(key, buf, file.type || undefined)

    // Bump version + propaga imageUrl pras instancias nao-detached, igual PUT JSON.
    const [updated] = await prisma.$transaction([
      prisma.clientLibraryAsset.update({
        where: { id: assetId },
        data: { imageUrl, version: { increment: 1 } },
      }),
      prisma.campaignAsset.updateMany({
        where: { libraryAssetId: assetId, libraryAssetDetached: false },
        data: { imageUrl },
      }),
    ])

    return NextResponse.json({ ok: true, imageUrl, version: updated.version })
  } catch (err: any) {
    console.error("[library asset image upload]", err)
    return NextResponse.json({ error: err?.message ?? "Erro" }, { status: 500 })
  }
}
