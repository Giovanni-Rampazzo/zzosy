"use client"
// Cascateia mudancas no Client.brandColors pra todas as peças do cliente que
// referenciam essas cores via fillBrandIdx (texto) ou colorBrandIdx (BG solid).
//
// Fluxo:
//  1. Lista campanhas do cliente (/api/clients/[id])
//  2. Pra cada campanha, lista pieces + busca assets
//  3. Pra cada piece, fetcha data completo + aplica resolveBrandRefsInData
//  4. Se data mudou: PATCH piece com novo data + regenera thumb via
//     buildPieceCanvas (rendering offscreen) + upload
//  5. Pra multi-step pieces: regenera step thumbs também
//
// Roda 100% no client. Pesado pra catalogos grandes — pode ser otimizado em
// V2 com endpoint server-side que faz update do data + flag "thumb dirty"
// (regen on-the-fly quando alguem ver a peça).

import { buildPieceCanvas } from "./exportPiece"

interface BrandColorLike { hex: string; name?: string | null }

// Aplica brand refs num objeto (layer override OU bg layer). Retorna true se
// alguma cor foi atualizada in-place.
function resolveOverrideFill(ov: any, brandColors: BrandColorLike[]): boolean {
  if (!ov || typeof ov.fillBrandIdx !== "number") return false
  const live = brandColors[ov.fillBrandIdx]
  if (!live?.hex || !/^#[0-9a-fA-F]{6}$/.test(live.hex)) return false
  if (live.hex.toLowerCase() === String(ov.fill ?? "").toLowerCase()) return false
  ov.fill = live.hex
  return true
}

function resolveBgLayer(bg: any, brandColors: BrandColorLike[]): boolean {
  if (!bg || bg.kind !== "solid" || typeof bg.colorBrandIdx !== "number") return false
  const live = brandColors[bg.colorBrandIdx]
  if (!live?.hex || !/^#[0-9a-fA-F]{6}$/.test(live.hex)) return false
  if (live.hex.toLowerCase() === String(bg.color ?? "").toLowerCase()) return false
  bg.color = live.hex
  return true
}

// Aplica brand refs em uma estrutura {layers, bgLayers, bgColor} (usado tanto
// pro data principal quanto pra cada step). Sincroniza bgColor com bgLayers[0]
// pra back-compat com leitores legacy.
function resolveBrandRefsInBlock(block: any, brandColors: BrandColorLike[]): boolean {
  if (!block) return false
  let changed = false
  if (Array.isArray(block.layers)) {
    for (const layer of block.layers) {
      if (resolveOverrideFill(layer?.overrides, brandColors)) changed = true
    }
  }
  if (Array.isArray(block.bgLayers)) {
    for (const bg of block.bgLayers) {
      if (resolveBgLayer(bg, brandColors)) changed = true
    }
    // Espelho legacy: bgColor = BG[0].color quando solid
    if (block.bgLayers[0]?.kind === "solid" && typeof block.bgLayers[0].color === "string") {
      block.bgColor = block.bgLayers[0].color
    }
  }
  return changed
}

// Resolve brand refs em piece.data inteiro (data raiz + cada step).
function resolveBrandRefsInData(data: any, brandColors: BrandColorLike[]): boolean {
  if (!data) return false
  let changed = resolveBrandRefsInBlock(data, brandColors)
  if (Array.isArray(data.steps)) {
    for (const step of data.steps) {
      if (resolveBrandRefsInBlock(step, brandColors)) changed = true
    }
  }
  return changed
}

// Renderiza thumb de uma piece (data + assets) e retorna PNG blob via
// buildPieceCanvas. `target` = max(w,h) do thumb.
async function renderPieceThumbBlob(piece: any, assets: any[], target = 1600): Promise<Blob | null> {
  try {
    const fc = await buildPieceCanvas(piece, assets)
    const data = typeof piece.data === "string" ? JSON.parse(piece.data) : (piece.data ?? {})
    const W = data?.width ?? piece.width ?? 1080
    const H = data?.height ?? piece.height ?? 1080
    const sc = Math.min(target / W, target / H, 1)
    const dataUrl = fc.toDataURL({ format: "jpeg", quality: 0.92, multiplier: sc, enableRetinaScaling: false })
    fc.dispose()
    return await (await fetch(dataUrl)).blob()
  } catch (e) {
    console.warn("[cascadeBrandUpdate] thumb render falhou:", piece.id, e)
    return null
  }
}

export interface CascadeProgress {
  total: number
  done: number
  pieceIds: string[]
}

/**
 * Cascateia uma mudança de brandColors do cliente pra todas as peças.
 * `onProgress` opcional pra mostrar progresso na UI.
 * Retorna a lista de pieceIds atualizadas.
 */
export async function cascadeBrandUpdate(
  clientId: string,
  brandColors: BrandColorLike[],
  onProgress?: (p: CascadeProgress) => void,
): Promise<string[]> {
  // 1. Lista campanhas do cliente
  let client: any
  try {
    const r = await fetch(`/api/clients/${clientId}`, { cache: "no-store" })
    if (!r.ok) return []
    client = await r.json()
  } catch { return [] }
  const campaigns: any[] = Array.isArray(client?.campaigns) ? client.campaigns : []
  if (campaigns.length === 0) return []

  // 2. Pra cada campanha, busca pieces + assets em paralelo
  const allWork: Array<{ piece: any; assets: any[] }> = []
  await Promise.all(
    campaigns.map(async (camp) => {
      try {
        const [piecesRes, campRes] = await Promise.all([
          fetch(`/api/pieces?campaignId=${camp.id}`, { cache: "no-store" }).then(r => r.ok ? r.json() : []),
          fetch(`/api/campaigns/${camp.id}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null),
        ])
        const pieces: any[] = Array.isArray(piecesRes) ? piecesRes : []
        const assets: any[] = Array.isArray(campRes?.assets) ? campRes.assets : []
        for (const p of pieces) allWork.push({ piece: p, assets })
      } catch (e) {
        console.warn("[cascadeBrandUpdate] falha listar campaign", camp.id, e)
      }
    })
  )

  // KV de cada campanha (matriz): processa em paralelo com pieces. Cada KV
  // conta como 1 "item" no progresso total. KV nao tem `data.steps` nem
  // multi-step — eh sempre 1 layer set.
  const kvWork: Array<{ campaignId: string; assets: any[] }> = []
  await Promise.all(
    campaigns.map(async (camp) => {
      // Reusa o fetch de assets ja feito no allWork loop acima
      const existing = allWork.find(w => w.piece?.campaignId === camp.id)
      const assets = existing?.assets ?? []
      // Se nao tinha pieces pra essa camp, ainda processa o KV (com fetch assets)
      let resolvedAssets = assets
      if (resolvedAssets.length === 0) {
        try {
          const c = await fetch(`/api/campaigns/${camp.id}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null)
          resolvedAssets = Array.isArray(c?.assets) ? c.assets : []
        } catch { resolvedAssets = [] }
      }
      kvWork.push({ campaignId: camp.id, assets: resolvedAssets })
    })
  )

  const touched: string[] = []
  let done = 0
  const totalAll = allWork.length + kvWork.length
  onProgress?.({ total: totalAll, done, pieceIds: [] })

  // 3. Processa cada piece em sequência (evita pico de memória ao renderizar
  //    muitas pieces em paralelo — cada thumb ~1600px é caro). Cada piece:
  //    fetch data completo → aplica refs → PATCH + regen thumb se mudou.
  for (const { piece, assets } of allWork) {
    try {
      // pieces?campaignId retorna SEM data completo (so com width/height/etc).
      // Precisamos do data inteiro pra aplicar refs.
      const freshRes = await fetch(`/api/pieces/${piece.id}`, { cache: "no-store" })
      if (!freshRes.ok) { done++; onProgress?.({ total: allWork.length, done, pieceIds: touched }); continue }
      const freshPiece = await freshRes.json()
      const data = typeof freshPiece.data === "string" ? JSON.parse(freshPiece.data) : (freshPiece.data ?? {})
      const dataCopy = JSON.parse(JSON.stringify(data))
      const changed = resolveBrandRefsInData(dataCopy, brandColors)
      if (!changed) { done++; onProgress?.({ total: allWork.length, done, pieceIds: touched }); continue }

      // Persiste novo data
      await fetch(`/api/pieces/${freshPiece.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: dataCopy }),
      })

      // Regenera thumb principal (do step ativo / single-step)
      const activeStepIdx = typeof dataCopy.activeStepIndex === "number" ? dataCopy.activeStepIndex : 0
      const activeStep = Array.isArray(dataCopy.steps) ? dataCopy.steps[activeStepIdx] : null
      const pieceForRender = activeStep
        ? { ...freshPiece, data: { ...dataCopy, layers: activeStep.layers, bgColor: activeStep.bgColor, bgOpacity: activeStep.bgOpacity, bgLayers: activeStep.bgLayers } }
        : { ...freshPiece, data: dataCopy }
      const mainBlob = await renderPieceThumbBlob(pieceForRender, assets, 1600)
      if (mainBlob) {
        const fd = new FormData()
        fd.append("thumbnail", mainBlob, "thumb.jpg")
        await fetch(`/api/pieces/${freshPiece.id}/thumbnail`, { method: "POST", body: fd })
      }

      // Multi-step: regenera cada step thumb também
      if (Array.isArray(dataCopy.steps) && dataCopy.steps.length >= 2) {
        for (let i = 0; i < dataCopy.steps.length; i++) {
          const step = dataCopy.steps[i]
          if (!step) continue
          const stepPiece = { ...freshPiece, data: { ...dataCopy, layers: step.layers, bgColor: step.bgColor, bgOpacity: step.bgOpacity, bgLayers: step.bgLayers } }
          const stepBlob = await renderPieceThumbBlob(stepPiece, assets, 2400)
          if (!stepBlob) continue
          const fd = new FormData()
          fd.append("thumbnail", stepBlob, `step${i}.jpg`)
          await fetch(`/api/pieces/${freshPiece.id}/step-thumbnail?index=${i}`, { method: "POST", body: fd })
        }
      }

      touched.push(freshPiece.id)
    } catch (e) {
      console.warn("[cascadeBrandUpdate] piece falhou:", piece.id, e)
    } finally {
      done++
      onProgress?.({ total: totalAll, done, pieceIds: touched })
    }
  }

  // Processa KVs (matriz). Pra cada campanha:
  //   1. GET /api/campaigns/[id]/key-vision
  //   2. Aplica brand refs nas layers (texto fillBrandIdx)
  //   3. PUT KV com layers atualizados
  //   4. Regenera thumb via /api/campaigns/[id]/key-vision/thumbnail
  for (const { campaignId, assets } of kvWork) {
    try {
      const kvRes = await fetch(`/api/campaigns/${campaignId}/key-vision`, { cache: "no-store" })
      if (!kvRes.ok) { done++; onProgress?.({ total: totalAll, done, pieceIds: touched }); continue }
      const kv = await kvRes.json()
      if (!kv || !Array.isArray(kv.layers)) { done++; onProgress?.({ total: totalAll, done, pieceIds: touched }); continue }
      const kvCopy = JSON.parse(JSON.stringify(kv))
      const changed = resolveBrandRefsInBlock(kvCopy, brandColors)
      if (!changed) { done++; onProgress?.({ total: totalAll, done, pieceIds: touched }); continue }

      // Persiste KV atualizado
      await fetch(`/api/campaigns/${campaignId}/key-vision`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bgColor: kvCopy.bgColor,
          layers: kvCopy.layers,
          width: kvCopy.width,
          height: kvCopy.height,
          data: kvCopy.data,
        }),
      })

      // Regenera thumb da matriz reusando renderPieceThumbBlob (KV vira
      // "piece virtual" com layers+bgColor do KV).
      const kvPiece = {
        id: `kv-${campaignId}`,
        data: { version: 2, width: kvCopy.width, height: kvCopy.height, bgColor: kvCopy.bgColor, layers: kvCopy.layers },
        width: kvCopy.width, height: kvCopy.height,
      }
      const blob = await renderPieceThumbBlob(kvPiece, assets, 1600)
      if (blob) {
        const fd = new FormData()
        fd.append("thumbnail", blob, "kv-thumb.jpg")
        await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: fd })
      }
      touched.push(`kv-${campaignId}`)
    } catch (e) {
      console.warn("[cascadeBrandUpdate] KV falhou:", campaignId, e)
    } finally {
      done++
      onProgress?.({ total: totalAll, done, pieceIds: touched })
    }
  }

  return touched
}
