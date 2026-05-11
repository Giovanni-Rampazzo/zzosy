// Converte uma LayerMask (formato interno ZZOSY) pro formato esperado pelo
// ag-psd ao escrever um PSD. Cada tipo (raster/vector/clipping) traduz pra
// uma estrutura diferente.

import type { LayerMask } from "@/lib/maskTypes"

/**
 * Gera os campos { mask, vectorMask, clipping } pra anexar num layer ag-psd.
 * Retorna {} se mascara desabilitada ou inexistente.
 *
 * Raster: mask.canvas com o grayscale + left/top/right/bottom.
 * Vector: vectorMask.paths com knots derivados do bounding box (V1 retangular).
 * Clipping: { clipping: true }.
 */
export async function maskToAgPsd(mask: LayerMask | null | undefined): Promise<{
  mask?: any
  vectorMask?: any
  clipping?: boolean
  disabled?: boolean
}> {
  if (!mask || !mask.enabled) return {}

  try {
    if (mask.type === "raster" && mask.raster) {
      // Carrega o PNG da raster mask num canvas pra ag-psd serializar.
      const canvas = await loadPngToCanvas(mask.raster.dataUrl)
      return {
        mask: {
          canvas,
          left: Math.round(mask.raster.posX),
          top: Math.round(mask.raster.posY),
          right: Math.round(mask.raster.posX + mask.raster.width),
          bottom: Math.round(mask.raster.posY + mask.raster.height),
          disabled: !mask.enabled,
        },
      }
    }

    if (mask.type === "vector" && mask.vector) {
      // V1: extrai os 4 cantos do path retangular pra montar o vectorMask.
      // ag-psd usa coords como fracoes 0..1 do canvas; precisamos saber as
      // dimensoes do canvas. Esse helper apenas devolve o esqueleto; o
      // chamador faz a normalizacao.
      // TODO V2: parseia path SVG completo pra paths arbitrarios.
      const v = mask.vector
      return {
        vectorMask: {
          // ag-psd structure: { paths: [{ knots: [{ anchor: [x, y] }, ...] }] }
          // Coords aqui em px do canvas - o chamador normaliza pra 0..1.
          paths: [{
            knots: [
              { anchor: [v.posX, v.posY] },
              { anchor: [v.posX + v.width, v.posY] },
              { anchor: [v.posX + v.width, v.posY + v.height] },
              { anchor: [v.posX, v.posY + v.height] },
            ],
            closed: true,
          }],
          disabled: !mask.enabled,
          _zzosyPxCoords: true, // flag pro chamador normalizar
        },
      }
    }

    if (mask.type === "clipping" && mask.clipping) {
      return { clipping: true }
    }
  } catch (e) {
    console.warn("[maskToAgPsd] falha:", e)
  }
  return {}
}

function loadPngToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const c = document.createElement("canvas")
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext("2d")!
      ctx.drawImage(img, 0, 0)
      resolve(c)
    }
    img.onerror = () => reject(new Error("Falha carregar PNG da raster mask"))
    img.src = dataUrl
  })
}

/**
 * Normaliza coords px → fracao 0..1 do canvas. Chamada pelo export depois
 * que o vectorMask foi gerado, quando o W/H do canvas e conhecido.
 */
export function normalizeVectorMaskCoords(vectorMask: any, canvasW: number, canvasH: number): any {
  if (!vectorMask || !vectorMask._zzosyPxCoords) return vectorMask
  const out = {
    ...vectorMask,
    paths: vectorMask.paths.map((p: any) => ({
      ...p,
      knots: p.knots.map((k: any) => ({
        ...k,
        anchor: [k.anchor[0] / canvasW, k.anchor[1] / canvasH],
      })),
    })),
  }
  delete out._zzosyPxCoords
  return out
}
