// Aplica uma LayerMask em um objeto Fabric.js.
//
// - Raster mask: cria fabric.Image do PNG grayscale e usa como clipPath
//   com globalCompositeOperation pra simular alpha. (Em Fabric v7, clipPath
//   simples nao suporta tons de cinza nativamente - usamos absolutePositioned
//   + Image como mascara binaria; valores cinza ficam como semi-transparencia.)
// - Vector mask: parseia o SVG path e cria fabric.Path como clipPath.
// - Clipping mask: nao se aplica via clipPath direto; o componente que renderiza
//   precisa olhar zIndex e re-encadear (sera tratado a parte).

import type { LayerMask } from "@/lib/maskTypes"

export async function applyMaskToFabricObject(fabric: any, obj: any, mask: LayerMask | null | undefined): Promise<void> {
  if (!mask || !mask.enabled) return

  // Salva o objeto LayerMask original no Fabric object pra round-trip do save.
  // Sem isso, ao salvar perderia o tipo/path/dataUrl original e so sobraria
  // o clipPath aplicado (que nao da pra serializar de volta no formato LayerMask).
  ;(obj as any).__maskData = mask

  try {
    if (mask.type === "vector" && mask.vector) {
      // Vector mask: cria fabric.Path com o SVG path d="..."
      // absolutePositioned=true faz o clipPath usar coordenadas absolutas do canvas
      // (nao relativas ao objeto). Assim a mascara fica onde estava no PSD.
      const clipPath = new fabric.Path(mask.vector.path, {
        absolutePositioned: true,
        // 'inverted' (Fabric v7) inverte o clipPath - fora do path = visivel.
        inverted: !!mask.inverted,
      })
      obj.clipPath = clipPath
      obj.dirty = true
      return
    }

    if (mask.type === "raster" && mask.raster) {
      // Raster mask: carrega PNG como fabric.Image, usa como clipPath.
      // Em Fabric v7 isso funciona como binario (alpha do PNG decide).
      await new Promise<void>((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
          try {
            const fImg = new fabric.Image(img, {
              left: mask.raster!.posX,
              top: mask.raster!.posY,
              originX: "left",
              originY: "top",
              absolutePositioned: true,
              inverted: !!mask.inverted,
              scaleX: mask.raster!.width / img.width,
              scaleY: mask.raster!.height / img.height,
            })
            obj.clipPath = fImg
            obj.dirty = true
            resolve()
          } catch (e) { reject(e) }
        }
        img.onerror = () => reject(new Error("Falha carregar raster mask"))
        img.src = mask.raster!.dataUrl
      })
      return
    }

    if (mask.type === "clipping" && mask.clipping) {
      // Clipping mask precisa de tratamento no nivel do renderer (referencia o
      // layer abaixo). Aqui apenas marca uma flag pra o renderer reagir.
      ;(obj as any).__clippingMask = true
      return
    }
  } catch (e) {
    console.warn("[applyMaskToFabricObject] falha:", e)
  }
}
