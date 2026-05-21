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
  // Salva o objeto LayerMask original no Fabric object pra round-trip do save.
  // IMPORTANTE: anota ANTES do early-return de !enabled. Mascara desabilitada
  // (enabled=false) ainda precisa ser persistida — Photoshop guarda mascaras
  // ocultas e o user pode re-habilitar. Sem essa anotacao, save grava layers
  // sem mask e ao recarregar a mask some pra sempre.
  if (mask) (obj as any).__maskData = mask
  if (!mask || !mask.enabled) return

  // Photoshop-style: text-layer raster masks sao aplicadas como ALPHA pixel
  // (texto fica semi-transparente nas regioes cinza da mask). Fabric v7 Image
  // clipPath ignora alpha — vira silhueta binaria que recorta o texto como
  // retangulo preto. Sem bake possivel pra texto vetorial. Decisao Adobe-fiel:
  // preserva __maskData pra round-trip ao salvar/exportar PSD, mas pula
  // aplicacao visual no canvas (texto inteiro continua visivel). Re-exportar
  // o PSD mantem a mask no layer.
  const isText = obj?.type === "textbox" || obj?.type === "i-text"
  if (isText && mask.type === "raster") return

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
      // Clipping mask placeholder: chegou aqui pq buildClippingMaskCanvas
      // retornou null no import (clipBase sem canvas + sem composite slice
      // como fallback). Aplicar rect bbox do layer abaixo DESVIRTUA o resultado
      // visual (audit F11): em PS o photo eh recortado pelo SILHUETTE real,
      // nao pelo bbox retangular.
      //
      // Antes (pre-F11): criava Fabric.Path rect ABS com bbox do target →
      // photo apareceria recortado em quadrado, e o user veria a foto
      // extrapolar a forma curva da silhueta.
      //
      // Decisao Adobe-fiel: melhor NAO aplicar mask alguma e mostrar o photo
      // inteiro do que mascarar errado. Anotacao __clippingMask preserva
      // round-trip pro PSD export. User pode reaplicar mask manualmente no
      // editor com Vector Mask – Reveal All / Hide All ou desenhar.
      ;(obj as any).__clippingMask = true
      return
    }
  } catch (e) {
    console.warn("[applyMaskToFabricObject] falha:", e)
  }
}
