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
      // ROUND-TRIP CLIPPING (2026-05-27): se essa raster mask nasceu de uma
      // clipping chain (importer marca __fromClipping=true via clipping.ts),
      // exporta de volta como CLIPPING — não como raster.
      //
      // Por que: o silhouette raster é só uma cópia bakeada da alpha do layer
      // BASE de baixo. Se exportamos como raster, o PSD fica com mask gigante
      // (98KB) e o Photoshop NÃO mostra como clipping (perde o tipo + a
      // ligação dinâmica ao layer base — usuario edita PA_Sicredi e IMG_A
      // não acompanha). User reportou 2026-05-27 "máscaras erradas".
      //
      // Importer sempre converte clipping → raster pra editor renderizar,
      // mas no export queremos voltar pra clipping puro.
      if ((mask as any).__fromClipping === true) {
        return { clipping: true }
      }
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
      // ag-psd v18 espera knots com a chave 'points' = array de 6 floats
      // [cpL_x, cpL_y, anchor_x, anchor_y, cpR_x, cpR_y]. Pra cantos retos
      // (sem curva), cpL = anchor = cpR — assim o segmento entre dois knots
      // vira reta. ANTES usavamos { anchor: [x,y] } e ag-psd lia points
      // como undefined → 'Cannot read properties of undefined (reading 1)'.
      // TODO V2: parseia path SVG completo pra paths arbitrarios.
      const v = mask.vector
      const mk = (x: number, y: number) => ({ points: [x, y, x, y, x, y] })
      return {
        vectorMask: {
          // Coords aqui em px do canvas - o chamador normaliza pra 0..1.
          paths: [{
            knots: [
              mk(v.posX,             v.posY),
              mk(v.posX + v.width,   v.posY),
              mk(v.posX + v.width,   v.posY + v.height),
              mk(v.posX,             v.posY + v.height),
            ],
            // ag-psd: open=false => path fechado (knot type linkedKnot=1).
            // closed:true nao eh propriedade reconhecida; usamos open:false.
            open: false,
            fillRule: "even-odd",
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
 *
 * IMPORTANTE: ag-psd writeBezierKnot ja divide por width/height internamente
 * (escreve writeFixedPointPath32(points[i] / width)), entao na verdade ele
 * espera coords em PIXEL e divide ele mesmo. Mas com `writeUint16(width)` /
 * `writeUint16(height)` o ag-psd sabe qual o canvas. NAO devemos pre-dividir.
 * Esta funcao agora soh remove a flag interna e mantem points em pixel.
 */
export function normalizeVectorMaskCoords(vectorMask: any, _canvasW: number, _canvasH: number): any {
  if (!vectorMask || !vectorMask._zzosyPxCoords) return vectorMask
  const out = { ...vectorMask }
  delete out._zzosyPxCoords
  return out
}
