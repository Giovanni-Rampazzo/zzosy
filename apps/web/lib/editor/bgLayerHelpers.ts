// BG layer helpers — extraidos de KeyVisionEditor.tsx (2026-05-28).
// Sem state, dependem apenas de tipos + Fabric module passado como arg.

import { applyMaskToFabricObject } from "@/lib/applyMaskToFabric"
import type { BgLayerData, BgImageFit } from "./types"

// Cor representativa do BG (usado pra alimentar espelhos legacy bgColor*Ref).
// Solid: cor direta. Gradient: 1o stop. Image: branco (sem cor representavel).
export function bgLayerLegacyColor(l: BgLayerData | undefined): string {
  if (!l) return "#ffffff"
  if (l.kind === "solid") return l.color
  if (l.kind === "gradient") return l.stops[0]?.color ?? "#ffffff"
  return "#ffffff"
}

// Migra um item bruto de JSON pra BgLayerData tipado. Preserva o `kind` se
// presente (back-compat: pieces salvas com bgLayers gradient/image precisam
// re-hidratar com o tipo certo, nao forcar tudo pra solid).
export function migrateBgLayerJson(l: any): BgLayerData {
  const opacity = typeof l?.opacity === "number" ? l.opacity : 1
  const hidden = l?.hidden === true ? true : undefined
  const locked = l?.locked === true ? true : undefined
  const colorBrandIdx = typeof l?.colorBrandIdx === "number" ? l.colorBrandIdx : undefined
  if (l?.kind === "gradient" && Array.isArray(l.stops) && l.stops.length >= 2) {
    return {
      kind: "gradient",
      gradientType: l.gradientType === "radial" ? "radial" : "linear",
      angle: typeof l.angle === "number" ? l.angle : 90,
      stops: l.stops.map((s: any) => ({ offset: Math.max(0, Math.min(1, s?.offset ?? 0)), color: typeof s?.color === "string" ? s.color : "#ffffff" })),
      opacity, hidden, locked,
    }
  }
  if (l?.kind === "image" && typeof l.imageDataUrl === "string" && l.imageDataUrl) {
    const fit: BgImageFit = (l.fit === "contain" || l.fit === "fill" || l.fit === "tile") ? l.fit : "cover"
    return { kind: "image", imageDataUrl: l.imageDataUrl, fit, opacity, hidden, locked }
  }
  return { kind: "solid", color: typeof l?.color === "string" ? l.color : "#ffffff", opacity, hidden, locked, colorBrandIdx }
}

// Robustez: stop.color pode chegar como objeto serializado ({r,g,b} ou
// similar) em pecas/matrizes legadas. Canvas addColorStop crasha com
// "could not be parsed as a color" — normaliza pra string CSS antes.
export function safeColorString(v: any): string {
  if (typeof v === "string" && v) return v
  if (v && typeof v === "object") {
    const r = typeof v.r === "number" ? v.r : null
    const g = typeof v.g === "number" ? v.g : null
    const b = typeof v.b === "number" ? v.b : null
    if (r !== null && g !== null && b !== null) {
      const a = typeof v.a === "number" ? v.a : 1
      return `rgba(${r},${g},${b},${a})`
    }
  }
  return "#ffffff"
}

// Constroi o `fill` pro Fabric a partir dos dados do BG. Pra gradient,
// gera fabric.Gradient com coords calculadas pelo angulo + dimensoes do
// canvas (raio = max(w,h)/2 garante cobertura total em qualquer angulo).
// Convencao: 0deg = horizontal esquerda→direita; 90deg = vertical cima→baixo.
export function buildBgFill(layer: BgLayerData, w: number, h: number, Gradient: any): any {
  if (layer.kind === "solid") return safeColorString(layer.color)
  if (layer.kind === "gradient") {
    const rad = (layer.angle * Math.PI) / 180
    const cx = w / 2, cy = h / 2
    if (layer.gradientType === "radial") {
      const r = Math.hypot(w, h) / 2
      return new Gradient({
        type: "radial",
        coords: { x1: cx, y1: cy, x2: cx, y2: cy, r1: 0, r2: r },
        colorStops: layer.stops.map(s => ({ offset: s.offset, color: safeColorString(s.color) })),
      })
    }
    const r = Math.max(w, h) / 2
    const dx = Math.cos(rad) * r
    const dy = Math.sin(rad) * r
    return new Gradient({
      type: "linear",
      coords: { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy },
      colorStops: layer.stops.map(s => ({ offset: s.offset, color: safeColorString(s.color) })),
    })
  }
  return "#ffffff"
}

// Carrega um <img> a partir dum data URL ou URL publica. Usado pra preparar
// o source do Pattern (BG kind="image").
export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Falha ao carregar imagem"))
    img.src = src
  })
}

// Aplica o fill correto no Rect BG. Async porque image precisa carregar a
// imagem + pre-renderizar (cover/contain/fill) ou montar Pattern (tile).
export async function applyBgFillAsync(rect: any, layer: BgLayerData, w: number, h: number, fabricMod: any): Promise<void> {
  if (layer.kind !== "image") {
    rect.set("fill", buildBgFill(layer, w, h, fabricMod.Gradient))
    return
  }
  const { Pattern } = fabricMod
  try {
    const img = await loadImageElement(layer.imageDataUrl)
    if (layer.fit === "tile") {
      rect.set("fill", new Pattern({ source: img, repeat: "repeat" }))
      return
    }
    const aux = document.createElement("canvas")
    aux.width = Math.max(1, Math.round(w))
    aux.height = Math.max(1, Math.round(h))
    const ctx = aux.getContext("2d")!
    ctx.clearRect(0, 0, aux.width, aux.height)
    if (layer.fit === "fill") {
      ctx.drawImage(img, 0, 0, aux.width, aux.height)
    } else {
      const iw = img.naturalWidth || img.width || 1
      const ih = img.naturalHeight || img.height || 1
      const s = layer.fit === "cover"
        ? Math.max(aux.width / iw, aux.height / ih)
        : Math.min(aux.width / iw, aux.height / ih)
      const dw = iw * s, dh = ih * s
      const dx = (aux.width - dw) / 2, dy = (aux.height - dh) / 2
      ctx.drawImage(img, dx, dy, dw, dh)
    }
    rect.set("fill", new Pattern({ source: aux, repeat: "no-repeat" }))
  } catch (e) {
    console.warn("[bg-image] falha ao aplicar imagem:", e)
    rect.set("fill", "#ffffff")
  }
}

// Sincroniza TODAS as props do BG layer no Rect Fabric: fill, opacity,
// visible, blendMode (globalCompositeOperation), mask (clipPath via
// applyMaskToFabricObject). Async pq fill pode envolver carregar imagem.
export async function syncBgLayerToRect(rect: any, layer: BgLayerData, w: number, h: number, fabricMod: any): Promise<void> {
  await applyBgFillAsync(rect, layer, w, h, fabricMod)
  rect.set("opacity", layer.opacity)
  rect.set("visible", layer.hidden !== true)
  rect.set("globalCompositeOperation", layer.blendMode ?? "source-over")
  if (layer.mask) {
    const { Image: FabImage, Path } = fabricMod
    ;(rect as any).__maskData = layer.mask
    ;(rect as any).clipPath = null
    try { await applyMaskToFabricObject({ Image: FabImage, Path }, rect, layer.mask) }
    catch (e) { console.warn("[bg-mask] falha:", e) }
  } else {
    delete (rect as any).__maskData
    ;(rect as any).clipPath = null
  }
}
