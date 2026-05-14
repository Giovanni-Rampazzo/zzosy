"use client"
// Re-render thumbnails de pecas. Roda no client em background, sem precisar
// de abrir o editor — Fabric.StaticCanvas renderiza tudo offscreen.
//
// Suporta:
// - Pecas single-step (pdata.layers) -> sobe /api/pieces/{id}/thumbnail
// - Pecas multi-step (pdata.steps[].layers) -> sobe um thumb por step via
//   /api/pieces/{id}/step-thumbnail?index=N + thumb principal usando step ativo
// - KV (matriz) -> sobe /api/campaigns/{id}/key-vision/thumbnail

interface Asset {
  id: string
  type: string
  label: string
  value: string | null
  imageUrl: string | null
  content: any
  lastOverride?: any
}

function parseContent(raw: any): any[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

// Renderiza um conjunto de layers num StaticCanvas e retorna o blob PNG.
// Reuso pra single-step e cada step de multi-step.
async function renderLayersToBlob(
  layers: any[],
  bgColor: string,
  width: number,
  height: number,
  assets: Asset[]
): Promise<Blob | null> {
  const fabric = await import("fabric")
  const StaticCanvas = (fabric as any).StaticCanvas
  const Textbox = (fabric as any).Textbox
  const FabricImage = (fabric as any).FabricImage ?? (fabric as any).Image

  const el = document.createElement("canvas")
  el.width = width; el.height = height
  const fc = new StaticCanvas(el, {
    width, height,
    enableRetinaScaling: false,
    backgroundColor: bgColor,
  })

  const assetMap = Object.fromEntries(assets.map(a => [a.id, a]))
  const sorted = [...layers].sort((a: any, b: any) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

  for (const layer of sorted) {
    if (!layer?.assetId) continue
    const asset = assetMap[layer.assetId]
    if (!asset) continue
    const overrides = layer.overrides ?? {}

    if (asset.type === "TEXT") {
      const spans = parseContent(asset.content)
      const fullText = spans.length ? spans.map((s: any) => s.text ?? "").join("") : (asset.value ?? asset.label)
      const def: any = spans[0]?.style ?? {}
      const assetTpl: any = asset.lastOverride && typeof asset.lastOverride === "object" ? asset.lastOverride : null
      const ov: any = overrides && Object.keys(overrides).length > 0 ? overrides : (assetTpl ?? {})

      const t = new Textbox(fullText, {
        left: layer.posX ?? 0, top: layer.posY ?? 0,
        width: Math.max(layer.width ?? 400, 100),
        fontSize: ov.fontSize ?? def.fontSize ?? 80,
        fontFamily: ov.fontFamily ?? def.fontFamily ?? "Arial",
        fontWeight: ov.fontWeight ?? def.fontWeight ?? "normal",
        fill: ov.fill ?? def.color ?? "#111",
        scaleX: layer.scaleX ?? 1, scaleY: layer.scaleY ?? 1,
        angle: layer.rotation ?? 0,
        charSpacing: ov.charSpacing ?? 0,
        lineHeight: ov.lineHeight ?? 1.16,
        textAlign: ov.textAlign ?? "left",
        styles: ov.styles ? JSON.parse(JSON.stringify(ov.styles)) : undefined,
      })
      if ((t as any).initDimensions) (t as any).initDimensions()
      fc.add(t)
    } else if (asset.type === "IMAGE" && asset.imageUrl) {
      try {
        const img = await new Promise<any>((resolve, reject) => {
          const ie = new window.Image()
          ie.crossOrigin = "anonymous"
          ie.onload = () => {
            const naturalW = ie.naturalWidth || ie.width || 1
            const naturalH = ie.naturalHeight || ie.height || 1
            let sx: number, sy: number
            const lScaleX = layer.scaleX ?? 1
            const lScaleY = layer.scaleY ?? 1
            if (lScaleX !== 1 || lScaleY !== 1) {
              sx = lScaleX; sy = lScaleY
            } else if (layer.height != null) {
              sx = (layer.width ?? 400) / naturalW
              sy = layer.height / naturalH
            } else {
              const ratio = (layer.width ?? 400) / naturalW
              sx = ratio; sy = ratio
            }
            resolve(new FabricImage(ie, {
              left: layer.posX ?? 0, top: layer.posY ?? 0,
              scaleX: sx, scaleY: sy,
              angle: layer.rotation ?? 0,
            }))
          }
          ie.onerror = reject
          ie.src = asset.imageUrl!
        })
        fc.add(img)
      } catch (e) { /* skip */ }
    }
  }

  fc.renderAll()
  await new Promise(r => setTimeout(r, 150))

  const TARGET = 1600
  const thumbScale = Math.min(TARGET / width, TARGET / height, 1)
  const dataUrl = fc.toDataURL({ format: "png", multiplier: thumbScale })
  fc.dispose()
  const res = await fetch(dataUrl)
  return await res.blob()
}

// Regenera thumbs de TODAS as pecas da campanha que usam um asset.
// Cobre single-step E multi-step.
export async function regeneratePieceThumbsForAsset(campaignId: string, assetId: string): Promise<void> {
  const [campRes, piecesRes] = await Promise.all([
    fetch(`/api/campaigns/${campaignId}`).then(r => r.json()),
    fetch(`/api/pieces?campaignId=${campaignId}`).then(r => r.json()),
  ])
  const assets: Asset[] = campRes.assets ?? []
  const pieces: any[] = Array.isArray(piecesRes) ? piecesRes : []

  console.log(`[regenThumbs] campanha=${campaignId} asset=${assetId} pecas=${pieces.length}`)

  for (const piece of pieces) {
    const pdata = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
    if (!pdata) continue

    const layersInSingle: any[] = Array.isArray(pdata.layers) ? pdata.layers : []
    const stepsInMulti: any[] = Array.isArray(pdata.steps) ? pdata.steps : []
    const usesInSingle = layersInSingle.some((l: any) => l?.assetId === assetId)
    const usesInMulti = stepsInMulti.some((s: any) => Array.isArray(s?.layers) && s.layers.some((l: any) => l?.assetId === assetId))
    if (!usesInSingle && !usesInMulti) continue

    const W = pdata.width ?? 1080
    const H = pdata.height ?? 1080
    console.log(`[regenThumbs] regerando peca ${piece.id} (${piece.name}) multi=${stepsInMulti.length}`)

    try {
      if (stepsInMulti.length > 1) {
        for (let i = 0; i < stepsInMulti.length; i++) {
          const step = stepsInMulti[i]
          if (!step || !Array.isArray(step.layers)) continue
          const stepBg = step.bgColor ?? pdata.bgColor ?? "#ffffff"
          const blob = await renderLayersToBlob(step.layers, stepBg, W, H, assets)
          if (!blob) { console.warn(`[regenThumbs] step ${i} blob veio null`); continue }
          const fd = new FormData()
          fd.append("thumbnail", blob, `step${i}.png`)
          const r = await fetch(`/api/pieces/${piece.id}/step-thumbnail?index=${i}`, { method: "POST", body: fd })
          console.log(`[regenThumbs] peca ${piece.id} step ${i} -> ${r.status}`)
        }
        const activeIdx = typeof pdata.activeStepIndex === "number" ? pdata.activeStepIndex : 0
        const activeStep = stepsInMulti[activeIdx] ?? stepsInMulti[0]
        if (activeStep && Array.isArray(activeStep.layers)) {
          const bg = activeStep.bgColor ?? pdata.bgColor ?? "#ffffff"
          const blob = await renderLayersToBlob(activeStep.layers, bg, W, H, assets)
          if (blob) {
            const fd = new FormData()
            fd.append("thumbnail", blob, "thumb.png")
            const r = await fetch(`/api/pieces/${piece.id}/thumbnail`, { method: "POST", body: fd })
            console.log(`[regenThumbs] peca ${piece.id} thumb principal -> ${r.status}`)
          }
        }
      } else {
        const bg = pdata.bgColor ?? "#ffffff"
        const blob = await renderLayersToBlob(layersInSingle, bg, W, H, assets)
        if (blob) {
          const fd = new FormData()
          fd.append("thumbnail", blob, "thumb.png")
          const r = await fetch(`/api/pieces/${piece.id}/thumbnail`, { method: "POST", body: fd })
          console.log(`[regenThumbs] peca ${piece.id} (single) -> ${r.status}`)
        }
      }
    } catch (e) {
      console.warn("[regenThumbs] falhou para peca", piece.id, e)
    }
  }
  console.log(`[regenThumbs] terminou`)
}

// Regenera o thumbnail do KV (matriz) a partir dos assets atuais.
export async function regenerateKVThumb(campaignId: string): Promise<void> {
  const camp = await fetch(`/api/campaigns/${campaignId}`).then(r => r.json())
  const kv = camp?.keyVision
  if (!kv) return
  let kvData: any = null
  try {
    kvData = typeof kv.data === "string" ? JSON.parse(kv.data) : kv.data
  } catch {}
  let layers: any[] = []
  if (Array.isArray(kv.layers)) layers = kv.layers
  else if (Array.isArray(kvData?.layers)) layers = kvData.layers
  if (!layers.length) return

  const assets: Asset[] = camp.assets ?? []
  const W = kv.width ?? 1080
  const H = kv.height ?? 1080
  const bg = kv.bgColor ?? "#ffffff"

  try {
    const blob = await renderLayersToBlob(layers, bg, W, H, assets)
    if (!blob) return
    const fd = new FormData()
    fd.append("thumbnail", blob, "kv-thumb.png")
    await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: fd })
  } catch (e) {
    console.warn("regen KV thumb falhou:", e)
  }
}
