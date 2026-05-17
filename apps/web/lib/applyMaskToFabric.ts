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
      // Sanity check: vector masks importadas com bug do bezier (knots
      // multiplicados 2x por psdW/H antes do fix de 2026-05-17) vinham com
      // coords na casa de 10⁷. Fabric.Path com path absurdo cria bbox
      // gigantesco e o canvas inteiro vira branco. Parseia números do path
      // diretamente — bbox metadata pode estar ok mesmo com path bichado.
      const maxCoord = 1_000_000
      const path = mask.vector.path ?? ""
      const nums = path.match(/-?\d+(?:\.\d+)?/g)
      const hasAbsurd = nums?.some((n: string) => Math.abs(parseFloat(n)) > maxCoord) ?? false
      if (hasAbsurd) {
        console.warn("[mask] vector mask com coords absurdas no path — descartando. Re-importe o PSD.")
        return
      }
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
      // Clipping mask: este layer recorta o layer ABAIXO (zIndex menor).
      // Aplicacao: pegamos o objeto Fabric do layer abaixo, clonamos como clipPath.
      // Marcamos __clippingMask + __clippingTargetIndex pra round-trip do save.
      ;(obj as any).__clippingMask = true
      try {
        const canvas = (obj as any).canvas
        if (canvas) {
          const objs = canvas.getObjects()
          const idx = objs.indexOf(obj)
          // Procura o layer imediatamente abaixo (com zIndex menor) que nao seja bg.
          let target: any = null
          for (let i = idx - 1; i >= 0; i--) {
            const candidate = objs[i]
            if (!(candidate as any).__isBg) { target = candidate; break }
          }
          if (target) {
            // Cria um Rect com bbox do target como clipPath. Idealmente seria o
            // outline real do target, mas isso requer clone profundo (path/textbox).
            // Pra retangulo basico funciona; pra outline preciso de mais trabalho.
            const tx = target.left ?? 0
            const ty = target.top ?? 0
            const tw = (target.width ?? 100) * (target.scaleX ?? 1)
            const th = (target.height ?? 100) * (target.scaleY ?? 1)
            const path = `M ${tx} ${ty} L ${tx + tw} ${ty} L ${tx + tw} ${ty + th} L ${tx} ${ty + th} Z`
            const clipPath = new fabric.Path(path, {
              absolutePositioned: true,
              inverted: false,
            })
            obj.clipPath = clipPath
            obj.dirty = true
          }
        }
      } catch (e) { console.warn("[clipping-mask] falha:", e) }
      return
    }
  } catch (e) {
    console.warn("[applyMaskToFabricObject] falha:", e)
  }
}
