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
      // SHAPE layer redundancy: PSD shape layers usam vectorMask COMO definicao
      // do proprio shape. O reader extrai esse vectorMask em DOIS lugares:
      //   1. asset.content.path (define a forma)
      //   2. layer.mask.vector.path (re-lido como mascara)
      // Aplicar clipPath = path do shape parece inofensivo (clipa pra si mesmo)
      // MAS o stroke do Fabric eh centrado no path — metade dele extrapola pra
      // fora. clipPath corta justamente essa metade externa, fazendo stroke
      // aparecer 50% mais fino + visivel apenas internamente. Sintoma reportado
      // 2026-05-23: "box verde com stroke preto nao esta importando direito".
      // Skipa quando obj eh PATH e path do mask === path do obj.
      // Shape PARAMETRIC (rect/roundedRect/ellipse): o path PROPRIO ja eh a
      // geometria final. Mask vector pra um shape parametric eh sempre redundante
      // (PSD shape layer = vectorMask). Skip imediato, sem comparar paths
      // (paths diferem quando user promoveu rect→roundedRect via cornerRadius).
      if (obj?.__isShape && obj?.__shapeKind) {
        return
      }
      if ((obj?.__isShape || obj?.type === "path") && Array.isArray(obj.path)) {
        // PSD shape layers usam vectorMask como definicao do shape. Reader
        // extrai esse mesmo path em DUAS hops:
        //   1. asset.content.path (vira o shape do Fabric)
        //   2. layer.mask.vector.path (re-lido como mascara)
        // No editor matriz, ambos vem identicos em coords. Em PECA gerada,
        // o mask path pode estar SCALED (ex: matriz 128x30, peca 256x60),
        // mas a TOPOLOGIA do shape eh a mesma — clipPath = shape sempre.
        //
        // Comparar paths normalizando pra bbox 0-1: extrai bbox, mapeia cada
        // numero ao range relativo, compara estruturas. Match = redundante.
        //
        // Sem skip, o clipPath corta o stroke (que Fabric centraliza no path):
        // metade externa fica fora do mask e somem visualmente. Sintoma:
        // "shape com stroke nao importa direito".
        const tokenize = (s: string): Array<string|number> => {
          const toks = s.match(/[mlhvcsqtazMLHVCSQTAZ]|-?\d+(?:\.\d+)?/g) || []
          return toks.map(t => /^-?\d/.test(t) ? Number(t) : t.toLowerCase())
        }
        const normalize = (toks: Array<string|number>): string => {
          const nums = toks.filter((t): t is number => typeof t === "number")
          if (nums.length === 0) return toks.join(" ")
          // Bbox: alterna X,Y nas posicoes pares/impares (heuristica simples).
          // Pra rects+curves do PSD shape, todos numeros vem em pares (x,y).
          const xs: number[] = [], ys: number[] = []
          for (let i = 0; i < nums.length; i++) (i % 2 === 0 ? xs : ys).push(nums[i])
          const minX = Math.min(...xs), maxX = Math.max(...xs)
          const minY = Math.min(...ys), maxY = Math.max(...ys)
          const dx = maxX - minX || 1
          const dy = maxY - minY || 1
          let xi = 0, yi = 0
          return toks.map(t => {
            if (typeof t === "string") return t
            const isX = (xi + yi) % 2 === 0
            if (isX) { const n = (t - minX) / dx; xi++; return n.toFixed(3) }
            else { const n = (t - minY) / dy; yi++; return n.toFixed(3) }
          }).join(" ")
        }
        const objNorm = normalize(tokenize(obj.path.map((c: any[]) => c.join(" ")).join(" ")))
        const maskNorm = normalize(tokenize(path))
        if (objNorm === maskNorm
            || objNorm.replace(/\s*z\s*$/, "") === maskNorm.replace(/\s*z\s*$/, "")) {
          // Path topologicamente identico (independente de scale/posicao) —
          // mask redundante. Preserva __maskData pra round-trip de PSD export.
          return
        }
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
