/**
 * Geradores de path SVG pra SHAPE assets parametricos.
 *
 * Antes esses geradores viviam duplicados em 3 sites (addShapeAsset em
 * /assets, setCornerRadius no KeyVisionEditor, addAssetToCanvas no
 * load). Centralizado aqui pra evitar drift quando parametros mudam.
 *
 * Cada gerador toma W/H + cornerRadius (quando aplicavel) e retorna a
 * string SVG comecando em (0,0). Caller posiciona via Fabric.Path.left/top.
 *
 * Constante K eh a aproximacao cubic-bezier de arco de circulo
 * (4*(sqrt(2)-1)/3). Usada pra cantos arredondados e elipse.
 */
export const K_BEZIER = 0.5522847498

export type ShapeKind = "rectangle" | "roundedRect" | "ellipse"

/**
 * Rectangle: 4 cantos sharp. Path de 4 segmentos L + Z.
 */
export function rectanglePath(W: number, H: number): string {
  return `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z`
}

/**
 * Rounded Rectangle: 4 cantos com raio cubic-bezier.
 *
 * Se cornerRadius > min(W,H)/2, clampa pra max valido (evita curvas
 * cruzadas). Se cornerRadius === 0, vira rectangle sharp.
 */
export function roundedRectPath(W: number, H: number, cornerRadius: number): string {
  const r = Math.max(0, Math.min(cornerRadius, Math.min(W, H) / 2))
  if (r === 0) return rectanglePath(W, H)
  const k = r * K_BEZIER
  return [
    `M ${r} 0`,
    `L ${W - r} 0`,
    `C ${W - r + k} 0, ${W} ${r - k}, ${W} ${r}`,
    `L ${W} ${H - r}`,
    `C ${W} ${H - r + k}, ${W - r + k} ${H}, ${W - r} ${H}`,
    `L ${r} ${H}`,
    `C ${r - k} ${H}, 0 ${H - r + k}, 0 ${H - r}`,
    `L 0 ${r}`,
    `C 0 ${r - k}, ${r - k} 0, ${r} 0`,
    "Z",
  ].join(" ")
}

/**
 * Ellipse: 4 quarter arcs aproximados com cubic Bezier. Funciona pra
 * elipse (rx != ry) ou circulo (rx === ry).
 */
export function ellipsePath(W: number, H: number): string {
  const cx = W / 2, cy = H / 2, rx = W / 2, ry = H / 2
  const dx = rx * K_BEZIER, dy = ry * K_BEZIER
  return [
    `M ${cx} 0`,
    `C ${cx + dx} 0, ${W} ${cy - dy}, ${W} ${cy}`,
    `C ${W} ${cy + dy}, ${cx + dx} ${H}, ${cx} ${H}`,
    `C ${cx - dx} ${H}, 0 ${cy + dy}, 0 ${cy}`,
    `C 0 ${cy - dy}, ${cx - dx} 0, ${cx} 0`,
    "Z",
  ].join(" ")
}

/**
 * Dispatcher central: dado kind + dimensoes + raio, retorna o path SVG.
 * cornerRadius ignorado pra rectangle/ellipse.
 */
export function buildShapePath(kind: ShapeKind, W: number, H: number, cornerRadius?: number): string {
  if (kind === "rectangle") return rectanglePath(W, H)
  if (kind === "roundedRect") return roundedRectPath(W, H, cornerRadius ?? 0)
  if (kind === "ellipse") return ellipsePath(W, H)
  // Default: rectangle. Caller deveria sempre passar kind valido.
  return rectanglePath(W, H)
}
