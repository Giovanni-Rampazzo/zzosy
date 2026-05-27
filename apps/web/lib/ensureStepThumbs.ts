"use client"
// Gera + faz upload de thumbnails faltantes pros steps de pieces multi-step.
// Usado pelo export PPTX (apresentacao) pra garantir que TODOS os steps tenham
// preview antes de serem desenhados no slide. Sem isso, peças cujo usuario nunca
// abriu no editor sairiam como "(sem preview)" no PPT — autoGen do editor so
// roda quando a peca eh aberta.
//
// Estrategia: pra cada step sem imageUrl, monta uma "piece virtual" (mesmo
// piece, mas data.layers/bgColor/bgLayers/bgOpacity = do step), passa pra
// buildPieceCanvas (reusa toda a lib de renderizacao do export), gera blob
// e faz upload via /api/pieces/[id]/step-thumbnail.

import { buildPieceCanvas } from "./exportPiece"

interface PieceLite {
  id: string
  campaignId?: string
  steps?: Array<{ index: number; imageUrl?: string | null; thumbnailUrl?: string | null }> | null
}

type CampaignAssetsFetcher = (campaignId: string) => Promise<any[]>

// Renderiza um step especifico de uma piece num canvas offscreen e retorna
// PNG blob. Reusa buildPieceCanvas montando piece virtual com data do step.
async function renderStepBlob(piece: any, assets: any[], stepIdx: number, target = 960): Promise<Blob | null> {
  const data = typeof piece.data === "string" ? JSON.parse(piece.data) : (piece.data ?? {})
  const allSteps = Array.isArray(data?.steps) ? data.steps : []
  const step = allSteps[stepIdx]
  if (!step) return null
  const virtualPiece = {
    ...piece,
    data: {
      ...data,
      layers: Array.isArray(step.layers) ? step.layers : [],
      bgColor: step.bgColor ?? data.bgColor ?? "#ffffff",
      bgOpacity: typeof step.bgOpacity === "number" ? step.bgOpacity : data.bgOpacity,
      bgLayers: Array.isArray(step.bgLayers) ? step.bgLayers : data.bgLayers,
      version: 2,
    },
  }
  const W = data?.width ?? piece.width ?? 1080
  const H = data?.height ?? piece.height ?? 1080
  try {
    const fc = await buildPieceCanvas(virtualPiece, assets)
    const sc = Math.min(target / W, target / H, 1)
    // JPEG quality 0.82 (era PNG) — peca tem bg solido. 2026-05-26 perf sweep.
    const dataUrl = fc.toDataURL({ format: "jpeg", quality: 0.82, multiplier: sc, enableRetinaScaling: false })
    fc.dispose()
    return await (await fetch(dataUrl)).blob()
  } catch (e) {
    console.warn(`[ensureStepThumbs] render step ${stepIdx} de ${piece.id} falhou:`, e)
    return null
  }
}

/**
 * Pra cada piece multi-step com 1+ steps sem imageUrl, gera + sobe os thumbs
 * faltantes em paralelo. Retorna lista de pieceIds que tiveram pelo menos um
 * thumb regenerado (caller pode usar pra refetch state).
 *
 * `fetchAssets` deve retornar `camp.assets` da campanha do piece — passar
 * `(campaignId) => fetch(/api/campaigns/${campaignId}).then(r => r.json()).then(c => c.assets)`.
 */
export async function ensureStepThumbsForPieces(
  pieces: PieceLite[],
  fetchAssets: CampaignAssetsFetcher,
): Promise<string[]> {
  const touched: string[] = []
  // Cache de assets por campaign pra evitar refetch da mesma camp
  const assetsByCamp = new Map<string, any[]>()
  async function getAssets(campaignId: string): Promise<any[]> {
    if (assetsByCamp.has(campaignId)) return assetsByCamp.get(campaignId)!
    const a = await fetchAssets(campaignId)
    assetsByCamp.set(campaignId, a)
    return a
  }

  for (const p of pieces) {
    const steps = Array.isArray(p.steps) ? p.steps : []
    if (steps.length < 2) continue
    const missingIdxs = steps
      .map((s, i) => (s?.imageUrl ? null : i))
      .filter((x): x is number => x !== null)
    if (missingIdxs.length === 0) continue
    // Fetch piece data completo (steps com layers) + assets da campanha
    let freshPiece: any
    try {
      const r = await fetch(`/api/pieces/${p.id}`, { cache: "no-store" })
      if (!r.ok) continue
      freshPiece = await r.json()
    } catch (e) {
      console.warn(`[ensureStepThumbs] fetch piece ${p.id} falhou:`, e)
      continue
    }
    const cid = freshPiece?.campaignId ?? p.campaignId
    if (!cid) continue
    let assets: any[] = []
    try { assets = await getAssets(cid) } catch (e) {
      console.warn(`[ensureStepThumbs] fetch assets da camp ${cid} falhou:`, e)
      continue
    }
    let pieceTouched = false
    for (const idx of missingIdxs) {
      const blob = await renderStepBlob(freshPiece, assets, idx)
      if (!blob) continue
      try {
        const fd = new FormData()
        fd.append("thumbnail", blob, `step${idx}.png`)
        const up = await fetch(`/api/pieces/${p.id}/step-thumbnail?index=${idx}`, { method: "POST", body: fd })
        if (up.ok) pieceTouched = true
      } catch (e) {
        console.warn(`[ensureStepThumbs] upload step ${idx} de ${p.id} falhou:`, e)
      }
    }
    if (pieceTouched) touched.push(p.id)
  }
  return touched
}
