/**
 * POST /api/campaigns/[id]/assets/import-ai
 *
 * Importa .ai ou .pdf como UM unico CampaignAsset type=SMART_OBJECT.
 * Mirror de /api/clients/[id]/library/import-ai mas no nivel campanha:
 * cria CampaignAsset + SmartObjectFile (nao ClientLibrary*). Mesmo
 * pipeline pdfjs-dist → @napi-rs/canvas → composite PNG.
 *
 * Consistency philosophy: o conceito "Importar AI/PDF como SO" existe
 * no Library; replicar no campaign mantem o app integrado.
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getStorage } from "@/lib/storage"
import { randomUUID } from "crypto"
import { apiErrors } from "@/lib/apiError"
import { rateLimit, identifierFromRequest } from "@/lib/rateLimit"

// pdfjs-dist v3.11 (CommonJS legacy build) — v4 removeu SVGGraphics
// que precisamos pra fase 2. v3 mantem API compativel pro raster.
function loadPdfjs() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("pdfjs-dist/legacy/build/pdf.js") as typeof import("pdfjs-dist/legacy/build/pdf")
}

const TARGET_DPI = 144
const PDF_DEFAULT_DPI = 72

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
    const aiFile = (formData.get("ai") ?? formData.get("file")) as File | null
    if (!aiFile) return NextResponse.json({ error: "Campo 'ai' (ou 'file') obrigatorio" }, { status: 400 })

    const aiBytes = Buffer.from(await aiFile.arrayBuffer())
    if (aiBytes.length === 0) return NextResponse.json({ error: "Arquivo vazio" }, { status: 400 })
    const originalName = aiFile.name || "vector.ai"
    const lowerName = originalName.toLowerCase()
    const isAi = lowerName.endsWith(".ai")
    const isPdf = lowerName.endsWith(".pdf")
    if (!isAi && !isPdf) {
      return NextResponse.json({ error: "Apenas .ai ou .pdf" }, { status: 415 })
    }

    const pdfjs = loadPdfjs()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createCanvas } = require("@napi-rs/canvas") as typeof import("@napi-rs/canvas")

    let pdfDoc
    try {
      const ab = aiBytes.buffer.slice(aiBytes.byteOffset, aiBytes.byteOffset + aiBytes.byteLength) as ArrayBuffer
      pdfDoc = await pdfjs.getDocument({
        data: new Uint8Array(ab),
        disableWorker: true,
        useSystemFonts: true,
        stopAtErrors: false,
      } as any).promise
    } catch (e: any) {
      return NextResponse.json({
        error: `Falha ao parsear arquivo: ${e?.message ?? "unknown"}. Pra .ai antigos (pre-CS), reabrir e re-salvar no Illustrator com 'Create PDF Compatible File' marcado.`,
      }, { status: 400 })
    }

    if (pdfDoc.numPages < 1) {
      return NextResponse.json({ error: "Arquivo nao contem paginas/artboards" }, { status: 400 })
    }

    const page = await pdfDoc.getPage(1)
    const viewportBase = page.getViewport({ scale: 1 })
    const scale = TARGET_DPI / PDF_DEFAULT_DPI
    const viewport = page.getViewport({ scale })

    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctxCanvas = canvas.getContext("2d")

    try {
      await page.render({
        canvasContext: ctxCanvas as any,
        viewport,
        canvasFactory: undefined as any,
      } as any).promise
    } catch (e: any) {
      return NextResponse.json({
        error: `Falha ao renderizar pagina 1: ${e?.message ?? "unknown"}`,
      }, { status: 500 })
    }

    const compositeBuffer: Buffer = canvas.toBuffer("image/png")
    const widthPx = Math.round(viewportBase.width)
    const heightPx = Math.round(viewportBase.height)

    try { await pdfDoc.cleanup() } catch {}
    try { await pdfDoc.destroy() } catch {}

    const storage = getStorage()
    const guid = randomUUID()
    const ext = isAi ? "ai" : "pdf"
    const mime = isAi ? "application/postscript" : "application/pdf"

    const compositeKey = `campaigns/${id}/smart/${guid}-composite.png`
    const { url: compositeUrl } = await storage.put(compositeKey, compositeBuffer, "image/png")

    const originalKey = `campaigns/${id}/smart/${guid}.${ext}`
    const { url: originalUrl } = await storage.put(originalKey, aiBytes, mime)

    const label = originalName.replace(/\.(ai|pdf)$/i, "") || (isAi ? "Illustrator Asset" : "PDF Asset")
    const order = await prisma.campaignAsset.count({ where: { campaignId: id } })

    const { asset, smartObject } = await prisma.$transaction(async (tx) => {
      const so = await tx.smartObjectFile.create({
        data: {
          campaignId: id,
          guid,
          filePath: originalUrl,
          mime,
          originalName,
          sizeBytes: aiBytes.length,
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
    console.error("[campaigns/import-ai]", e)
    return NextResponse.json({ error: e?.message ?? "Erro desconhecido", stack: process.env.NODE_ENV !== "production" ? e?.stack : undefined }, { status: 500 })
  }
}
