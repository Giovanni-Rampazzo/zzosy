/**
 * POST /api/clients/[id]/library/import-psd-as-so
 *
 * Importa um .psd inteiro como UM unico ClientLibraryAsset type=SMART_OBJECT.
 * Mirror exato de /api/campaigns/[id]/assets/import-psd-as-so mas no nivel
 * LIBRARY (cliente, nao campanha): guarda PSD original em
 * ClientLibrarySmartObjectFile + composite PNG como preview (asset.imageUrl).
 *
 * User pediu (2026-05-29): "faca esse botao de importar tambem importar psd
 * como SO" — antes dava drop de PSD na page do Library e nao acontecia nada
 * (importSmart so cobria image/text/cartridge).
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getStorage } from "@/lib/storage"
import { randomUUID } from "crypto"
import { apiErrors } from "@/lib/apiError"
import { rateLimit, identifierFromRequest } from "@/lib/rateLimit"

// ag-psd + @napi-rs/canvas sao lazy (Turbopack dev nao bundla .node nativos).
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

    const { id: clientId } = await ctx.params
    const client = await prisma.client.findFirst({ where: { id: clientId, tenantId }, select: { id: true } })
    if (!client) return apiErrors.forbidden()

    const formData = await req.formData()
    const psdFile = (formData.get("psd") ?? formData.get("file")) as File | null
    if (!psdFile) return NextResponse.json({ error: "Campo 'psd' (ou 'file') obrigatorio" }, { status: 400 })

    const psdBytes = Buffer.from(await psdFile.arrayBuffer())
    if (psdBytes.length === 0) return NextResponse.json({ error: "Arquivo vazio" }, { status: 400 })
    const originalName = psdFile.name || "smart-object.psd"

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
        error: "PSD sem composite. Abra no Photoshop, ative File > Save Options > 'Maximize Compatibility' e salve novamente.",
      }, { status: 400 })
    }

    const compositeBuffer: Buffer = composite.toBuffer("image/png")

    const storage = getStorage()
    const guid = randomUUID()

    const compositeKey = `clients/${clientId}/library/smart/${guid}-composite.png`
    const { url: compositeUrl } = await storage.put(compositeKey, compositeBuffer, "image/png")

    const psdKey = `clients/${clientId}/library/smart/${guid}.psd`
    const { url: psdUrl } = await storage.put(psdKey, psdBytes, "image/vnd.adobe.photoshop")

    const label = originalName.replace(/\.psd$/i, "") || "Smart Object"
    const widthPx = (psd as any).width ?? 800
    const heightPx = (psd as any).height ?? 600

    const { asset, smartObject } = await prisma.$transaction(async (tx) => {
      const so = await tx.clientLibrarySmartObjectFile.create({
        data: {
          clientId,
          guid,
          filePath: psdUrl,
          mime: "image/vnd.adobe.photoshop",
          originalName,
          sizeBytes: psdBytes.length,
          width: widthPx,
          height: heightPx,
        },
      })
      const a = await tx.clientLibraryAsset.create({
        data: {
          clientId,
          name: label,
          type: "SMART_OBJECT",
          imageUrl: compositeUrl,
          smartObjectId: so.id,
          tags: [],
          meta: {},
          version: 1,
          createdBy: userId,
        },
      })
      return { asset: a, smartObject: so }
    })

    return NextResponse.json({ ok: true, asset, smartObject })
  } catch (e: any) {
    console.error("[library/import-psd-as-so]", e)
    return NextResponse.json({ error: e?.message ?? "Erro desconhecido", stack: process.env.NODE_ENV !== "production" ? e?.stack : undefined }, { status: 500 })
  }
}
