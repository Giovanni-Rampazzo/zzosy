"use client"
// Exportacao de pecas: PSD editavel + PNG + JPG + PDF
// Suporta peca v2 (layers + assets) e v1 (canvasData legacy)

import { getPostScriptName } from "@/lib/fonts"

export type ExportFormat = "PSD" | "PNG" | "JPG" | "PDF"

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 100)
}

function safeName(s: string) {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-zA-Z0-9]+/g, "-")                    // tudo que nao for alfanumerico vira '-'
    .replace(/^-+|-+$/g, "")                           // tira '-' nas pontas
    .replace(/-{2,}/g, "-")                            // colapsa multiplos '-'
    .substring(0, 80)
}

function buildFileName(campaignName: string | undefined, piece: { name: string; width: number; height: number }) {
  const camp = campaignName ? safeName(campaignName) : ""
  const midia = safeName(piece.name)
  const dims = `${Math.round(piece.width)}x${Math.round(piece.height)}`
  // Formato: CAMPANHA_MIDIA_DIMENSOESxDIMENSOES (separador entre os 3 campos = '_')
  return [camp, midia, dims].filter(Boolean).join("_")
}

// Inverso do psdBlendToCanvas do PsdImporter: canvas globalCompositeOperation
// → blendMode nativo do PSD (string com espaços). Pra preservar opacidade/blend
// na round-trip ZZOSY → PSD → Photoshop.
function canvasBlendToPsd(bm: string | undefined): string | undefined {
  if (!bm || bm === "source-over") return undefined
  const m: Record<string, string> = {
    "multiply": "multiply", "screen": "screen", "overlay": "overlay",
    "darken": "darken", "lighten": "lighten",
    "color-dodge": "color dodge", "color-burn": "color burn",
    "hard-light": "hard light", "soft-light": "soft light",
    "difference": "difference", "exclusion": "exclusion",
    "hue": "hue", "saturation": "saturation",
    "color": "color", "luminosity": "luminosity",
    "lighter": "linear dodge",
  }
  return m[bm] ?? undefined
}

// Renderiza todos os BG layers (BgLayerData[]) num CanvasRenderingContext2D.
// Suporta solid, gradient linear/radial e image (cover/contain/fill/tile).
// Respeita opacity, blendMode (globalCompositeOperation) e hidden.
// Ignora mask por enquanto (mask só funciona no editor; export degraded).
// Async pq image precisa carregar.
async function renderBgLayersOntoCanvas(
  ctx: CanvasRenderingContext2D, layers: any[], w: number, h: number,
): Promise<void> {
  for (const layer of layers) {
    if (!layer || layer.hidden) continue
    ctx.save()
    ctx.globalAlpha = typeof layer.opacity === "number" ? layer.opacity : 1
    ctx.globalCompositeOperation = (layer.blendMode ?? "source-over") as GlobalCompositeOperation
    try {
      if (layer.kind === "solid") {
        ctx.fillStyle = layer.color ?? "#ffffff"
        ctx.fillRect(0, 0, w, h)
      } else if (layer.kind === "gradient") {
        const angle = typeof layer.angle === "number" ? layer.angle : 90
        const rad = (angle * Math.PI) / 180
        const cx = w / 2, cy = h / 2
        const r = Math.max(w, h) / 2
        const grad = layer.gradientType === "radial"
          ? ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) / 2)
          : ctx.createLinearGradient(cx - Math.cos(rad) * r, cy - Math.sin(rad) * r, cx + Math.cos(rad) * r, cy + Math.sin(rad) * r)
        for (const s of (layer.stops ?? [])) {
          if (typeof s?.offset === "number" && typeof s?.color === "string") grad.addColorStop(s.offset, s.color)
        }
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, w, h)
      } else if (layer.kind === "image" && typeof layer.imageDataUrl === "string" && layer.imageDataUrl) {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new window.Image()
          i.crossOrigin = "anonymous"
          i.onload = () => resolve(i)
          i.onerror = () => reject(new Error("img load"))
          i.src = layer.imageDataUrl
        })
        if (layer.fit === "tile") {
          const pat = ctx.createPattern(img, "repeat")
          if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h) }
        } else if (layer.fit === "fill") {
          ctx.drawImage(img, 0, 0, w, h)
        } else {
          const iw = img.naturalWidth || img.width || 1
          const ih = img.naturalHeight || img.height || 1
          const s = layer.fit === "contain" ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)
          const dw = iw * s, dh = ih * s
          ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
        }
      }
    } catch (e) {
      console.warn("[bg-export] falha renderizando BG layer:", e)
    } finally {
      ctx.restore()
    }
  }
}

// Pega bgLayers do data; se nao existir, migra do bgColor/bgOpacity legacy
// pra um array com 1 BG solid (back-compat).
function bgLayersFromData(data: any): any[] {
  if (Array.isArray(data?.bgLayers) && data.bgLayers.length > 0) return data.bgLayers
  return [{ kind: "solid", color: data?.bgColor ?? "#ffffff", opacity: typeof data?.bgOpacity === "number" ? data.bgOpacity : 1 }]
}

interface Asset {
  id: string; type: string; label: string; value: string | null; imageUrl: string | null; content: any
  smartObject?: {
    id: string
    guid: string
    filePath: string
    mime: string
    originalName: string
    width: number | null
    height: number | null
  } | null
}

// Normaliza um asset vindo da API (CampaignAsset com include smartObject) pro
// formato local Asset usado pelos export pipelines.
function normalizeAsset(a: any): Asset {
  return {
    id: a.id,
    type: a.type,
    label: a.label,
    value: a.value ?? null,
    imageUrl: a.imageUrl ?? null,
    content: a.content ?? null,
    smartObject: a.smartObject ? {
      id: a.smartObject.id,
      guid: a.smartObject.guid,
      filePath: a.smartObject.filePath,
      mime: a.smartObject.mime,
      originalName: a.smartObject.originalName,
      width: a.smartObject.width ?? null,
      height: a.smartObject.height ?? null,
    } : null,
  }
}

function parseContent(raw: any): any[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

// Constroi o canvas Fabric da peca a partir de layers + assets
export async function buildPieceCanvas(piece: any, assets: Asset[]): Promise<any> {
  const fabric = await import("fabric")
  const StaticCanvas = (fabric as any).StaticCanvas
  const Textbox = (fabric as any).Textbox
  const FabricImage = (fabric as any).FabricImage ?? (fabric as any).Image
  const Rect = (fabric as any).Rect
  const Shadow = (fabric as any).Shadow

  const data = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
  const W = data?.width ?? piece.width ?? 1080
  const H = data?.height ?? piece.height ?? 1080
  // BG-7: usa novo schema bgLayers se existir, senao migra do bgColor legacy.
  // StaticCanvas tem backgroundColor apenas pra cor solida; pra gradient/image
  // multilayer, a renderizacao completa do BG eh feita no ctx final ANTES do
  // drawImage(fc) — ver bloco "ctx.fillStyle = bgColor[0]" mais abaixo.
  const bgLayers = bgLayersFromData(data)
  const fallbackBg = bgLayers[0]?.kind === "solid" ? bgLayers[0].color : "#ffffff"

  const el = document.createElement("canvas")
  el.width = W; el.height = H
  const fc = new StaticCanvas(el, { width: W, height: H, enableRetinaScaling: false, backgroundColor: fallbackBg })

  // V2: layers + assets
  if (data?.version === 2 && Array.isArray(data?.layers)) {
    const assetMap = Object.fromEntries(assets.map(a => [a.id, a]))
    const sorted = [...data.layers].sort((a: any, b: any) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

    for (const layer of sorted) {
      const asset = assetMap[layer.assetId]
      if (!asset) continue
      // Layers hidden no PSD não devem renderizar (mas continuam no JSON pra
      // round-trip preservar o estado).
      if (layer.hidden === true) continue
      const overrides = layer.overrides ?? {}
      // PSD opacity/blendMode (capturados no import) → Fabric props.
      // Fabric aceita "opacity" 0..1 e "globalCompositeOperation" (canvas spec).
      // Sanity check: opacity < 0.01 = bug do importer antigo (divisão 2x por 255).
      // Trata como 1 pra render sair visível mesmo em KV/peças não-reimportados.
      const rawOpacity = typeof layer.opacity === "number" ? layer.opacity : 1
      const layerOpacity = (rawOpacity > 0 && rawOpacity < 0.01) ? 1 : rawOpacity
      const layerBlend = typeof layer.blendMode === "string" && layer.blendMode ? layer.blendMode : "source-over"
      const layerEffects = (layer.effects && typeof layer.effects === "object") ? layer.effects : null
      // Fabric v7 exige Shadow INSTANCE — passar plain object faz o render
      // sair em branco silenciosamente.
      const fabricShadow = (() => {
        if (!layerEffects) return undefined
        const d = layerEffects.dropShadow ?? layerEffects.outerGlow
        if (!d) return undefined
        return new Shadow({ color: d.color ?? "rgba(0,0,0,0.5)", offsetX: d.offsetX ?? 0, offsetY: d.offsetY ?? 0, blur: d.blur ?? 5 })
      })()
      const fabricStroke = layerEffects?.stroke ? { stroke: layerEffects.stroke.color, strokeWidth: layerEffects.stroke.width ?? 1 } : null

      if (asset.type === "TEXT") {
        const spans = parseContent(asset.content)
        // overrides.text: se a peca/matriz salvou quebras de linha locais (\n
        // inserido pelo user no editor), usar esse texto em vez do raw do asset.
        // Sem isso, o PSD exportado nao tem as quebras, e texto vem ofuscado.
        const rawAssetText = spans.length ? spans.map((s: any) => s.text).join("") : (asset.value ?? asset.label)
        const fullText: string = (typeof overrides.text === "string" && overrides.text.length > 0)
          ? overrides.text
          : rawAssetText
        const def = spans[0]?.style ?? {}
        // Calcular styles per-char a partir dos spans (usados quando peça NAO tem overrides.styles)
        let assetStyles: any = undefined
        if (spans.length > 1) {
          const stylesMap: Record<number, Record<number, any>> = {}
          let lineNum = 0, col = 0
          const defaultKey = JSON.stringify(def)
          for (const span of spans) {
            const sStyle = span.style ?? {}
            const sKey = JSON.stringify(sStyle)
            for (const ch of (span.text ?? "")) {
              if (ch === "\n") { lineNum++; col = 0; continue }
              if (sKey !== defaultKey) {
                if (!stylesMap[lineNum]) stylesMap[lineNum] = {}
                stylesMap[lineNum][col] = {
                  fill: sStyle.color, fontSize: sStyle.fontSize,
                  fontWeight: sStyle.fontWeight, fontFamily: sStyle.fontFamily,
                }
              }
              col++
            }
          }
          if (Object.keys(stylesMap).length > 0) assetStyles = stylesMap
        }
        const t = new Textbox(fullText, {
          left: layer.posX, top: layer.posY,
          width: Math.max(layer.width ?? 400, 100),
          fontSize: overrides.fontSize ?? def.fontSize ?? 80,
          fontFamily: overrides.fontFamily ?? def.fontFamily ?? "Arial",
          fontWeight: overrides.fontWeight ?? def.fontWeight ?? "normal",
          fill: overrides.fill ?? def.color ?? "#111",
          scaleX: layer.scaleX ?? 1,
          scaleY: layer.scaleY ?? 1,
          angle: layer.rotation ?? 0,
          charSpacing: overrides.charSpacing ?? 0,
          // Default lineHeight 1.0 (1:1 com fontSize) pra bater com o editor.
          // Antes era 1.16 (Fabric default) — gerava entrelinha errada no PSD.
          lineHeight: overrides.lineHeight ?? 1.0,
          textAlign: overrides.textAlign ?? "left",
          opacity: layerOpacity,
          globalCompositeOperation: layerBlend,
          ...(fabricStroke ?? {}),
          ...(fabricShadow ? { shadow: fabricShadow } : {}),
        })
        // leadingPt: fonte da verdade pra entrelinha (Adobe-style). Aplica apos
        // o construtor pra exporter conseguir ler em buildStyleRuns.
        if (overrides.leadingPt !== undefined && overrides.leadingPt !== null) {
          ;(t as any).leadingPt = overrides.leadingPt
          const fs = t.fontSize ?? 48
          ;(t as any).set("lineHeight", overrides.leadingPt / fs)
        }
        // Aplicar styles per-char DEPOIS (Fabric Textbox ignora styles no construtor)
        // Prioridade: overrides.styles (peca) > assetStyles (matriz/asset)
        const finalStyles = overrides.styles ?? assetStyles
        if (finalStyles && Object.keys(finalStyles).length > 0) {
          ;(t as any).set("styles", finalStyles)
          if ((t as any).initDimensions) (t as any).initDimensions()
        }
        ;(t as any).__assetId = asset.id
        ;(t as any).__assetLabel = asset.label
        if (layer.mask) (t as any).__maskData = layer.mask
        if (layerEffects) (t as any).__psdEffects = layerEffects
        fc.add(t)
      } else if (asset.type === "IMAGE") {
        if (asset.imageUrl) {
          try {
            // Mesmo fix do KeyVisionEditor: SVGs sem width/height intrinsecos carregam
            // com naturalWidth=150 (default do user-agent). Injeta dimensoes do viewBox
            // no markup via Blob URL pra Fabric pegar tamanho real.
            const isSvg = /\.svg(\?|$)/i.test(asset.imageUrl)
            let imgSrc = asset.imageUrl
            if (isSvg) {
              try {
                const txt = await fetch(asset.imageUrl).then(r => r.text())
                const widthAttr = txt.match(/<svg[^>]*\swidth\s*=\s*["']([^"']+)["']/i)?.[1]
                const heightAttr = txt.match(/<svg[^>]*\sheight\s*=\s*["']([^"']+)["']/i)?.[1]
                const viewBox = txt.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
                const numFromAttr = (s?: string) => {
                  if (!s) return undefined
                  const n = parseFloat(s)
                  return Number.isFinite(n) && n > 0 ? n : undefined
                }
                let w = numFromAttr(widthAttr)
                let h = numFromAttr(heightAttr)
                if ((!w || !h) && viewBox) {
                  const parts = viewBox.split(/[\s,]+/).map(Number)
                  if (parts.length === 4 && parts.every(Number.isFinite)) {
                    w = w ?? parts[2]
                    h = h ?? parts[3]
                  }
                }
                if (w && h && (!widthAttr || !heightAttr)) {
                  const patched = txt.replace(/<svg\b([^>]*)>/i, (_, attrs) => {
                    let a = attrs
                    if (!/\swidth\s*=/i.test(a)) a += ` width="${w}"`
                    if (!/\sheight\s*=/i.test(a)) a += ` height="${h}"`
                    return `<svg${a}>`
                  })
                  const blob = new Blob([patched], { type: "image/svg+xml" })
                  imgSrc = URL.createObjectURL(blob)
                }
              } catch (e) { console.warn("[SVG-EXPORT] falha lendo dimensoes:", e) }
            }
            const img = await new Promise<any>((resolve, reject) => {
              const ie = new window.Image()
              ie.crossOrigin = "anonymous"
              ie.onload = () => resolve(new FabricImage(ie, {
                left: layer.posX, top: layer.posY,
                scaleX: layer.scaleX ?? 1, scaleY: layer.scaleY ?? 1,
                angle: layer.rotation ?? 0,
                opacity: layerOpacity,
                globalCompositeOperation: layerBlend,
                ...(fabricStroke ?? {}),
                ...(fabricShadow ? { shadow: fabricShadow } : {}),
              }))
              ie.onerror = reject
              ie.src = imgSrc
            })
            ;(img as any).__assetId = asset.id
            ;(img as any).__assetLabel = asset.label
            // Preserva mask do layer pro export PSD reproduzi-la no arquivo.
            if (layer.mask) (img as any).__maskData = layer.mask
            if (layerEffects) (img as any).__psdEffects = layerEffects
            fc.add(img)
          } catch (e) { console.warn("img load fail:", asset.label, e) }
        } else {
          const r = new Rect({
            left: layer.posX, top: layer.posY,
            width: layer.width ?? 400, height: layer.height ?? 300,
            fill: "#d0d0d0", stroke: "#999",
            scaleX: layer.scaleX ?? 1, scaleY: layer.scaleY ?? 1, angle: layer.rotation ?? 0,
          })
          fc.add(r)
        }
      }
    }
    fc.renderAll()
    await new Promise(r => setTimeout(r, 250))
    return fc
  }

  // V1: canvasData legacy
  if (data?.canvasData) {
    await new Promise<void>((resolve) => {
      const r = fc.loadFromJSON(data.canvasData, () => resolve())
      if (r && typeof r.then === "function") r.then(() => resolve())
    })
    await new Promise(r => setTimeout(r, 250))
    fc.renderAll()
    return fc
  }
  return fc
}

async function fetchPieceWithAssets(pieceId: string): Promise<{ piece: any; assets: Asset[] }> {
  // cache: "no-store" eh CRITICO. Sem ele, o navegador serve respostas
  // cacheadas de GETs anteriores. Resultado: o user edita uma peca no editor,
  // exporta — e o export usa a versao VELHA (cache). Bug "exporta layout
  // antigo" mesmo com a peca editada no banco.
  const pres = await fetch(`/api/pieces/${pieceId}`, { cache: "no-store" })
  const piece = await pres.json()
  const cres = await fetch(`/api/campaigns/${piece.campaignId}`, { cache: "no-store" })
  const camp = await cres.json()
  return { piece, assets: Array.isArray(camp.assets) ? camp.assets.map(normalizeAsset) : [] }
}

async function renderToCanvas(pieceLite: { id?: string; name: string; data: any; width: number; height: number; __virtualStepOriginalId?: string }): Promise<{ canvas: HTMLCanvasElement; dpi: number }> {
  // Sempre busca peça + assets do servidor (sync) caso tenha id
  let piece: any = pieceLite
  let assets: Asset[] = []
  if (pieceLite.id) {
    if (pieceLite.id.startsWith("kv-")) {
      const campaignId = pieceLite.id.slice(3)
      const r = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" })
      if (r.ok) {
        const camp = await r.json()
        if (Array.isArray(camp.assets)) {
          assets = camp.assets.map(normalizeAsset)
        }
      }
    } else if (pieceLite.__virtualStepOriginalId) {
      // Peca virtual de step: busca SO os assets da campanha. Mantem o
      // piece.data como veio em pieceLite (com layers do step especifico).
      // Sem isso, o data do banco (com TODOS os steps) sobrescreveria os
      // layers do step e o export sairia errado/vazio.
      const r = await fetch(`/api/pieces/${pieceLite.id}`, { cache: "no-store" })
      if (r.ok) {
        const p = await r.json()
        const cres = await fetch(`/api/campaigns/${p.campaignId}`, { cache: "no-store" })
        if (cres.ok) {
          const camp = await cres.json()
          if (Array.isArray(camp.assets)) assets = camp.assets.map(normalizeAsset)
        }
      }
      // NAO sobrescreve piece — fica como pieceLite (com data do step certo).
    } else {
      const fetched = await fetchPieceWithAssets(pieceLite.id)
      piece = fetched.piece
      assets = fetched.assets
    }
  }
  const fc = await buildPieceCanvas(piece, assets)
  const data = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
  const W = data?.width ?? pieceLite.width
  const H = data?.height ?? pieceLite.height
  // DPI vem do data.dpi (salvo no momento da geracao a partir do MediaFormat).
  // Fallback 72 (tela) se nao definido.
  const dpi = Math.round(Number(data?.dpi)) || 72

  const out = document.createElement("canvas")
  out.width = W; out.height = H
  const ctx = out.getContext("2d", { alpha: false } as any)! as CanvasRenderingContext2D
  // BG-7: renderiza TODOS os BG layers (solid/gradient/image) antes dos
  // asset layers do fc. Fallback automatico pra bgColor legacy se sem bgLayers.
  await renderBgLayersOntoCanvas(ctx, bgLayersFromData(data), W, H)
  ctx.drawImage(fc.getElement() as HTMLCanvasElement, 0, 0)
  fc.dispose()
  return { canvas: out, dpi }
}

/**
 * Injeta um chunk pHYs no PNG com a resolucao em pixels-per-meter.
 * Photoshop e visualizadores leem isso pra mostrar o DPI correto.
 *  Padrao do pHYs: 9 bytes de dados + 4 bytes CRC.
 *  ppX (4 bytes) | ppY (4 bytes) | unit (1 byte, 1 = meter)
 *  ppm = round(dpi / 0.0254) (1 inch = 0.0254 m)
 */
function injectPngDpi(pngBytes: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254)
  // Sinatura PNG (8 bytes) + IHDR (que tem length 13 bytes + type + data + crc).
  // O IHDR comeca em offset 8. Tamanho total IHDR: 4 (length) + 4 (type) + 13 (data) + 4 (crc) = 25 bytes.
  // Quero inserir o pHYs LOGO APOS o IHDR. Offset de insercao = 8 + 25 = 33.
  const insertAt = 33

  // Monta o chunk pHYs:
  //   length (4 bytes BE) = 9
  //   type (4 bytes ASCII) = "pHYs"
  //   data (9 bytes) = ppX(4) + ppY(4) + unit(1)
  //   crc (4 bytes BE) = CRC32 de (type + data)
  const chunkData = new Uint8Array(9)
  const dv = new DataView(chunkData.buffer)
  dv.setUint32(0, ppm, false)
  dv.setUint32(4, ppm, false)
  chunkData[8] = 1 // unit = meter

  const typeAndData = new Uint8Array(4 + 9)
  typeAndData[0] = 0x70 // 'p'
  typeAndData[1] = 0x48 // 'H'
  typeAndData[2] = 0x59 // 'Y'
  typeAndData[3] = 0x73 // 's'
  typeAndData.set(chunkData, 4)

  const crc = crc32(typeAndData)

  const chunk = new Uint8Array(4 + 4 + 9 + 4)
  const cdv = new DataView(chunk.buffer)
  cdv.setUint32(0, 9, false)         // length
  chunk.set(typeAndData, 4)          // type + data
  cdv.setUint32(4 + 4 + 9, crc, false) // crc

  // Cola: [PNG bytes ate insertAt] + [pHYs chunk] + [PNG bytes apos insertAt]
  const out = new Uint8Array(pngBytes.length + chunk.length)
  out.set(pngBytes.subarray(0, insertAt), 0)
  out.set(chunk, insertAt)
  out.set(pngBytes.subarray(insertAt), insertAt + chunk.length)
  return out
}

/** CRC32 (polynomio PNG/zlib). Usado pra chunk pHYs. */
const _crc32Table = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = (_crc32Table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Injeta DPI no header APP0/JFIF do JPG. O Canvas API gera JPG com JFIF
 * default em 72 dpi — vamos sobrescrever pro DPI da peca.
 *
 * Estrutura JPG: SOI(FFD8) + APP0 (FFE0 ... JFIF\0 ... density)
 * O APP0 esta sempre logo apos SOI nos JPGs do Canvas. Tamanho: 18 bytes total.
 * Offset do density unit dentro do APP0:
 *   - 0: marker (FFE0)
 *   - 2: length (2 bytes)
 *   - 4: "JFIF\0" (5 bytes)
 *   - 9: version major (1 byte)
 *   - 10: version minor (1 byte)
 *   - 11: density units (1 byte) - 1=DPI, 2=DPcm
 *   - 12: x density (2 bytes BE)
 *   - 14: y density (2 bytes BE)
 */
function injectJpgDpi(jpgBytes: Uint8Array, dpi: number): Uint8Array {
  const out = new Uint8Array(jpgBytes)
  // Procura APP0 logo apos SOI (offset 2-3 deve ser 0xFFE0)
  if (out[0] !== 0xFF || out[1] !== 0xD8) return out
  if (out[2] !== 0xFF || out[3] !== 0xE0) return out
  // Verifica "JFIF\0" em offset 6-10
  if (out[6] !== 0x4A || out[7] !== 0x46 || out[8] !== 0x49 || out[9] !== 0x46 || out[10] !== 0x00) return out
  out[13] = 1                    // density units = DPI
  out[14] = (dpi >> 8) & 0xff    // x density high
  out[15] = dpi & 0xff           // x density low
  out[16] = (dpi >> 8) & 0xff    // y density high
  out[17] = dpi & 0xff           // y density low
  return out
}

export async function exportPNGBlob(piece: { id?: string; name: string; data: any; width: number; height: number }): Promise<Blob> {
  const { canvas, dpi } = await renderToCanvas(piece)
  const rawBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob PNG falhou")), "image/png")
  })
  // Injeta DPI no chunk pHYs do PNG. Canvas API nao define DPI por padrao.
  const bytes = new Uint8Array(await rawBlob.arrayBuffer())
  const withDpi = injectPngDpi(bytes, dpi)
  return new Blob([withDpi.buffer as ArrayBuffer], { type: "image/png" })
}

export async function exportJPGBlob(piece: { id?: string; name: string; data: any; width: number; height: number }): Promise<Blob> {
  const { canvas, dpi } = await renderToCanvas(piece)
  const rawBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob JPG falhou")), "image/jpeg", 0.92)
  })
  // Sobrescreve density no header JFIF do JPG. Canvas API usa 72 dpi por padrao.
  const bytes = new Uint8Array(await rawBlob.arrayBuffer())
  const withDpi = injectJpgDpi(bytes, dpi)
  return new Blob([withDpi.buffer as ArrayBuffer], { type: "image/jpeg" })
}

export async function exportPDFBlob(piece: { id?: string; name: string; data: any; width: number; height: number }): Promise<Blob> {
  const { canvas: c, dpi } = await renderToCanvas(piece)
  const jpegDataUrl = c.toDataURL("image/jpeg", 0.92)
  const jpegBase64 = jpegDataUrl.split(",")[1]
  const jpegBytes = atob(jpegBase64)
  const jpegBuf = new Uint8Array(jpegBytes.length)
  for (let i = 0; i < jpegBytes.length; i++) jpegBuf[i] = jpegBytes.charCodeAt(i)

  // PDF MediaBox e' em PONTOS (1 inch = 72 pt). Pra que o PDF abra com o
  // tamanho fisico correto, converte W/H (px) pra pt: pt = px * 72 / dpi.
  // Se dpi=300 e img=3000x3000 px, o PDF fica 720x720 pt (= 10 inch = 25.4 cm),
  // que e o tamanho fisico real do desenho.
  const Wpx = c.width, Hpx = c.height
  const Wpt = Math.round((Wpx * 72) / dpi * 1000) / 1000
  const Hpt = Math.round((Hpx * 72) / dpi * 1000) / 1000
  const enc = new TextEncoder()
  const parts: Array<Uint8Array> = []
  const offsets: number[] = []
  let pos = 0
  function push(s: string | Uint8Array) {
    const u = typeof s === "string" ? enc.encode(s) : s
    parts.push(u); pos += u.length
  }
  function startObj(idx: number) { offsets[idx] = pos; push(`${idx} 0 obj\n`) }
  function endObj() { push("\nendobj\n") }

  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
  startObj(1); push("<< /Type /Catalog /Pages 2 0 R >>"); endObj()
  startObj(2); push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"); endObj()
  // MediaBox em PONTOS (1/72 inch). PDF mostra o documento no tamanho fisico
  // correto baseado no dpi da peca. Imagem fica nos pixels originais (Wpx/Hpx),
  // mas escalada pra Wpt/Hpt pontos via matriz 'cm'.
  startObj(3); push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${Wpt} ${Hpt}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>`); endObj()
  startObj(4)
  push(`<< /Type /XObject /Subtype /Image /Width ${Wpx} /Height ${Hpx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBuf.length} >>\nstream\n`)
  push(jpegBuf)
  push("\nendstream")
  endObj()
  // Matriz 'cm' escala a imagem (1x1 unit no espaco do XObject) pra Wpt x Hpt no MediaBox.
  const content = `q\n${Wpt} 0 0 ${Hpt} 0 0 cm\n/Im0 Do\nQ\n`
  startObj(5)
  push(`<< /Length ${content.length} >>\nstream\n${content}endstream`)
  endObj()
  const xrefOffset = pos
  push(`xref\n0 6\n0000000000 65535 f \n`)
  for (let i = 1; i <= 5; i++) push(offsets[i].toString().padStart(10, "0") + " 00000 n \n")
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)

  const total = parts.reduce((a, p) => a + p.length, 0)
  const buf = new Uint8Array(total)
  let off = 0
  for (const p of parts) { buf.set(p, off); off += p.length }
  return new Blob([buf], { type: "application/pdf" })
}

function parseColor(c: string): { r: number; g: number; b: number } {
  if (typeof c !== "string") return { r: 0, g: 0, b: 0 }
  const hex = c.replace("#", "")
  if (hex.length === 6) return { r: parseInt(hex.slice(0,2),16), g: parseInt(hex.slice(2,4),16), b: parseInt(hex.slice(4,6),16) }
  if (hex.length === 3) return { r: parseInt(hex[0]+hex[0],16), g: parseInt(hex[1]+hex[1],16), b: parseInt(hex[2]+hex[2],16) }
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (m) return { r: +m[1], g: +m[2], b: +m[3] }
  return { r: 0, g: 0, b: 0 }
}

// Photoshop espera PostScript name no campo `font.name`, nao display name.
// Sem isso, abrir o PSD reclama "missing font" mesmo com a fonte instalada.
const PS_FONTS: Record<string, { regular: string; bold?: string }> = {
  "Arial":           { regular: "ArialMT",           bold: "Arial-BoldMT" },
  "Arial Black":     { regular: "Arial-Black" },
  "Georgia":         { regular: "Georgia",           bold: "Georgia-Bold" },
  "Times New Roman": { regular: "TimesNewRomanPSMT", bold: "TimesNewRomanPS-BoldMT" },
  "Courier New":     { regular: "CourierNewPSMT",    bold: "CourierNewPS-BoldMT" },
  "Verdana":         { regular: "Verdana",           bold: "Verdana-Bold" },
  "Impact":          { regular: "Impact" },
  "Trebuchet MS":    { regular: "TrebuchetMS",       bold: "TrebuchetMS-Bold" },
  "Palatino":        { regular: "Palatino-Roman",    bold: "Palatino-Bold" },
  "Tahoma":          { regular: "Tahoma",            bold: "Tahoma-Bold" },
  "Helvetica Neue":  { regular: "HelveticaNeue",     bold: "HelveticaNeue-Bold" },
}

function toPSFont(family: string, isBold: boolean): { name: string; fauxBold: boolean } {
  // 1. Tenta buscar postscriptName real via Local Font Access API (carregado quando
  //    a fonte foi aplicada no editor). Funciona pra QUALQUER fonte instalada no
  //    sistema do usuario — Exo 2, Sicredi Sans, etc — sem precisar mapa hardcoded.
  try {
    const ps = getPostScriptName(family)
    if (ps) return { name: ps, fauxBold: false }
  } catch { /* ignore */ }

  // 2. Fallback: mapa de fontes do sistema (Arial, Times etc) — usado quando
  //    Local Font Access nao foi inicializado ou a fonte foi salva apenas com
  //    nome generico ("Arial", "Times New Roman").
  const f = PS_FONTS[family]
  if (!f) return { name: family, fauxBold: isBold }       // fonte desconhecida: passa direto
  if (isBold && f.bold) return { name: f.bold, fauxBold: false }
  if (isBold && !f.bold) return { name: f.regular, fauxBold: true } // sem variante bold: faux
  return { name: f.regular, fauxBold: false }
}

// Converte charSpacing do Fabric (1/1000 em — mesmo valor que letter-spacing CSS em em*1000?)
// pra tracking do Photoshop (1/1000 em). Fabric usa 1/1000 em diretamente:
// charSpacing 1000 = 1em de espaço extra. Photoshop tracking idem. Sem conversão.
function fabricCharSpacingToPsTracking(cs: number | undefined): number {
  if (cs === undefined || cs === null) return 0
  return Math.round(cs)
}

function buildStyleRuns(textbox: any, fullText: string, scale: number = 1): any[] {
  // IMPORTANTE: textbox.styles eh keyed pelo TEXTO CRU (obj.text), nao pelo
  // texto wrappeado pelo Fabric. Mas fullText aqui pode ser wrapped (com \n
  // adicionais inseridos pelo wrap). Iterando fullText com (lineNum, col) leria
  // styles[lineNumWrapped][colWrapped] que nao existem — fallback pro default
  // do textbox e cor/fonte per-char some.
  // Solucao: pra cada char nao-\n do fullText, pegamos o estilo do char
  // CORRESPONDENTE no rawText (mantendo um cursor rawIdx). \n adicionais do
  // wrap simplesmente repetem o estilo anterior (nao avancam rawIdx).
  const rawText: string = textbox.text ?? ""
  const styles = textbox.styles ?? {}

  function styleAtRawIndex(globalIdx: number): any {
    let line = 0, col = 0
    for (let i = 0; i < globalIdx && i < rawText.length; i++) {
      if (rawText[i] === "\n") { line++; col = 0 } else col++
    }
    return styles[line]?.[col] ?? null
  }

  const runs: any[] = []
  let prevStyleKey = ""
  let runStyle: any = null
  let runLength = 0
  let rawIdx = 0

  for (let i = 0; i < fullText.length; i++) {
    const ch = fullText[i]
    let cs: any = null
    if (ch !== "\n") {
      // Char comum: avanca rawIdx e usa estilo do char correspondente
      cs = styleAtRawIndex(rawIdx)
      rawIdx++
    } else if (rawText[rawIdx] === "\n") {
      // \n real do rawText: avanca e usa estilo do \n
      cs = styleAtRawIndex(rawIdx)
      rawIdx++
    } else {
      // \n adicional inserido pelo auto-wrap do Fabric. Esse \n SUBSTITUI um
      // espaco no rawText (Fabric quebra entre palavras). Pra manter sincronia,
      // consumimos o espaco correspondente do rawText e usamos o estilo dele.
      // Se rawText[rawIdx] nao for um espaco (raro), so mantem estilo anterior.
      if (rawText[rawIdx] === " ") {
        cs = styleAtRawIndex(rawIdx)
        rawIdx++
      }
    }
    // Se cs ainda eh null (= \n adicional do wrap), mantem estilo anterior.
    const fill = cs?.fill ?? textbox.fill ?? "#000000"
    const fontSize = (cs?.fontSize ?? textbox.fontSize ?? 48) * scale
    const fontFamily = cs?.fontFamily ?? textbox.fontFamily ?? "Arial"
    const fontWeight = cs?.fontWeight ?? textbox.fontWeight ?? "normal"
    const styleKey = `${fill}|${fontSize}|${fontFamily}|${fontWeight}`
    if (styleKey !== prevStyleKey) {
      if (runLength > 0 && runStyle) runs.push({ length: runLength, style: runStyle })
      const isBold = (fontWeight === "bold" || fontWeight === 700)
      const ps = toPSFont(fontFamily, isBold)
      // Leading em px: usa leadingPt explicito da peca/matriz se setado,
      // senao deriva de lineHeight*fontSize. Sem isso, Photoshop usa leading
      // default da fonte (que pode ser muito diferente do que o user ve).
      const objLeadingPt = (textbox as any).leadingPt
      const lineH = textbox.lineHeight ?? 1.0
      const leading = Math.round(
        (objLeadingPt !== undefined && objLeadingPt !== null)
          ? objLeadingPt * scale
          : fontSize * lineH
      )
      const tracking = fabricCharSpacingToPsTracking(textbox.charSpacing)
      runStyle = {
        font: { name: ps.name },
        fontSize: Math.round(fontSize),
        fillColor: parseColor(fill),
        fauxBold: ps.fauxBold,
        autoLeading: false,
        leading,
        tracking,
        autoKerning: true,
      }
      prevStyleKey = styleKey
      runLength = 1
    } else {
      runLength++
    }
  }
  if (runLength > 0 && runStyle) runs.push({ length: runLength, style: runStyle })
  return runs
}

export async function exportPSDBlob(pieceLite: { id?: string; name: string; data: any; width: number; height: number; __virtualStepOriginalId?: string }): Promise<Blob> {
  let piece: any = pieceLite
  let assets: Asset[] = []
  if (pieceLite.id) {
    // Pseudo-piece "kv-{campaignId}" eh exportacao do Key Vision direto do editor
    // (nao corresponde a uma piece no banco). Busca apenas os assets da campanha.
    if (pieceLite.id.startsWith("kv-")) {
      const campaignId = pieceLite.id.slice(3)
      const r = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" })
      if (r.ok) {
        const camp = await r.json()
        if (Array.isArray(camp.assets)) {
          assets = camp.assets.map(normalizeAsset)
        }
      }
      // piece ja eh o pieceLite com data preenchido (vem do editor)
    } else if (pieceLite.__virtualStepOriginalId) {
      // Peca virtual de step: busca SO os assets. Mantem data como veio.
      const r = await fetch(`/api/pieces/${pieceLite.id}`, { cache: "no-store" })
      if (r.ok) {
        const p = await r.json()
        const cres = await fetch(`/api/campaigns/${p.campaignId}`, { cache: "no-store" })
        if (cres.ok) {
          const camp = await cres.json()
          if (Array.isArray(camp.assets)) assets = camp.assets.map(normalizeAsset)
        }
      }
    } else {
      const fetched = await fetchPieceWithAssets(pieceLite.id)
      piece = fetched.piece
      assets = fetched.assets
    }
  }
  const fc = await buildPieceCanvas(piece, assets)
  const data = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
  const W = data?.width ?? pieceLite.width
  const H = data?.height ?? pieceLite.height
  // DPI da peca (salvo no momento da geracao a partir do MediaFormat). Default 72.
  const dpi = Math.round(Number(data?.dpi)) || 72

  const objects = fc.getObjects()
  const agpsd = await import("ag-psd") as any

  const psdLayers: any[] = []

  // === SMART OBJECT INFRA ===
  // Mapa pra lookup rapido do asset original pelo __assetId do Fabric object
  const assetById = new Map<string, Asset>()
  for (const a of assets) assetById.set(a.id, a)

  // linkedFiles vai pro psd.linkedFiles. Cada SVG embeddado aparece aqui uma vez (cache por assetId)
  // pra que o mesmo SVG usado em multiplas pecas/layers nao duplique conteudo.
  const linkedFiles: any[] = []
  const linkedByAssetId = new Map<string, string>() // assetId -> linkedFile.id (GUID)

  // GUID v4 simples (suficiente pro PSD; nao precisa ser cripto-forte)
  function makeGuid(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0
      const v = c === "x" ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  // Embedda um arquivo "linkado" (Smart Object) no PSD, retornando GUID + dimensoes.
  // Prioridades:
  // 1. Se o asset tem smartObject (preservado de um import), usa os bytes ORIGINAIS
  //    e o GUID ORIGINAL — round-trip sem perda. Photoshop reconhece como o mesmo SO.
  // 2. Se nao tem mas tem imageUrl com .svg, baixa o SVG do servidor e cria SO novo
  //    com GUID v4 gerado.
  // 3. Caso contrario retorna null (asset rasteriza normal, sem virar SO).
  const linkedDimsByAssetId = new Map<string, { w: number; h: number }>()
  async function ensureLinkedSmartObject(asset: Asset): Promise<{ guid: string; w: number; h: number } | null> {
    const cached = linkedByAssetId.get(asset.id)
    if (cached) {
      const dims = linkedDimsByAssetId.get(asset.id)
      if (dims) return { guid: cached, w: dims.w, h: dims.h }
    }

    // CAMINHO 1: smart object preservado de import — usa bytes originais
    if (asset.smartObject) {
      try {
        const so = asset.smartObject
        const res = await fetch(so.filePath)
        if (!res.ok) throw new Error(`fetch smart object falhou: ${res.status}`)
        const bytes = new Uint8Array(await res.arrayBuffer())
        // Dimensoes: prioridade ao que foi salvo no DB; senao tenta extrair de SVG
        let w = so.width ?? 0
        let h = so.height ?? 0
        if ((!w || !h) && so.mime === "image/svg+xml") {
          try {
            const txt = new TextDecoder().decode(bytes)
            const vb = txt.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
            if (vb) {
              const parts = vb.split(/[\s,]+/).map(Number)
              if (parts.length === 4 && parts.every(Number.isFinite)) {
                w = w || parts[2]; h = h || parts[3]
              }
            }
          } catch { /* ignora */ }
        }
        if (!w || !h) { w = 512; h = 512 } // fallback safe
        linkedFiles.push({
          id: so.guid, // GUID ORIGINAL — preserva identidade do SO
          name: so.originalName,
          data: bytes,
        })
        linkedByAssetId.set(asset.id, so.guid)
        linkedDimsByAssetId.set(asset.id, { w, h })
        console.log("[PSD-SMART:preserved]", { asset: asset.label, guid: so.guid, mime: so.mime, w, h })
        return { guid: so.guid, w, h }
      } catch (e) {
        console.warn("[PSD] falha lendo smart object preservado, caira no fallback SVG:", asset.id, e)
        // cai no caminho 2 abaixo
      }
    }

    // CAMINHO 2: SVG comum via imageUrl
    if (!asset.imageUrl) return null
    if (!/\.svg(\?|$)/i.test(asset.imageUrl)) return null
    try {
      const res = await fetch(asset.imageUrl)
      if (!res.ok) return null
      const svgText = await res.text()
      let w = 0, h = 0
      const viewBox = svgText.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
      if (viewBox) {
        const parts = viewBox.split(/[\s,]+/).map(Number)
        if (parts.length === 4 && parts.every(Number.isFinite)) {
          w = parts[2]; h = parts[3]
        }
      }
      if (!w || !h) {
        const wAttr = parseFloat(svgText.match(/<svg[^>]*\swidth\s*=\s*["']([^"']+)["']/i)?.[1] ?? "")
        const hAttr = parseFloat(svgText.match(/<svg[^>]*\sheight\s*=\s*["']([^"']+)["']/i)?.[1] ?? "")
        if (Number.isFinite(wAttr) && wAttr > 0) w = wAttr
        if (Number.isFinite(hAttr) && hAttr > 0) h = hAttr
      }
      if (!w || !h) {
        console.warn("[PSD] SVG sem dimensoes detectaveis, fallback 512x512:", asset.id)
        w = 512; h = 512
      }
      const svgBytes = new TextEncoder().encode(svgText)
      const guid = makeGuid()
      const fname = `${(asset.label || "asset").replace(/[^\w.-]+/g, "_")}.svg`
      linkedFiles.push({ id: guid, name: fname, data: svgBytes })
      linkedByAssetId.set(asset.id, guid)
      linkedDimsByAssetId.set(asset.id, { w, h })
      return { guid, w, h }
    } catch (e) {
      console.warn("[PSD] falha embeddando SVG do asset:", asset.id, e)
      return null
    }
  }

  // BACKGROUND: cada bgLayer vira uma LAYER NATIVA do Photoshop em vez de
  // ser rasterizado num canvas único.
  //  - kind "solid"   → Solid Color Fill Layer (vectorFill type="color")
  //                     editavel no PS: duplo clique no thumb troca a cor.
  //  - kind "gradient"→ Gradient Fill Layer (vectorFill type="solid" com
  //                     colorStops) editavel no PS.
  //  - kind "image"   → fallback raster (Pattern Fill ainda nao mapeado).
  // Ordem: BG[0] no fundo → primeiro pushed; assets vem em seguida no topo.
  // Convencao ag-psd writer: ordem do push() = ordem visual (primeiro=fundo).
  function hexToPsdColor(hex: string): { r: number; g: number; b: number } {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "")
    if (!m) return { r: 255, g: 255, b: 255 }
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
  }
  const bgLayersArr: any[] = bgLayersFromData(data)
  for (let i = 0; i < bgLayersArr.length; i++) {
    const bl = bgLayersArr[i]
    if (!bl || bl.hidden) continue
    const layerName = i === 0 ? "Background" : `Background ${i + 1}`
    const opacityByte = Math.max(0, Math.min(255, Math.round((typeof bl.opacity === "number" ? bl.opacity : 1) * 255)))
    if (bl.kind === "solid") {
      psdLayers.push({
        name: layerName,
        top: 0, left: 0, bottom: H, right: W,
        opacity: opacityByte,
        vectorFill: { type: "color", color: hexToPsdColor(bl.color) },
      })
    } else if (bl.kind === "gradient") {
      // Converte angle ZZOSY (0=L→R, 90=T→B) → PSD (0=cima, sentido horario)
      // Formula inversa do extractPsdBgLayer: psd = (zzosy + 180) mod 360
      const angleZ = typeof bl.angle === "number" ? bl.angle : 90
      const anglePsd = ((angleZ + 180) % 360 + 360) % 360
      const psStyle = bl.gradientType === "radial" ? "radial" : "linear"
      psdLayers.push({
        name: layerName,
        top: 0, left: 0, bottom: H, right: W,
        opacity: opacityByte,
        vectorFill: {
          type: "solid",
          name: "Custom",
          smoothness: 4096,
          colorStops: (bl.stops ?? []).map((s: any) => ({
            color: hexToPsdColor(s.color),
            location: Math.max(0, Math.min(1, s.offset ?? 0)),
            midpoint: 50,
          })),
          opacityStops: [
            { opacity: 100, location: 0, midpoint: 50 },
            { opacity: 100, location: 1, midpoint: 50 },
          ],
          style: psStyle,
          angle: anglePsd,
        },
      })
    } else if (bl.kind === "image") {
      // Raster fallback (V2: mapear pra Pattern Fill Layer nativo do PS)
      const bgCanvas = document.createElement("canvas")
      bgCanvas.width = W; bgCanvas.height = H
      const ctx = bgCanvas.getContext("2d")!
      await renderBgLayersOntoCanvas(ctx, [bl], W, H)
      psdLayers.push({
        name: layerName,
        top: 0, left: 0, bottom: H, right: W,
        opacity: opacityByte,
        canvas: bgCanvas,
      })
    }
  }

  for (const obj of objects) {
    if ((obj as any).__isBg) continue
    const ox = obj.left ?? 0
    const oy = obj.top ?? 0
    const ow = (obj.width ?? 100) * (obj.scaleX ?? 1)
    const oh = (obj.height ?? 100) * (obj.scaleY ?? 1)
    const left = Math.round(ox)
    const top = Math.round(oy)
    const right = Math.round(ox + ow)
    const bottom = Math.round(oy + oh)
    const w = Math.max(1, right - left)
    const h = Math.max(1, bottom - top)
    let name = (obj as any).__assetLabel ?? obj.type ?? "Layer"
    // Opacity/blendMode do Fabric → PSD nativo (round-trip completo).
    // PSD opacity = 0..255; defaults (1.0 e source-over) omitidos pra não inflar JSON.
    const psdLayerOpacity = typeof obj.opacity === "number" && obj.opacity < 1
      ? Math.max(0, Math.min(255, Math.round(obj.opacity * 255)))
      : undefined
    const psdLayerBlend = canvasBlendToPsd(obj.globalCompositeOperation)
    // PSD layer effects (drop shadow / stroke / outer glow) round-trip.
    // Converte schema ZZOSY → schema ag-psd (cores {r,g,b}, angle/distance, etc).
    const psdLayerEffects = (() => {
      const fx = (obj as any).__psdEffects
      if (!fx) return undefined
      const out: any = {}
      if (fx.dropShadow) {
        const d = fx.dropShadow
        const dx = d.offsetX ?? 0, dy = d.offsetY ?? 0
        const distance = Math.round(Math.hypot(dx, dy))
        // Inverso da extração: PSD angle (0=direita, +sentido horário) a partir
        // dos offsets (sombra cai oposta à luz). Defensivo se distance=0.
        const angle = distance > 0 ? (Math.atan2(dy, -dx) * 180 / Math.PI) : 120
        out.dropShadow = [{
          enabled: true,
          color: hexToPsdColor(d.color ?? "#000000"),
          opacity: typeof d.opacity === "number" ? d.opacity : 0.75,
          angle, distance,
          size: d.blur ?? 5,
          blendMode: "multiply",
          useGlobalLight: false,
        }]
      }
      if (fx.outerGlow && !fx.dropShadow) {
        out.outerGlow = [{
          enabled: true,
          color: hexToPsdColor(fx.outerGlow.color ?? "#ffffff"),
          opacity: typeof fx.outerGlow.opacity === "number" ? fx.outerGlow.opacity : 0.5,
          size: fx.outerGlow.blur ?? 5,
          blendMode: "screen",
        }]
      }
      if (fx.stroke) {
        out.stroke = [{
          enabled: true,
          position: fx.stroke.position ?? "outside",
          fillColor: { color: hexToPsdColor(fx.stroke.color ?? "#000000") },
          size: fx.stroke.width ?? 1,
          opacity: typeof fx.stroke.opacity === "number" ? fx.stroke.opacity : 1,
          blendMode: "normal",
        }]
      }
      return Object.keys(out).length > 0 ? out : undefined
    })()

    if (obj.type === "textbox" || obj.type === "i-text" || obj.type === "text") {
      try {
      // Nome da layer = label do asset (editavel na pagina de assets).
      // Fallback: conteudo do texto se nao tiver label.
      if (!((obj as any).__assetLabel)) {
        const txt = ((obj as any).text ?? "").trim().replace(/\s+/g, " ")
        if (txt.length > 0) name = txt.length > 64 ? txt.substring(0, 64) + "…" : txt
      }
      // Texto: rasteriza COMO FALLBACK VISUAL + engineData pra Photoshop oferecer edicao.
      // Combinado com invalidateTextLayers:true no writePsd, Photoshop ao abrir mostra
      // dialogo "Update text layers" → ao aceitar, recomputa do engineData (texto editavel
      // com formatacao correta). Se cancelar, fica o canvas raster (visual correto, mas
      // nao-editavel).
      // CRITICO: obj.fontSize do Fabric eh ANTES do scale. O bbox (w/h) JA esta com scale aplicado.
      // Se nao multiplicar pelo scale aqui, fontSize fica enorme ("DATA" virou 137px no PSD com scaleY=0.12).
      // Usamos scaleY pra fontSize (consistente com como Fabric escala texto verticalmente).
      const sY = obj.scaleY ?? 1
      const fontSize = Math.round((obj.fontSize ?? 48) * sY)
      // CHAVE: usa as LINHAS WRAPPEADAS pelo Fabric (visual real do editor) como texto.
      // obj.text e' o texto cru (so com \n explicitos do usuario).
      // obj._textLines e' o array de linhas REAIS apos o wrap automatico pelo width do Textbox.
      // Se mandassemos obj.text cru, Photoshop tentaria wrappar de novo e poderia diferir
      // (mesma fonte com metricas ligeiramente diferentes da Fabric => quebra em outro ponto).
      // Juntando as linhas wrappeadas com \n explicitos, garantimos o mesmo visual.
      const wrappedLines = (obj as any)._textLines as string[][] | undefined
      const fullText = (Array.isArray(wrappedLines) && wrappedLines.length > 0)
        ? wrappedLines.map(line => Array.isArray(line) ? line.join("") : String(line)).join("\n")
        : (obj.text ?? "")
      const styleRuns = buildStyleRuns(obj, fullText, sY)
      const isBold = (obj.fontWeight === "bold" || obj.fontWeight === 700)
      const ps = toPSFont(obj.fontFamily ?? "Arial", isBold)
      const layerCanvas = document.createElement("canvas")
      layerCanvas.width = w
      layerCanvas.height = h
      const lctx = layerCanvas.getContext("2d")! // alpha:true (transparente)
      try {
        const rendered = obj.toCanvasElement({ multiplier: 1 })
        lctx.drawImage(rendered, 0, 0, w, h)
      } catch (e) { console.warn("rasterize text fail:", name, e) }
      // Alinhamento real do textbox (Photoshop nao suporta "justify" no
      // paragraphStyle, fallback pra left). Hoje hardcoded "left" — bug.
      const psJust: "left" | "center" | "right" =
        obj.textAlign === "center" ? "center" :
        obj.textAlign === "right" ? "right" :
        "left"
      // Leading do default style (mesma logica que em buildStyleRuns).
      const defLeadingPt = (obj as any).leadingPt
      const defLineH = obj.lineHeight ?? 1.0
      const defLeading = Math.round(
        (defLeadingPt !== undefined && defLeadingPt !== null)
          ? defLeadingPt * sY
          : fontSize * defLineH
      )
      const defTracking = fabricCharSpacingToPsTracking(obj.charSpacing)
      psdLayers.push({
        name, top, left, bottom, right,
        canvas: layerCanvas,
        ...(psdLayerOpacity !== undefined ? { opacity: psdLayerOpacity } : {}),
        ...(psdLayerBlend ? { blendMode: psdLayerBlend } : {}),
        ...(psdLayerEffects ? { effects: psdLayerEffects } : {}),
        // anotação temporária: removida antes do writePsd na fase de nesting.
        __groupPath: Array.isArray((obj as any).__groupPath) ? (obj as any).__groupPath : undefined,
        text: {
          text: fullText,
          transform: [1, 0, 0, 1, left, top + fontSize],
          // Point text com quebras explicitas (vindas do wrap do Fabric).
          // Sem boxBounds: deixa Photoshop respeitar nossas quebras sem tentar re-wrappar.
          style: {
            font: { name: ps.name },
            fontSize,
            fillColor: parseColor(obj.fill ?? "#000000"),
            fauxBold: ps.fauxBold,
            // Sem esses campos, Photoshop usa leading metric default da fonte
            // e tracking 0 — texto sai com entrelinha grande e sem char spacing.
            autoLeading: false,
            leading: defLeading,
            tracking: defTracking,
            autoKerning: true,
          },
          styleRuns,
          paragraphStyle: { justification: psJust },
        },
      })
      } catch (errText) {
        // CRITICO: se algo na branch text deu throw, o console.log [PSD-TEXT-EXPORT] nao roda
        // e o layer nao eh adicionado ao PSD. Antes esse erro era engolido silenciosamente.
        // Agora logamos pra debug.
        console.error("[PSD-TEXT-CRASH]", {
          name: (obj as any).__assetLabel ?? "?",
          text: (obj as any).text?.substring?.(0, 60),
          error: errText,
          stack: (errText as any)?.stack,
        })
      }
    } else {
      // === Imagem: detecta se eh Smart Object embeddavel ===
      // Eh SO se: (a) asset preserva smart object de import, OU (b) eh SVG via imageUrl.
      const assetId = (obj as any).__assetId as string | undefined
      const asset = assetId ? assetById.get(assetId) : undefined
      const isSmartObjectCandidate = !!asset && (
        !!asset.smartObject ||
        (!!asset.imageUrl && /\.svg(\?|$)/i.test(asset.imageUrl))
      )

      // Sempre rasteriza pra usar como preview (Photoshop precisa do canvas mesmo
      // pra smart objects — eh o que ele mostra antes do double-click "abrir conteudo").
      const layerCanvas = document.createElement("canvas")
      layerCanvas.width = w
      layerCanvas.height = h
      const lctx = layerCanvas.getContext("2d")! // alpha:true (transparente)
      try {
        const img = obj.toCanvasElement({ multiplier: 1 })
        lctx.drawImage(img, 0, 0, w, h)
      } catch (e) { console.warn("rasterize fail:", name, e) }

      if (isSmartObjectCandidate && asset) {
        // SMART OBJECT EMBEDDED: vai como Smart Object no PSD.
        const linked = await ensureLinkedSmartObject(asset)
        if (linked) {
          // Os 4 cantos do retangulo onde a imagem esta posicionada (em pixels do PSD).
          const transform = [
            left, top,
            right, top,
            right, bottom,
            left, bottom,
          ]
          psdLayers.push({
            name,
            top, left, bottom, right,
            canvas: layerCanvas,
            ...(psdLayerOpacity !== undefined ? { opacity: psdLayerOpacity } : {}),
            ...(psdLayerBlend ? { blendMode: psdLayerBlend } : {}),
            ...(psdLayerEffects ? { effects: psdLayerEffects } : {}),
            __groupPath: Array.isArray((obj as any).__groupPath) ? (obj as any).__groupPath : undefined,
            placedLayer: {
              id: linked.guid,
              type: "raster",
              width: linked.w,   // ag-psd exige
              height: linked.h,  // ag-psd exige
              transform,
            },
          })
          console.log("[PSD-SMART]", {
            name,
            guid: linked.guid,
            svgW: linked.w, svgH: linked.h,
            psdBbox: { left, top, right, bottom, w, h },
            transform,
            objFabric: { left: obj.left, top: obj.top, scaleX: obj.scaleX, scaleY: obj.scaleY, w: obj.width, h: obj.height },
          })
          continue
        }
      }

      // Fallback: imagem raster comum (PNG/JPG ou SVG que nao deu pra embeddar)
      psdLayers.push({
        name, top, left, bottom, right, canvas: layerCanvas,
        ...(psdLayerOpacity !== undefined ? { opacity: psdLayerOpacity } : {}),
        ...(psdLayerBlend ? { blendMode: psdLayerBlend } : {}),
        ...(psdLayerEffects ? { effects: psdLayerEffects } : {}),
        __groupPath: Array.isArray((obj as any).__groupPath) ? (obj as any).__groupPath : undefined,
      })
    }
  }

  // === PROPAGA __hidden / __locked DO FABRIC PRO PSD ===
  // ag-psd suporta:
  //   hidden: true            -> camada oculta (igual olho fechado)
  //   transparencyProtected: true -> "Lock transparent pixels" do PS (mais
  //     proximo do nosso lock simples; ag-psd nao tem all-locks num campo)
  // Iteracao em paralelo: psdLayers[0] eh Background, psdLayers[1..] = objects[i].
  {
    let psdLayerIdx = 1
    for (const obj of objects) {
      if ((obj as any).__isBg) continue
      const psdLayer: any = psdLayers[psdLayerIdx]
      if (!psdLayer) { psdLayerIdx++; continue }
      if ((obj as any).__hidden === true) psdLayer.hidden = true
      if ((obj as any).__locked === true) psdLayer.transparencyProtected = true
      psdLayerIdx++
    }
  }

  // === APLICA MASCARAS (raster / vector / clipping) NOS LAYERS DO PSD ===
  // Percorre os objects do canvas (em mesma ordem dos psdLayers) e injeta a
  // mascara salva em __maskData no psdLayer correspondente. Background nao
  // tem mascara entao comeca em index 1 dos psdLayers (index 0 = background).
  {
    const { maskToAgPsd, normalizeVectorMaskCoords } = await import("@/lib/maskToAgPsd")
    let psdLayerIdx = 1 // pula o background
    for (const obj of objects) {
      if ((obj as any).__isBg) continue
      const maskData = (obj as any).__maskData
      const psdLayer = psdLayers[psdLayerIdx]
      if (maskData && psdLayer) {
        const agpsdMask = await maskToAgPsd(maskData)
        if (agpsdMask.mask) psdLayer.mask = agpsdMask.mask
        if (agpsdMask.vectorMask) psdLayer.vectorMask = normalizeVectorMaskCoords(agpsdMask.vectorMask, W, H)
        if (agpsdMask.clipping) psdLayer.clipping = true
      }
      psdLayerIdx++
    }
  }

  // Composite (preview): BG-7 renderiza bgLayers completo antes do fc
  const compositeCanvas = document.createElement("canvas")
  compositeCanvas.width = W
  compositeCanvas.height = H
  const cctx = compositeCanvas.getContext("2d", { alpha: false } as any)! as CanvasRenderingContext2D
  await renderBgLayersOntoCanvas(cctx, bgLayersFromData(data), W, H)
  cctx.drawImage(fc.getElement(), 0, 0)

  const thumbCanvas = document.createElement("canvas")
  const thumbScale = Math.min(256 / W, 256 / H)
  thumbCanvas.width = Math.round(W * thumbScale)
  thumbCanvas.height = Math.round(H * thumbScale)
  const tctx = thumbCanvas.getContext("2d", { alpha: false } as any)! as CanvasRenderingContext2D
  tctx.fillStyle = "#fff"
  tctx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height)
  tctx.drawImage(compositeCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height)

  // Reconstrói a hierarquia de folders do Photoshop a partir do __groupPath
  // anotado em cada psdLayer. Walking bottom→top (ordem do psdLayers), abre
  // novos folders quando o path estende o atual, fecha quando diverge. Layers
  // sem groupPath vão pra raiz. Folders ag-psd: { name, opened:true, children }.
  // EDGE CASE: se layers de um mesmo grupo ficarem não-contíguos no z-stack
  // (user moveu manualmente após import), o grupo é "re-aberto" — gera 2
  // folders com mesmo nome no PSD. Aceitável (designer merge manual no PS).
  function nestByGroupPath(flat: any[]): any[] {
    const root: any = { children: [] }
    let currentPath: string[] = []
    const stack: any[] = [root]
    for (const layer of flat) {
      const lp: string[] = Array.isArray(layer.__groupPath) ? layer.__groupPath : []
      let common = 0
      while (common < currentPath.length && common < lp.length && currentPath[common] === lp[common]) common++
      while (currentPath.length > common) {
        stack.pop()
        currentPath.pop()
      }
      while (currentPath.length < lp.length) {
        const newGroup: any = { name: lp[currentPath.length], opened: true, children: [] }
        stack[stack.length - 1].children.push(newGroup)
        stack.push(newGroup)
        currentPath.push(lp[currentPath.length])
      }
      const { __groupPath, ...clean } = layer
      stack[stack.length - 1].children.push(clean)
    }
    return root.children
  }
  const nestedChildren = nestByGroupPath(psdLayers)

  const psd: any = {
    width: W, height: H,
    canvas: compositeCanvas,
    children: nestedChildren,
    imageResources: {
      thumbnail: thumbCanvas,
      // resolutionInfo grava o DPI no PSD. Photoshop le isso ao abrir o arquivo
      // e mostra Image Size > Resolution com o valor correto.
      // displayUnit / widthUnit: PscMt = mm. Mais comum no Photoshop seria
      // PscCm/PscIn — ag-psd aceita ambos. Usamos PscCm pra metric.
      resolutionInfo: {
        horizontalResolution: dpi,
        horizontalResolutionUnit: "PPI",
        widthUnit: "Centimeters",
        verticalResolution: dpi,
        verticalResolutionUnit: "PPI",
        heightUnit: "Centimeters",
      },
    },
    // Smart objects embeddados: cada SVG vira um linkedFile referenciado pelos placedLayers.
    // ag-psd serializa esses bytes dentro do PSD; Photoshop reconhece como SO.
    linkedFiles: linkedFiles.length > 0 ? linkedFiles : undefined,
  }
  const buffer = agpsd.writePsd(psd, { generateThumbnail: false, invalidateTextLayers: true })
  fc.dispose()
  return new Blob([buffer], { type: "image/vnd.adobe.photoshop" })
}

const EXT_MAP: Record<ExportFormat, string> = { PSD: "psd", PNG: "png", JPG: "jpg", PDF: "pdf" }

async function buildBlob(piece: { id?: string; name: string; data: any; width: number; height: number }, format: ExportFormat): Promise<Blob> {
  switch (format) {
    case "PNG": return exportPNGBlob(piece)
    case "JPG": return exportJPGBlob(piece)
    case "PDF": return exportPDFBlob(piece)
    case "PSD": return exportPSDBlob(piece)
  }
}

/**
 * Expande pecas com multiplos steps em "pecas virtuais" — uma por step.
 * Cada step vira uma peca independente do export com:
 *   - name: "{original}_Step1", "{original}_Step2", etc.
 *   - data.layers: os layers daquele step
 *   - data.bgColor: o bg daquele step (steps podem ter bg diferente)
 *   - mesma width/height da peca original
 *
 * Pecas com 1 step soh (ou sem campo 'steps'): passam direto sem modificacao.
 */
function expandSteps(
  pieces: Array<{ id?: string; name: string; data: any; width: number; height: number }>
): Array<{ id?: string; name: string; data: any; width: number; height: number; __virtualStepOriginalId?: string }> {
  const out: any[] = []
  for (const p of pieces) {
    const d = typeof p.data === "string" ? JSON.parse(p.data) : p.data
    const allSteps: Array<{ layers: any[]; bgColor?: string }> = Array.isArray(d?.steps) ? d.steps : []
    if (allSteps.length <= 1) {
      // Peca legada / 1 step soh: passa direto.
      out.push(p)
      continue
    }
    // Multi-step: gera N pecas virtuais.
    // CRITICO: usa o ID ORIGINAL pra renderToCanvas conseguir buscar os assets
    // da campanha via fetchPieceWithAssets. Mas marca a peca como virtual
    // (__virtualStepOriginalId) pra o renderToCanvas saber que NAO deve
    // sobrescrever piece.data com o data do banco (que tem todos os steps),
    // e sim usar o data ja preparado aqui (com layers do step especifico).
    allSteps.forEach((step, i) => {
      out.push({
        id: p.id, // mesmo id pra renderToCanvas buscar assets do banco
        __virtualStepOriginalId: p.id, // marca como virtual
        name: `${p.name}_Step${i + 1}`,
        width: p.width,
        height: p.height,
        data: {
          ...d,
          layers: step.layers,
          bgColor: step.bgColor ?? d.bgColor,
          // remove o campo steps pra nao confundir o resto do pipeline
          steps: undefined,
          activeStepIndex: undefined,
        },
      })
    })
  }
  return out
}

export async function exportPieces(
  pieces: Array<{ id?: string; name: string; data: any; width: number; height: number }>,
  formats: ExportFormat[],
  onProgress?: (msg: string) => void,
  campaignName?: string,
): Promise<void> {
  // Expande pecas multi-step ANTES de iniciar o export. Cada step vira uma
  // peca virtual com nome _StepN. O resto do pipeline trata como peca normal.
  pieces = expandSteps(pieces)
  const total = pieces.length * formats.length
  if (total === 0) return

  if (total === 1) {
    const piece = pieces[0]
    const fmt = formats[0]
    onProgress?.(`Gerando ${piece.name} (${fmt})`)
    const blob = await buildBlob(piece, fmt)
    downloadBlob(blob, `${buildFileName(campaignName, piece)}.${EXT_MAP[fmt]}`)
    return
  }

  const JSZip = (await import("jszip")).default
  const zip = new JSZip()
  let done = 0
  for (const piece of pieces) {
    for (const fmt of formats) {
      done++
      onProgress?.(`${done}/${total} — ${piece.name} (${fmt})`)
      try {
        const blob = await buildBlob(piece, fmt)
        const buf = await blob.arrayBuffer()
        zip.file(`${buildFileName(campaignName, piece)}.${EXT_MAP[fmt]}`, buf)
      } catch (e) {
        console.error("Falha exportar", piece.name, fmt, e)
      }
    }
  }

  onProgress?.(`Empacotando zip...`)
  const zipBlob = await zip.generateAsync({ type: "blob" })
  const zipBase = campaignName ? safeName(campaignName) : "export"
  const zipName = `${zipBase}_${new Date().toISOString().slice(0, 10)}.zip`
  downloadBlob(zipBlob, zipName)
}

export async function exportPiece(
  piece: { id?: string; name: string; data: any; width: number; height: number },
  format: ExportFormat
) {
  return exportPieces([piece], [format])
}


/**
 * Monta um ZIP de entrega organizado em pasta por MÍDIA / pasta por FORMATO / arquivos.
 * Retorna o Blob (não dispara download — quem chama decide o que fazer com ele).
 *
 * Estrutura de pasta esperada: ZIP/{Mídia}/{Formato}/{nome-arquivo}.{ext}
 * - mídia: vem de piece.media (string livre, ex: "Instagram", "Facebook")
 * - formato: nome do extensao em maiusculo (PSD, PNG, JPG, PDF)
 */
export async function buildDeliveryZip(
  pieces: Array<{ id: string; name: string; data: any; width: number; height: number; media?: string }>,
  formats: ExportFormat[],
  campaignName?: string,
  onProgress?: (msg: string) => void,
  /** Arquivos extras a incluir no zip. Cada um vai pra pasta especificada em folder. */
  extraFiles?: Array<{ folder: string; name: string; blob: Blob }>,
): Promise<Blob> {
  const JSZip = (await import("jszip")).default
  const zip = new JSZip()
  // Expande pecas multi-step (carrossel etc): cada step vira uma peca virtual
  // com nome _StepN no zip de entrega.
  pieces = expandSteps(pieces) as any
  let done = 0
  const total = pieces.length * formats.length

  for (const piece of pieces) {
    const mediaFolder = (piece.media || "Outros").trim().replace(/[\\/:*?"<>|]/g, "-")
    for (const fmt of formats) {
      done++
      onProgress?.(`${done}/${total} — ${piece.name} (${fmt})`)
      try {
        const blob = await buildBlob(piece, fmt)
        const buf = await blob.arrayBuffer()
        const folderPath = `${mediaFolder}/${fmt.toUpperCase()}`
        const fileName = `${buildFileName(campaignName, piece)}.${EXT_MAP[fmt]}`
        zip.file(`${folderPath}/${fileName}`, buf)
      } catch (e) {
        console.error("Falha exportar", piece.name, fmt, e)
      }
    }
  }

  // Adiciona arquivos extras (ex: apresentacao em Deck/) se fornecidos
  if (extraFiles && extraFiles.length > 0) {
    for (const f of extraFiles) {
      onProgress?.(`Adicionando ${f.folder}/${f.name}...`)
      const buf = await f.blob.arrayBuffer()
      zip.file(`${f.folder}/${f.name}`, buf)
    }
  }

  onProgress?.(`Empacotando zip...`)
  return await zip.generateAsync({ type: "blob" })
}
