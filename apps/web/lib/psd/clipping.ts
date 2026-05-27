/**
 * clipping — resolucao de clipping chains do PSD em masks raster Adobe-fieis.
 *
 * Modulo BROWSER-ONLY (usa Canvas API). Roda em toCampaign apos o reader
 * popular as imageData de cada layer.
 *
 * Conceito Adobe:
 *   - Layer "Clipped" com clipping=true mostra-se SOMENTE onde "Base" abaixo
 *     tem pixels opacos.
 *   - "Base" eh a layer imediatamente abaixo na chain (resolvida em
 *     resolveClippingChains).
 *   - Multiplos Clipped podem clipar pra mesma Base (chain).
 *
 * Estrategia (Adobe-fiel sem ambiguidade):
 *   1. Le base.imageData (dataUrl), desenha em canvas offscreen
 *   2. Extrai alpha channel pra grayscale (R=G=B=A, alpha=255)
 *   3. Devolve como novo PsdRasterMask
 *   4. toCampaign substitui mask.kind="clipping" por mask.kind="raster"
 *      com a silhueta resolved
 *
 * Resultado: editor (applyMaskToFabricObject) ja sabe lidar com raster
 * mask via Fabric.Image clipPath. Sem placeholder rect, sem fallback.
 */
import type { PsdLayer, PsdImageData, PsdRasterMask } from "./types"

/**
 * Le um PsdImageData (dataUrl) e devolve HTMLCanvasElement carregado.
 * Promise-based pra await em sequencia.
 */
function imageDataToCanvas(img: PsdImageData): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || img.format !== "dataUrl" || typeof img.data !== "string") {
      resolve(null); return
    }
    const el = new Image()
    el.onload = () => {
      try {
        const c = document.createElement("canvas")
        c.width = el.naturalWidth || img.width || 1
        c.height = el.naturalHeight || img.height || 1
        const ctx = c.getContext("2d")
        if (!ctx) { resolve(null); return }
        ctx.drawImage(el, 0, 0)
        resolve(c)
      } catch { resolve(null) }
    }
    el.onerror = () => resolve(null)
    el.src = img.data as string
  })
}

/**
 * Converte alpha channel de um canvas em grayscale (R=G=B=alpha, alpha=255).
 * Use-se como silhueta: pixels opacos do source viram brancos na mask
 * (visibilidade total), pixels transparentes viram pretos (invisivel).
 *
 * Adobe clipping mask = mesma logica: clipped layer aparece SOMENTE onde
 * base tem alpha > 0.
 */
function alphaToGrayscale(c: HTMLCanvasElement): HTMLCanvasElement | null {
  const w = c.width, h = c.height
  if (w === 0 || h === 0) return null
  const tmp = document.createElement("canvas")
  tmp.width = w; tmp.height = h
  const tctx = tmp.getContext("2d")
  if (!tctx) return null
  tctx.drawImage(c, 0, 0)
  const id = tctx.getImageData(0, 0, w, h)
  const dd = id.data
  // BUG FIX 2026-05-27: antes setava dd[i+3]=255 (alpha=opaco em tudo).
  // Fabric clipPath usa canal ALPHA pra decidir o que clipa → silhouette
  // virava "mostre tudo" → IMG_A renderizava SEM clipping visual.
  // User reportou 'continua sem mascarar'.
  // Fix: PRESERVAR alpha original. RGB recebem alpha grayscale (debug visual),
  // mas alpha channel mantem original — Fabric usa esse canal pra clip.
  for (let i = 0; i < dd.length; i += 4) {
    const a = dd[i + 3]
    dd[i] = dd[i + 1] = dd[i + 2] = a
    // dd[i + 3] preserva valor original (a) — nao re-set pra 255
  }
  tctx.putImageData(id, 0, 0)
  return tmp
}

/**
 * Resolve clipping chain de UMA layer: substitui mask.kind="clipping"
 * pela silhueta raster do base layer correspondente.
 *
 * Modifica `layer.mask` in-place. Se base nao tem imageData (smart object
 * com canvas vazio, etc), deixa o mask intacto — caller decide o que fazer.
 *
 * @returns true se a clipping foi resolvida pra raster; false caso contrario
 */
export async function resolveLayerClippingMask(
  layer: PsdLayer,
  layersById: Map<string, PsdLayer>,
): Promise<boolean> {
  if (!layer.mask || layer.mask.kind !== "clipping") return false
  const baseId = layer.mask.baseLayerId
  if (!baseId) return false
  const base = layersById.get(baseId)
  if (!base) return false

  // Captura imageData do base. Diferentes tipos guardam em fields diferentes:
  //   - PsdImageLayer.imageData
  //   - PsdSmartObjectLayer.composite (composite rendered pelo PS)
  //   - PsdGroupLayer: sem imageData propria (Fase 4: composite do folder)
  let baseImageData: PsdImageData | null = null
  if (base.type === "image") baseImageData = base.imageData
  else if (base.type === "smartObject") baseImageData = base.composite

  if (!baseImageData || !baseImageData.data) return false

  // Decoda + extrai alpha grayscale via canvas API.
  const baseCanvas = await imageDataToCanvas(baseImageData)
  if (!baseCanvas) return false
  const silhouette = alphaToGrayscale(baseCanvas)
  if (!silhouette) return false

  // Substitui mask.kind=clipping por raster com a silhueta resolved.
  // bbox da mask = bbox do base (escala/posicao do silhouette no canvas).
  const dataUrl = silhouette.toDataURL("image/png")
  const newMask: PsdRasterMask = {
    kind: "raster",
    imageData: {
      data: dataUrl,
      width: silhouette.width,
      height: silhouette.height,
      format: "dataUrl",
    },
    bbox: { ...base.bbox },
    defaultColor: 0, // fora do bbox do base = invisivel (Adobe clipping behavior)
    disabled: false,
    invert: false,
  }
  // Marca __fromClipping pra detectWrapperSmartObjects (e outros consumers)
  // saberem que essa mask raster nasceu de clipping — clipping layers nunca
  // sao wrappers, sao design intencional.
  ;(newMask as any).__fromClipping = true
  layer.mask = newMask
  return true
}

/**
 * Itera o documento inteiro resolvendo TODAS as clipping chains. Operacao
 * BROWSER-SIDE (precisa Canvas API). Modifica `doc` in-place.
 *
 * @returns estatistica de quantas resolveram vs ficaram pendentes
 */
export async function resolveAllClippingChains(
  doc: import("./types").PsdDocument,
): Promise<{ resolved: number; pending: number }> {
  // Build id → layer map (incluindo dentro de folders).
  const layersById = new Map<string, PsdLayer>()
  function collect(layers: PsdLayer[]) {
    for (const l of layers) {
      layersById.set(l.id, l)
      if (l.type === "group") collect(l.children)
    }
  }
  collect(doc.layers)

  let resolved = 0
  let pending = 0
  async function walk(layers: PsdLayer[]) {
    for (const l of layers) {
      if (l.mask?.kind === "clipping") {
        const ok = await resolveLayerClippingMask(l, layersById)
        if (ok) resolved++; else pending++
      }
      if (l.type === "group") await walk(l.children)
    }
  }
  await walk(doc.layers)
  return { resolved, pending }
}
