/**
 * POST /api/clients/[id]/library/import-ai
 *
 * Importa um .ai (Adobe Illustrator) — ou .pdf — como UM unico
 * ClientLibraryAsset type=SMART_OBJECT.
 *
 * Por que SMART_OBJECT (e nao IMAGE)? Mirror do flow PSD-as-SO:
 *   - bytes originais ficam guardados em ClientLibrarySmartObjectFile
 *     (futuro: re-render em alta DPI sob demanda, edit do original em Illustrator,
 *      round-trip Illustrator ⟷ ZZOSY)
 *   - composite PNG (asset.imageUrl) eh o que o editor Fabric renderiza
 *
 * Por que pdfjs-dist e nao parser .ai nativo?
 *   - Illustrator 9+ (1999+) salva .ai como PDF-compatible no header
 *     (objeto Adobe PDF wrapping o conteudo nativo PostScript)
 *   - pdfjs-dist le esse wrapper PDF perfeitamente (raster da page 1)
 *   - Parser nativo de .ai exigiria SDK Adobe (paid) ou reverse-engineer
 *     do formato PostScript proprietario — fora de escopo v1
 *
 * Tradeoff aceito v1: import perde editabilidade vetorial (vira raster).
 * User pode mover/redimensionar/transformar no canvas, mas nao editar paths.
 * Pra editar layers, abre o .ai original em Illustrator, re-importa.
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getStorage } from "@/lib/storage"
import { randomUUID } from "crypto"
import { apiErrors } from "@/lib/apiError"
import { rateLimit, identifierFromRequest } from "@/lib/rateLimit"

// pdfjs-dist + @napi-rs/canvas lazy (Turbopack dev nao bundla nativos).
async function loadPdfjs() {
  // legacy build = compatible com Node sem worker thread.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  return pdfjs
}

// DPI alvo do render do composite. 144 = 2x retina (boa fidelidade pro
// preview no Fabric, sem explodir o tamanho do PNG). Se user precisar
// alta-fidelidade no canvas, edita o original e re-importa.
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

    const { id: clientId } = await ctx.params
    const client = await prisma.client.findFirst({ where: { id: clientId, tenantId }, select: { id: true } })
    if (!client) return apiErrors.forbidden()

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

    // .ai modernos sao PDF wrapped. Bytes raw do PDF comecam em "%PDF-"
    // — em .ai isso pode estar offset alguns bytes (header proprio do AI
    // antes), pdfjs aceita normal porque procura signature internamente.
    const pdfjs = await loadPdfjs()

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createCanvas } = require("@napi-rs/canvas") as typeof import("@napi-rs/canvas")

    let pdfDoc
    try {
      const ab = aiBytes.buffer.slice(aiBytes.byteOffset, aiBytes.byteOffset + aiBytes.byteLength) as ArrayBuffer
      // disableWorker: rodamos no Node sem worker; useSystemFonts: deixa pdf.js
      // tentar match em fonts do sistema (mais fidelidade quando .ai usa fontes
      // padrao); stopAtErrors=false pra ser tolerante com .ai exotico.
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

    // Page 1 (= primeiro artboard no .ai).
    const page = await pdfDoc.getPage(1)
    const viewportBase = page.getViewport({ scale: 1 })
    const scale = TARGET_DPI / PDF_DEFAULT_DPI
    const viewport = page.getViewport({ scale })

    // Canvas backing pro pdf.js. @napi-rs/canvas implementa Canvas2D
    // suficientemente compativel.
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

    // Cleanup pdf.js doc handles.
    try { await pdfDoc.cleanup() } catch {}
    try { await pdfDoc.destroy() } catch {}

    const storage = getStorage()
    const guid = randomUUID()
    const ext = isAi ? "ai" : "pdf"
    const mime = isAi ? "application/postscript" : "application/pdf"

    const compositeKey = `clients/${clientId}/library/smart/${guid}-composite.png`
    const { url: compositeUrl } = await storage.put(compositeKey, compositeBuffer, "image/png")

    const originalKey = `clients/${clientId}/library/smart/${guid}.${ext}`
    const { url: originalUrl } = await storage.put(originalKey, aiBytes, mime)

    const label = originalName.replace(/\.(ai|pdf)$/i, "") || (isAi ? "Illustrator Asset" : "PDF Asset")

    const { asset, smartObject } = await prisma.$transaction(async (tx) => {
      const so = await tx.clientLibrarySmartObjectFile.create({
        data: {
          clientId,
          guid,
          filePath: originalUrl,
          mime,
          originalName,
          sizeBytes: aiBytes.length,
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
    console.error("[library/import-ai]", e)
    return NextResponse.json({ error: e?.message ?? "Erro desconhecido", stack: process.env.NODE_ENV !== "production" ? e?.stack : undefined }, { status: 500 })
  }
}
