"use client"
// Cascateia mudancas no Client.brandColors pra todas as peças do cliente que
// referenciam essas cores via fillBrandIdx (texto) ou colorBrandIdx (BG solid).

// Broadcast helpers — notifica /campaigns/[id], /pieces, /presentation, etc
// pra refetch IMEDIATO. Mesma logica usada em lib/regenerateThumbs.ts.
// Sem isso, mudancas de brand font/cor regeravam thumbs mas as views abertas
// nao percebiam ate proximo focus/visibility (user reportou 2026-05-22:
// "quando mudo a fonte do cliente os preview nao atualizam na hora").
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
  let changed = false
  // Fill DEFAULT do textbox (fillBrandIdx no override raiz)
  if (ov && typeof ov.fillBrandIdx === "number") {
    const live = brandColors[ov.fillBrandIdx]
    if (live?.hex && /^#[0-9a-fA-F]{6}$/.test(live.hex)
        && live.hex.toLowerCase() !== String(ov.fill ?? "").toLowerCase()) {
      ov.fill = live.hex
      changed = true
    }
  }
  // Styles per-char com fillBrandIdx (quando swatch Marca foi aplicado via
  // seleção parcial). Atualiza fill de cada char vinculado.
  if (ov?.styles && typeof ov.styles === "object") {
    for (const lineKey of Object.keys(ov.styles)) {
      const lineStyles = ov.styles[lineKey]
      if (!lineStyles || typeof lineStyles !== "object") continue
      for (const colKey of Object.keys(lineStyles)) {
        const cs = lineStyles[colKey]
        if (!cs || typeof cs.fillBrandIdx !== "number") continue
        const live = brandColors[cs.fillBrandIdx]
        if (!live?.hex || !/^#[0-9a-fA-F]{6}$/.test(live.hex)) continue
        if (live.hex.toLowerCase() !== String(cs.fill ?? "").toLowerCase()) {
          cs.fill = live.hex
          changed = true
        }
      }
    }
  }
  return changed
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
async function renderPieceThumbBlob(piece: any, assets: any[], target = 960): Promise<Blob | null> {
  try {
    const fc = await buildPieceCanvas(piece, assets)
    const data = typeof piece.data === "string" ? JSON.parse(piece.data) : (piece.data ?? {})
    const W = data?.width ?? piece.width ?? 1080
    const H = data?.height ?? piece.height ?? 1080
    const sc = Math.min(target / W, target / H, 1)
    // Guard fonts antes do toDataURL (sweep 2026-05-30).
    const { awaitFontsReadyAndRender } = await import("@/lib/awaitFontsReady")
    await awaitFontsReadyAndRender(fc)
    // JPEG quality 0.82 + crop explicito ao bbox da peca (sweep 2026-05-30).
    const dataUrl = fc.toDataURL({
      format: "jpeg", quality: 0.82, multiplier: sc, enableRetinaScaling: false,
      left: 0, top: 0, width: W, height: H,
    })
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
 *
 * `forceRender` = pula a checagem "data nao mudou" e re-renderiza tudo. Usado
 * quando algum efeito externo (ex: propagacao server-side de brandTypography)
 * ja atualizou o data — precisamos regerar thumbs mesmo sem brand_colors mexer.
 */
export async function cascadeBrandUpdate(
  clientId: string,
  brandColors: BrandColorLike[],
  onProgress?: (p: CascadeProgress) => void,
  forceRender = false,
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

  // Pre-carrega brandFont + customFontFiles + Google Fonts referenciadas nos
  // assets ANTES de comecar a renderizar thumbs. Sem isso, buildPieceCanvas
  // criava Textbox com a brandFont nova mas o browser ainda nao tinha o
  // @font-face registrado -> thumb saia com fallback (Arial). Sintoma reportado:
  // mudar fonte do cliente nao atualizava preview na pagina de campanha.
  try {
    const { loadGoogleFont, loadCustomFontFamily, forceLoadFontFaces } = await import("@/lib/google-fonts")
    if (client.brandFont) {
      const files = Array.isArray(client.customFontFiles) ? client.customFontFiles : []
      if (files.length > 0) loadCustomFontFamily(client.brandFont, files)
      else loadGoogleFont(client.brandFont)
    }
    // Coleta fontFamilies referenciadas em todos os assets de texto pra pre-load
    const fontSet = new Set<string>()
    if (client.brandFont) fontSet.add(client.brandFont)
    for (const camp of campaigns) {
      for (const a of (camp.assets ?? [])) {
        if (a.type !== "TEXT") continue
        const spans: any = typeof a.content === "string"
          ? (() => { try { return JSON.parse(a.content) } catch { return [] } })()
          : a.content
        if (Array.isArray(spans)) for (const s of spans) {
          if (typeof s?.style?.fontFamily === "string") fontSet.add(s.style.fontFamily)
        }
        const lo = (a as any).lastOverride
        if (lo && typeof lo.fontFamily === "string") fontSet.add(lo.fontFamily)
      }
    }
    for (const fn of fontSet) loadGoogleFont(fn)
    await forceLoadFontFaces(Array.from(fontSet), 6000)
    try { await (document as any).fonts?.ready } catch {}
  } catch (e) { console.warn("[cascadeBrandUpdate] preload fonts falhou:", e) }

  // 2. Pra cada campanha, busca pieces + assets em paralelo
  const allWork: Array<{ piece: any; assets: any[] }> = []
  await Promise.all(
    campaigns.map(async (camp) => {
      try {
        const [piecesRes, campRes] = await Promise.all([
          // withData=true: cascadeBrandUpdate processa piece.data direto (resolve
          // brand refs em todas layers). Default da rota (perf opt 2026-05-26)
          // strippa data — opt-in pra incluir.
          fetch(`/api/pieces?campaignId=${camp.id}&withData=true`, { cache: "no-store" }).then(r => r.ok ? r.json() : []),
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

  console.log("[brand-cascade] start", { clientId, pieces: allWork.length, kvs: kvWork.length, brandColors })

  // 3. Processa cada piece em sequência (evita pico de memória ao renderizar
  //    muitas pieces em paralelo — cada thumb ~1600px é caro). Cada piece:
  //    fetch data completo → aplica refs → PATCH + regen thumb se mudou.
  for (const { piece, assets } of allWork) {
    try {
      // pieces?campaignId retorna SEM data completo (so com width/height/etc).
      // Precisamos do data inteiro pra aplicar refs.
      const freshRes = await fetch(`/api/pieces/${piece.id}`, { cache: "no-store" })
      if (!freshRes.ok) { done++; onProgress?.({ total: totalAll, done, pieceIds: touched }); continue }
      const freshPiece = await freshRes.json()
      const data = typeof freshPiece.data === "string" ? JSON.parse(freshPiece.data) : (freshPiece.data ?? {})
      // DEBUG: lista quem tem brand ref pra confirmar que o ref foi salvo
      const refsFound: any[] = []
      const collectRefs = (block: any, prefix: string) => {
        if (Array.isArray(block?.layers)) {
          block.layers.forEach((l: any, i: number) => {
            if (typeof l?.overrides?.fillBrandIdx === "number") {
              refsFound.push({ where: `${prefix}layers[${i}]`, fillBrandIdx: l.overrides.fillBrandIdx, fill: l.overrides.fill, assetId: l.assetId })
            }
          })
        }
        if (Array.isArray(block?.bgLayers)) {
          block.bgLayers.forEach((b: any, i: number) => {
            if (b?.kind === "solid" && typeof b?.colorBrandIdx === "number") {
              refsFound.push({ where: `${prefix}bgLayers[${i}]`, colorBrandIdx: b.colorBrandIdx, color: b.color })
            }
          })
        }
      }
      collectRefs(data, "")
      if (Array.isArray(data.steps)) data.steps.forEach((s: any, i: number) => collectRefs(s, `steps[${i}].`))
      console.log("[brand-cascade] piece", piece.id, "name:", freshPiece.name, "refs:", refsFound)

      const dataCopy = JSON.parse(JSON.stringify(data))
      const changed = resolveBrandRefsInData(dataCopy, brandColors)
      console.log("[brand-cascade] piece", piece.id, "changed:", changed, "force:", forceRender)
      // Pula re-render quando nao mudou nada E nao estamos em modo force
      // (force = typography mudou server-side e thumb precisa refletir).
      if (!changed && !forceRender) { done++; onProgress?.({ total: totalAll, done, pieceIds: touched }); continue }

      // Persiste novo data SOMENTE se cores mudaram aqui no cliente — em modo
      // force, server ja persistiu e mexer aqui sobrescreveria. Em modo cor
      // normal, persistimos.
      if (changed) {
        const patchRes = await fetch(`/api/pieces/${freshPiece.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: JSON.stringify(dataCopy) }),
        })
        console.log("[brand-cascade] piece", piece.id, "PATCH status:", patchRes.status)
      }

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

      // Broadcast pra views abertas (/campaigns/[id], /pieces, /presentation)
      // refetcharem IMEDIATO. Antes ficavam stale ate focus event.
      broadcastPieceUpdated(freshPiece.id, freshPiece.campaignId ?? piece.campaignId)
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
      if (!changed && !forceRender) { done++; onProgress?.({ total: totalAll, done, pieceIds: touched }); continue }

      // Persiste KV atualizado SOMENTE se cores mudaram (em force, server ja salvou)
      if (changed) {
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
      }

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
      // Broadcast pra campaign overview / dashboard refetch o KV thumb novo.
      broadcastKvUpdated(campaignId)
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
