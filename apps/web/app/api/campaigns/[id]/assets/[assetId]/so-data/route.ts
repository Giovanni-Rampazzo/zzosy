// SO Editor — endpoint pra editar o PSD interno de um asset SMART_OBJECT.
//
// GET: parseia o PSD do SmartObjectFile e retorna estrutura simples
//   { width, height, compositeUrl, textLayers[] } onde textLayers contem
//   path (indice recursivo pra achar o layer no doc), name, text, fontSize,
//   color. UI MVP: edita SO texto-only (move/scale fica pra v2).
//
// PUT: recebe { textEdits: { [pathKey]: newText } }, lê PSD, muta o text de
//   cada layer correspondente, regrava bytes via writer.ts (invalidateText
//   = true pra PS regenerar render correto na proxima abertura), uploads
//   PSD + composite. Composite atualizado vira asset.imageUrl — auto-propaga
//   pras pecas/KV que referenciam esse asset.
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"
import { getStorage } from "@/lib/storage"
import { randomUUID } from "crypto"
import { readPsdDocument } from "@/lib/psd/reader"
import { writePsdDocument } from "@/lib/psd/writer"
import type { PsdDocument, PsdLayer, PsdTextLayer } from "@/lib/psd/types"

// ag-psd/@napi-rs/canvas LAZY — Turbopack dev nao bundla native binding (.node).
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

type Ctx = { params: Promise<{ id: string; assetId: string }> }

interface TextLayerDTO {
  // Path = [groupIdx, ..., layerIdx]. Usado pra achar o layer recursivamente
  // ao salvar (text por path eh mais robusto que id pq PSD nao tem id estavel).
  path: number[]
  name: string
  text: string
  fontSize: number
  color: string
  bbox: { left: number; top: number; right: number; bottom: number }
}

function collectTextLayers(layers: PsdLayer[], prefix: number[], out: TextLayerDTO[]) {
  layers.forEach((l, i) => {
    const path = [...prefix, i]
    if (l.type === "text") {
      out.push({
        path,
        name: l.name,
        text: l.text,
        fontSize: l.defaultStyle.fontSize,
        color: l.defaultStyle.color,
        bbox: { left: l.bbox.left, top: l.bbox.top, right: l.bbox.right, bottom: l.bbox.bottom },
      })
    } else if (l.type === "group") {
      collectTextLayers(l.children, path, out)
    }
  })
}

function findLayerByPath(layers: PsdLayer[], path: number[]): PsdLayer | null {
  let cursor: PsdLayer[] = layers
  let current: PsdLayer | null = null
  for (const idx of path) {
    current = cursor[idx] ?? null
    if (!current) return null
    if (current.type === "group") cursor = current.children
  }
  return current
}

async function loadSoAsset(campaignId: string, assetId: string, tenantId: string) {
  const asset = await prisma.campaignAsset.findFirst({
    where: { id: assetId, campaignId, campaign: { client: { tenantId } } },
    include: { smartObject: true },
  })
  if (!asset) return { error: apiErrors.notFound() }
  if (asset.type !== "SMART_OBJECT" || !asset.smartObject) {
    return { error: NextResponse.json({ error: "Asset nao eh SMART_OBJECT" }, { status: 400 }) }
  }
  return { asset, error: null as null }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any).tenantId

    const { id, assetId } = await ctx.params
    const r = await loadSoAsset(id, assetId, tenantId)
    if (r.error) return r.error
    const { asset } = r

    const storage = getStorage()
    const psdBytes = await storage.get(asset.smartObject!.filePath)
    if (!psdBytes) return NextResponse.json({ error: "PSD nao encontrado no storage" }, { status: 404 })

    ensureCanvasInit()
    const ab = psdBytes.buffer.slice(psdBytes.byteOffset, psdBytes.byteOffset + psdBytes.byteLength) as ArrayBuffer
    const { document } = readPsdDocument(ab, { includeImageData: false, includeComposite: false })

    const textLayers: TextLayerDTO[] = []
    collectTextLayers(document.layers, [], textLayers)

    // ESTRATEGIA NOVA 2026-05-26: server NAO renderiza texto (sem fonts =
    // tudo preto). Em vez disso, compoe SO LAYERS NAO-TEXTO server-side
    // (imagens, shapes, background) e devolve. Cliente renderiza texto via
    // CSS overlay com fontes do browser.
    //
    // Bug: user reportou 3x que preview tava preto. Causa: PSD tem texto
    // baked como render Photoshop, mas ag-psd no Node nao tem text engine
    // — ele entrega canvas all-black no lugar dos textos.
    let backgroundComposite: string | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readPsd } = require("ag-psd") as typeof import("ag-psd")
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createCanvas } = require("@napi-rs/canvas")
      const psdRe = readPsd(ab, {
        skipLayerImageData: false,  // PRECISAMOS dos canvases por layer
        skipThumbnail: true,
        skipCompositeImageData: true,  // skip composite stored (era preto)
      })
      const W = (psdRe as any).width
      const H = (psdRe as any).height
      const canvas = createCanvas(W, H)
      const ctx = canvas.getContext("2d")
      // Background branco default — se houver layer "Background" no PSD, ela
      // sobrescreve. Senao, preview nao fica transparente.
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, W, H)
      let skippedTextLayers = 0
      function walk(layers: any[]) {
        if (!Array.isArray(layers)) return
        for (const layer of layers) {
          if (layer?.hidden) continue
          // Group: recursa nos children
          if (Array.isArray(layer?.children)) { walk(layer.children); continue }
          // Text: skip — vai ser renderizado client-side via CSS overlay
          if (layer?.text != null) { skippedTextLayers++; continue }
          // Raster (image/shape/etc): drawImage no canvas composite
          if (layer?.canvas) {
            try {
              const left = layer.left ?? 0
              const top = layer.top ?? 0
              const opacity = typeof layer.opacity === "number" ? layer.opacity / 255 : 1
              ctx.save()
              ctx.globalAlpha = opacity
              if (typeof layer.blendMode === "string" && layer.blendMode !== "normal") {
                // best-effort blend mode mapping; nao critico
                const blendMap: Record<string, GlobalCompositeOperation> = {
                  multiply: "multiply", screen: "screen", overlay: "overlay",
                  darken: "darken", lighten: "lighten", difference: "difference",
                }
                if (blendMap[layer.blendMode]) ctx.globalCompositeOperation = blendMap[layer.blendMode]
              }
              ctx.drawImage(layer.canvas, left, top)
              ctx.restore()
            } catch (e) {
              console.warn("[so-data GET] drawImage layer falhou:", layer?.name, e)
            }
          }
        }
      }
      walk((psdRe as any).children ?? [])
      const buf: Buffer = canvas.toBuffer("image/png")
      backgroundComposite = `data:image/png;base64,${buf.toString("base64")}`
      console.log("[so-data GET] composite client-side OK:", { W, H, textLayersSkipped: skippedTextLayers })
    } catch (e) {
      console.warn("[so-data GET] compose non-text layers falhou:", e)
    }

    return NextResponse.json({
      width: document.width,
      height: document.height,
      // backgroundComposite = composite SEM texto (texto sera overlay no
      // cliente). Frontend sabe disso e renderiza overlays via bbox+text+style.
      compositeUrl: backgroundComposite ?? asset.imageUrl,
      hasTextOverlay: backgroundComposite != null,
      textLayers,
    })
  } catch (e: any) {
    console.error("[so-data GET]", e)
    return NextResponse.json({ error: e?.message ?? "Erro" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any).tenantId

    const { id, assetId } = await ctx.params
    const r = await loadSoAsset(id, assetId, tenantId)
    if (r.error) return r.error
    const { asset } = r

    const body = await req.json().catch(() => ({}))
    const textEdits: Record<string, string> = body?.textEdits ?? {}
    if (typeof textEdits !== "object" || textEdits === null) {
      return NextResponse.json({ error: "textEdits deve ser objeto { pathKey: newText }" }, { status: 400 })
    }

    const storage = getStorage()
    const psdBytes = await storage.get(asset.smartObject!.filePath)
    if (!psdBytes) return NextResponse.json({ error: "PSD nao encontrado no storage" }, { status: 404 })

    ensureCanvasInit()
    const ab = psdBytes.buffer.slice(psdBytes.byteOffset, psdBytes.byteOffset + psdBytes.byteLength) as ArrayBuffer

    // Captura composite ORIGINAL (pre-edit) via ag-psd direto — usado como
    // fallback se o re-render pos-write retornar preto/null (caso comum quando
    // invalidateTextLayers=true + ag-psd sem text engine completo).
    // Bug reportado 2026-05-26: preview ficava todo preto apos salvar.
    let originalCompositeBuffer: Buffer | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readPsd: readOriginal } = require("ag-psd") as typeof import("ag-psd")
      const origPsd = readOriginal(ab.slice(0), {
        skipLayerImageData: true,
        skipThumbnail: true,
        skipCompositeImageData: false,
      })
      const origCanvas = (origPsd as any).canvas
      if (origCanvas && typeof origCanvas.toBuffer === "function") {
        originalCompositeBuffer = origCanvas.toBuffer("image/png")
      }
    } catch (e) { console.warn("[so-data PUT] captura composite original falhou:", e) }

    const { document } = readPsdDocument(ab, { includeImageData: true, includeComposite: true })

    // Aplica edits — cada chave eh "0.1.2" (path joined por .)
    let changedCount = 0
    for (const [pathKey, newText] of Object.entries(textEdits)) {
      const path = pathKey.split(".").map(s => parseInt(s, 10))
      if (path.some(n => Number.isNaN(n))) continue
      const layer = findLayerByPath(document.layers, path)
      if (!layer || layer.type !== "text") continue
      if (typeof newText !== "string") continue
      const t = layer as PsdTextLayer
      if (t.text === newText) continue
      t.text = newText
      // styleRuns: se o texto encolheu, faz clamp dos runs pra nao exceder length
      const len = newText.length
      t.styleRuns = t.styleRuns
        .map(r => ({ ...r, length: Math.max(0, Math.min(r.length, len - r.start)) }))
        .filter(r => r.start < len && r.length > 0)
      // nameSource='srct' -> PS auto-renomeia layer ao editar texto.
      // Se for 'lyr ', mantem nome manual.
      if ((!t.nameSource || t.nameSource === "srct") && newText.trim()) {
        t.name = newText.split("\n")[0].slice(0, 80)
      }
      changedCount++
    }

    if (changedCount === 0) {
      return NextResponse.json({ ok: true, changed: 0, message: "Nenhuma alteracao" })
    }

    // Regrava PSD via writer.ts. invalidateTextLayers=true sinaliza PS pra
    // redrawn os textos com a fonte real (sem isso PS abre com texto antigo).
    const { bytes: newBytes } = writePsdDocument(document, { invalidateTextLayers: true })
    const newBuf = Buffer.from(newBytes)

    // Re-render composite via ag-psd (le o PSD recem-escrito, extrai canvas).
    // ag-psd renderiza texto se tiver canvas adapter + fonts disponiveis.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readPsd } = require("ag-psd") as typeof import("ag-psd")
    const newAb = newBuf.buffer.slice(newBuf.byteOffset, newBuf.byteOffset + newBuf.byteLength) as ArrayBuffer
    const psdRe = readPsd(newAb, {
      skipLayerImageData: true,
      skipThumbnail: true,
      skipCompositeImageData: false,
    })
    const composite = (psdRe as any).canvas
    let compositeBuffer: Buffer | null = null
    if (composite && typeof composite.toBuffer === "function") {
      compositeBuffer = composite.toBuffer("image/png")
    }

    // Sanity check: composite all-black significa que ag-psd nao conseguiu
    // renderizar (text engine falta). Detecta via probe central — se 99% dos
    // pixels da regiao central tem RGB=0, considera preto e usa o original.
    if (compositeBuffer) {
      try {
        const probe = compositeBuffer
        // PNG header eh 33 bytes; pula ele e checa amostra dos pixels.
        // Sample simples: conta bytes != 0 nas primeiras 4KB pos-header.
        const start = 100
        const end = Math.min(probe.length, start + 4096)
        let nonZero = 0
        for (let i = start; i < end; i++) {
          if (probe[i] !== 0) nonZero++
        }
        const ratio = nonZero / (end - start)
        if (ratio < 0.05 && originalCompositeBuffer) {
          console.warn("[so-data PUT] composite pos-write parece all-black (nonzero ratio:", ratio, "), usando original como fallback")
          compositeBuffer = originalCompositeBuffer
        }
      } catch (e) { console.warn("[so-data PUT] probe composite falhou:", e) }
    } else if (originalCompositeBuffer) {
      // composite null = re-render falhou totalmente. Usa original.
      console.warn("[so-data PUT] composite pos-write retornou null, usando original")
      compositeBuffer = originalCompositeBuffer
    }

    // Captura paths antigos ANTES do update pra apagar do storage depois
    // (sem isso, cada PUT orfanava um par PSD+composite no disco eternamente).
    const oldPsdUrl = asset.smartObject!.filePath
    const oldImageUrl = asset.imageUrl

    // Upload PSD novo
    const guid = randomUUID()
    const psdKey = `campaigns/${id}/smart/${guid}.psd`
    const { url: psdUrl } = await storage.put(psdKey, newBuf, "image/vnd.adobe.photoshop")

    let imageUrl = asset.imageUrl
    if (compositeBuffer) {
      const compositeKey = `campaigns/${id}/smart/${guid}-composite.png`
      const { url: cUrl } = await storage.put(compositeKey, compositeBuffer, "image/png")
      imageUrl = cUrl
    }

    // Atualiza SmartObjectFile + asset.imageUrl numa transacao.
    await prisma.$transaction(async (tx) => {
      await tx.smartObjectFile.update({
        where: { id: asset.smartObject!.id },
        data: { filePath: psdUrl, sizeBytes: newBuf.length },
      })
      await tx.campaignAsset.update({
        where: { id: assetId },
        data: { imageUrl },
      })
    })

    // Best-effort cleanup dos arquivos antigos (post-transaction pra nao
    // apagar antes de confirmar o save). Errors so logam — orfaos eventuais
    // podem ser limpos por job offline depois.
    try {
      const oldPsdKey = storage.keyFromUrl(oldPsdUrl)
      if (oldPsdKey && oldPsdKey !== psdKey) await storage.delete(oldPsdKey)
      if (oldImageUrl && oldImageUrl !== imageUrl) {
        const oldImgKey = storage.keyFromUrl(oldImageUrl)
        if (oldImgKey) await storage.delete(oldImgKey)
      }
    } catch (e) { console.warn("[so-data PUT] cleanup falhou (orfao):", e) }

    return NextResponse.json({ ok: true, changed: changedCount, imageUrl })
  } catch (e: any) {
    console.error("[so-data PUT]", e)
    return NextResponse.json({ error: e?.message ?? "Erro", stack: process.env.NODE_ENV !== "production" ? e?.stack : undefined }, { status: 500 })
  }
}
