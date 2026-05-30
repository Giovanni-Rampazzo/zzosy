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

// UNIFICADO 2026-05-27: delegate pra buildPieceCanvas (mesmo renderer do export
// PSD/PNG) pra GARANTIR que thumb === editor === export. Antes esse renderer
// simplificado tinha so TEXT+IMAGE (sem SHAPE), nao convertia styles per-char
// no formato Fabric v7 (array vs object), e ignorava effects + bgLayers
// multi-layer. Sintoma: shape sumia do thumb, per-char nao aparecia, gradiente
// de bg renderizava como cor solida. Bug recorrente reportado.
async function buildThumbnailFromPieceData(pieceData: any, assets: Asset[]): Promise<Blob | null> {
  if (pieceData?.version !== 2) return null
  const W = pieceData?.width ?? 1080
  const H = pieceData?.height ?? 1080
  try {
    const { buildPieceCanvas } = await import("@/lib/exportPiece")
    const fc = await buildPieceCanvas({
      id: undefined, name: "thumb",
      data: pieceData, width: W, height: H,
    } as any, assets)
    if (!fc) return null
    // PERF 2026-05-26: 1440 → 960 + JPEG 0.82. ~60% reducao bytes sem perda visual.
    const scale = Math.min(960 / W, 960 / H, 1)
    // Guard fonts antes do toDataURL (sweep 2026-05-30).
    const { awaitFontsReadyAndRender } = await import("@/lib/awaitFontsReady")
    await awaitFontsReadyAndRender(fc)
    const dataUrl = fc.toDataURL({ format: "jpeg", quality: 0.82, multiplier: scale })
    try { fc.dispose() } catch {}
    const res = await fetch(dataUrl)
    return await res.blob()
  } catch (e) {
    console.warn("[buildThumbnailFromPieceData]", e)
    return null
  }
}

// Concorrencia limitada — Fabric StaticCanvas usa GPU/canvas memory. Demais
// que 3 simultaneos pode estourar OOM em mobile/laptop fraco. 3 eh sweet spot:
// 3x mais rapido que sequencial sem risco de OOM.
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = items.slice()
  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(limit, queue.length); i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift()
        if (item === undefined) break
        try { await fn(item) } catch (e) { console.warn("[runWithConcurrency] item failed:", e) }
      }
    })())
  }
  await Promise.all(workers)
}

export async function regeneratePieceThumbsForAsset(campaignId: string, assetId: string): Promise<void> {
  // ?withData=true: payload da lista agora strippa data por default (perf opt
  // 2026-05-26). Como aqui precisamos do data pra filtrar quem usa o asset,
  // pedimos com data.
  const [campRes, piecesRes] = await Promise.all([
    fetch(`/api/campaigns/${campaignId}`).then(r => r.json()),
    fetch(`/api/pieces?campaignId=${campaignId}&withData=true`).then(r => r.json()),
  ])
  const assets: Asset[] = campRes.assets ?? []
  const pieces: any[] = Array.isArray(piecesRes) ? piecesRes : []

  // PERF: paraleliza o regen com concorrencia 3 — antes era sequencial
  // (30 pecas × 200-500ms cada = 6-15s bloqueando). Agora ~3x mais rapido.
  await runWithConcurrency(pieces, 3, async (piece) => {
    const pdata = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
    if (!pdata || pdata.version !== 2) return

    // MULTI-STEP: pdata.steps[] contem layers de cada step. Cada step precisa
    // de seu proprio thumb (via /step-thumbnail?index=N). O thumb principal
    // (piece.imageUrl) usa o step ATIVO.
    const steps: any[] = Array.isArray(pdata.steps) ? pdata.steps : []
    const isMultiStep = steps.length >= 2

    if (isMultiStep) {
      const W = pdata.width ?? 1080
      const H = pdata.height ?? 1080
      const activeIdx = typeof pdata.activeStepIndex === "number" ? pdata.activeStepIndex : 0
      let regeneratedSomething = false

      // Paraleliza steps internamente — concorrencia 2 (dentro do worker pai
      // que ja eh 3, totalizando ~6 renders simultaneos no pico).
      const stepIndices = steps.map((_, i) => i)
      await runWithConcurrency(stepIndices, 2, async (i) => {
        const step = steps[i]
        if (!step || !Array.isArray(step.layers)) return
        const stepUsesAsset = step.layers.some((l: any) => l?.assetId === assetId)
        if (!stepUsesAsset) return
        // BG canonico do step (helper unificado bgFromAny). Inclui bgColor
        // legacy derivado pra back-compat com renderers que ainda leem root.
        const { bgFromAny, packBgForSave } = await import("@/lib/bgLayers")
        const stepBg = bgFromAny(step)
        const bgFinal = stepBg.length > 0 && stepBg[0] !== undefined ? stepBg : bgFromAny(pdata)
        const pseudoStepPiece = {
          version: 2,
          width: W, height: H,
          ...packBgForSave(bgFinal),
          layers: step.layers,
        }
        try {
          const blob = await buildThumbnailFromPieceData(pseudoStepPiece, assets)
          if (!blob) return
          const fd = new FormData()
          fd.append("thumbnail", blob, `step${i}.jpg`)
          await fetch(`/api/pieces/${piece.id}/step-thumbnail?index=${i}`, { method: "POST", body: fd })
          regeneratedSomething = true
          if (i === activeIdx) {
            const fdMain = new FormData()
            fdMain.append("thumbnail", blob, "thumb.jpg")
            await fetch(`/api/pieces/${piece.id}/thumbnail`, { method: "POST", body: fdMain })
          }
        } catch (e) {
          console.warn("regen step falhou", piece.id, i, e)
        }
      })

      if (regeneratedSomething) {
        broadcastPieceUpdated(piece.id, campaignId)
        return
      }
    }

    // SINGLE-STEP
    if (!Array.isArray(pdata.layers)) return
    const usesAsset = pdata.layers.some((l: any) => l.assetId === assetId)
    if (!usesAsset) return

    try {
      const blob = await buildThumbnailFromPieceData(pdata, assets)
      if (!blob) return
      const fd = new FormData()
      fd.append("thumbnail", blob, "thumb.jpg")
      await fetch(`/api/pieces/${piece.id}/thumbnail`, { method: "POST", body: fd })
      broadcastPieceUpdated(piece.id, campaignId)
    } catch (e) {
      console.warn("regen falhou para peca", piece.id, e)
    }
  })
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
// renderPieceThumbViaExport REMOVIDO 2026-05-27: era duplicata de
// buildThumbnailFromPieceData (agora unificado pra usar buildPieceCanvas).
// Mantemos so 1 renderer source-of-truth.
const renderPieceThumbViaExport = (pieceLike: { data: any; width: number; height: number }, assets: Asset[]) =>
  buildThumbnailFromPieceData(pieceLike.data, assets)

// Cache de campaign por id, TTL 10s + in-flight dedup. Sem in-flight,
// 5 regens paralelas faziam 5 fetches simultaneos (todas viam cache miss
// no mesmo instante). Agora a primeira inicia o fetch e as outras await.
// User reportou 2026-05-27 'sistema muito lento ate em local'.
const __campCache = new Map<string, { ts: number; data: any }>()
const __campInflight = new Map<string, Promise<any>>()
const __CAMP_CACHE_TTL_MS = 10_000

async function getCampaignCached(campaignId: string): Promise<any | null> {
  const cached = __campCache.get(campaignId)
  if (cached && Date.now() - cached.ts < __CAMP_CACHE_TTL_MS) return cached.data
  let inflight = __campInflight.get(campaignId)
  if (!inflight) {
    inflight = (async () => {
      // PERF 2026-05-27: ?lite=true pula KV.data + KV.layers (raster mask
      // pode ter 98KB+). Regen so precisa de assets, nao da matriz inteira.
      const campRes = await fetch(`/api/campaigns/${campaignId}?lite=true`, { cache: "no-store" })
      if (!campRes.ok) return null
      const camp = await campRes.json()
      __campCache.set(campaignId, { ts: Date.now(), data: camp })
      return camp
    })()
    __campInflight.set(campaignId, inflight)
    inflight.finally(() => __campInflight.delete(campaignId))
  }
  return await inflight
}

export async function regeneratePieceThumb(pieceId: string): Promise<boolean> {
  try {
    const pieceRes = await fetch(`/api/pieces/${pieceId}`, { cache: "no-store" })
    if (!pieceRes.ok) return false
    const piece = await pieceRes.json()
    const campaignId = piece?.campaignId
    if (!campaignId) return false
    const camp = await getCampaignCached(campaignId)
    if (!camp) return false
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
