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

    // Helper: aplica mask na ctx ANTES de drawImage. ctx ja deve estar
    // em save() — caller faz restore depois. Suporta raster + vector +
    // clipping (clip to layer below).
    //
    // Estrategia:
    //  - vector: Path2D do svg path → ctx.clip (corta render seguinte)
    //  - raster: cria offscreen canvas com mask alpha, depois apos drawImage
    //    do conteudo usa composite "destination-in" pra preservar so onde
    //    mask tem alpha. Mas mask precisa ser aplicada APOS conteudo. Solucao:
    //    desenha conteudo num offscreen canvas, aplica raster mask,
    //    blit offscreen no ctx principal.
    //  - clipping: usa layer.path/bbox do layer ABAIXO. Se nao disponivel,
    //    skip (limitacao). Pra clipping correto seria preciso lookahead
    //    no proximo layer. Por enquanto skip + log.
    async function applyVectorMaskClip(mask: any) {
      const vpath = mask?.vector?.path
      if (!vpath) return false
      try {
        const p2d = new (canvasModule.Path2D ?? globalThis.Path2D)(vpath)
        // Aplica scale do thumb pra clip ficar no espaco do canvas thumb.
        // Vector path eh em coords absolutas do PSD.
        ctx.scale(scale, scale)
        ctx.clip(p2d)
        ctx.scale(1 / scale, 1 / scale)
        return true
      } catch (e) {
        console.warn("[serverThumbRender] vector mask falhou:", e)
        return false
      }
    }

    async function renderImageLayerWithMask(layer: any, asset: any) {
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

      // RASTER MASK: render num offscreen primeiro, aplica mask, blit no ctx.
      if (maskType === "raster" && mask.raster?.dataUrl) {
        try {
          const { createCanvas } = getCanvasModule()
          const off = createCanvas(thumbW, thumbH)
          const octx = off.getContext("2d") as any
          // Draw image no offscreen
          if (typeof layer.rotation === "number" && layer.rotation !== 0) {
            octx.translate(drawX, drawY)
            octx.rotate((layer.rotation * Math.PI) / 180)
            octx.drawImage(img, 0, 0, drawW, drawH)
          } else {
            octx.drawImage(img, drawX, drawY, drawW, drawH)
          }
          // Load raster mask + apply
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
              // destination-in: keep dest pixels onde mask tem alpha
              octx.globalCompositeOperation = mask.inverted ? "destination-out" : "destination-in"
              octx.drawImage(maskImg, maskX, maskY, maskW, maskH)
              octx.globalCompositeOperation = "source-over"
            }
          }
          // Blit offscreen no ctx principal
          ctx.drawImage(off, 0, 0)
          return
        } catch (e) {
          console.warn("[serverThumbRender] raster mask falhou:", e)
          // fallback: draw sem mask
        }
      }

      // VECTOR MASK: clip antes de draw
      if (maskType === "vector") {
        const applied = await applyVectorMaskClip(mask)
        if (applied) {
          if (typeof layer.rotation === "number" && layer.rotation !== 0) {
            ctx.translate(drawX, drawY)
            ctx.rotate((layer.rotation * Math.PI) / 180)
            ctx.drawImage(img, 0, 0, drawW, drawH)
          } else {
            ctx.drawImage(img, drawX, drawY, drawW, drawH)
          }
          return
        }
      }

      // CLIPPING MASK ou sem mask: drawImage normal
      // (Clipping mask = clip to layer below — server-side seria complexo
      //  porque precisa silhouette do layer abaixo. Skip por agora; thumb
      //  vai mostrar layer sem clip. Browser regen aplica certo depois.)
      if (typeof layer.rotation === "number" && layer.rotation !== 0) {
        ctx.translate(drawX, drawY)
        ctx.rotate((layer.rotation * Math.PI) / 180)
        ctx.drawImage(img, 0, 0, drawW, drawH)
      } else {
        ctx.drawImage(img, drawX, drawY, drawW, drawH)
      }
    }

    for (const layer of sorted) {
      if (layer.hidden === true) continue
      const asset = assetsMap.get(layer.assetId)
      if (!asset) continue
      ctx.save()
      try {
        // Aplica opacity da layer
        if (typeof layer.opacity === "number" && layer.opacity < 1) {
          ctx.globalAlpha = layer.opacity
        }
        if (asset.type === "IMAGE" && asset.imageUrl) {
          await renderImageLayerWithMask(layer, asset)
        } else if (asset.type === "TEXT") {
          // TEXT render server-side (basico, sem font custom nem per-char styles).
          // Pega text do asset.content (spans) ou overrides.text.
          let textContent = layer.overrides?.text ?? ""
          if (!textContent && asset.content) {
            try {
              const spans = typeof asset.content === "string" ? JSON.parse(asset.content) : asset.content
              if (Array.isArray(spans)) textContent = spans.map((s: any) => s.text ?? "").join("")
            } catch {}
          }
          if (!textContent) { ctx.restore(); continue }
          const ovrd = layer.overrides ?? {}
          let asfontSize = ovrd.fontSize ?? 80
          let asfill = ovrd.fill ?? "#000"
          let astFontFamily = ovrd.fontFamily ?? "Arial"
          let asfontWeight = ovrd.fontWeight ?? "normal"
          // Asset default style fallback
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
          ctx.fillStyle = asfill as string
          ctx.font = `${asfontWeight} ${fs}px "${astFontFamily}", Arial, sans-serif`
          ctx.textBaseline = "top"
          ctx.textAlign = (ovrd.textAlign as any) ?? "left"
          // Word-wrap simples: split por space, quebra quando excede maxW
          const lines: string[] = []
          for (const sourceLine of String(textContent).split("\n")) {
            const words = sourceLine.split(" ")
            let cur = ""
            for (const w of words) {
              const tryLine = cur ? cur + " " + w : w
              const m = ctx.measureText(tryLine)
              if (m.width > maxW && cur) {
                lines.push(cur)
                cur = w
              } else {
                cur = tryLine
              }
            }
            if (cur) lines.push(cur)
          }
          // Render lines (lineHeight 1.0 default Photoshop)
          const lineHeight = fs * (ovrd.lineHeight ?? 1.0)
          lines.forEach((line, i) => {
            const x = ctx.textAlign === "center" ? drawX + maxW / 2 :
                      ctx.textAlign === "right" ? drawX + maxW :
                      drawX
            ctx.fillText(line, x, drawY + i * lineHeight)
          })
        } else if (asset.type === "SHAPE") {
          // Parse asset.content → { path, fill, stroke, pathBbox }
          let shape: any = null
          try { shape = typeof asset.content === "string" ? JSON.parse(asset.content) : asset.content } catch {}
          if (!shape?.path) { ctx.restore(); continue }
          const overrides = layer.overrides ?? {}
          const fill = overrides.fill ?? shape.fill?.color ?? "transparent"
          const lScale = (layer.scaleX ?? 1) * scale
          const lScaleY = (layer.scaleY ?? 1) * scale
          const drawX = (layer.posX ?? 0) * scale
          const drawY = (layer.posY ?? 0) * scale
          // SVG path via Path2D
          ctx.translate(drawX, drawY)
          ctx.scale(lScale, lScaleY)
          // pathBbox: o path SVG usa coords absolutas do PSD. Trans pra origem.
          if (shape.pathBbox?.left || shape.pathBbox?.top) {
            ctx.translate(-shape.pathBbox.left, -shape.pathBbox.top)
          }
          try {
            const p = new (canvasModule.Path2D ?? globalThis.Path2D)(shape.path)
            if (fill && fill !== "transparent") {
              ctx.fillStyle = fill
              ctx.fill(p)
            }
            if (shape.stroke?.color && (shape.stroke.width ?? 0) > 0) {
              ctx.strokeStyle = shape.stroke.color
              ctx.lineWidth = shape.stroke.width
              ctx.stroke(p)
            }
          } catch (e) {
            // Path2D pode nao aceitar todos SVG paths
            console.warn("[serverThumbRender] Path2D falhou:", e)
          }
        }
        // TEXT: skip — browser auto-regen renderiza depois (texto eh dificil
        // server-side: fonts custom, per-char styles, charSpacing...)
      } catch (e) {
        console.warn("[serverThumbRender] layer falhou:", layer.assetId, e)
      } finally {
        ctx.restore()
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

/** Renderiza thumbs de TODAS pieces da campanha. Concorrencia limitada
 *  pra nao OOM (cada render aloca canvas + image buffers). */
export async function renderAllPiecesThumbsServer(campaignId: string, concurrency = 4): Promise<{ total: number; ok: number; failed: number; details: RenderResult[] }> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { pieces: true, assets: true },
  })
  if (!campaign) return { total: 0, ok: 0, failed: 0, details: [] }

  const assetsMap = new Map<string, any>()
  for (const a of campaign.assets) assetsMap.set(a.id, a)

  // Pieces precisam de thumb (sem imageUrl)
  const targets = campaign.pieces.filter(p => !p.imageUrl || p.imageUrl.length === 0)
  if (targets.length === 0) return { total: 0, ok: 0, failed: 0, details: [] }

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
  return { total: targets.length, ok, failed: targets.length - ok, details: results }
}
