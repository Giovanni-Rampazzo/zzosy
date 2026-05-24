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

// Broadcast helpers — notifica /campaigns/[id], /pieces, /presentation, etc
// pra refetch IMEDIATO sem esperar polling/focus. Sem isso, regerar thumb
// pelo /assets nao refletia em outras abas/paginas ja abertas.
function broadcastPieceUpdated(pieceId: string, campaignId: string | undefined) {
  try {
    if (typeof BroadcastChannel === "undefined") return
    const bc = new BroadcastChannel("zzosy:pieces")
    bc.postMessage({ type: "piece-updated", pieceId, campaignId, ts: Date.now() })
    bc.close()
  } catch {}
}
function broadcastKvUpdated(campaignId: string) {
  try {
    if (typeof BroadcastChannel === "undefined") return
    const bc = new BroadcastChannel("zzosy:campaigns")
    bc.postMessage({ type: "kv-updated", campaignId, ts: Date.now() })
    bc.close()
  } catch {}
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
      // PSD layer props: opacity + blendMode (canvas globalCompositeOperation).
      // Sem isso, o thumb do KV (gerado via regenerateKVThumb) perdia
      // multiply/screen/overlay → preview ficava diferente do editor que
      // respeita esses. Sintoma reportado: layer em multiply aparece como
      // imagem normal sobreposta no thumb da matriz.
      const psdProps: any = {}
      if (typeof layer.opacity === "number" && layer.opacity < 1 && layer.opacity >= 0.01) {
        psdProps.opacity = layer.opacity
      }
      if (typeof layer.blendMode === "string" && layer.blendMode && layer.blendMode !== "source-over") {
        psdProps.globalCompositeOperation = layer.blendMode
      }
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
          ...psdProps,
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
              ...psdProps,
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
    // PNG (nao JPEG) — preserva canal alpha em mascaras raster transparentes.
    const dataUrl = fc.toDataURL({ format: "png", multiplier: thumbScale })
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
    if (!pdata || pdata.version !== 2) continue

    // MULTI-STEP: pdata.steps[] contem layers de cada step. Cada step
    // precisa de seu proprio thumb (via /step-thumbnail?index=N).
    // O thumb principal (piece.imageUrl) usa o step ATIVO.
    const steps: any[] = Array.isArray(pdata.steps) ? pdata.steps : []
    const isMultiStep = steps.length >= 2

    if (isMultiStep) {
      // Detecta quais steps usam o asset alterado.
      const W = pdata.width ?? 1080
      const H = pdata.height ?? 1080
      const activeIdx = typeof pdata.activeStepIndex === "number" ? pdata.activeStepIndex : 0
      let regeneratedSomething = false

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        if (!step || !Array.isArray(step.layers)) continue
        const stepUsesAsset = step.layers.some((l: any) => l?.assetId === assetId)
        if (!stepUsesAsset) continue
        // Renderiza esse step com layers + bgColor proprios.
        const pseudoStepPiece = {
          version: 2,
          width: W, height: H,
          bgColor: step.bgColor ?? pdata.bgColor ?? "#ffffff",
          layers: step.layers,
        }
        try {
          const blob = await buildThumbnailFromPieceData(pseudoStepPiece, assets)
          if (!blob) continue
          const fd = new FormData()
          fd.append("thumbnail", blob, `step${i}.jpg`)
          await fetch(`/api/pieces/${piece.id}/step-thumbnail?index=${i}`, { method: "POST", body: fd })
          regeneratedSomething = true
          // Se eh o step ativo, tambem sobe como thumb principal.
          if (i === activeIdx) {
            const fdMain = new FormData()
            fdMain.append("thumbnail", blob, "thumb.jpg")
            await fetch(`/api/pieces/${piece.id}/thumbnail`, { method: "POST", body: fdMain })
          }
        } catch (e) {
          console.warn("regen step falhou", piece.id, i, e)
        }
      }
      // Se o step ativo NAO usa o asset (mas algum inativo usa), o thumb
      // principal continua igual — nao precisamos sobrescrever.
      if (regeneratedSomething) {
        broadcastPieceUpdated(piece.id, campaignId)
        continue
      }
    }

    // SINGLE-STEP (ou multi-step onde nenhum step usou o asset — improvavel):
    // codigo original.
    if (!Array.isArray(pdata.layers)) continue
    const usesAsset = pdata.layers.some((l: any) => l.assetId === assetId)
    if (!usesAsset) continue

    try {
      const blob = await buildThumbnailFromPieceData(pdata, assets)
      if (!blob) continue
      const fd = new FormData()
      fd.append("thumbnail", blob, "thumb.jpg")
      await fetch(`/api/pieces/${piece.id}/thumbnail`, { method: "POST", body: fd })
      broadcastPieceUpdated(piece.id, campaignId)
    } catch (e) {
      console.warn("regen falhou para peca", piece.id, e)
    }
  }
}


/**
 * Regenera o thumbnail de UMA peca especifica (pelo id). Usado quando:
 *   - peca eh DUPLICADA com troca de formato (server seta imageUrl=null
 *     porque o thumb antigo nao bate com novas dimensoes)
 *   - peca eh criada via API e precisa de preview imediato sem o user abrir
 *     o editor
 * Roda no client em background — busca a peca + assets, renderiza headlessly
 * via Fabric StaticCanvas, e faz upload pro endpoint de thumbnail.
 */
/**
 * Renderiza piece via buildPieceCanvas (mesmo renderer do export PSD/PNG).
 * Garante que thumb bate com o que o user ve no editor / vai pro PSD.
 *
 * Substitui buildThumbnailFromPieceData (renderer simplificado que faltava
 * SHAPE branch, mask raster correto, layer effects, etc). Bug fix 2026-05-24:
 * 'preview nao bate com editor — green box some, masks erradas'.
 */
async function renderPieceThumbViaExport(pieceLike: { data: any; width: number; height: number }, assets: Asset[]): Promise<Blob | null> {
  try {
    const { buildPieceCanvas } = await import("@/lib/exportPiece")
    const fc = await buildPieceCanvas({
      id: undefined,
      name: "thumb",
      data: pieceLike.data,
      width: pieceLike.width,
      height: pieceLike.height,
    } as any, assets)
    if (!fc) return null
    const W = pieceLike.width
    const H = pieceLike.height
    // Thumb compacto pra UI: max 1920 px no maior lado. Preserva alpha (PNG).
    const scale = Math.min(1920 / W, 1920 / H, 1)
    const dataUrl = fc.toDataURL({ format: "png", multiplier: scale })
    try { fc.dispose() } catch {}
    const res = await fetch(dataUrl)
    return await res.blob()
  } catch (e) {
    console.warn("[renderPieceThumbViaExport]", e)
    return null
  }
}

export async function regeneratePieceThumb(pieceId: string): Promise<boolean> {
  try {
    const pieceRes = await fetch(`/api/pieces/${pieceId}`, { cache: "no-store" })
    if (!pieceRes.ok) return false
    const piece = await pieceRes.json()
    const campaignId = piece?.campaignId
    if (!campaignId) return false
    const campRes = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" })
    if (!campRes.ok) return false
    const camp = await campRes.json()
    const assets: Asset[] = Array.isArray(camp?.assets) ? camp.assets : []
    const pdata = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
    if (!pdata) return false
    const steps: any[] = Array.isArray(pdata.steps) ? pdata.steps : []
    const activeIdx = typeof pdata.activeStepIndex === "number" ? pdata.activeStepIndex : 0
    const W = pdata.width ?? 1080
    const H = pdata.height ?? 1080
    let mainBlob: Blob | null = null
    if (steps.length >= 2) {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        if (!step) continue
        const pseudoStep = {
          version: 2,
          width: W, height: H,
          bgColor: step.bgColor ?? pdata.bgColor ?? "#ffffff",
          bgLayers: step.bgLayers ?? pdata.bgLayers,
          layers: Array.isArray(step.layers) ? step.layers : [],
        }
        const blob = await renderPieceThumbViaExport({ data: pseudoStep, width: W, height: H }, assets)
        if (!blob) continue
        const fd = new FormData()
        fd.append("thumbnail", blob, `step${i}.png`)
        try { await fetch(`/api/pieces/${pieceId}/step-thumbnail?index=${i}`, { method: "POST", body: fd }) }
        catch { /* segue */ }
        if (i === activeIdx) mainBlob = blob
      }
    } else {
      mainBlob = await renderPieceThumbViaExport({ data: pdata, width: W, height: H }, assets)
    }
    if (mainBlob) {
      const fd = new FormData()
      fd.append("thumbnail", mainBlob, "thumb.png")
      const r = await fetch(`/api/pieces/${pieceId}/thumbnail`, { method: "POST", body: fd })
      if (!r.ok) return false
      // NAO broadcastar daqui (2026-05-24): regen e uma OPERACAO INTERNA de
      // cada page (auto-regen no useEffect) — broadcastar disparava refetch
      // em outras pages → updatedAt mudava → smart-regen guard achava que
      // piece foi modificada → re-regen → LOOP entre tabs com mesma campanha.
      // Broadcasts reais sao do EDITOR ao salvar (mudanca user-driven) e do
      // GeneratePiecesModal ao criar piece.
    }
    return !!mainBlob
  } catch (e) {
    console.warn("[regeneratePieceThumb] falhou:", pieceId, e)
    return false
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
    broadcastKvUpdated(campaignId)
  } catch (e) {
    console.warn("regen KV thumb falhou:", e)
  }
}
