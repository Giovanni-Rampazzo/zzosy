// Helpers de SHAPE override + path manipulation — extraidos de
// KeyVisionEditor.tsx (2026-05-28). Puros, sem dependencia de state.

/**
 * Parser minimo de path SVG → formato interno do Fabric.Path
 *   `[ ["M", x, y], ["L", x, y], ["C", x1, y1, x2, y2, x, y], ["Z"] ]`
 *
 * Suporta apenas os comandos usados em lib/shapePaths.ts: M, L, C, Z (uppercase
 * absolutos). Pra geradores parametricos isso eh suficiente — paths importados
 * de PSD podem ter outros comandos mas esses NAO sao recomputados aqui (o
 * recompute so roda em shapes com __shapeKind setado, i.e., adicionadas via
 * "+ Forma" ou Live Shapes PSD).
 */
export function parseSimpleSvgPathToFabric(d: string): any[] {
  const tokens = d.match(/[MLCZmlczMLCZ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []
  const out: any[] = []
  let i = 0
  while (i < tokens.length) {
    const cmd = tokens[i]
    if (cmd === "M" || cmd === "L") {
      out.push([cmd, Number(tokens[i + 1]), Number(tokens[i + 2])])
      i += 3
    } else if (cmd === "C") {
      out.push([
        cmd,
        Number(tokens[i + 1]), Number(tokens[i + 2]),
        Number(tokens[i + 3]), Number(tokens[i + 4]),
        Number(tokens[i + 5]), Number(tokens[i + 6]),
      ])
      i += 7
    } else if (cmd === "Z" || cmd === "z") {
      out.push(["Z"])
      i += 1
    } else {
      i += 1
    }
  }
  return out
}

/**
 * Substitui o `d` (path SVG) de um Fabric.Path EXISTENTE in-place.
 * Reusa o objeto sem destrui-lo (preserva listeners, __assetId, selecao
 * ativa). Fabric v7: obj.path eh array de comandos; precisa parsear o
 * d string e atribuir. Depois marca dirty, recalcula bbox via
 * _calcDimensions e setCoords pra handles atualizarem.
 *
 * Usado por: setCornerRadius (slider de raio) e scaling hook (parametric
 * resize). Centralizado pra eliminar duplicacao + tratamento de erro.
 */
export function applyShapePathInPlace(obj: any, newPathD: string): void {
  try {
    const parsed = parseSimpleSvgPathToFabric(newPathD)
    if (!parsed || !parsed.length) return
    // _setPath eh a API CERTA do Fabric: atribui path E recalcula pathOffset
    // a partir do novo bbox. Atribuir obj.path direto + _calcDimensions NAO
    // atualiza pathOffset → o path fica desenhado fora da posicao visual
    // esperada e o shape "some". Sintoma 2026-05-23: "mudei cornerRadius
    // e shape desapareceu".
    if (typeof obj._setPath === "function") {
      obj._setPath(parsed, false)
    } else {
      obj.path = parsed
      if (typeof obj._calcDimensions === "function") obj._calcDimensions()
    }
    obj.dirty = true
    if (obj.setCoords) obj.setCoords()
  } catch (e) {
    console.warn("[applyShapePathInPlace] falha:", e)
  }
}

/**
 * Aplica stroke position (Photoshop lineAlignment) visualmente no Fabric.Path.
 *
 * SIMPLIFICADO 2026-05-27: hack visual de inside/outside via clipPath +
 * strokeWidth dobrado causava bugs em cascata (shape invisivel em paths
 * com coords absolutas, strokeWidth dobrando a cada save/reload). User
 * reportou: "esse erro no editor e por causa de mascara".
 *
 * Position eh PRESERVADO como metadata em p.__strokePosition pra round-
 * trip PSD (export grava em vectorStroke.lineAlignment). No editor, sempre
 * renderiza com Fabric center-stroke nativo. Trade-off aceito: editor nao
 * mostra preview visual exato de inside/outside, mas o PSD ROUND-TRIP esta
 * correto e o editor nunca quebra.
 */
export function applyStrokePositionVisual(p: any, _position: "inside" | "center" | "outside", _PathCtor: any): void {
  const naturalW = typeof p.__naturalStrokeWidth === "number"
    ? p.__naturalStrokeWidth
    : (p.strokeWidth ?? 0)
  p.__naturalStrokeWidth = naturalW
  if (p.clipPath && p.clipPath.__zzosyStrokePosClip) p.clipPath = null
  p.set("paintFirst", "fill")
  p.set("strokeWidth", naturalW)
}

/**
 * FONTE UNICA DE VERDADE pra serializar overrides de SHAPE (Fabric.Path).
 * Mesmo pattern do serializeTextboxOverrides — evita drift.
 */
export function serializeShapeOverrides(o: any): Record<string, any> {
  const ov: Record<string, any> = {}
  if (typeof o.fill === "string") ov.fill = o.fill
  if (typeof o.stroke === "string") ov.stroke = o.stroke
  // strokeWidth: quando strokePosition inside/outside, o hack visual DOBROU
  // o.strokeWidth. Salvar o valor cru faria toda save DOBRAR. Fonte de
  // verdade: __naturalStrokeWidth (valor que o USER setou).
  if (typeof o.strokeWidth === "number") {
    const natural = typeof o.__naturalStrokeWidth === "number"
      ? o.__naturalStrokeWidth
      : o.strokeWidth
    ov.strokeWidth = natural
  }
  if (o.__strokePosition === "inside" || o.__strokePosition === "center" || o.__strokePosition === "outside") {
    ov.strokePosition = o.__strokePosition
  }
  if (typeof o.__cornerRadius === "number") ov.cornerRadius = o.__cornerRadius
  // bboxW/bboxH: dimensoes EFFECTIVE (path internal * scale). Multiplicar pelo
  // scale eh CRITICO — sem isso o save captura bbox cru e o user perdia o
  // resize que fez na canvas (user reportou export 3x menor que editor).
  if (o.__shapeKind && o.__pathBbox) {
    const bb = o.__pathBbox
    const W = (bb.right ?? 0) - (bb.left ?? 0)
    const H = (bb.bottom ?? 0) - (bb.top ?? 0)
    const sX = typeof o.scaleX === "number" ? o.scaleX : 1
    const sY = typeof o.scaleY === "number" ? o.scaleY : 1
    if (W > 0 && H > 0) {
      ov.bboxW = W * sX
      ov.bboxH = H * sY
    }
  }
  return ov
}
