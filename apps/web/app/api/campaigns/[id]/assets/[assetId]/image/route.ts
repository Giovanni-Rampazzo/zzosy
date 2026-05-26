import { NextResponse, NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"
import { maybeSanitizeImage } from "@/lib/svgSanitize"
import { apiErrors } from "@/lib/apiError"
import { getStorage } from "@/lib/storage"
import { rateLimit, identifierFromRequest } from "@/lib/rateLimit"

// ag-psd e @napi-rs/canvas LAZY: Turbopack dev nao bundla native binding
// (.node). Mesmo padrao do /import-psd-as-so route.
let canvasInitialized = false
function ensureCanvasInit() {
  if (canvasInitialized) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initializeCanvas } = require("ag-psd")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCanvas } = require("@napi-rs/canvas")
  initializeCanvas(createCanvas)
  canvasInitialized = true
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string; assetId: string }> }

export const maxDuration = 60

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any).tenantId
    const userId = (session.user as any).id
    const rl = await rateLimit.upload.check(identifierFromRequest(req, userId))
    if (!rl.ok) return apiErrors.tooManyRequests(rl.retryAfter)

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

    const isPsd = /\.psd$/i.test(file.name) || file.type === "image/vnd.adobe.photoshop"

    if (isPsd) {
      // PSD substitui imagem -> upgrade do asset pra SMART_OBJECT.
      // Cria SmartObjectFile + composite PNG e atualiza asset.type/imageUrl/smartObjectId.
      const psdBytes = Buffer.from(await file.arrayBuffer())
      if (psdBytes.length === 0) return NextResponse.json({ error: "Arquivo vazio" }, { status: 400 })

      ensureCanvasInit()
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readPsd } = require("ag-psd") as typeof import("ag-psd")

      let psd
      try {
        const ab = psdBytes.buffer.slice(psdBytes.byteOffset, psdBytes.byteOffset + psdBytes.byteLength) as ArrayBuffer
        psd = readPsd(ab, {
          skipLayerImageData: true,
          skipThumbnail: true,
          skipCompositeImageData: false,
        })
      } catch (e: any) {
        return NextResponse.json({ error: `Falha ao parsear PSD: ${e?.message ?? "unknown"}` }, { status: 400 })
      }

      const composite = (psd as any).canvas
      if (!composite || typeof composite.toBuffer !== "function") {
        return NextResponse.json({
          error: "PSD sem composite. Abra no Photoshop, ative 'Maximize Compatibility' em Save Options e salve novamente.",
        }, { status: 400 })
      }

      const compositeBuffer: Buffer = composite.toBuffer("image/png")
      const storage = getStorage()
      const guid = randomUUID()

      const compositeKey = `campaigns/${id}/smart/${guid}-composite.png`
      const { url: imageUrl } = await storage.put(compositeKey, compositeBuffer, "image/png")
      const psdKey = `campaigns/${id}/smart/${guid}.psd`
      const { url: psdUrl } = await storage.put(psdKey, psdBytes, "image/vnd.adobe.photoshop")

      const widthPx = (psd as any).width ?? 800
      const heightPx = (psd as any).height ?? 600
      const originalName = file.name || "smart-object.psd"

      const updated = await prisma.$transaction(async (tx) => {
        const so = await tx.smartObjectFile.create({
          data: {
            campaignId: id,
            guid,
            filePath: psdUrl,
            mime: "image/vnd.adobe.photoshop",
            originalName,
            sizeBytes: psdBytes.length,
            width: widthPx,
            height: heightPx,
          },
        })
        return tx.campaignAsset.update({
          where: { id: assetId },
          data: {
            type: "SMART_OBJECT",
            imageUrl,
            smartObjectId: so.id,
            width: widthPx,
          },
        })
      })

      return NextResponse.json({ ok: true, imageUrl, asset: updated, isSmartObject: true })
    }

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
