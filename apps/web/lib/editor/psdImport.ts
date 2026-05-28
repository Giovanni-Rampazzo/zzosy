// Helpers de importacao PSD — extraidos de KeyVisionEditor.tsx (2026-05-28).
// Puros, sem state externo.

import type { BgLayerData, BgGradientStop } from "./types"

// Cor ag-psd → hex. ag-psd ora retorna 0..255, ora 0..1; normalizamos pelos dois.
export function psdColorToHex(color: any): string {
  if (!color) return "#000000"
  const rr = color.r > 1 ? Math.round(color.r) : Math.round(color.r * 255)
  const gg = color.g > 1 ? Math.round(color.g) : Math.round(color.g * 255)
  const bb = color.b > 1 ? Math.round(color.b) : Math.round(color.b * 255)
  return "#" + [rr, gg, bb].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
}

// Amostra pixel central dum canvas raster; retorna null se transparente.
export function sampleHexAt(c: HTMLCanvasElement, x: number, y: number): string | null {
  try {
    const ctx = c.getContext("2d")
    if (!ctx) return null
    const cx = Math.max(0, Math.min(c.width - 1, Math.floor(x)))
    const cy = Math.max(0, Math.min(c.height - 1, Math.floor(y)))
    const px = ctx.getImageData(cx, cy, 1, 1).data
    if (px[3] === 0) return null
    const h = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")
    return `#${h(px[0])}${h(px[1])}${h(px[2])}`
  } catch { return null }
}

// Detecta se um canvas raster eh uma cor solida uniforme. Amostra 9 pontos
// (cantos, meio dos lados, centro) — se todos batem com tolerancia 2 em
// cada canal, considera solido. Caso contrario tem desenho/textura/gradient
// rasterizado e deve virar BG kind="image" pra preservar.
export function isCanvasUniform(c: HTMLCanvasElement): boolean {
  const ctx = c.getContext("2d")
  if (!ctx) return true
  const w = c.width, h = c.height
  if (w === 0 || h === 0) return true
  const xs = [0, Math.floor(w / 2), w - 1]
  const ys = [0, Math.floor(h / 2), h - 1]
  let ref: Uint8ClampedArray | null = null
  for (const y of ys) {
    for (const x of xs) {
      try {
        const px = ctx.getImageData(x, y, 1, 1).data
        if (!ref) { ref = px; continue }
        if (
          Math.abs(px[0] - ref[0]) > 2 ||
          Math.abs(px[1] - ref[1]) > 2 ||
          Math.abs(px[2] - ref[2]) > 2 ||
          Math.abs(px[3] - ref[3]) > 2
        ) return false
      } catch { return false }
    }
  }
  return true
}

// Tenta extrair um BG layer (BgLayerData) a partir dum layer PSD top-level.
// Suporta:
//  - Solid Color fill layer (vectorFill.type === 'color') → BG solid exato
//  - Gradient fill layer (vectorFill.type === 'solid' + colorStops) → BG gradient
//  - Layer raster cobrindo canvas → BG solid amostrado (pixel central)
export function extractPsdBgLayer(layer: any, psdW: number, psdH: number): BgLayerData | null {
  if (!layer) return null
  const vf = layer.vectorFill
  if (vf?.type === "color" && vf.color) {
    return { kind: "solid", color: psdColorToHex(vf.color), opacity: 1 }
  }
  if (vf?.type === "solid" && Array.isArray(vf.colorStops) && vf.colorStops.length >= 2) {
    const stops: BgGradientStop[] = vf.colorStops.map((s: any) => ({
      offset: Math.max(0, Math.min(1, s.location ?? 0)),
      color: psdColorToHex(s.color),
    }))
    // Convencao PS: angle em graus, 0=cima. Nossa: 0=L→R, 90=cima→baixo.
    // Conversao: nosso = (psd - 180) % 360
    const psStyle = vf.style ?? "linear"
    const gradientType: "linear" | "radial" = psStyle === "radial" ? "radial" : "linear"
    const psAngle = typeof vf.angle === "number" ? vf.angle : 0
    const angle = ((psAngle - 180) % 360 + 360) % 360
    return { kind: "gradient", gradientType, angle, stops, opacity: 1 }
  }
  if (layer.canvas) {
    const c = layer.canvas as HTMLCanvasElement
    if (isCanvasUniform(c)) {
      const color = sampleHexAt(c, c.width / 2, c.height / 2)
      if (color) return { kind: "solid", color, opacity: 1 }
    } else {
      try {
        const dataUrl = c.toDataURL("image/png")
        return { kind: "image", imageDataUrl: dataUrl, fit: "cover", opacity: 1 }
      } catch (e) {
        console.warn("[bg-import] toDataURL falhou, fallback solid:", e)
        const color = sampleHexAt(c, c.width / 2, c.height / 2)
        if (color) return { kind: "solid", color, opacity: 1 }
      }
    }
  }
  return null
}

// Extrai estilo de texto dum layer PSD pra um override do layer da peca.
//
// Cores/fontes/pesos: ag-psd guarda o estilo em DOIS lugares:
//  - td.style: "default" do layer (frequentemente VAZIO ou so com campos
//    parciais quando o designer usou Character panel pra estilizar)
//  - td.styleRuns[]: lista de runs (segmentos contiguos) com style proprio
//    cada. Quando o texto tem 1 cor so, ha 1 run cobrindo tudo. Quando tem
//    cores diferentes (ex: "Robo" rosa + "jento" verde), ha varios runs.
// Logica: pegamos defaults do 1o styleRun (fallback td.style). Se ha >1 run,
// gera styles per-char proporcionalmente.
export function psdTextLayerToOverride(
  layer: any, pieceScale: number, pieceW: number, pieceH: number, assetText: string,
): any | null {
  const td = layer?.text
  if (!td) return null
  const fallbackStyle = td.style ?? {}
  const runs: any[] = td.styleRuns ?? []
  const primary = runs[0]?.style ?? fallbackStyle

  const pickFontName = (s: any) => s?.font?.name ?? fallbackStyle?.font?.name ?? "Arial"
  const pickFontSize = (s: any) => s?.fontSize ?? fallbackStyle?.fontSize ?? 48
  const pickColor = (s: any) => {
    if (s?.fillColor) return psdColorToHex(s.fillColor)
    if (fallbackStyle?.fillColor) return psdColorToHex(fallbackStyle.fillColor)
    return "#000000"
  }
  const pickWeight = (s: any, fontName: string) =>
    (s?.fauxBold || fontName.toLowerCase().includes("bold")) ? "bold" : "normal"

  const defFontName = pickFontName(primary)
  const defFontSize = pickFontSize(primary)
  const defColor = pickColor(primary)
  const defWeight = pickWeight(primary, defFontName)

  // ag-psd retorna fontSize NO ESPACO DO TEXTO. transform 6-elem aplica
  // scale/rot/translate; pra fontSize visual real, multiplica pela magnitude
  // de [a,b]. Sem isso, textos grandes saem com fontSize gigante.
  const tform: number[] | undefined = td.transform
  let textScale = 1
  if (tform && tform.length >= 4) {
    const sx = Math.hypot(tform[0] ?? 1, tform[1] ?? 0)
    const sy = Math.hypot(tform[2] ?? 0, tform[3] ?? 1)
    const avg = (sx + sy) / 2
    if (Number.isFinite(avg) && avg > 0) textScale = avg
  }
  const finalScale = textScale * pieceScale
  const sizeOf = (s: any) => Math.max(1, Math.round(pickFontSize(s) * finalScale))

  const ov: any = {
    width: pieceW,
    height: pieceH,
    fontFamily: defFontName,
    fontSize: sizeOf(primary),
    fontWeight: defWeight,
    fill: defColor,
    charSpacing: 0,
    lineHeight: 1.0,
    textAlign: "left",
  }

  if (runs.length > 1 && assetText.length > 0) {
    const psdTextLen = runs.reduce((acc, r) => acc + (r.length ?? 0), 0)
    if (psdTextLen > 0) {
      const cells: Array<{ line: number; col: number }> = []
      let line = 0, col = 0
      for (const ch of assetText) {
        if (ch === "\n") { line++; col = 0; continue }
        cells.push({ line, col })
        col++
      }
      const assetCharLen = cells.length
      if (assetCharLen > 0) {
        const styles: Record<number, Record<number, any>> = {}
        let psdCursor = 0
        for (const run of runs) {
          const rLen = run.length ?? 0
          if (rLen <= 0) continue
          const rStyle = run.style ?? {}
          const fontName = pickFontName(rStyle)
          const charStyle = {
            fill: pickColor(rStyle),
            fontSize: sizeOf(rStyle),
            fontFamily: fontName,
            fontWeight: pickWeight(rStyle, fontName),
          }
          const startIdx = Math.floor((psdCursor / psdTextLen) * assetCharLen)
          const endIdx = Math.floor(((psdCursor + rLen) / psdTextLen) * assetCharLen)
          for (let i = startIdx; i < endIdx && i < assetCharLen; i++) {
            const { line: ln, col: cl } = cells[i]
            if (!styles[ln]) styles[ln] = {}
            styles[ln][cl] = charStyle
          }
          psdCursor += rLen
        }
        if (Object.keys(styles).length > 0) ov.styles = styles
      }
    }
  }

  return ov
}

/**
 * FONTE UNICA DE VERDADE pra propagar metadados PSD do Fabric obj pro
 * objeto `layer` JSON serializado. Era duplicado em 4 sites do save
 * (PIECE/MATRIX/2x step) — cada vez que um novo metadado PSD entrava
 * (effects → nameSource → ...), tinha que tocar os 4 ou criava drift.
 *
 * Mutates `layer` setando os fields se o Fabric obj tem o equivalente
 * __psdXxx. Convencao: defaults (opacity=1, blendMode=source-over) sao
 * OMITIDOS pra nao inflar o JSON do DB.
 */
export function applyPsdLayerMetadata(o: any, layer: any): void {
  if (o.__hidden === true) layer.hidden = true
  if (o.__locked === true) layer.locked = true
  if ((o as any).__maskData) layer.mask = (o as any).__maskData
  if (typeof o.opacity === "number" && o.opacity < 1) layer.opacity = o.opacity
  if (typeof o.globalCompositeOperation === "string" && o.globalCompositeOperation && o.globalCompositeOperation !== "source-over") {
    layer.blendMode = o.globalCompositeOperation
  }
  if ((o as any).__psdEffects && typeof (o as any).__psdEffects === "object") {
    layer.effects = (o as any).__psdEffects
  }
  if (typeof (o as any).__psdNameSource === "string") {
    layer.nameSource = (o as any).__psdNameSource
  }
  if (Array.isArray((o as any).__groupPath) && (o as any).__groupPath.length > 0) {
    layer.groupPath = (o as any).__groupPath
  }
  if ((o as any).__isSmartObject === true) {
    layer.isSmartObject = true
    if (typeof (o as any).__smartObjectGuid === "string") layer.smartObjectGuid = (o as any).__smartObjectGuid
  }
}
