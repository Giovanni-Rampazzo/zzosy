// Server-side thumb render via @napi-rs/canvas (sem Fabric — Fabric/node
// requer canvas package que nao compila em Node 24 do Railway).
//
// Render simplificado mas suficiente pra preview:
//   - BG color sólido
//   - IMAGE layers: loadImage + drawImage com pos/scale/angle
//   - SHAPE layers: parse content.path + fill solid
//   - TEXT layers: SKIP (browser regen completo depois). Coloca placeholder
//     transparente pra preservar layout. Quando browser auto-regen rodar,
//     thumb completo substitui.
//
// Trade-off: thumb server-rendered NAO tem texto. UX: user ve fotos+caixas
// imediato (vs verde puro), texto vem segundos depois via auto-regen client.
// 10x mais rapido que client render hoje.
import { prisma } from "@/lib/prisma"
import { getStorage } from "@/lib/storage"
import { randomUUID } from "crypto"

interface RenderResult {
  pieceId: string
  ok: boolean
  imageUrl?: string
  error?: string
}

// Lazy load napi-canvas — module load eh caro (binding nativo).
let canvasModule: any = null
function getCanvasModule() {
  if (canvasModule) return canvasModule
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  canvasModule = require("@napi-rs/canvas")
  return canvasModule
}

async function loadImageBuffer(buf: Buffer): Promise<any | null> {
  try {
    const { loadImage } = getCanvasModule()
    return await loadImage(buf)
  } catch (e) {
    console.warn("[serverThumbRender] loadImage falhou:", e)
    return null
  }
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    // Storage URL pode ser path interno (/uploads/...) ou full URL. Resolve.
    const storage = getStorage()
    const key = storage.keyFromUrl(url)
    if (key) {
      const buf = await storage.get(key)
      if (buf) return buf
    }
    // Fallback: HTTP fetch
    const r = await fetch(url)
    if (!r.ok) return null
    const ab = await r.arrayBuffer()
    return Buffer.from(ab)
  } catch (e) {
    console.warn("[serverThumbRender] fetch image falhou:", url, e)
    return null
  }
}

export async function renderPieceThumbServer(piece: { id: string; data: string | null; campaignId: string }, assetsMap: Map<string, any>): Promise<RenderResult> {
  try {
    if (!piece.data) return { pieceId: piece.id, ok: false, error: "no data" }
    let pData: any
    try { pData = JSON.parse(piece.data) } catch { return { pieceId: piece.id, ok: false, error: "data malformed" } }
    const W = pData.width ?? 1080
    const H = pData.height ?? 1080
    // Thumb scale: 960px max preservando ratio
    const scale = Math.min(960 / W, 960 / H, 1)
    const thumbW = Math.round(W * scale)
    const thumbH = Math.round(H * scale)

    const { createCanvas } = getCanvasModule()
    const canvas = createCanvas(thumbW, thumbH)
    const ctx = canvas.getContext("2d") as any

    // BG fill (solid + opacity)
    const bgColor = pData.bgColor ?? "#ffffff"
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, thumbW, thumbH)

    const layers: any[] = Array.isArray(pData.layers) ? pData.layers : []
    const sorted = [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

    // Mask handling — suporta raster + vector + clipping (clip to layer below).
    //
    // Estrategia:
    //  - vector: Path2D do svg path → ctx.clip (corta render seguinte)
    //  - raster: offscreen com mask alpha + composite destination-in
    //  - clipping: render layer num offscreen + destination-in com silhueta do
    //    primeiro layer non-clipping ABAIXO (lastBaseAlpha). Multiplos clippers
    //    consecutivos compartilham o mesmo base (Photoshop behavior).
    //
    // 2026-05-27: implementacao do clipping. Antes, clipping era ignorado
    // (thumb mostrava layer sem clip). User reportou "mascaras se perdendo".
    function applyVectorMaskClip(targetCtx: any, mask: any) {
      const vpath = mask?.vector?.path
      if (!vpath) return false
      try {
        const p2d = new (canvasModule.Path2D ?? globalThis.Path2D)(vpath)
        targetCtx.scale(scale, scale)
        targetCtx.clip(p2d)
        targetCtx.scale(1 / scale, 1 / scale)
        return true
      } catch (e) {
        console.warn("[serverThumbRender] vector mask falhou:", e)
        return false
      }
    }

    async function renderImageLayer(targetCtx: any, layer: any, asset: any) {
      const buf = await fetchImageBuffer(asset.imageUrl)
      if (!buf) return
      const img = await loadImageBuffer(buf)
      if (!img) return
      const lScale = (layer.scaleX ?? 1) * scale
      const lScaleY = (layer.scaleY ?? 1) * scale
      const drawW = (img.width ?? 100) * lScale
      const drawH = (img.height ?? 100) * lScaleY
      const drawX = (layer.posX ?? 0) * scale
      const drawY = (layer.posY ?? 0) * scale

      const mask = layer.mask
      const maskEnabled = mask && mask.enabled !== false
      const maskType = maskEnabled ? mask?.type : null

      // RASTER MASK: render em offscreen secundario, aplica mask, blit.
      // (Mesmo dentro de uma renderizacao que ja foi pra offscreen — usamos
      //  um sub-offscreen pra nao contaminar o offscreen do clipping group.)
      if (maskType === "raster" && mask.raster?.dataUrl) {
        try {
          const { createCanvas } = getCanvasModule()
          const off = createCanvas(thumbW, thumbH)
          const octx = off.getContext("2d") as any
          if (typeof layer.rotation === "number" && layer.rotation !== 0) {
            octx.translate(drawX, drawY)
            octx.rotate((layer.rotation * Math.PI) / 180)
            octx.drawImage(img, 0, 0, drawW, drawH)
          } else {
            octx.drawImage(img, drawX, drawY, drawW, drawH)
          }
          const m = mask.raster
          const maskMatch = /^data:([^;]+);base64,(.+)$/.exec(m.dataUrl)
          if (maskMatch) {
            const maskBuf = Buffer.from(maskMatch[2], "base64")
            const maskImg = await loadImageBuffer(maskBuf)
            if (maskImg) {
              const maskX = (m.posX ?? 0) * scale
              const maskY = (m.posY ?? 0) * scale
              const maskW = (m.width ?? 0) * scale
              const maskH = (m.height ?? 0) * scale
              octx.globalCompositeOperation = mask.inverted ? "destination-out" : "destination-in"
              octx.drawImage(maskImg, maskX, maskY, maskW, maskH)
              octx.globalCompositeOperation = "source-over"
            }
          }
          targetCtx.drawImage(off, 0, 0)
          return
        } catch (e) {
          console.warn("[serverThumbRender] raster mask falhou:", e)
        }
      }

      // VECTOR MASK: clip antes de draw
      if (maskType === "vector") {
        const applied = applyVectorMaskClip(targetCtx, mask)
        if (applied) {
          if (typeof layer.rotation === "number" && layer.rotation !== 0) {
            targetCtx.translate(drawX, drawY)
            targetCtx.rotate((layer.rotation * Math.PI) / 180)
            targetCtx.drawImage(img, 0, 0, drawW, drawH)
          } else {
            targetCtx.drawImage(img, drawX, drawY, drawW, drawH)
          }
          return
        }
      }

      // Sem mask (ou clipping — sera tratado fora pelo lastBaseAlpha)
      if (typeof layer.rotation === "number" && layer.rotation !== 0) {
        targetCtx.translate(drawX, drawY)
        targetCtx.rotate((layer.rotation * Math.PI) / 180)
        targetCtx.drawImage(img, 0, 0, drawW, drawH)
      } else {
        targetCtx.drawImage(img, drawX, drawY, drawW, drawH)
      }
    }

    function renderTextLayer(targetCtx: any, layer: any, asset: any) {
      let textContent = layer.overrides?.text ?? ""
      if (!textContent && asset.content) {
        try {
          const spans = typeof asset.content === "string" ? JSON.parse(asset.content) : asset.content
          if (Array.isArray(spans)) textContent = spans.map((s: any) => s.text ?? "").join("")
        } catch {}
      }
      if (!textContent) return
      const ovrd = layer.overrides ?? {}
      let asfontSize = ovrd.fontSize ?? 80
      let asfill = ovrd.fill ?? "#000"
      let astFontFamily = ovrd.fontFamily ?? "Arial"
      let asfontWeight = ovrd.fontWeight ?? "normal"
      if (asset.content) {
        try {
          const spans = typeof asset.content === "string" ? JSON.parse(asset.content) : asset.content
          const def = spans?.[0]?.style ?? {}
          if (!ovrd.fontSize) asfontSize = def.fontSize ?? asfontSize
          if (!ovrd.fill) asfill = def.color ?? asfill
          if (!ovrd.fontFamily) astFontFamily = def.fontFamily ?? astFontFamily
        } catch {}
      }
      const drawX = (layer.posX ?? 0) * scale
      const drawY = (layer.posY ?? 0) * scale
      const lScale = (layer.scaleX ?? 1) * scale
      const fs = (asfontSize as number) * lScale
      const wRaw = layer.width ?? 400
      const maxW = wRaw * lScale
      targetCtx.fillStyle = asfill as string
      targetCtx.font = `${asfontWeight} ${fs}px "${astFontFamily}", Arial, sans-serif`
      targetCtx.textBaseline = "top"
      targetCtx.textAlign = (ovrd.textAlign as any) ?? "left"
      const lines: string[] = []
      for (const sourceLine of String(textContent).split("\n")) {
        const words = sourceLine.split(" ")
        let cur = ""
        for (const w of words) {
          const tryLine = cur ? cur + " " + w : w
          const m = targetCtx.measureText(tryLine)
          if (m.width > maxW && cur) {
            lines.push(cur)
            cur = w
          } else {
            cur = tryLine
          }
        }
        if (cur) lines.push(cur)
      }
      const lineHeight = fs * (ovrd.lineHeight ?? 1.0)
      lines.forEach((line, i) => {
        const x = targetCtx.textAlign === "center" ? drawX + maxW / 2 :
                  targetCtx.textAlign === "right" ? drawX + maxW :
                  drawX
        targetCtx.fillText(line, x, drawY + i * lineHeight)
      })
    }

    function renderShapeLayer(targetCtx: any, layer: any, asset: any) {
      let shape: any = null
      try { shape = typeof asset.content === "string" ? JSON.parse(asset.content) : asset.content } catch {}
      if (!shape?.path) return
      const overrides = layer.overrides ?? {}
      const fill = overrides.fill ?? shape.fill?.color ?? "transparent"
      const lScale = (layer.scaleX ?? 1) * scale
      const lScaleY = (layer.scaleY ?? 1) * scale
      const drawX = (layer.posX ?? 0) * scale
      const drawY = (layer.posY ?? 0) * scale
      targetCtx.translate(drawX, drawY)
      targetCtx.scale(lScale, lScaleY)
      if (shape.pathBbox?.left || shape.pathBbox?.top) {
        targetCtx.translate(-shape.pathBbox.left, -shape.pathBbox.top)
      }
      try {
        const p = new (canvasModule.Path2D ?? globalThis.Path2D)(shape.path)
        if (fill && fill !== "transparent") {
          targetCtx.fillStyle = fill
          targetCtx.fill(p)
        }
        if (shape.stroke?.color && (shape.stroke.width ?? 0) > 0) {
          targetCtx.strokeStyle = shape.stroke.color
          targetCtx.lineWidth = shape.stroke.width
          targetCtx.stroke(p)
        }
      } catch (e) {
        console.warn("[serverThumbRender] Path2D falhou:", e)
      }
    }

    async function renderLayerToCtx(targetCtx: any, layer: any, asset: any) {
      if (asset.type === "IMAGE" && asset.imageUrl) {
        await renderImageLayer(targetCtx, layer, asset)
      } else if (asset.type === "TEXT") {
        renderTextLayer(targetCtx, layer, asset)
      } else if (asset.type === "SHAPE") {
        renderShapeLayer(targetCtx, layer, asset)
      }
    }

    // Pre-pass: identifica layers que participam de clipping group
    // (clipper OU base imediatamente abaixo). So esses precisam offscreen
    // — resto renderiza direto em ctx (perf).
    const needsOffscreen = new Set<number>()
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i]
      if (cur.hidden === true) continue
      const isClipping = cur.mask?.type === "clipping" && cur.mask?.enabled !== false
      if (!isClipping) continue
      needsOffscreen.add(i)
      // Acha base (primeiro non-clipping non-hidden abaixo)
      for (let j = i - 1; j >= 0; j--) {
        const prev = sorted[j]
        if (prev.hidden === true) continue
        const prevClipping = prev.mask?.type === "clipping" && prev.mask?.enabled !== false
        if (!prevClipping) { needsOffscreen.add(j); break }
      }
    }

    // lastBaseAlpha: silhueta do ultimo layer non-clipping renderizado pra
    // offscreen. Usado como destination-in mask pra clippers acima dele.
    let lastBaseAlpha: any = null

    for (let i = 0; i < sorted.length; i++) {
      const layer = sorted[i]
      if (layer.hidden === true) continue
      const asset = assetsMap.get(layer.assetId)
      if (!asset) continue
      const isClipping = layer.mask?.type === "clipping" && layer.mask?.enabled !== false
      const opacity = (typeof layer.opacity === "number" && layer.opacity < 1) ? layer.opacity : 1
      const useOffscreen = needsOffscreen.has(i)

      try {
        if (useOffscreen) {
          const off = createCanvas(thumbW, thumbH)
          const octx = off.getContext("2d") as any
          await renderLayerToCtx(octx, layer, asset)
          if (isClipping && lastBaseAlpha) {
            octx.globalCompositeOperation = "destination-in"
            octx.drawImage(lastBaseAlpha, 0, 0)
            octx.globalCompositeOperation = "source-over"
          }
          ctx.save()
          if (opacity < 1) ctx.globalAlpha = opacity
          ctx.drawImage(off, 0, 0)
          ctx.restore()
          if (!isClipping) lastBaseAlpha = off
        } else {
          ctx.save()
          if (opacity < 1) ctx.globalAlpha = opacity
          await renderLayerToCtx(ctx, layer, asset)
          ctx.restore()
        }
      } catch (e) {
        console.warn("[serverThumbRender] layer falhou:", layer.assetId, e)
      }
    }

    // Upload thumb pro storage
    const buf: Buffer = canvas.toBuffer("image/jpeg", 82)
    const storage = getStorage()
    const key = `campaigns/${piece.campaignId}/server-thumb-${randomUUID()}.jpg`
    const { url } = await storage.put(key, buf, "image/jpeg")
    return { pieceId: piece.id, ok: true, imageUrl: url }
  } catch (e: any) {
    console.error("[serverThumbRender] piece falhou:", piece.id, e)
    return { pieceId: piece.id, ok: false, error: e?.message ?? "Erro" }
  }
}

/** Renderiza thumb do KV (matriz) server-side e salva em keyVision.thumbnailUrl.
 *  Adicionado 2026-05-27: user reportou campanhas sem preview na lista
 *  (cade o preview?). Auto-regen no editor exige user abrir o editor; aqui
 *  geramos batch via endpoint server-render-thumbs. */
export async function renderKvThumbServer(campaignId: string): Promise<{ ok: boolean; imageUrl?: string; error?: string }> {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { keyVision: true, assets: true },
    })
    if (!campaign || !campaign.keyVision) return { ok: false, error: "no kv" }
    const kv = campaign.keyVision
    const layers = Array.isArray((kv as any).layers) ? (kv as any).layers : []
    if (layers.length === 0) return { ok: false, error: "no layers" }
    const pseudoPiece = {
      version: 2,
      width: kv.width ?? 1080,
      height: kv.height ?? 1080,
      bgColor: kv.bgColor ?? "#ffffff",
      layers,
    }
    const assetsMap = new Map<string, any>()
    for (const a of campaign.assets) assetsMap.set(a.id, a)
    // Reusa renderPieceThumbServer com pseudoPiece (data eh string JSON).
    const result = await renderPieceThumbServer({
      id: `kv-${campaignId}`,
      data: JSON.stringify(pseudoPiece),
      campaignId,
    }, assetsMap)
    if (!result.ok || !result.imageUrl) return { ok: false, error: result.error }
    // Salva no KV
    await prisma.keyVision.update({
      where: { campaignId },
      data: { thumbnailUrl: result.imageUrl },
    })
    return { ok: true, imageUrl: result.imageUrl }
  } catch (e: any) {
    console.error("[renderKvThumbServer] erro:", e)
    return { ok: false, error: e?.message ?? "Erro" }
  }
}

/** Renderiza thumbs de TODAS pieces da campanha. Concorrencia limitada
 *  pra nao OOM (cada render aloca canvas + image buffers). */
export async function renderAllPiecesThumbsServer(campaignId: string, concurrency = 4): Promise<{ total: number; ok: number; failed: number; details: RenderResult[]; kv?: { ok: boolean; imageUrl?: string; error?: string } }> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { pieces: true, assets: true, keyVision: true },
  })
  if (!campaign) return { total: 0, ok: 0, failed: 0, details: [] }

  const assetsMap = new Map<string, any>()
  for (const a of campaign.assets) assetsMap.set(a.id, a)

  // Pieces precisam de thumb (sem imageUrl)
  const targets = campaign.pieces.filter(p => !p.imageUrl || p.imageUrl.length === 0)
  // KV thumb tambem precisa? (mesmo se nao tem pieces pendentes)
  const kvMissing = !campaign.keyVision || !(campaign.keyVision as any).thumbnailUrl
  if (targets.length === 0 && !kvMissing) return { total: 0, ok: 0, failed: 0, details: [] }
  if (targets.length === 0 && kvMissing) {
    const kvResult = await renderKvThumbServer(campaignId)
    return { total: 0, ok: 0, failed: 0, details: [], kv: kvResult }
  }

  // Concurrency pool
  const results: RenderResult[] = []
  const queue = [...targets]
  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(concurrency, queue.length); w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const piece = queue.shift()
        if (!piece) break
        const r = await renderPieceThumbServer({ id: piece.id, data: piece.data, campaignId: piece.campaignId }, assetsMap)
        results.push(r)
        if (r.ok && r.imageUrl) {
          try {
            await prisma.piece.update({
              where: { id: piece.id },
              data: { imageUrl: r.imageUrl },
            })
          } catch (e) {
            console.warn("[serverThumbRender] update piece.imageUrl falhou:", piece.id, e)
          }
        }
      }
    })())
  }
  await Promise.all(workers)
  const ok = results.filter(r => r.ok).length

  // Tambem renderiza KV thumb se estiver faltando. User reportou
  // 2026-05-27 'cade o preview?' em campanhas na lista — sem thumb.
  let kvResult: { ok: boolean; imageUrl?: string; error?: string } | undefined
  if (!campaign.keyVision || !(campaign.keyVision as any).thumbnailUrl) {
    kvResult = await renderKvThumbServer(campaignId)
  }

  return { total: targets.length, ok, failed: targets.length - ok, details: results, kv: kvResult }
}
