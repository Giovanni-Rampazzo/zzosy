// Importa um .psd inteiro como UM unico CampaignAsset type=SMART_OBJECT.
// Diferente do /import-psd existente (que quebra o PSD em N assets por layer):
// aqui guardamos o PSD inteiro (bytes originais em SmartObjectFile) + o
// composite do PSD como preview PNG (asset.imageUrl). Asset renderiza no
// editor como imagem; edicao da SO (Fase 2) abre mini-editor isolado.
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getStorage } from "@/lib/storage"
import { randomUUID } from "crypto"
import { apiErrors } from "@/lib/apiError"
import { rateLimit, identifierFromRequest } from "@/lib/rateLimit"
// ag-psd e @napi-rs/canvas sao carregados LAZY dentro do handler — Turbopack
// dev nao consegue empacotar o native binding (.node) do napi-rs e da erro
// "Cannot find native binding" no module load. Lazy import via require()
// dinamico contorna o bundler (ja tem serverExternalPackages no next.config
// como cinto-e-suspensorio).
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
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any).tenantId
    const userId = (session.user as any).id
    const rl = await rateLimit.upload.check(identifierFromRequest(req, userId))
    if (!rl.ok) return apiErrors.tooManyRequests(rl.retryAfter)

    const { id } = await ctx.params
    const campaign = await prisma.campaign.findFirst({
      where: { id, client: { tenantId } },
    })
    if (!campaign) return apiErrors.forbidden()

    const formData = await req.formData()
    const psdFile = formData.get("psd") as File | null
    if (!psdFile) return NextResponse.json({ error: "Campo 'psd' obrigatorio" }, { status: 400 })

    const psdBytes = Buffer.from(await psdFile.arrayBuffer())
    if (psdBytes.length === 0) return NextResponse.json({ error: "Arquivo vazio" }, { status: 400 })
    const originalName = psdFile.name || "smart-object.psd"

    ensureCanvasInit()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readPsd } = require("ag-psd") as typeof import("ag-psd")

    let psd
    try {
      // arrayBuffer copy — Buffer.from(...).buffer pode incluir slack do pool
      const ab = psdBytes.buffer.slice(psdBytes.byteOffset, psdBytes.byteOffset + psdBytes.byteLength) as ArrayBuffer
      psd = readPsd(ab, {
        // Composite vem do PSD root (gerado pelo PS com Maximize Compatibility).
        // skipLayerImageData: pula raster dos layers internos — economiza CPU/RAM
        // ja que so usamos o composite final aqui.
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
        error: "PSD sem composite. Abra no Photoshop, ative File > Save Options > 'Maximize Compatibility' e salve novamente.",
      }, { status: 400 })
    }

    const compositeBuffer: Buffer = composite.toBuffer("image/png")

    const storage = getStorage()
    const guid = randomUUID()

    const compositeKey = `campaigns/${id}/smart/${guid}-composite.png`
    const { url: compositeUrl } = await storage.put(compositeKey, compositeBuffer, "image/png")

    const psdKey = `campaigns/${id}/smart/${guid}.psd`
    const { url: _psdUrl } = await storage.put(psdKey, psdBytes, "image/vnd.adobe.photoshop")

    const label = originalName.replace(/\.psd$/i, "") || "Smart Object"
    const widthPx = (psd as any).width ?? 800
    const heightPx = (psd as any).height ?? 600

    const order = await prisma.campaignAsset.count({ where: { campaignId: id } })

    const { asset, smartObject } = await prisma.$transaction(async (tx) => {
      const so = await tx.smartObjectFile.create({
        data: {
          campaignId: id,
          guid,
          filePath: _psdUrl,
          mime: "image/vnd.adobe.photoshop",
          originalName,
          sizeBytes: psdBytes.length,
          width: widthPx,
          height: heightPx,
        },
      })
      const a = await tx.campaignAsset.create({
        data: {
          campaignId: id,
          type: "SMART_OBJECT",
          label,
          imageUrl: compositeUrl,
          smartObjectId: so.id,
          width: widthPx,
          order,
        },
      })
      return { asset: a, smartObject: so }
    })

    return NextResponse.json({ ok: true, asset, smartObject })
  } catch (e: any) {
    console.error("[import-psd-as-so]", e)
    return NextResponse.json({ error: e?.message ?? "Erro desconhecido", stack: process.env.NODE_ENV !== "production" ? e?.stack : undefined }, { status: 500 })
  }
}
