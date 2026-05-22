/**
 * pathToKnots — converte SVG path string "M x y L x y C cx cy cx cy x y ... Z"
 * em array de knots ag-psd `{ points: [cpLx, cpLy, anchorX, anchorY, cpRx, cpRy] }`.
 *
 * Subset suportado: M, L, C, Z. Cobre os 3 kinds parametricos do ZZOSY
 * (rectangle, roundedRect, ellipse — todos gerados via buildShapePath).
 *
 * Inverso da reader.ts:bezierPathToSvg.
 *
 * Diferente da versao em exportPiece.ts: aqui NAO aplica transformacao
 * (writer V2 ja trabalha com coords absolutas no PsdShapeLayer.path).
 */
type Knot = { cpL: { x: number; y: number }; anchor: { x: number; y: number }; cpR: { x: number; y: number } }

export function svgPathToKnots(svg: string): Array<{ points: number[] }> | null {
  if (!svg) return null
  // Tokens: split por M/L/C/Z (preservando o operador).
  const tokens = svg.replace(/Z\s*$/i, "").trim().split(/(?=[MLCZmlcz])/).map(s => s.trim()).filter(Boolean)
  const knots: Knot[] = []
  for (const tok of tokens) {
    const op = tok[0].toUpperCase()
    const nums = (tok.slice(1).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
    if (op === "M") {
      knots.push({
        cpL: { x: nums[0], y: nums[1] },
        anchor: { x: nums[0], y: nums[1] },
        cpR: { x: nums[0], y: nums[1] },
      })
    } else if (op === "L") {
      const x = nums[0], y = nums[1]
      if (knots.length > 0) {
        knots[knots.length - 1].cpR = { x, y }
      }
      knots.push({ cpL: { x, y }, anchor: { x, y }, cpR: { x, y } })
    } else if (op === "C") {
      const cp1x = nums[0], cp1y = nums[1]
      const cp2x = nums[2], cp2y = nums[3]
      const endx = nums[4], endy = nums[5]
      if (knots.length > 0) {
        knots[knots.length - 1].cpR = { x: cp1x, y: cp1y }
      }
      knots.push({
        cpL: { x: cp2x, y: cp2y },
        anchor: { x: endx, y: endy },
        cpR: { x: endx, y: endy },
      })
    }
  }
  if (knots.length === 0) return null
  // Path fechado: ultimo knot duplica o primeiro. Funde transferindo cpL do
  // ultimo pro primeiro (com tolerancia 0.5px pra coords arredondadas).
  if (knots.length >= 2) {
    const first = knots[0]
    const last = knots[knots.length - 1]
    if (Math.abs(first.anchor.x - last.anchor.x) < 0.5 && Math.abs(first.anchor.y - last.anchor.y) < 0.5) {
      first.cpL = last.cpL
      knots.pop()
    }
  }
  return knots.map(k => ({
    points: [k.cpL.x, k.cpL.y, k.anchor.x, k.anchor.y, k.cpR.x, k.cpR.y],
  }))
}
