/**
 * shapeImport — centraliza detecção/extração de SHAPE a partir de layer PSD.
 *
 * Centralizado em 2026-05-23 (antes da 4a copia): PsdImporter (matriz) e
 * PsdPieceImporter (peças) ambos precisavam dessa logica; o segundo nao tinha
 * e shapes em peças vinham SEMPRE rasterizados (user reportou).
 *
 * Fluxo de detecção (em ordem de preferencia):
 *   1. Parametric: vogk descriptor com keyOriginType 1/2/5 (Rect/RoundedRect/
 *      Ellipse) — preserva cornerRadius e permite editar slider.
 *   2. Path arbitrario: extrai SVG do vectorMask via bezier paths.
 *   3. Null: shape nao detectado, caller cai no fallback raster.
 */
import { unwrapPsdUnits } from "@/lib/psd/psdHelpers"
import { buildShapePath } from "@/lib/shapePaths"

export type ShapeContent = {
  path: string
  pathBbox: { left: number; top: number; right: number; bottom: number }
  kind?: "rectangle" | "roundedRect" | "ellipse"
  cornerRadius?: number
  fill: { kind: "solid"; color: string } | null
  stroke: { color: string; width: number } | null
  fillRule: "nonzero" | "evenodd"
}

export type ExtractedShape = {
  shapeContent: ShapeContent
  /** bbox absoluto no canvas do PSD (left/top onde colocar o asset) */
  bboxLeft: number
  bboxTop: number
  W: number
  H: number
  /** indica qual caminho foi usado pra deteccao (telemetria/debug) */
  source: "parametric" | "path"
}

export function colorToHex(color: any): string {
  if (!color) return "#000000"
  const rr = color.r > 1 ? Math.round(color.r) : Math.round(color.r * 255)
  const gg = color.g > 1 ? Math.round(color.g) : Math.round(color.g * 255)
  const bb = color.b > 1 ? Math.round(color.b) : Math.round(color.b * 255)
  return "#" + [rr, gg, bb].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
}

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

/** Concatena todos os paths do vectorMask num único SVG path d-attribute.
 *  Boolean operations (combine/subtract/exclude/intersect) NÃO suportadas
 *  completamente — apenas concatena. Sub-paths Z separados respeitam
 *  fillRule "evenodd" naturalmente (forma com furo). */
export function vectorMaskToSvgPath(vm: any): { d: string; bbox: { minX: number; minY: number; maxX: number; maxY: number } | null } {
  if (!vm?.paths?.length) return { d: "", bbox: null }
  const parts: string[] = []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of vm.paths) {
    const d = bezierPathToSvg(p)
    if (!d) continue
    parts.push(d)
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

/** Detecta vogk (vectorOrigination.keyDescriptorList) e extrai shape parametric.
 *  keyOriginType: 1=Rectangle, 2=RoundedRectangle, 5=Ellipse.
 *
 *  Quando o PSD foi feito com Shape Tool do PS (rect/roundedRect/ellipse com
 *  cornerRadius), preserva a parametricidade — usuario edita o raio no slider
 *  e re-export PSD volta com vogk equivalente. Sem essa deteccao, shape era
 *  rasterizado pra image perdendo o cornerRadius. */
export function detectParametricShape(layer: any): {
  kind: "rectangle" | "roundedRect" | "ellipse"
  bbox: { left: number; top: number; right: number; bottom: number }
  cornerRadius: number
  fill: { kind: "solid"; color: string } | null
  stroke: { color: string; width: number } | null
} | null {
  const vo = layer.vectorOrigination
  const item = vo?.keyDescriptorList?.[0]
  if (!item) return null
  const type = item.keyOriginType
  const kindMap: Record<number, "rectangle" | "roundedRect" | "ellipse"> = {
    1: "rectangle",
    2: "roundedRect",
    5: "ellipse",
  }
  const kind = kindMap[type]
  if (!kind) return null

  const bb = item.keyOriginShapeBoundingBox
  if (!bb) return null
  const left = unwrapPsdUnits(bb.left)
  const top = unwrapPsdUnits(bb.top)
  const right = unwrapPsdUnits(bb.right)
  const bottom = unwrapPsdUnits(bb.bottom)
  if (right <= left || bottom <= top) return null

  // Corner radius (uniform) — usa topLeft. RoundedRect tem 4 raios independentes
  // no PSD; ZZOSY MVP suporta um raio uniforme. Per-canto fica pra futuro.
  let cornerRadius = 0
  if (kind === "roundedRect" && item.keyOriginRRectRadii) {
    cornerRadius = unwrapPsdUnits(item.keyOriginRRectRadii.topLeft)
  }

  const vf = layer.vectorFill
  const fill = (vf?.type === "color" && vf.color) ? {
    kind: "solid" as const,
    color: colorToHex(vf.color),
  } : null

  const vs = layer.vectorStroke
  const stroke = (vs && vs.strokeEnabled !== false) ? {
    color: (vs.content?.type === "color" && vs.content.color) ? colorToHex(vs.content.color) : "#000000",
    width: unwrapPsdUnits(vs.lineWidth) || 0,
  } : null

  return { kind, bbox: { left, top, right, bottom }, cornerRadius, fill, stroke }
}

/** Tenta extrair shape editavel de um layer PSD. Retorna null se nao deve
 *  ser tratado como shape (faltam vectorMask+fill/stroke, ou path invalido).
 *  Caller deve cair no fallback raster nesse caso. */
export function tryExtractShapeFromLayer(layer: any): ExtractedShape | null {
  if (!layer?.vectorMask?.paths?.length) return null
  if (!layer.vectorFill && !layer.vectorStroke) return null

  // Caminho (a) — parametric (vogk)
  const parametric = detectParametricShape(layer)
  if (parametric) {
    const W = parametric.bbox.right - parametric.bbox.left
    const H = parametric.bbox.bottom - parametric.bbox.top
    return {
      shapeContent: {
        path: buildShapePath(parametric.kind, W, H, parametric.cornerRadius),
        pathBbox: { left: 0, top: 0, right: W, bottom: H },
        kind: parametric.kind,
        cornerRadius: parametric.cornerRadius,
        fill: parametric.fill,
        stroke: parametric.stroke,
        fillRule: "nonzero",
      },
      bboxLeft: parametric.bbox.left,
      bboxTop: parametric.bbox.top,
      W, H,
      source: "parametric",
    }
  }

  // Caminho (b) — path arbitrario via vectorMask
  const { d, bbox } = vectorMaskToSvgPath(layer.vectorMask)
  if (!d || !bbox) return null

  const W = bbox.maxX - bbox.minX
  const H = bbox.maxY - bbox.minY
  const vf = layer.vectorFill
  const vs = layer.vectorStroke
  const fill = (vf?.type === "color" && vf.color) ? {
    kind: "solid" as const,
    color: colorToHex(vf.color),
  } : null
  const stroke = (vs && vs.strokeEnabled !== false) ? {
    color: (vs.content?.type === "color" && vs.content.color) ? colorToHex(vs.content.color) : "#000000",
    width: (typeof vs.lineWidth?.value === "number") ? vs.lineWidth.value : (typeof vs.lineWidth === "number" ? vs.lineWidth : 0),
  } : null

  return {
    shapeContent: {
      path: d,
      pathBbox: { left: bbox.minX, top: bbox.minY, right: bbox.maxX, bottom: bbox.maxY },
      fill,
      stroke,
      fillRule: "nonzero",
    },
    bboxLeft: bbox.minX,
    bboxTop: bbox.minY,
    W, H,
    source: "path",
  }
}
