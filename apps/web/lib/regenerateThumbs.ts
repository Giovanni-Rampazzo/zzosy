"use client"
// Re-render thumbnail of pieces that use a given asset.
// Roda no client em segundo plano (sem bloquear UI).

interface Asset {
  id: string; type: string; label: string; value: string | null; imageUrl: string | null; content: any
}

function parseContent(raw: any): any[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

async function buildThumbnailFromPieceData(pieceData: any, assets: Asset[]): Promise<Blob | null> {
  const fabric = await import("fabric")
  const StaticCanvas = (fabric as any).StaticCanvas
  const Textbox = (fabric as any).Textbox
  const FabricImage = (fabric as any).FabricImage ?? (fabric as any).Image

  const W = pieceData?.width ?? 1080
  const H = pieceData?.height ?? 1080
  const bgColor = pieceData?.bgColor ?? "#ffffff"

  const el = document.createElement("canvas")
  el.width = W; el.height = H
  const fc = new StaticCanvas(el, { width: W, height: H, enableRetinaScaling: false, backgroundColor: bgColor })

  if (pieceData?.version === 2 && Array.isArray(pieceData?.layers)) {
    const assetMap = Object.fromEntries(assets.map(a => [a.id, a]))
    const sorted = [...pieceData.layers].sort((a: any, b: any) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    for (const layer of sorted) {
      const asset = assetMap[layer.assetId]
      if (!asset) continue
      const overrides = layer.overrides ?? {}
      if (asset.type === "TEXT") {
        const spans = parseContent(asset.content)
        const fullText = spans.length ? spans.map((s: any) => s.text).join("") : (asset.value ?? asset.label)
        const def = spans[0]?.style ?? {}
        const t = new Textbox(fullText, {
          left: layer.posX, top: layer.posY,
          width: Math.max(layer.width ?? 400, 100),
          fontSize: overrides.fontSize ?? def.fontSize ?? 80,
          fontFamily: overrides.fontFamily ?? def.fontFamily ?? "Arial",
          fontWeight: overrides.fontWeight ?? def.fontWeight ?? "normal",
          fill: overrides.fill ?? def.color ?? "#111",
          scaleX: layer.scaleX ?? 1, scaleY: layer.scaleY ?? 1,
          angle: layer.rotation ?? 0,
          charSpacing: overrides.charSpacing ?? 0,
          lineHeight: overrides.lineHeight ?? 1.16,
          textAlign: overrides.textAlign ?? "left",
          styles: overrides.styles ?? undefined,
        })
        fc.add(t)
      } else if (asset.type === "IMAGE" && asset.imageUrl) {
        try {
          const img = await new Promise<any>((resolve, reject) => {
            const ie = new window.Image()
            ie.crossOrigin = "anonymous"
            ie.onload = () => resolve(new FabricImage(ie, {
              left: layer.posX, top: layer.posY,
              scaleX: layer.scaleX ?? 1, scaleY: layer.scaleY ?? 1,
              angle: layer.rotation ?? 0,
            }))
            ie.onerror = reject
            ie.src = asset.imageUrl!
          })
          fc.add(img)
        } catch (e) { /* ignora */ }
      }
    }
    fc.renderAll()
    await new Promise(r => setTimeout(r, 200))

    const thumbScale = Math.min(1600 / W, 1600 / H, 1)
    const dataUrl = fc.toDataURL({ format: "jpeg", quality: 0.92, multiplier: thumbScale })
    fc.dispose()
    const res = await fetch(dataUrl)
    return await res.blob()
  }

  fc.dispose()
  return null
}

export async function regeneratePieceThumbsForAsset(campaignId: string, assetId: string): Promise<void> {
  const [campRes, piecesRes] = await Promise.all([
    fetch(`/api/campaigns/${campaignId}`).then(r => r.json()),
    fetch(`/api/pieces?campaignId=${campaignId}`).then(r => r.json()),
  ])
  const assets: Asset[] = campRes.assets ?? []
  const pieces: any[] = Array.isArray(piecesRes) ? piecesRes : []

  for (const piece of pieces) {
    const pdata = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
    if (!pdata || pdata.version !== 2 || !Array.isArray(pdata.layers)) continue

    const usesAsset = pdata.layers.some((l: any) => l.assetId === assetId)
    if (!usesAsset) continue

    try {
      const blob = await buildThumbnailFromPieceData(pdata, assets)
      if (!blob) continue
      const fd = new FormData()
      fd.append("thumbnail", blob, "thumb.jpg")
      await fetch(`/api/pieces/${piece.id}/thumbnail`, { method: "POST", body: fd })
    } catch (e) {
      console.warn("regen falhou para peca", piece.id, e)
    }
  }
}


// Regenera o thumbnail do KV (matriz) a partir dos assets atuais.
// Usa-se a mesma logica de buildThumbnailFromPieceData mas para o keyVision.
export async function regenerateKVThumb(campaignId: string): Promise<void> {
  const camp = await fetch(`/api/campaigns/${campaignId}`).then(r => r.json())
  const kv = camp?.keyVision
  if (!kv) return
  let kvData: any = null
  try {
    kvData = typeof kv.data === "string" ? JSON.parse(kv.data) : kv.data
  } catch {}
  // KV usa layers no formato Fabric serializado em kv.data.layers (canvasData) ou
  // em kv.layers como array de assetIds com posicao. Se nao tiver layers utilizaveis, sai.
  // Mais simples: usa kv.layers (cada item: assetId/posX/posY/scaleX/scaleY/rotation/zIndex/width/height/overrides?)
  let layers: any[] = []
  if (Array.isArray(kv.layers)) layers = kv.layers
  else if (Array.isArray(kvData?.layers)) layers = kvData.layers

  if (!layers.length) return

  // Reaproveita buildThumbnailFromPieceData usando um pseudo-pieceData
  const pseudoPiece = {
    version: 2,
    width: kv.width ?? 1080,
    height: kv.height ?? 1080,
    bgColor: kv.bgColor ?? "#ffffff",
    layers,
  }
  const assets: Asset[] = camp.assets ?? []
  try {
    const blob = await buildThumbnailFromPieceData(pseudoPiece, assets)
    if (!blob) return
    const fd = new FormData()
    fd.append("thumbnail", blob, "kv-thumb.jpg")
    await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: fd })
  } catch (e) {
    console.warn("regen KV thumb falhou:", e)
  }
}
