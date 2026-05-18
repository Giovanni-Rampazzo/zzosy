"use client"
import { useState } from "react"
import { Button } from "@/components/ui/Button"

interface Props {
  campaignId: string
  onImported: () => void
}

function colorToHex(color: any): string {
  if (!color) return "#000000"
  const rr = color.r > 1 ? Math.round(color.r) : Math.round(color.r * 255)
  const gg = color.g > 1 ? Math.round(color.g) : Math.round(color.g * 255)
  const bb = color.b > 1 ? Math.round(color.b) : Math.round(color.b * 255)
  return "#" + [rr, gg, bb].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
}

// Retorna folhas (layers nao-folder) com:
//  - parentHidden: folder ancestral marcado hidden no PSD ⇒ SKIP no import
//  - inheritedRawMask: mask de folder ancestral. Em Photoshop, mask de folder
//    SEMPRE clipa todos os children — e nosso editor precisa reproduzir isso.
//    A heuristica anterior (INHERIT_FOLDER_MASK=false) achava que estava
//    evitando um bug visual num caso especifico, mas na verdade quebrava
//    todos os PSDs onde o designer usa folder mask como viewport (ex: foto
//    dentro de shield, BG dentro de container retangular). Re-habilitado:
//    a logica abaixo so herda quando o layer NAO tem mask propria (mantem
//    a logica de "own mask wins" — Photoshop trata folder+layer mask como
//    INTERSECTION, mas isso fica pra refinamento futuro; preferir a own
//    cobre a maioria dos casos sem regressao visivel).
const INHERIT_FOLDER_MASK = true
type RawMaskRef = { kind: "raster" | "vector"; data: any }

// Computa bbox-uniao das layer-folhas (nao-folder, nao-hidden) de um subtree.
// Usado pra resolver folder masks com positionRelativeToLayer=true: o PS usa
// a uniao dos filhos como origem da mask quando a flag esta ativa.
function computeLeafUnionBbox(layer: any): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  function walk(l: any, parentHidden = false) {
    if (parentHidden || l.hidden === true) return
    if (l.children?.length) {
      for (const c of l.children) walk(c, false)
      return
    }
    const l_ = l.left ?? 0, t_ = l.top ?? 0
    const r_ = l.right ?? l_, b_ = l.bottom ?? t_
    if (r_ > l_ && b_ > t_) {
      minX = Math.min(minX, l_); minY = Math.min(minY, t_)
      maxX = Math.max(maxX, r_); maxY = Math.max(maxY, b_)
    }
  }
  if (Array.isArray(layer.children)) for (const c of layer.children) walk(c, false)
  if (minX === Infinity) return null
  return { minX, minY, maxX, maxY }
}

// groupPath: array de nomes de folder ancestrais (raiz → pai direto). Preserva
// a hierarquia de groups do Photoshop pro round-trip. Sem isso, ao re-exportar
// o PSD designers perdem toda a organização de pastas.
function collectAllLayers(
  layers: any[],
  parentHidden = false,
  inheritedRawMask: RawMaskRef | null = null,
  groupPath: string[] = [],
): Array<{ layer: any; inheritedRawMask: RawMaskRef | null; groupPath: string[]; clipBase: any; adjustments: any[] }> {
  const result: Array<{ layer: any; inheritedRawMask: RawMaskRef | null; groupPath: string[]; clipBase: any; adjustments: any[] }> = []
  // PS clipping chain: layer com clipping=true clipa pela primeira layer
  // NAO-clipping IMEDIATAMENTE ABAIXO no painel = no mesmo grupo. "Abaixo no
  // painel" = INDICE ANTERIOR no array de children (PSD armazena bottom→top).
  // Multiplas clipping consecutivas clipam pela MESMA base.
  let clipBaseInThisFolder: any = null
  // Pre-scan: pra cada index, lista de adjustments que afetam esse layer.
  // PS: adjustment afeta TUDO abaixo dele no mesmo grupo. ag-psd entrega
  // children[0]=baixo, children[N-1]=topo, entao adjustments em indices >
  // current affect current.
  function adjustmentsForIndex(i: number): any[] {
    const adjs: any[] = []
    for (let j = i + 1; j < layers.length; j++) {
      const sib = layers[j]
      if (!sib?.adjustment) continue
      // Adjustment com clipping=true so afeta a layer diretamente abaixo dela.
      // Se nao for nosso caso (i+1 != j), pula. Se for, aceita.
      if (sib.clipping && j !== i + 1) continue
      adjs.push(sib.adjustment)
    }
    return adjs
  }
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    const effectiveHidden = parentHidden || layer.hidden === true
    if (effectiveHidden) continue // SKIP filho de folder hidden

    if (layer.children?.length) {
      let folderMask: RawMaskRef | null = inheritedRawMask
      if (INHERIT_FOLDER_MASK) {
        const m = layer.mask
        const vm = (layer as any).vectorMask
        if (m?.canvas) {
          if (m.positionRelativeToLayer !== true) {
            // Caso simples: coords absolutas
            folderMask = { kind: "raster", data: m }
          } else {
            // Caso posRel=true: coords sao relativas ao bbox-uniao dos filhos.
            // PS calcula a uniao das layer-folhas visiveis do folder e usa
            // como origem. Sem essa adaptacao, mask aparece com offset errado
            // (testado: folder "Design System Alta renda copy 2" do PSD
            // Seguro Viagem tinha mask posRel=true que sem fix vazava pro
            // topo do canvas em vez de cobrir o painel inferior).
            const union = computeLeafUnionBbox(layer)
            if (union) {
              const adjustedMask = {
                ...m,
                left: (m.left ?? 0) + union.minX,
                top: (m.top ?? 0) + union.minY,
                right: (m.right ?? 0) + union.minX,
                bottom: (m.bottom ?? 0) + union.minY,
                positionRelativeToLayer: false, // pos-conversao: agora absolutas
              }
              folderMask = { kind: "raster", data: adjustedMask }
            }
            // Se nao conseguiu computar union, deixa sem mask (fallback seguro)
          }
        } else if (vm?.paths?.length) {
          folderMask = { kind: "vector", data: vm }
        }
      }
      const folderName = (layer.name ?? "").trim() || "Group"
      const childPath = [...groupPath, folderName]
      result.push(...collectAllLayers(layer.children, effectiveHidden, folderMask, childPath))
      // Folder serve como base de clipping se a proxima sibling for clipping=true.
      // Em PS, clipping pode usar folder abaixo — usamos o folder.mask como
      // silhueta aproximada (folder composite real seria mais fiel mas custoso).
      clipBaseInThisFolder = layer
      continue
    }
    // Layer-folha: detecta clipping (precisa referenciar a base pra recortar)
    const isClipping = layer.clipping === true
    const isAdjustment = !!layer.adjustment
    const entry: any = { layer, inheritedRawMask, groupPath, clipBase: null, adjustments: [] }
    if (isClipping && clipBaseInThisFolder) {
      entry.clipBase = clipBaseInThisFolder
    }
    if (!isAdjustment) {
      // Coleta adjustments do mesmo grupo que afetam esta layer
      entry.adjustments = adjustmentsForIndex(i)
    }
    result.push(entry)
    // Layers adjustment NAO servem como base (sem conteudo visivel). Clipping
    // tambem nao reseta a base (chain semantics: varias clippings → mesma base).
    if (!isClipping && !isAdjustment) {
      clipBaseInThisFolder = layer
    }
  }
  return result
}

// Aplica uma lista de adjustment layers ao canvas IN-PLACE.
// Suporta os tipos mais comuns: levels, brightness/contrast, hue/saturation.
// Os outros sao logados como skip pra preservar comportamento atual.
function applyAdjustmentsToCanvas(canvas: HTMLCanvasElement, adjustments: any[]): void {
  if (!adjustments || adjustments.length === 0) return
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = id.data
  for (const adj of adjustments) {
    if (!adj || !adj.type) continue
    if (adj.type === "levels") applyLevels(d, adj)
    else if (adj.type === "brightness/contrast" || adj.type === "brightnessContrast") applyBrightnessContrast(d, adj)
    else if (adj.type === "hue/saturation" || adj.type === "hueSaturation") applyHueSaturation(d, adj)
    // outros: invert, posterize, threshold, curves, color balance — skip por enquanto
  }
  ctx.putImageData(id, 0, 0)
}

// Levels: shadowInput, highlightInput, midtoneInput(gamma), shadowOutput, highlightOutput
// Aplica RGB composite primeiro, depois canais individuais.
function applyLevels(data: Uint8ClampedArray, adj: any): void {
  const apply = (val: number, ch: any) => {
    if (!ch) return val
    const sI = ch.shadowInput ?? 0
    const hI = ch.highlightInput ?? 255
    const sO = ch.shadowOutput ?? 0
    const hO = ch.highlightOutput ?? 255
    const gamma = ch.midtoneInput ?? 1
    const range = Math.max(1, hI - sI)
    let norm = (val - sI) / range
    if (norm < 0) norm = 0; else if (norm > 1) norm = 1
    if (gamma !== 1 && gamma > 0) norm = Math.pow(norm, 1 / gamma)
    return sO + norm * (hO - sO)
  }
  for (let i = 0; i < data.length; i += 4) {
    // RGB composite primeiro (aplicado a cada canal)
    data[i] = apply(data[i], adj.rgb)
    data[i + 1] = apply(data[i + 1], adj.rgb)
    data[i + 2] = apply(data[i + 2], adj.rgb)
    // Canais individuais depois
    data[i] = apply(data[i], adj.red)
    data[i + 1] = apply(data[i + 1], adj.green)
    data[i + 2] = apply(data[i + 2], adj.blue)
  }
}

// Brightness/Contrast: brightness/contrast valores tipicos -150 a 150 em PSD.
function applyBrightnessContrast(data: Uint8ClampedArray, adj: any): void {
  const b = (adj.brightness ?? 0) // -150 a 150
  const c = (adj.contrast ?? 0)   // -150 a 150
  // Contrast: scale pivoted em 128. Brightness: shift linear.
  const cFactor = (c >= 0) ? 1 + c / 100 : 1 + c / 200
  for (let i = 0; i < data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      let v = data[i + ch] + b
      v = (v - 128) * cFactor + 128
      data[i + ch] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }
}

// Hue/Saturation: master ou per-color shifts. Implementacao basica do master:
// hue (-180 a 180), saturation (-100 a 100), lightness (-100 a 100).
function applyHueSaturation(data: Uint8ClampedArray, adj: any): void {
  const master = adj.master ?? adj
  const hueShift = (master.hue ?? 0) / 360
  const satShift = (master.saturation ?? 0) / 100
  const lightShift = (master.lightness ?? 0) / 100
  if (hueShift === 0 && satShift === 0 && lightShift === 0) return
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255
    // RGB → HSL
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    let h = 0, s = 0
    const l = (max + min) / 2
    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
      else if (max === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      h /= 6
    }
    // Aplica shifts
    h = (h + hueShift) % 1
    if (h < 0) h += 1
    let sNew = s + satShift * (satShift > 0 ? (1 - s) : s)
    if (sNew < 0) sNew = 0; else if (sNew > 1) sNew = 1
    let lNew = l + lightShift * (lightShift > 0 ? (1 - l) : l)
    if (lNew < 0) lNew = 0; else if (lNew > 1) lNew = 1
    // HSL → RGB
    let r2 = lNew, g2 = lNew, b2 = lNew
    if (sNew !== 0) {
      const hueToRgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < 1 / 6) return p + (q - p) * 6 * t
        if (t < 1 / 2) return q
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
      }
      const q = lNew < 0.5 ? lNew * (1 + sNew) : lNew + sNew - lNew * sNew
      const p = 2 * lNew - q
      r2 = hueToRgb(p, q, h + 1 / 3)
      g2 = hueToRgb(p, q, h)
      b2 = hueToRgb(p, q, h - 1 / 3)
    }
    data[i] = Math.round(r2 * 255)
    data[i + 1] = Math.round(g2 * 255)
    data[i + 2] = Math.round(b2 * 255)
  }
}

// Converte um BezierPath do ag-psd em SVG path "d=" attribute.
// ag-psd BezierKnot.points = [cpLeft.x, cpLeft.y, anchor.x, anchor.y, cpRight.x, cpRight.y]
// JÁ EM PIXELS — readBezierKnot em additionalInfo.js multiplica internamente
// por psdW/H ao parsear. Multiplicar de novo gera coords absurdas (psdW²),
// Fabric.Path cria bbox gigantesco e o canvas inteiro fica branco.
type BezierPt = { cpL: { x: number; y: number }; anchor: { x: number; y: number }; cpR: { x: number; y: number } }
function bezierPathToSvg(path: any): string {
  const knots = path?.knots
  if (!Array.isArray(knots) || knots.length === 0) return ""
  const pts: BezierPt[] = knots.map((k: any): BezierPt | null => {
    const p = k?.points
    if (!Array.isArray(p) || p.length < 6) return null
    return {
      cpL: { x: p[0], y: p[1] },
      anchor: { x: p[2], y: p[3] },
      cpR: { x: p[4], y: p[5] },
    }
  }).filter((x: BezierPt | null): x is BezierPt => x !== null)
  if (pts.length === 0) return ""
  let d = `M ${pts[0].anchor.x.toFixed(2)} ${pts[0].anchor.y.toFixed(2)}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    d += ` C ${prev.cpR.x.toFixed(2)} ${prev.cpR.y.toFixed(2)}, ${cur.cpL.x.toFixed(2)} ${cur.cpL.y.toFixed(2)}, ${cur.anchor.x.toFixed(2)} ${cur.anchor.y.toFixed(2)}`
  }
  if (!path.open) {
    const last = pts[pts.length - 1]
    const first = pts[0]
    d += ` C ${last.cpR.x.toFixed(2)} ${last.cpR.y.toFixed(2)}, ${first.cpL.x.toFixed(2)} ${first.cpL.y.toFixed(2)}, ${first.anchor.x.toFixed(2)} ${first.anchor.y.toFixed(2)}`
    d += " Z"
  }
  return d
}

// Concatena todos os paths do vectorMask num único SVG path d-attribute.
// Boolean operations (combine/subtract/exclude/intersect) NÃO suportadas
// completamente — apenas concatena. Sub-paths Z separados respeitam
// fillRule "evenodd" naturalmente (forma com furo).
function vectorMaskToSvgPath(vm: any): { d: string; bbox: { minX: number; minY: number; maxX: number; maxY: number } | null } {
  if (!vm?.paths?.length) return { d: "", bbox: null }
  const parts: string[] = []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of vm.paths) {
    const d = bezierPathToSvg(p)
    if (!d) continue
    parts.push(d)
    // bbox grosseiro via anchors (knots já em pixels — não multiplicar)
    for (const k of (p.knots ?? [])) {
      const pts = k?.points
      if (Array.isArray(pts) && pts.length >= 4) {
        const ax = pts[2], ay = pts[3]
        if (ax < minX) minX = ax
        if (ay < minY) minY = ay
        if (ax > maxX) maxX = ax
        if (ay > maxY) maxY = ay
      }
    }
  }
  if (parts.length === 0 || !isFinite(minX)) return { d: "", bbox: null }
  return { d: parts.join(" "), bbox: { minX, minY, maxX, maxY } }
}

// Constroi APENAS o canvas + bounds da mask, sem serializar pra dataUrl.
// Permite composicao (interseccao) entre multiplas masks no mesmo workspace.
function buildRasterMaskCanvas(m: any, layerLeft: number = 0, layerTop: number = 0, layerRight?: number, layerBottom?: number)
  : { canvas: HTMLCanvasElement; posX: number; posY: number; width: number; height: number; disabled: boolean } | null {
  const offX = m.positionRelativeToLayer ? layerLeft : 0
  const offY = m.positionRelativeToLayer ? layerTop : 0
  const src = m.canvas as HTMLCanvasElement
  const mLeft = (m.left ?? 0) + offX
  const mTop = (m.top ?? 0) + offY
  const mRight = (m.right ?? ((m.left ?? 0) + src.width)) + offX
  const mBottom = (m.bottom ?? ((m.top ?? 0) + src.height)) + offY
  const defaultColor = typeof m.defaultColor === "number" ? m.defaultColor : 255
  const expandToBounds = layerRight != null && layerBottom != null
  const finalLeft = expandToBounds ? Math.min(mLeft, layerLeft) : mLeft
  const finalTop = expandToBounds ? Math.min(mTop, layerTop) : mTop
  const finalRight = expandToBounds ? Math.max(mRight, layerRight!) : mRight
  const finalBottom = expandToBounds ? Math.max(mBottom, layerBottom!) : mBottom
  const w = src.width, h = src.height
  const finalW = finalRight - finalLeft
  const finalH = finalBottom - finalTop
  const drawX = mLeft - finalLeft
  const drawY = mTop - finalTop
  try {
    const conv = document.createElement("canvas")
    conv.width = Math.max(1, Math.round(finalW))
    conv.height = Math.max(1, Math.round(finalH))
    const cctx = conv.getContext("2d")
    if (!cctx) return null
    const srcCtx = src.getContext("2d")
    if (!srcCtx) return null
    const srcData = srcCtx.getImageData(0, 0, w, h)
    const subCanvas = document.createElement("canvas")
    subCanvas.width = w; subCanvas.height = h
    const subCtx = subCanvas.getContext("2d")
    if (!subCtx) return null
    const subData = subCtx.createImageData(w, h)
    const sd = srcData.data, od = subData.data
    for (let i = 0; i < sd.length; i += 4) {
      const gray = sd[i]
      const srcA = sd[i + 3]
      od[i] = 255; od[i + 1] = 255; od[i + 2] = 255
      od[i + 3] = Math.round((gray * srcA) / 255)
    }
    subCtx.putImageData(subData, 0, 0)
    cctx.drawImage(subCanvas, drawX, drawY)
    cctx.fillStyle = `rgba(255,255,255,${defaultColor / 255})`
    const subEndX = drawX + w
    const subEndY = drawY + h
    if (drawY > 0) cctx.fillRect(0, 0, conv.width, drawY)
    if (subEndY < conv.height) cctx.fillRect(0, subEndY, conv.width, conv.height - subEndY)
    if (drawX > 0) cctx.fillRect(0, drawY, drawX, h)
    if (subEndX < conv.width) cctx.fillRect(subEndX, drawY, conv.width - subEndX, h)
    // PSD layer mask propriedades adicionais (ag-psd expõe):
    //  - feather: blur em px aplicado a borda da mask
    //  - density: 0-1 multiplier no alpha (0.5 = mask 50% mais fraco)
    // Sem aplicar, masks com feather (suavização) ou density (parcial) saem
    // hardcoded em vez de suaves no editor.
    const feather = typeof (m as any).feather === "number" ? (m as any).feather : 0
    const density = typeof (m as any).density === "number" ? (m as any).density : 1
    if (feather > 0) {
      // CSS filter blur aplicado ao output do canvas
      try {
        const blurred = document.createElement("canvas")
        blurred.width = conv.width; blurred.height = conv.height
        const bctx = blurred.getContext("2d")
        if (bctx) {
          bctx.filter = `blur(${Math.min(feather, 50)}px)`
          bctx.drawImage(conv, 0, 0)
          bctx.filter = "none"
          cctx.clearRect(0, 0, conv.width, conv.height)
          cctx.drawImage(blurred, 0, 0)
        }
      } catch {}
    }
    if (density < 1) {
      // Multiplica alpha por density (mask "fica mais transparente").
      // Usa source-atop com fill semi-transparente — equivalente a alpha mult.
      try {
        const id = cctx.getImageData(0, 0, conv.width, conv.height)
        const dd = id.data
        for (let i = 3; i < dd.length; i += 4) dd[i] = Math.round(dd[i] * density)
        cctx.putImageData(id, 0, 0)
      } catch {}
    }
    return { canvas: conv, posX: finalLeft, posY: finalTop, width: finalW, height: finalH, disabled: !!m.disabled }
  } catch (e) {
    console.warn("[psd-mask] falha convertendo grayscale→alpha:", e)
    return null
  }
}

// Compõe duas masks raster numa só via INTERSECCAO (destination-in). Resultado:
// pixel visivel apenas onde AMBAS as masks tem alpha > 0. Bounds = uniao dos
// dois para preservar info; areas onde uma das masks nao cobre = transparentes
// (porque destination-in zera quem nao tem cobertura).
function composeMasksIntersection(
  m1: { canvas: HTMLCanvasElement; posX: number; posY: number; width: number; height: number; disabled: boolean },
  m2: { canvas: HTMLCanvasElement; posX: number; posY: number; width: number; height: number; disabled: boolean },
): { canvas: HTMLCanvasElement; posX: number; posY: number; width: number; height: number; disabled: boolean } {
  const minX = Math.min(m1.posX, m2.posX)
  const minY = Math.min(m1.posY, m2.posY)
  const maxX = Math.max(m1.posX + m1.width, m2.posX + m2.width)
  const maxY = Math.max(m1.posY + m1.height, m2.posY + m2.height)
  const w = Math.max(1, Math.round(maxX - minX))
  const h = Math.max(1, Math.round(maxY - minY))
  const out = document.createElement("canvas")
  out.width = w; out.height = h
  const ctx = out.getContext("2d")!
  // m1 -> out (source-over)
  ctx.drawImage(m1.canvas, Math.round(m1.posX - minX), Math.round(m1.posY - minY))
  // m2 intersected with m1 (destination-in: keeps only pixels of m1 covered by m2)
  ctx.globalCompositeOperation = "destination-in"
  ctx.drawImage(m2.canvas, Math.round(m2.posX - minX), Math.round(m2.posY - minY))
  ctx.globalCompositeOperation = "source-over"
  return { canvas: out, posX: minX, posY: minY, width: w, height: h, disabled: m1.disabled || m2.disabled }
}

function buildRasterAssetMask(m: any, layerLeft: number = 0, layerTop: number = 0, layerRight?: number, layerBottom?: number) {
  // Wrapper que constroi o canvas e serializa pra dataUrl no formato LayerMask.
  // Pra composicao com mask herdada de folder, ver composeMasksIntersection +
  // serializeMaskCanvas.
  const w = buildRasterMaskCanvas(m, layerLeft, layerTop, layerRight, layerBottom)
  if (!w) {
    return { type: "raster" as const, enabled: !m.disabled, raster: { dataUrl: (m.canvas as HTMLCanvasElement).toDataURL("image/png"), posX: m.left ?? 0, posY: m.top ?? 0, width: (m.right ?? 0) - (m.left ?? 0), height: (m.bottom ?? 0) - (m.top ?? 0) } }
  }
  return serializeMaskCanvas(w, !m.disabled)
}

// Rasteriza uma vectorMask num canvas. Necessario quando composta com outras
// masks (raster/clipping) — Adobe rasteriza no nivel do display antes de
// intersectar. Saida: canvas RGBA com alpha=255 dentro do path, alpha=0 fora.
function rasterizeVectorMaskCanvas(
  vectorMask: any,
  layerLeft: number,
  layerTop: number,
  layerRight: number,
  layerBottom: number,
): { canvas: HTMLCanvasElement; posX: number; posY: number; width: number; height: number; disabled: boolean } | null {
  try {
    const { d: pathStr, bbox } = vectorMaskToSvgPath(vectorMask)
    if (!pathStr || !bbox || !isFinite(bbox.minX)) return null
    // Bounds finais: uniao do bbox do path com o layer (pra cobrir caso de
    // defaultColor implícito do path em PS: vector mask sem invert = visivel
    // dentro do path, transparente fora. Bbox de saida deve cobrir layer.)
    const finalLeft = Math.min(bbox.minX, layerLeft)
    const finalTop = Math.min(bbox.minY, layerTop)
    const finalRight = Math.max(bbox.maxX, layerRight)
    const finalBottom = Math.max(bbox.maxY, layerBottom)
    const finalW = Math.max(1, Math.round(finalRight - finalLeft))
    const finalH = Math.max(1, Math.round(finalBottom - finalTop))
    const c = document.createElement("canvas")
    c.width = finalW; c.height = finalH
    const ctx = c.getContext("2d")
    if (!ctx) return null
    // Translate pra que o path desenhe nos coords corretos dentro do canvas.
    ctx.translate(-finalLeft, -finalTop)
    const p = new Path2D(pathStr)
    ctx.fillStyle = "rgba(255,255,255,1)"
    ctx.fill(p, (vectorMask.invert ? "evenodd" : "nonzero"))
    // PS invert flag: troca visivel/escondido
    if (vectorMask.invert) {
      // Inverte: tudo dentro do canvas vira alpha=255, depois subtrai o path.
      // Implementacao simples: re-pinta tudo branco e depois apaga path.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, finalW, finalH)
      ctx.fillStyle = "rgba(255,255,255,1)"
      ctx.fillRect(0, 0, finalW, finalH)
      ctx.translate(-finalLeft, -finalTop)
      ctx.globalCompositeOperation = "destination-out"
      ctx.fill(p)
      ctx.globalCompositeOperation = "source-over"
    }
    return { canvas: c, posX: finalLeft, posY: finalTop, width: finalW, height: finalH, disabled: !!vectorMask.disabled }
  } catch (e) {
    console.warn("[psd-mask] rasterizeVectorMaskCanvas falhou:", e)
    return null
  }
}

// Constroi mask canvas do CLIPPING silhouette: usa o canal alpha do clipBase
// como mascara. Em Adobe, clipping mask = base layer alpha. Esta funcao replica
// isso pegando o canvas do clipBase, extraindo alpha em grayscale, e passando
// pra buildRasterMaskCanvas como se fosse um raster mask normal.
function buildClippingMaskCanvas(
  clipBase: any,
  layerLeft: number,
  layerTop: number,
  layerRight: number,
  layerBottom: number,
): { canvas: HTMLCanvasElement; posX: number; posY: number; width: number; height: number; disabled: boolean } | null {
  if (!clipBase) return null
  // Caso 1: clipBase eh folder com mask. Adobe usa o composite do folder como
  // base — aproximamos pela folder mask (silhueta do grupo).
  if (clipBase.children?.length && clipBase.mask?.canvas) {
    const m = clipBase.mask
    if (m.positionRelativeToLayer === true) {
      const union = computeLeafUnionBbox(clipBase)
      if (union) {
        const adjusted = { ...m,
          left: (m.left ?? 0) + union.minX,
          top: (m.top ?? 0) + union.minY,
          right: (m.right ?? 0) + union.minX,
          bottom: (m.bottom ?? 0) + union.minY,
          positionRelativeToLayer: false,
        }
        return buildRasterMaskCanvas(adjusted, layerLeft, layerTop, layerRight, layerBottom)
      }
      return null
    }
    return buildRasterMaskCanvas(m, layerLeft, layerTop, layerRight, layerBottom)
  }
  // Caso 2: clipBase eh layer com canvas. Adobe usa o ALPHA do canvas direto.
  if (clipBase.canvas) {
    const baseL = clipBase.left ?? 0
    const baseT = clipBase.top ?? 0
    const baseR = clipBase.right ?? baseL
    const baseB = clipBase.bottom ?? baseT
    // Converte alpha do canvas em grayscale (R=G=B=alpha, A=255) pra que
    // buildRasterMaskCanvas processe via sua rotina gray→alpha padrao.
    const c = clipBase.canvas as HTMLCanvasElement
    const tmp = document.createElement("canvas")
    tmp.width = c.width; tmp.height = c.height
    const tctx = tmp.getContext("2d")
    if (!tctx) return null
    tctx.drawImage(c, 0, 0)
    const id = tctx.getImageData(0, 0, c.width, c.height)
    const dd = id.data
    for (let i = 0; i < dd.length; i += 4) {
      dd[i] = dd[i + 1] = dd[i + 2] = dd[i + 3]
      dd[i + 3] = 255
    }
    tctx.putImageData(id, 0, 0)
    // defaultColor=0: fora do bbox do clipBase = transparente. Adobe clipping
    // so revela onde o base tem pixels — fora do bbox eh transparente por def.
    const fakeMask = {
      canvas: tmp,
      left: baseL, top: baseT, right: baseR, bottom: baseB,
      defaultColor: 0, disabled: false, positionRelativeToLayer: false,
    }
    return buildRasterMaskCanvas(fakeMask, layerLeft, layerTop, layerRight, layerBottom)
  }
  return null
}

function serializeMaskCanvas(
  w: { canvas: HTMLCanvasElement; posX: number; posY: number; width: number; height: number; disabled: boolean },
  enabled: boolean,
) {
  return {
    type: "raster" as const,
    enabled,
    raster: { dataUrl: w.canvas.toDataURL("image/png"), posX: w.posX, posY: w.posY, width: w.width, height: w.height },
  }
}

// Helper: extrai number opcional de UnitsValue do ag-psd ({value, units} ou number cru)
function numU(v: any, def = 0): number {
  if (typeof v === "number") return v
  if (v && typeof v.value === "number") return v.value
  return def
}
// Helper: extrai color do ag-psd (pode vir aninhado em .color)
function colorOf(v: any): string {
  return colorToHex(v?.color ?? v)
}
// Helper: pega a primeira instância habilitada de um efeito (array ou objeto)
function pickEnabled(v: any): any | null {
  if (!v) return null
  if (Array.isArray(v)) return v.find((s: any) => s?.enabled) ?? null
  return v.enabled ? v : null
}

// Extrai layer effects do PSD pra round-trip ZZOSY ↔ Photoshop.
// COBERTURA:
//  - dropShadow, innerShadow         (sombras externa/interna)
//  - outerGlow, innerGlow            (brilhos)
//  - stroke                          (borda)
//  - colorOverlay (ag-psd: solidFill) (cor sobreposta)
//  - gradientOverlay                 (gradiente sobreposto)
//  - bevel                           (chanfro/relevo) — só metadados
//  - satin                           (cetim) — só metadados
//  - patternOverlay                  (padrão) — só metadados
// Convenção angles: PSD 0°=direita, aumenta sentido horário; sombra cai oposta
// à luz (sinal negativo no cos). offsetY positivo = pra baixo no canvas.
function extractPsdEffects(layer: any): any | undefined {
  const fx = (layer as any)?.effects
  if (!fx) return undefined
  const out: any = {}

  const ds = pickEnabled(fx.dropShadow)
  if (ds) {
    const distance = numU(ds.distance, 0)
    const angleRad = ((ds.angle ?? 120) * Math.PI) / 180
    out.dropShadow = {
      color: colorOf(ds), opacity: ds.opacity ?? 0.75,
      offsetX: Math.round(-Math.cos(angleRad) * distance),
      offsetY: Math.round(Math.sin(angleRad) * distance),
      blur: numU(ds.size, 5),
      blendMode: ds.blendMode ?? "normal",
    }
  }
  const is = pickEnabled(fx.innerShadow)
  if (is) {
    const distance = numU(is.distance, 0)
    const angleRad = ((is.angle ?? 120) * Math.PI) / 180
    out.innerShadow = {
      color: colorOf(is), opacity: is.opacity ?? 0.75,
      offsetX: Math.round(-Math.cos(angleRad) * distance),
      offsetY: Math.round(Math.sin(angleRad) * distance),
      blur: numU(is.size, 5),
      choke: numU(is.choke, 0),
      blendMode: is.blendMode ?? "multiply",
    }
  }
  const og = pickEnabled(fx.outerGlow)
  if (og) {
    out.outerGlow = {
      color: colorOf(og), opacity: og.opacity ?? 0.5,
      blur: numU(og.size, 5),
      choke: numU(og.choke, 0),
      blendMode: og.blendMode ?? "screen",
    }
  }
  const ig = pickEnabled(fx.innerGlow)
  if (ig) {
    out.innerGlow = {
      color: colorOf(ig), opacity: ig.opacity ?? 0.5,
      blur: numU(ig.size, 5),
      choke: numU(ig.choke, 0),
      source: ig.source ?? "edge",
      blendMode: ig.blendMode ?? "screen",
    }
  }
  const st = pickEnabled(fx.stroke)
  if (st) {
    const fc = st.fillColor?.color ?? st.fillColor ?? st.color
    out.stroke = {
      color: colorToHex(fc),
      width: numU(st.size, 1),
      position: st.position ?? "outside",
      opacity: st.opacity ?? 1,
      blendMode: st.blendMode ?? "normal",
    }
  }
  // Color Overlay no Photoshop ↔ solidFill no ag-psd
  const co = pickEnabled(fx.solidFill)
  if (co) {
    out.colorOverlay = {
      color: colorOf(co), opacity: co.opacity ?? 1,
      blendMode: co.blendMode ?? "normal",
    }
  }
  const go = pickEnabled(fx.gradientOverlay)
  if (go) {
    const grad = go.gradient
    out.gradientOverlay = {
      opacity: go.opacity ?? 1,
      blendMode: go.blendMode ?? "normal",
      type: go.type ?? "linear",
      angle: go.angle ?? 90,
      scale: go.scale ?? 100,
      reverse: go.reverse === true,
      align: go.align !== false,
      stops: Array.isArray(grad?.colorStops)
        ? grad.colorStops.map((cs: any) => ({ color: colorOf(cs), offset: cs.location ?? 0 }))
        : [],
      opacityStops: Array.isArray(grad?.opacityStops)
        ? grad.opacityStops.map((os: any) => ({ opacity: os.opacity ?? 1, offset: os.location ?? 0 }))
        : [],
    }
  }
  // Bevel/Satin/PatternOverlay: preserva metadados pro round-trip (sem render
  // visual no editor — Fabric não tem equivalente nativo, exigiria offscreen
  // canvas custom. Designer vê o efeito ao re-abrir no Photoshop).
  const bv = pickEnabled(fx.bevel)
  if (bv) {
    out.bevel = {
      style: bv.style ?? "inner bevel",
      direction: bv.direction ?? "up",
      size: numU(bv.size, 5),
      angle: bv.angle ?? 120,
      altitude: bv.altitude ?? 30,
      highlightColor: colorOf(bv.highlightColor),
      highlightOpacity: bv.highlightOpacity ?? 0.75,
      highlightBlendMode: bv.highlightBlendMode ?? "screen",
      shadowColor: colorOf(bv.shadowColor),
      shadowOpacity: bv.shadowOpacity ?? 0.75,
      shadowBlendMode: bv.shadowBlendMode ?? "multiply",
      strength: bv.strength ?? 100,
      soften: numU(bv.soften, 0),
    }
  }
  const sa = pickEnabled(fx.satin)
  if (sa) {
    out.satin = {
      color: colorOf(sa), opacity: sa.opacity ?? 0.5,
      angle: sa.angle ?? 19, distance: numU(sa.distance, 11),
      size: numU(sa.size, 14), invert: sa.invert === true,
      blendMode: sa.blendMode ?? "multiply",
    }
  }
  const po = pickEnabled(fx.patternOverlay)
  if (po) {
    out.patternOverlay = {
      opacity: po.opacity ?? 1,
      scale: po.scale ?? 100,
      align: po.align !== false,
      blendMode: po.blendMode ?? "normal",
      // pattern asset não é preservado aqui (precisaria ID + bytes do PSD).
      // Round-trip parcial — designer reaplica no Photoshop se necessário.
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// Mapeia blendMode PSD pra Canvas2D globalCompositeOperation. Subset comum.
function psdBlendToCompositeOp(bm: string | undefined): GlobalCompositeOperation {
  if (!bm) return "source-over"
  const m: Record<string, GlobalCompositeOperation> = {
    "normal": "source-over",
    "multiply": "multiply",
    "screen": "screen",
    "overlay": "overlay",
    "darken": "darken",
    "lighten": "lighten",
    "color dodge": "color-dodge",
    "color burn": "color-burn",
    "hard light": "hard-light",
    "soft light": "soft-light",
    "difference": "difference",
    "exclusion": "exclusion",
  }
  return m[bm.toLowerCase()] ?? "source-over"
}

// Bake de effects no bitmap de uma image layer. Photoshop aplica color/gradient
// overlay, drop shadow, etc no RENDER do layer; ag-psd entrega o raster base
// SEM essas effects. Pra fidelidade visual no editor (Fabric não tem nativo
// pra source-atop tint em image fill), compomos as effects no PNG antes de
// salvar. Resultado: logo/shape com colorOverlay verde aparece preenchido
// no editor (antes só outline).
//
// Estratégia (ordem que Photoshop usa, simplificada):
//   1. Drop shadow ATRÁS do silhueta (composite separado)
//   2. Base bitmap
//   3. Color overlay (source-atop tint, preserva alpha)
//   4. Gradient overlay (source-atop com gradient)
//   5. Inner shadow (apenas tint escuro nas bordas internas — aproximação)
//
// Round-trip: effects PERMANECEM no JSON pra export PSD. Em re-import, o
// PSD original (não o nosso baked PNG) volta. Risco de "double-bake" só se
// re-importarmos NOSSO export — caso raro, aceitável.
function bakeImageEffects(src: HTMLCanvasElement, effects: any): { canvas: HTMLCanvasElement; pad: number } {
  if (!effects || !src) return { canvas: src, pad: 0 }
  const co = effects.colorOverlay
  const go = effects.gradientOverlay
  const ds = effects.dropShadow
  const isOG = effects.outerGlow
  const iS = effects.innerShadow
  const iG = effects.innerGlow
  const strokeFx = effects.stroke
  if (!co && !go && !ds && !isOG && !iS && !iG && !strokeFx) return { canvas: src, pad: 0 }

  const w = src.width, h = src.height
  // Padding pra acomodar shadow/glow externos. Calcula max blur+offset.
  const dsPad = ds ? Math.ceil(Math.max(Math.abs(ds.offsetX ?? 0), Math.abs(ds.offsetY ?? 0)) + (ds.blur ?? 0) * 2) : 0
  const ogPad = isOG ? Math.ceil((isOG.blur ?? 0) * 2 + (isOG.choke ?? 0)) : 0
  // Stroke "outside" expande visualmente (width/2 pra cada lado)
  const strokePad = (strokeFx && strokeFx.position === "outside") ? Math.ceil(strokeFx.width ?? 1) : 0
  const pad = Math.max(dsPad, ogPad, strokePad, 0)
  const outW = w + pad * 2
  const outH = h + pad * 2

  const out = document.createElement("canvas")
  out.width = outW; out.height = outH
  const ctx = out.getContext("2d")
  if (!ctx) return { canvas: src, pad: 0 }

  // 1. DROP SHADOW: silhueta colorida + blur + offset, ATRÁS do bitmap base
  if (ds) {
    const sc = document.createElement("canvas")
    sc.width = outW; sc.height = outH
    const sctx = sc.getContext("2d")
    if (sctx) {
      // Desenha base shifted pelo offset
      sctx.drawImage(src, pad + (ds.offsetX ?? 0), pad + (ds.offsetY ?? 0))
      // Tint pra cor da shadow (source-atop preserva alpha)
      sctx.globalCompositeOperation = "source-atop"
      sctx.fillStyle = ds.color ?? "rgba(0,0,0,0.5)"
      sctx.globalAlpha = ds.opacity ?? 0.75
      sctx.fillRect(0, 0, outW, outH)
      sctx.globalAlpha = 1
      // Aplica blur via filter na composição final
      ctx.filter = `blur(${(ds.blur ?? 5) / 2}px)`
      ctx.drawImage(sc, 0, 0)
      ctx.filter = "none"
    }
  }
  // 2. OUTER GLOW (similar, sem offset, sempre atrás)
  if (isOG) {
    const sc = document.createElement("canvas")
    sc.width = outW; sc.height = outH
    const sctx = sc.getContext("2d")
    if (sctx) {
      sctx.drawImage(src, pad, pad)
      sctx.globalCompositeOperation = "source-atop"
      sctx.fillStyle = isOG.color ?? "rgba(255,255,255,0.5)"
      sctx.globalAlpha = isOG.opacity ?? 0.5
      sctx.fillRect(0, 0, outW, outH)
      sctx.globalAlpha = 1
      ctx.filter = `blur(${(isOG.blur ?? 5) / 2}px)`
      ctx.drawImage(sc, 0, 0)
      ctx.filter = "none"
    }
  }
  // 3. BASE BITMAP (desenha com offset pro pad)
  ctx.drawImage(src, pad, pad)

  // 4. COLOR OVERLAY: tint do bitmap existente
  if (co && co.color) {
    ctx.globalCompositeOperation = psdBlendToCompositeOp(co.blendMode)
    // source-atop garante que só pinta onde tem alpha (preserva silhueta)
    if (ctx.globalCompositeOperation === "source-over") ctx.globalCompositeOperation = "source-atop"
    ctx.fillStyle = co.color
    ctx.globalAlpha = co.opacity ?? 1
    ctx.fillRect(0, 0, outW, outH)
    ctx.globalAlpha = 1
  }

  // 4.5 INNER SHADOW: sombra DENTRO da silhueta. Estrategia:
  // 1) inverte alpha da base (areas vazias→opaque, opaque→vazias)
  // 2) desenha essa "neg" deslocada+blur, clip à silhueta original via source-in
  if (iS) {
    try {
      const sc = document.createElement("canvas")
      sc.width = outW; sc.height = outH
      const sctx = sc.getContext("2d")
      if (sctx) {
        // Negativo do alpha original (com offset)
        sctx.drawImage(src, pad + (iS.offsetX ?? 0), pad + (iS.offsetY ?? 0))
        sctx.globalCompositeOperation = "source-out"
        sctx.drawImage(src, pad, pad)
        sctx.globalCompositeOperation = "source-over"
        // Tint pra cor da inner shadow
        const tnt = document.createElement("canvas")
        tnt.width = outW; tnt.height = outH
        const tctx = tnt.getContext("2d")
        if (tctx) {
          tctx.fillStyle = iS.color ?? "rgba(0,0,0,0.5)"
          tctx.fillRect(0, 0, outW, outH)
          tctx.globalCompositeOperation = "destination-in"
          tctx.drawImage(sc, 0, 0)
          // Aplica blur + clip à silhueta original
          ctx.save()
          ctx.globalAlpha = iS.opacity ?? 0.75
          ctx.filter = `blur(${(iS.blur ?? 5) / 2}px)`
          ctx.drawImage(tnt, 0, 0)
          ctx.filter = "none"
          ctx.restore()
          // Re-clip pra silhueta original (source-atop nao funciona pos-blur, usa
          // destination-in na base)
          ctx.globalCompositeOperation = "destination-in"
          ctx.drawImage(src, pad, pad)
          ctx.globalCompositeOperation = "source-over"
          // Re-desenha base por baixo (inner shadow agora ta sobreposta com alpha)
          const baseRedraw = document.createElement("canvas")
          baseRedraw.width = outW; baseRedraw.height = outH
          const brctx = baseRedraw.getContext("2d")
          if (brctx) {
            brctx.drawImage(src, pad, pad)
            brctx.globalCompositeOperation = "source-atop"
            brctx.drawImage(out, 0, 0)
            ctx.clearRect(0, 0, outW, outH)
            ctx.drawImage(baseRedraw, 0, 0)
          }
        }
      }
    } catch (e) { console.warn("[bakeImageEffects] innerShadow falhou:", e) }
  }

  // 4.6 INNER GLOW: brilho DENTRO da silhueta. Mesma logica do inner shadow
  // mas sem offset (sempre na borda interna).
  if (iG) {
    try {
      const sc = document.createElement("canvas")
      sc.width = outW; sc.height = outH
      const sctx = sc.getContext("2d")
      if (sctx) {
        // Borda interna: silhueta original menos a silhueta "contraida"
        sctx.drawImage(src, pad, pad)
        // Cor do glow + alpha por blur
        const tnt = document.createElement("canvas")
        tnt.width = outW; tnt.height = outH
        const tctx = tnt.getContext("2d")
        if (tctx) {
          tctx.fillStyle = iG.color ?? "rgba(255,255,255,0.5)"
          tctx.fillRect(0, 0, outW, outH)
          tctx.globalCompositeOperation = "destination-in"
          tctx.drawImage(src, pad, pad)
          ctx.save()
          ctx.globalAlpha = iG.opacity ?? 0.5
          ctx.filter = `blur(${(iG.blur ?? 5) / 2}px)`
          ctx.globalCompositeOperation = "destination-out" // remove borda
          ctx.drawImage(tnt, 0, 0)
          ctx.filter = "none"
          ctx.globalCompositeOperation = "source-atop"
          ctx.drawImage(tnt, 0, 0)
          ctx.restore()
        }
      }
    } catch (e) { console.warn("[bakeImageEffects] innerGlow falhou:", e) }
  }

  // 4.7 STROKE EFFECT: contorno na silhueta.
  // position: "outside" | "inside" | "center". Simplificacao: tudo como "outside"
  // — borda da silhueta, expandida pra fora pelo width.
  if (strokeFx && strokeFx.color) {
    try {
      const sw = strokeFx.width ?? 1
      // Expansao da silhueta: usa dilation aproximado via multi-drawImage offset
      const sc = document.createElement("canvas")
      sc.width = outW; sc.height = outH
      const sctx = sc.getContext("2d")
      if (sctx) {
        // Dilation: desenha o src varias vezes com pequenos offsets em volta
        for (let dx = -sw; dx <= sw; dx++) {
          for (let dy = -sw; dy <= sw; dy++) {
            if (dx * dx + dy * dy <= sw * sw) {
              sctx.drawImage(src, pad + dx, pad + dy)
            }
          }
        }
        // Pinta o "dilated" com a cor do stroke
        sctx.globalCompositeOperation = "source-in"
        sctx.fillStyle = strokeFx.color
        sctx.globalAlpha = strokeFx.opacity ?? 1
        sctx.fillRect(0, 0, outW, outH)
        sctx.globalAlpha = 1
        sctx.globalCompositeOperation = "source-over"
        // Compose: stroke ATRAS do bitmap base (assume position=outside default)
        const composed = document.createElement("canvas")
        composed.width = outW; composed.height = outH
        const cctx2 = composed.getContext("2d")
        if (cctx2) {
          cctx2.drawImage(sc, 0, 0)        // stroke primeiro
          cctx2.drawImage(out, 0, 0)        // depois tudo que ja foi composto
          ctx.clearRect(0, 0, outW, outH)
          ctx.drawImage(composed, 0, 0)
        }
      }
    } catch (e) { console.warn("[bakeImageEffects] stroke falhou:", e) }
  }

  // 5. GRADIENT OVERLAY
  if (go && Array.isArray(go.stops) && go.stops.length > 0) {
    try {
      const angleRad = ((go.angle ?? 90) * Math.PI) / 180
      // Centro do bbox da imagem
      const cx = pad + w / 2, cy = pad + h / 2
      // Half-diagonal pra cobrir tudo
      const r = Math.hypot(w, h) / 2
      const dx = Math.cos(angleRad) * r
      const dy = Math.sin(angleRad) * r
      const grad = go.type === "radial"
        ? ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
        : ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
      const stops = go.reverse
        ? go.stops.map((s: any) => ({ offset: 1 - (s.offset ?? 0), color: s.color }))
        : go.stops.map((s: any) => ({ offset: s.offset ?? 0, color: s.color }))
      for (const s of stops) {
        grad.addColorStop(Math.max(0, Math.min(1, s.offset)), s.color ?? "#000")
      }
      ctx.globalCompositeOperation = psdBlendToCompositeOp(go.blendMode)
      if (ctx.globalCompositeOperation === "source-over") ctx.globalCompositeOperation = "source-atop"
      ctx.fillStyle = grad
      ctx.globalAlpha = go.opacity ?? 1
      ctx.fillRect(0, 0, outW, outH)
      ctx.globalAlpha = 1
    } catch (e) { console.warn("[bakeImageEffects] gradientOverlay falhou:", e) }
  }

  ctx.globalCompositeOperation = "source-over"
  return { canvas: out, pad }
}

// Renderiza um shape layer (vectorMask + vectorFill/vectorStroke) num canvas
// local da bbox do layer. Resolve o caso em que ag-psd entrega layer.canvas
// vazio/parcial (só com stroke, sem fill) — comum quando o fill vem de Color
// Overlay ou vectorFill puro. Estrategia: renderiza shape UNDER, depois
// composita ag-psd canvas (se houver) POR CIMA. Se ag-psd já tem fill, nada
// muda visualmente; se transparente, o vector preenche.
function renderShapeLayerCanvas(
  layer: any,
  bboxW: number,
  bboxH: number,
  bboxLeft: number,
  bboxTop: number,
): HTMLCanvasElement | null {
  const vm = (layer as any).vectorMask
  if (!vm?.paths?.length) return null
  const vf = (layer as any).vectorFill
  const vs = (layer as any).vectorStroke
  if (!vf && !vs) return null

  const w = Math.max(1, Math.round(bboxW))
  const h = Math.max(1, Math.round(bboxH))
  const c = document.createElement("canvas")
  c.width = w; c.height = h
  const ctx = c.getContext("2d")
  if (!ctx) return null

  // Constrói Path2D a partir dos sub-paths bezier. Coords PSD-globais →
  // translada por (-bboxLeft, -bboxTop) pra ficar relativo ao canvas local.
  const pathStr = vectorMaskToSvgPath(vm).d
  if (!pathStr) return null
  let path2d: Path2D
  try {
    path2d = new Path2D(pathStr)
  } catch {
    return null
  }
  // Aplica translação via transform (Path2D não tem método translate)
  ctx.save()
  ctx.translate(-bboxLeft, -bboxTop)

  // FILL: cor sólida (mais comum). Gradiente: TODO (suporta linear simples
  // se aparecer no piloto). Pattern: TODO (precisa do pattern asset).
  if (vf) {
    if ((vf as any).type === "color" && (vf as any).color) {
      ctx.fillStyle = colorToHex((vf as any).color)
      ctx.fill(path2d, "evenodd")
    } else if ((vf as any).type === "solid" && Array.isArray((vf as any).colorStops)) {
      // Gradient linear simples horizontal (não respeita angle ainda)
      try {
        const grad = ctx.createLinearGradient(bboxLeft, bboxTop, bboxLeft + w, bboxTop)
        for (const cs of (vf as any).colorStops) {
          const stop = Math.max(0, Math.min(1, cs.location ?? 0))
          grad.addColorStop(stop, colorToHex(cs))
        }
        ctx.fillStyle = grad
        ctx.fill(path2d, "evenodd")
      } catch { /* ignora */ }
    }
  }

  // STROKE
  if (vs && (vs as any).strokeEnabled !== false) {
    const sc = (vs as any).content
    if (sc && (sc as any).type === "color" && (sc as any).color) {
      ctx.strokeStyle = colorToHex((sc as any).color)
      const lw = typeof (vs as any).lineWidth === "number" ? (vs as any).lineWidth : ((vs as any).lineWidth?.value ?? 1)
      ctx.lineWidth = lw
      const cap = (vs as any).lineCapType
      ctx.lineCap = cap === "round" ? "round" : cap === "square" ? "square" : "butt"
      const join = (vs as any).lineJoinType
      ctx.lineJoin = join === "round" ? "round" : join === "bevel" ? "bevel" : "miter"
      const ml = (vs as any).miterLimit
      if (typeof ml === "number") ctx.miterLimit = ml
      ctx.stroke(path2d)
    }
  }
  ctx.restore()

  // Composita ag-psd canvas POR CIMA (se houver). Se ele tem fill, fica
  // visualmente igual. Se só tem stroke + transparência, nosso fill aparece.
  const existing = layer.canvas as HTMLCanvasElement | undefined
  if (existing) {
    try { ctx.drawImage(existing, 0, 0) } catch {}
  }
  return c
}

// Mapeia blendMode do PSD pra globalCompositeOperation do Canvas2D.
// PSD usa nomes com espaço ("color dodge"); canvas usa hífen ("color-dodge").
// "pass through" e "dissolve" não tem equivalente puro — caem em "source-over".
function psdBlendToCanvas(bm: string | undefined): string | null {
  if (!bm) return null
  const m: Record<string, string> = {
    "normal": "source-over",
    "multiply": "multiply",
    "screen": "screen",
    "overlay": "overlay",
    "darken": "darken",
    "lighten": "lighten",
    "color dodge": "color-dodge",
    "color burn": "color-burn",
    "hard light": "hard-light",
    "soft light": "soft-light",
    "difference": "difference",
    "exclusion": "exclusion",
    "hue": "hue",
    "saturation": "saturation",
    "color": "color",
    "luminosity": "luminosity",
    "linear dodge": "lighter",
  }
  return m[bm.toLowerCase()] ?? null
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png")
  })
}

export function PsdImporter({ campaignId, onImported }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [progress, setProgress] = useState("")
  // Estado pro modal de fontes faltando — apos import, listamos as fontes
  // do PSD que NAO estao no browser e oferecemos: (a) ir pra pagina do cliente
  // pra upload, (b) pular e continuar com fallback (Arial), (c) ignorar.
  const [missingFontsModal, setMissingFontsModal] = useState<{ fonts: string[]; clientId: string | null } | null>(null)

  async function handleFile(file: File) {
    if (loading) return // guard de re-entrada
    setLoading(true)
    setError("")
    setProgress("Lendo PSD...")
    try {
      const agPsd = await import("ag-psd")
      const { readPsd } = agPsd
      if ((agPsd as any).initializeCanvas) {
        ;(agPsd as any).initializeCanvas(
          (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c },
          (c: any) => (c as HTMLCanvasElement).getContext("2d")
        )
      }

      const buffer = await file.arrayBuffer()
      // skipCompositeImageData: false — precisamos do canvas composto pra gerar
      // o thumbnail da matriz no card de entrada. Custa um pouco mais de memoria
      // (composite do PSD) mas evita preview vazio apos o import.
      const psd = readPsd(buffer, { skipLayerImageData: false, skipCompositeImageData: false, skipThumbnail: true })

      setProgress("Extraindo layers...")
      const allLayerEntries = collectAllLayers(psd.children ?? [])
      const assets: any[] = []
      const imageBlobs: Blob[] = []
      // Set de fontes únicas referenciadas por text layers (default style + runs).
      // Após o import, alerta o user pra fazer upload das que não estão instaladas
      // — sem isso o browser cai em fallback (Arial), métricas diferem do PSD e o
      // texto wrappa em pontos diferentes / overflows visual no editor.
      const fontsRequired = new Set<string>()
      let zIndex = 0

      // Smart Objects: extrai linkedFiles do PSD (bytes originais embeddados)
      // e mapeia GUID -> indice. Layers com placedLayer apontam pro GUID, e
      // ai linkamos o asset ao SO correspondente.
      const linkedFiles = (psd as any).linkedFiles ?? []
      const linkedBlobs: Blob[] = []
      const linkedMeta: Array<{ guid: string; mime: string; originalName: string; sizeBytes: number; width?: number; height?: number }> = []
      const guidToIndex = new Map<string, number>()
      for (const lf of linkedFiles) {
        const guid = lf.id
        if (!guid) continue
        const data: Uint8Array | undefined = lf.data
        if (!data) continue
        const name: string = lf.name ?? `linked-${guid}`
        // Deduz mime pela extensao do nome (ag-psd nao expoe mime diretamente)
        const ext = (name.split(".").pop() ?? "").toLowerCase()
        const mime =
          ext === "svg" ? "image/svg+xml" :
          ext === "ai"  ? "application/postscript" :
          ext === "pdf" ? "application/pdf" :
          ext === "psd" ? "image/vnd.adobe.photoshop" :
          ext === "png" ? "image/png" :
          ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
          "application/octet-stream"
        // Pra SVG da pra extrair viewBox; pros outros formatos deixa undefined
        let width: number | undefined, height: number | undefined
        if (mime === "image/svg+xml") {
          try {
            const txt = new TextDecoder().decode(data)
            const vb = txt.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
            if (vb) {
              const parts = vb.split(/[\s,]+/).map(Number)
              if (parts.length === 4 && parts.every(Number.isFinite)) {
                width = parts[2]; height = parts[3]
              }
            }
          } catch { /* ignora */ }
        }
        const idx = linkedBlobs.length
        // Constroi Blob a partir dos bytes — Buffer pra blob
        // OBS: Uint8Array satisfaz BlobPart, mas TS as vezes reclama em modos strict
        linkedBlobs.push(new Blob([data as any], { type: mime }))
        linkedMeta.push({ guid, mime, originalName: name, sizeBytes: data.byteLength, width, height })
        guidToIndex.set(guid, idx)
      }

      for (const { layer, inheritedRawMask, groupPath, clipBase, adjustments } of allLayerEntries) {
        const name = (layer.name ?? "").trim()
        // Fix #6: filtra a "Background" auto-criada pelo PS (raster top-level
        // sem placedLayer), mas deixa passar Smart Objects intencionais que o
        // designer nomeou de "Background" (ex: PSD do Sicredi tem um SO assim
        // dentro de Design System que eh o painel verde inferior inteiro).
        const isSmartObject = !!(layer as any).placedLayer
        if (!name || (name === "Background" && !isSmartObject)) { zIndex++; continue }

        // Pula adjustment layers (Niveis/Levels, Equilibrio de Cores/Color Balance,
        // Matiz/Hue, Curvas/Curves, etc). Em Photoshop esses layers modificam
        // os pixels DOS LAYERS ABAIXO via blend; nao tem conteudo visual proprio.
        // No editor sem essa logica de adjustment compositing, eles apareceriam
        // como assets vazios no dropdown ("Niveis 1", "Equilibrio de Cores 1") e
        // confundiriam o usuario. ag-psd expoe via layer.adjustment (objeto).
        // Tambem pulamos layers SEM canvas E SEM placedLayer (raster vazio).
        if ((layer as any).adjustment) {
          console.log("[psd-import] skip adjustment layer:", name)
          zIndex++
          continue
        }

        // REMOVIDO 2026-05-18: name-pattern adjustment skip era falso-positivo.
        // Designers as vezes nomeiam smart objects raster com nome de ajuste
        // (no PSD Seguro Viagem "Equilíbrio de Cores 1" é a propria FOTO 5221x2932,
        // nao um Color Balance real). Skip pelo nome estava removendo a foto.
        // Confiamos apenas na flag layer.adjustment do ag-psd.

        // Diag pra debugar layers nao-importados em PSDs complexos.
        // Loga cada layer + flags antes de tentar processar — quando o user
        // reporta "tal foto sumiu", esse log mostra se a layer caiu no else
        // do "if (layer.canvas || ...)" ou em outro caminho.
        console.log("[psd-import] processing:", name, {
          hasCanvas: !!layer.canvas,
          isText: !!layer.text,
          isSmartObj: isSmartObject,
          hasVectorMask: !!(layer as any).vectorMask?.paths?.length,
          hasVectorFill: !!(layer as any).vectorFill,
          hasVectorStroke: !!(layer as any).vectorStroke,
          bbox: `(${layer.left},${layer.top})-(${layer.right},${layer.bottom})`,
        })

        const left = layer.left ?? 0
        const top = layer.top ?? 0
        const width = Math.max((layer.right ?? left + 200) - left, 10)
        const height = Math.max((layer.bottom ?? top + 50) - top, 10)

        // === EXTRAI MASCARA (raster, vector, clipping) ===
        // ag-psd expoe: layer.mask (raster) com canvas+left+top+right+bottom,
        // layer.vectorMask com paths, e layer.clipping=true pra clipping mask.
        // Salvamos no formato LayerMask pra reproduzir no editor e re-exportar.
        let assetMask: any = null
        // Raster mask: layer.mask.canvas tem o grayscale (preto = transparente).
        // Passa layer.left/top/right/bottom pra:
        //  - converter coords relativas quando positionRelativeToLayer=true
        //  - expandir a mask ate cobrir todo o layer (defaultColor implicito
        //    fora do bbox da mask). Sem isso, mask cobre so o bbox armazenado
        //    e o resto do layer fica clipado fora (invisivel).
        // ========================================================================
        // ADOBE MASK COMPOSITION
        // Em PS, um layer pode ter SIMULTANEAMENTE ate 4 mascaras:
        //   1. layer.mask (raster mask propria)
        //   2. layer.vectorMask (vector path mask propria)
        //   3. inheritedRawMask (folder mask herdada do grupo pai)
        //   4. clipping silhouette (alpha do clipBase quando layer.clipping=true)
        // Adobe aplica TODAS por INTERSECCAO (visivel onde TODAS sao visiveis).
        // Sem prioridade, sem "uma vence outra". Implementacao:
        //   a) Constroi canvas pra cada silhueta presente
        //   b) Compoe via destination-in chain
        //   c) Output unico raster mask (perde info de vector quando composto)
        // Otimizacao: se SO uma silhueta vector existe (sem outras), preserva
        // formato vector pra resolucao no editor.
        type MaskCanvas = { canvas: HTMLCanvasElement; posX: number; posY: number; width: number; height: number; disabled: boolean }
        const silhouettes: Array<MaskCanvas> = []
        // 1. Own raster mask — Adobe: se layer.mask.disabled=true, ignora ELA
        // mas as outras mascaras continuam aplicando. NAO propaga disabled pra
        // composicao inteira (esse era o bug: 1 mask disabled fazia todo o
        // composite virar enabled=false e nenhuma mask renderizava).
        if (layer.mask?.canvas && !layer.mask.disabled) {
          try {
            const w = buildRasterMaskCanvas(layer.mask, left, top, left + width, top + height)
            if (w) silhouettes.push(w)
          } catch (e) { console.warn("[psd-mask] own raster falhou:", name, e) }
        }
        // 2. Own vector mask (rasterizado se for compor com outras; vetor se solo)
        const hasVector = !!(layer as any).vectorMask?.paths?.length && !(layer as any).vectorMask?.disabled
        // 3. Inherited folder mask
        if (inheritedRawMask?.kind === "raster" && inheritedRawMask.data?.canvas && !inheritedRawMask.data.disabled) {
          try {
            const w = buildRasterMaskCanvas(inheritedRawMask.data, left, top, left + width, top + height)
            if (w) silhouettes.push(w)
          } catch (e) { console.warn("[psd-mask] inherited raster falhou:", name, e) }
        }
        // 4. Clipping silhouette (alpha do clipBase). clipping NAO tem disabled
        // — eh sempre ativo quando layer.clipping===true.
        const hasClipping = (layer as any).clipping === true && !!clipBase
        if (hasClipping) {
          try {
            const w = buildClippingMaskCanvas(clipBase, left, top, left + width, top + height)
            if (w) silhouettes.push(w)
          } catch (e) { console.warn("[psd-mask] clipping silhouette falhou:", name, e) }
        }
        // Decisao de output:
        // - Vector solo (sem raster/inherited/clipping): preserva como vector
        // - Vector + outros: rasteriza vector e intersecta
        // - Sem vector, mas com outros: intersecta as silhuetas raster
        // - Nenhum mask: assetMask = null
        if (hasVector) {
          const vm = (layer as any).vectorMask
          if (silhouettes.length === 0) {
            // Vector solo: mantem formato vetorial
            try {
              const { d: pathStr, bbox } = vectorMaskToSvgPath(vm)
              if (pathStr && bbox && isFinite(bbox.minX)) {
                const minX = bbox.minX, minY = bbox.minY
                const vWidth = Math.max(bbox.maxX - minX, 1)
                const vHeight = Math.max(bbox.maxY - minY, 1)
                assetMask = {
                  type: "vector" as const,
                  enabled: true,
                  vector: { path: pathStr, posX: minX, posY: minY, width: vWidth, height: vHeight },
                }
              }
            } catch (e) { console.warn("[psd-mask] vector solo falhou:", name, e) }
          } else {
            // Vector composto com outros: rasteriza e adiciona pra intersectar
            const rastered = rasterizeVectorMaskCanvas(vm, left, top, left + width, top + height)
            if (rastered) silhouettes.push(rastered)
          }
        }
        // Se temos silhuetas raster pra compor (e nao foi caso vector-solo)
        if (!assetMask && silhouettes.length > 0) {
          let composed = silhouettes[0]
          for (let i = 1; i < silhouettes.length; i++) {
            composed = composeMasksIntersection(composed, silhouettes[i])
          }
          // enabled SEMPRE true aqui: silhuetas disabled ja foram filtradas na
          // coleta. Se chegou ate aqui, tem pelo menos 1 silhueta ativa.
          assetMask = serializeMaskCanvas(composed, true)
        }
        // Fallback: clipping=true mas sem clipBase resolvido — placeholder type
        // pra preservar round-trip pro PSD save.
        if (!assetMask && (layer as any).clipping === true) {
          assetMask = { type: "clipping" as const, enabled: true, clipping: true }
        }

        // Opacity (0-255 no PSD → 0-1 pro canvas) e blendMode (string PSD → canvas op).
        // Persistimos como propriedades do layer pra cada peça poder ter sua própria
        // opacity/blend depois (override). Na importação inicial, todos os layers
        // da matriz herdam direto do PSD.
        // ag-psd JÁ normaliza opacity pra 0..1 (psdReader.js: readUint8 / 0xff).
        // Não dividir de novo — antes virava 1/255 ≈ 0.004 e os layers ficavam
        // invisíveis no canvas.
        const psdOpacity = typeof (layer as any).opacity === "number" ? Math.max(0, Math.min(1, (layer as any).opacity)) : undefined
        const psdBlend = psdBlendToCanvas((layer as any).blendMode) ?? undefined
        const psdEffects = extractPsdEffects(layer)

        if (layer.text) {
          const td = layer.text
          const rawText = String(td.text ?? name).split("\r\n").join("\n").split("\r").join("\n")
          const defStyle = td.style ?? {}
          const defFontName = defStyle.font?.name ?? "Arial"
          if (defStyle.font?.name) fontsRequired.add(defStyle.font.name)
          const defFontSize = defStyle.fontSize ?? 48
          const defColor = defStyle.fillColor ? colorToHex(defStyle.fillColor) : "#000000"
          const isItalicByName = /italic|oblique|kursiv|cursiv/i.test(defFontName)
          // Extrai peso NUMERICO especifico do nome PostScript. PSDs frequentemente
          // usam Light(300), Medium(500), SemiBold(600), Black(900) — antes
          // mapeavamos tudo pra "normal"/"bold" e o browser caia em fallback,
          // perdendo a hierarquia visual (titulo Light com peso 400 ficava igual
          // ao corpo Regular). Agora detecta o sufixo exato e retorna o weight
          // ISO (100-900) que o Google Fonts (com axis wght@*) resolve direto.
          const extractWeight = (psdName: string, fauxBold: boolean): number => {
            if (fauxBold) return 700
            if (/(^|-)Thin/i.test(psdName)) return 100
            if (/(^|-)(ExtraLight|UltraLight)/i.test(psdName)) return 200
            if (/(^|-)Light/i.test(psdName)) return 300
            if (/(^|-)(Medium|Md)/i.test(psdName)) return 500
            if (/(^|-)(SemiBold|DemiBold|SemiBd|DemiBd)/i.test(psdName)) return 600
            if (/(^|-)(ExtraBold|UltraBold)/i.test(psdName)) return 800
            if (/(^|-)(Black|Heavy)/i.test(psdName)) return 900
            if (/(^|-)Bold/i.test(psdName) || /-(bd|b)$/i.test(psdName)) return 700
            return 400 // Regular/Roman default
          }
          const defWeight = extractWeight(defFontName, !!defStyle.fauxBold)
          const defStyleItalic = (defStyle.fauxItalic || isItalicByName) ? "italic" : "normal"
          // Alinhamento real do paragraphStyle (era hardcoded "left" — texto
          // PSD centralizado virava esquerdo, bug visivel no painel verde Sicredi).
          const psJust = td.paragraphStyle?.justification
          const defAlign: "left" | "center" | "right" = psJust === "center" ? "center" : psJust === "right" ? "right" : "left"
          // Leading absoluto em PONTOS (Adobe-style). leadingPt eh fonte da verdade
          // no editor; lineHeight derivado pra Fabric. ag-psd: defStyle.leading vem
          // em PONTOS pre-transform — multiplica por textScale pra ficar correto.

          // Fix #1: ag-psd retorna fontSize NO ESPACO DO TEXTO (antes da transform).
          // A transform 6-elem [a,b,c,d,e,f] aplica scale/rot/translate; pra fontSize
          // visual real, multiplica pelo magnitude de [a,b] (scaleX) ~= [c,d] (scaleY).
          // Sem isso, "Seguro Viagem" sai com fontSize 788 (cru) em vez de 189 (visual).
          const tform: number[] | undefined = td.transform
          let textScale = 1
          if (tform && tform.length >= 4) {
            const sx = Math.hypot(tform[0] ?? 1, tform[1] ?? 0)
            const sy = Math.hypot(tform[2] ?? 0, tform[3] ?? 1)
            const avg = (sx + sy) / 2
            if (Number.isFinite(avg) && avg > 0) textScale = avg
          }
          const scaledDefFontSize = defFontSize * textScale
          // Leading em PONTOS já escalado. HEURÍSTICA PHOTOSHOP:
          // autoLeading=true (explicit) → usa o fator do paragraphStyle (1.2 default)
          // leading === fontSize (PSD freq. stora isso quando "Auto" tá marcado mas
          //   a UI mostra valor explicito) → também trata como Auto
          // caso contrário usa o valor literal.
          // Sem essa heuristica, textos com leading=fontSize renderizam com
          // lineHeight=1.0 (linhas baselines grudadas) e ficam sobrepostos.
          const defLeadingRaw = typeof defStyle.leading === "number" ? defStyle.leading : undefined
          const paraAutoFactor = typeof td.paragraphStyle?.autoLeading === "number" ? td.paragraphStyle.autoLeading : 1.2
          const leadingEqualsFont = defLeadingRaw !== undefined && Math.abs(defLeadingRaw - defFontSize) < 0.5
          const isLeadingAuto = defStyle.autoLeading === true || defLeadingRaw === undefined || leadingEqualsFont
          const defLeadingPt = isLeadingAuto
            ? Math.round(scaledDefFontSize * paraAutoFactor)
            : Math.round(defLeadingRaw! * textScale)

          // Normalizador inline: PSD PostScript name → Google Font family.
          // Mesma logica que normalizePsdFontToGoogle em lib/google-fonts.ts.
          // Replicada inline pra evitar import dinamico em loop quente.
          //   "OpenSans-BoldItalic" → "Open Sans"
          //   "Exo2Roman-Bold"      → "Exo 2"   (Roman = variante PostScript)
          //   "ArialMT"             → "Arial"   (MT suffix Adobe)
          const normalizeFamily = (psdName: string): string => {
            if (!psdName) return psdName
            let base = psdName.replace(/-(Thin|ExtraLight|UltraLight|Light|Regular|Medium|SemiBold|DemiBold|Bold|ExtraBold|Black|Heavy)(Italic|Oblique)?$/i, "")
                              .replace(/-(Italic|Oblique)$/i, "")
                              .replace(/Roman$/i, "")
                              .replace(/MT$/, "")
                              .trim()
            let spaced = base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
            return spaced.replace(/([A-Za-z])(\d)/g, "$1 $2")
          }
          const defFamilyNorm = normalizeFamily(defFontName)

          let spans: any[] = []
          const runs = td.styleRuns ?? []
          if (runs.length > 0) {
            let cursor = 0
            for (const run of runs) {
              const len = run.length ?? 0
              const segment = rawText.substring(cursor, cursor + len)
              if (!segment) { cursor += len; continue }
              const rs = run.style ?? {}
              const fontName = rs.font?.name ?? defFontName
              if (rs.font?.name) fontsRequired.add(rs.font.name)
              const fontSize = (rs.fontSize ?? defFontSize) * textScale
              const color = rs.fillColor ? colorToHex(rs.fillColor) : defColor
              const isItalicRs = /italic|oblique|kursiv|cursiv/i.test(fontName)
              // Peso numerico (100-900) extraido do nome PostScript — Google
              // Fonts axis wght resolve com precisao. Sem rs.font?.name usa
              // o defWeight como fallback (mesmo peso da camada padrao).
              const fontWeight = rs.font?.name ? extractWeight(fontName, !!rs.fauxBold) : defWeight
              const fontStyle = (rs.fauxItalic || isItalicRs) ? "italic" : defStyleItalic
              const fontFamilyNorm = normalizeFamily(fontName)
              spans.push({ text: segment, style: { color, fontSize: Math.round(fontSize), fontWeight, fontStyle, fontFamily: fontFamilyNorm } })
              cursor += len
            }
            if (cursor < rawText.length) {
              spans.push({ text: rawText.substring(cursor), style: { color: defColor, fontSize: Math.round(scaledDefFontSize), fontWeight: defWeight, fontStyle: defStyleItalic, fontFamily: defFamilyNorm } })
            }
          } else {
            spans = [{ text: rawText, style: { color: defColor, fontSize: Math.round(scaledDefFontSize), fontWeight: defWeight, fontStyle: defStyleItalic, fontFamily: defFamilyNorm } }]
          }

          // Fix #1 (cont): td.boundingBox vem em PONTOS no espaco PRE-transform —
          // pode dar valores absurdos (5000+). layer.right-left/bottom-top ja eh o
          // bbox visual em pixels no canvas, sempre correto. Usamos esse direto.
          const textWidth = width
          const textHeight = height

          // Monta lastOverride: BOX (width/height) + CHARACTER (cor, fonte, etc).
          // Se ha multiplos spans, gera styles per-caractere pra preservar formatacao
          // original do PSD ate ao ultimo caractere.
          const lastOverride: any = {
            width: textWidth,
            height: textHeight,
            fontFamily: defFamilyNorm,
            fontSize: Math.round(scaledDefFontSize),
            fontWeight: defWeight,
            fontStyle: defStyleItalic,
            fill: defColor,
            charSpacing: 0,
            // lineHeight derivado de leadingPt/fontSize (Fabric usa multiplier).
            lineHeight: scaledDefFontSize > 0 ? defLeadingPt / scaledDefFontSize : 1.0,
            leadingPt: defLeadingPt,
            textAlign: defAlign,
          }
          if (spans.length > 1) {
            const styles: any = { 0: {} }
            let charIdx = 0
            for (const span of spans) {
              const txt = span.text
              for (let i = 0; i < txt.length; i++) {
                if (txt[i] === "\n") { charIdx++; continue }
                styles[0][String(charIdx)] = {
                  fill: span.style.color,
                  fontSize: span.style.fontSize,
                  fontFamily: span.style.fontFamily,
                  fontWeight: span.style.fontWeight,
                  fontStyle: span.style.fontStyle,
                }
                charIdx++
              }
            }
            lastOverride.styles = styles
          }

          assets.push({
            label: name, type: "TEXT",
            content: spans,
            posX: left, posY: top, width: textWidth, height: textHeight, zIndex,
            lastOverride,
            mask: assetMask,
            // Clipping mask agora resolvida via clipBase + folder mask como
            // silhueta; layer entra visivel normalmente.
            hidden: layer.hidden === true ? true : undefined,
            locked: (layer as any).transparencyProtected === true ? true : undefined,
            opacity: psdOpacity,
            blendMode: psdBlend,
            effects: psdEffects,
            groupPath: groupPath.length > 0 ? groupPath : undefined,
          })
        } else if (layer.canvas || ((layer as any).vectorMask?.paths?.length && ((layer as any).vectorFill || (layer as any).vectorStroke))) {
          try {
            // Shape layer com vectorFill/vectorStroke: ag-psd às vezes entrega
            // canvas só com stroke (fill vem de Color Overlay) ou nem isso.
            // Re-renderizamos vector UNDER + ag-psd canvas POR CIMA pra garantir
            // o visual completo (escudo verde do piloto Sicredi caía nesse caso).
            const renderedShape = renderShapeLayerCanvas(layer, width, height, left, top)
            const preBakeOriginal: HTMLCanvasElement = renderedShape ?? (layer.canvas as HTMLCanvasElement)
            // ADJUSTMENT LAYERS: aplica Levels/Brightness/Hue+Sat antes do bake.
            // Em PS, adjustments no mesmo grupo (acima desta layer) modificam
            // os pixels DESTA layer. Clona o canvas pra nao mutar o original.
            let preBake = preBakeOriginal
            if (adjustments && adjustments.length > 0) {
              try {
                const cloned = document.createElement("canvas")
                cloned.width = preBakeOriginal.width
                cloned.height = preBakeOriginal.height
                const cctx = cloned.getContext("2d")
                if (cctx) {
                  cctx.drawImage(preBakeOriginal, 0, 0)
                  applyAdjustmentsToCanvas(cloned, adjustments)
                  preBake = cloned
                  console.log("[psd-adjust] aplicado", adjustments.length, "adjustment(s) em", name, "→", adjustments.map(a => a.type).join(","))
                }
              } catch (e) { console.warn("[psd-adjust] falha em", name, e) }
            }
            // Bake colorOverlay/gradientOverlay/dropShadow/outerGlow no bitmap.
            // Fabric não tem source-atop tint pra image fill — só fazendo bake
            // o logo Sicredi (outline raster + colorOverlay verde) aparece com
            // o fill correto no editor.
            const baked = bakeImageEffects(preBake, psdEffects)
            const finalCanvas = baked.canvas
            const bakePad = baked.pad
            // Effects que foram embutidas no bitmap: REMOVE do JSON pra evitar
            // dupla aplicação. Agora bakeamos TAMBEM innerShadow, innerGlow,
            // stroke (alem de colorOverlay/gradientOverlay/dropShadow/outerGlow).
            // Mantém bevel/satin pra round-trip (sao mais complexos e raros).
            let effectsForLayer = psdEffects
            if (bakePad > 0 || (psdEffects && (psdEffects.colorOverlay || psdEffects.gradientOverlay || psdEffects.innerShadow || psdEffects.innerGlow || psdEffects.stroke))) {
              if (psdEffects) {
                effectsForLayer = { ...psdEffects }
                delete effectsForLayer.colorOverlay
                delete effectsForLayer.gradientOverlay
                delete effectsForLayer.dropShadow
                delete effectsForLayer.outerGlow
                delete effectsForLayer.innerShadow
                delete effectsForLayer.innerGlow
                delete effectsForLayer.stroke
                if (Object.keys(effectsForLayer).length === 0) effectsForLayer = undefined
              }
            }
            const blob = await canvasToBlob(finalCanvas)
            const imageIndex = imageBlobs.length
            imageBlobs.push(blob)
            // Smart Object: se layer tem placedLayer.id, linkamos ao linkedFile
            // correspondente pra preservar o original. O preview raster (canvas)
            // continua usado como imageUrl pro editor renderizar.
            const placed: any = (layer as any).placedLayer
            const linkedIndex = placed?.id ? guidToIndex.get(placed.id) : undefined
            // Ajusta posX/posY/width/height pelo padding do bake. Effects como
            // dropShadow/outerGlow expandem a área visível além do bbox PSD.
            // Sem o ajuste, a shadow seria CORTADA pelo bbox original ou o
            // conteúdo apareceria deslocado.
            assets.push({
              label: name, type: "IMAGE",
              imageIndex,
              linkedIndex,           // index no linkedBlobs (se for smart object)
              posX: left - bakePad, posY: top - bakePad,
              width: width + bakePad * 2, height: height + bakePad * 2,
              zIndex,
              mask: assetMask,
              // Clipping mask agora resolvida via clipBase + folder mask como
              // silhueta; layer entra visivel normalmente.
              hidden: layer.hidden === true ? true : undefined,
              locked: (layer as any).transparencyProtected === true ? true : undefined,
              opacity: psdOpacity,
              blendMode: psdBlend,
              effects: effectsForLayer,
              groupPath: groupPath.length > 0 ? groupPath : undefined,
            })
          } catch (e) {
            console.warn("Falha ao extrair imagem do layer", name, e)
          }
        } else {
          // Caiu fora de todos os branches (text, image-com-canvas, vector-fill).
          // Log explicito pra capturar PSDs onde smart objects ou shape layers
          // chegam sem canvas decodificado nem vector data — comum em PSDs com
          // generative fill, smart objects nao-rasterizados, ou camadas tipo
          // "Preenchimento generativo" que ag-psd nao decodifica.
          console.warn("[psd-import] LAYER NAO IMPORTADO:", name, {
            hasCanvas: !!layer.canvas,
            isText: !!layer.text,
            isSmartObj: isSmartObject,
            isAdjustment: !!(layer as any).adjustment,
            placedLayerType: (layer as any).placedLayer?.type,
          })
        }
        zIndex++
      }

      if (assets.length === 0) {
        setError("Nenhum layer extraido do PSD")
        return
      }

      // Threshold: se o PSD for maior que 50MB, NAO envia o arquivo original
      // no mesmo request (estouraria limite de FormData do Next/Node, dando
      // 'Failed to parse body as FormData'). Os assets+imagens decompostas
      // sao pequenas e sobem normal. Upload do master PSD original vai ser
      // implementado em chunked upload posteriormente.
      const PSD_INLINE_LIMIT = 50 * 1024 * 1024 // 50MB
      const skipMasterPsd = file.size > PSD_INLINE_LIMIT

      setProgress(`Enviando ${assets.length} assets, ${imageBlobs.length} imagens, ${linkedBlobs.length} smart objects...${skipMasterPsd ? " (PSD master sera uploadado em seguida)" : ""}`)

      const fd = new FormData()
      if (!skipMasterPsd) {
        fd.append("psd", file)
      } else {
        // Avisa o backend que o PSD master sera uploadado depois (via chunked).
        // Por enquanto so registramos o nome original.
        fd.append("psdName", file.name)
        fd.append("psdSize", String(file.size))
        fd.append("skipMaster", "1")
      }
      fd.append("assets", JSON.stringify(assets))
      fd.append("canvasWidth", String(psd.width))
      fd.append("canvasHeight", String(psd.height))
      // Detecta cor de fundo da peca: sampleia top-left + 4 cantos do composite
      // do PSD. Se todos batem (variancia baixa) eh BG solido — usamos essa cor.
      // Antes era hardcoded "#ffffff" e o editor renderizava branco mesmo em
      // PSDs com bg colorido. Fallback continua branco quando psd.canvas
      // indisponivel ou pixels transparentes.
      let detectedBg = "#ffffff"
      try {
        const psdCanvas = (psd as any).canvas as HTMLCanvasElement | undefined
        if (psdCanvas && psdCanvas.width > 0 && psdCanvas.height > 0) {
          const ctx = psdCanvas.getContext("2d")
          if (ctx) {
            const samplePoints: Array<[number, number]> = [
              [0, 0],
              [psdCanvas.width - 1, 0],
              [0, psdCanvas.height - 1],
              [psdCanvas.width - 1, psdCanvas.height - 1],
              [Math.floor(psdCanvas.width / 2), Math.floor(psdCanvas.height / 2)],
            ]
            const samples: Array<[number, number, number]> = []
            for (const [x, y] of samplePoints) {
              const d = ctx.getImageData(x, y, 1, 1).data
              if (d[3] >= 240) samples.push([d[0], d[1], d[2]]) // ignora transparente
            }
            if (samples.length > 0) {
              // Media dos samples opacos
              const r = Math.round(samples.reduce((a, s) => a + s[0], 0) / samples.length)
              const g = Math.round(samples.reduce((a, s) => a + s[1], 0) / samples.length)
              const b = Math.round(samples.reduce((a, s) => a + s[2], 0) / samples.length)
              detectedBg = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")
            }
          }
        }
      } catch { /* mantem fallback */ }
      fd.append("bgColor", detectedBg)
      // Fontes referenciadas no PSD (defStyle + runs). Backend devolve no
      // payload pra UI alertar o user que precisa fazer upload das ausentes.
      const fontsList = Array.from(fontsRequired).sort()
      fd.append("fontsRequired", JSON.stringify(fontsList))
      // Auto-carrega fontes do PSD via Google Fonts (best-effort) ANTES de
      // gerar peças. Sem isso, ao abrir o editor a fonte cai em fallback
      // (Arial) ate o usuario fazer upload manual da brand font.
      try {
        const { ensurePsdFontsReady } = await import("@/lib/google-fonts")
        ensurePsdFontsReady(fontsList)
      } catch (e) { console.warn("[psd] ensurePsdFontsReady falhou:", e) }
      imageBlobs.forEach((b, i) => fd.append("images", b, `layer-${i}.png`))
      // Smart objects: bytes + metadados (mesmo index na lista do backend)
      fd.append("linkedMeta", JSON.stringify(linkedMeta))
      linkedBlobs.forEach((b, i) => {
        const meta = linkedMeta[i]
        fd.append("linked", b, meta.originalName ?? `linked-${i}`)
      })

      const res = await fetch(`/api/campaigns/${campaignId}/import-psd`, { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Falha ao importar")

      // Gera e envia o thumbnail da matriz a partir do composite do PSD.
      // Sem isso, o card 'Key Vision (Matriz)' fica vazio depois do import
      // (so com fallback do tamanho em texto). Faz best-effort: falha aqui nao
      // bloqueia o import.
      try {
        if (psd.canvas) {
          setProgress("Gerando preview...")
          const TARGET = 480 // mesmo target que o editor usa pro KV thumb
          const sw = (psd.canvas as HTMLCanvasElement).width
          const sh = (psd.canvas as HTMLCanvasElement).height
          const scale = Math.min(TARGET / sw, TARGET / sh, 1)
          const tw = Math.max(1, Math.round(sw * scale))
          const th = Math.max(1, Math.round(sh * scale))
          const thumbCanvas = document.createElement("canvas")
          thumbCanvas.width = tw
          thumbCanvas.height = th
          const ctx = thumbCanvas.getContext("2d")
          if (ctx) {
            ctx.fillStyle = "#ffffff"
            ctx.fillRect(0, 0, tw, th)
            ctx.drawImage(psd.canvas as HTMLCanvasElement, 0, 0, tw, th)
            const thumbBlob: Blob | null = await new Promise(resolve => {
              thumbCanvas.toBlob(b => resolve(b), "image/jpeg", 0.85)
            })
            if (thumbBlob) {
              const tfd = new FormData()
              tfd.append("thumbnail", thumbBlob, "kv-thumb.jpg")
              await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: tfd })
            }
          }
        }
      } catch (thumbErr) {
        console.warn("KV thumb post-import upload failed:", thumbErr)
      }

      // Alerta sobre fontes do PSD que NÃO estão disponíveis no navegador.
      // document.fonts.check("12px FontName") retorna false se o browser não
      // tem essa fonte (system + brand fonts carregadas via @font-face).
      // Se faltar, browser cai em fallback (Arial) → métricas diferentes →
      // wrap+altura do texto destoam do PSD original.
      try {
        const fonts: string[] = Array.isArray(data?.fontsRequired) ? data.fontsRequired : []
        const missing: string[] = []
        if (fonts.length > 0 && typeof document !== "undefined" && (document as any).fonts?.check) {
          for (const fname of fonts) {
            // Testa com weight padrão; check é exato no nome da família.
            const probe = `12px "${fname.replace(/"/g, '\\"')}"`
            try {
              if (!(document as any).fonts.check(probe)) missing.push(fname)
            } catch { missing.push(fname) }
          }
        }
        if (missing.length > 0) {
          // Modal de upload em vez de alert() bruto: usuario pode escolher
          // ir pra pagina do cliente fazer upload, ou pular.
          setMissingFontsModal({ fonts: missing, clientId: data?.clientId ?? null })
        }
      } catch (fontWarnErr) { console.warn("[font-check] falhou:", fontWarnErr) }

      onImported()
    } catch (e: any) {
      console.error("PSD import error:", e)
      setError("Erro: " + (e?.message ?? "desconhecido"))
    } finally {
      setLoading(false)
      setProgress("")
    }
  }

  return (
    <>
      <Button
        variant="primary"
        size="lg"
        accept=".psd"
        onFileSelect={(f) => handleFile(f)}
        loading={loading}
        title="Importar arquivo PSD"
      >
        {loading ? (progress || "Processando...") : "Importar PSD"}
      </Button>
      {error && <div style={{ fontSize: 12, color: "#f87171", marginTop: 4 }}>{error}</div>}
      {missingFontsModal && (
        <div
          onClick={() => setMissingFontsModal(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#1e1e1e", color: "#fff",
              padding: 24, borderRadius: 12,
              maxWidth: 520, width: "90%",
              border: "1px solid #333",
              boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
              Fontes do PSD não instaladas
            </div>
            <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5, marginBottom: 12 }}>
              O PSD usa {missingFontsModal.fonts.length === 1 ? "esta fonte" : "estas fontes"} que não estão
              disponíveis. Sem o arquivo exato (.ttf/.otf), o editor tenta carregar via Google Fonts
              — fica visualmente parecido mas as <strong>métricas (largura, kerning, line-height)
              divergem</strong> do PSD original, o que pode causar texto vazando da bbox ou
              quebrando em pontos diferentes. Pra fidelidade Photoshop, faça upload dos
              arquivos exatos no painel de Fontes da Marca do cliente.
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
              Após o upload, <strong>recarregue esta página</strong> pra o editor usar a fonte nova.
            </div>
            <ul style={{ background: "#0f0f0f", borderRadius: 8, padding: "10px 14px 10px 28px", margin: "0 0 16px", fontSize: 13, listStyle: "disc", maxHeight: 200, overflow: "auto" }}>
              {missingFontsModal.fonts.map((f) => (
                <li key={f} style={{ padding: "2px 0", fontFamily: "monospace" }}>{f}</li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setMissingFontsModal(null)}
                style={{
                  padding: "8px 14px", borderRadius: 6,
                  background: "transparent", color: "#aaa",
                  border: "1px solid #444", cursor: "pointer", fontSize: 13,
                }}
              >
                Pular (usar fallback)
              </button>
              {missingFontsModal.clientId ? (
                <button
                  onClick={() => {
                    const cid = missingFontsModal.clientId
                    setMissingFontsModal(null)
                    // Abre em nova aba pra nao perder o estado da campanha
                    window.open(`/clients/${cid}/edit`, "_blank")
                  }}
                  style={{
                    padding: "8px 14px", borderRadius: 6,
                    background: "#facc15", color: "#000",
                    border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                  }}
                >
                  Fazer upload das fontes
                </button>
              ) : (
                <button
                  onClick={() => setMissingFontsModal(null)}
                  style={{
                    padding: "8px 14px", borderRadius: 6,
                    background: "#facc15", color: "#000",
                    border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                  }}
                >
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
