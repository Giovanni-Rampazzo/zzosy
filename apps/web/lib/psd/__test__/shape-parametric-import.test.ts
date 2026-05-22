/**
 * shape-parametric-import.test.ts — valida que detectParametricShape extrai
 * kind/cornerRadius/fill/stroke corretamente de um PSD com Shape Tool layer.
 *
 * Antes deste fix: PsdImporter rasterizava o shape pra image, perdendo o
 * cornerRadius. User reportou em 2026-05-22: "shape do PS nao vem com radius
 * corner no ZZOSY".
 *
 * NOTA: testa a logica de extracao isolada (sem depender do React do
 * PsdImporter). Inline a funcao detectParametricShape pra rodar em Node.
 *
 * Uso: npx tsx lib/psd/__test__/shape-parametric-import.test.ts
 */
import { unwrapPsdUnits } from "../psdHelpers"

function colorToHex(color: any): string {
  if (!color) return "#000000"
  const rr = color.r > 1 ? Math.round(color.r) : Math.round(color.r * 255)
  const gg = color.g > 1 ? Math.round(color.g) : Math.round(color.g * 255)
  const bb = color.b > 1 ? Math.round(color.b) : Math.round(color.b * 255)
  return "#" + [rr, gg, bb].map(v => v.toString(16).padStart(2, "0")).join("")
}

// Replica detectParametricShape do PsdImporter
function detectParametricShape(layer: any) {
  const vo = layer.vectorOrigination
  const item = vo?.keyDescriptorList?.[0]
  if (!item) return null
  const type = item.keyOriginType
  const kindMap: Record<number, "rectangle" | "roundedRect" | "ellipse"> = {
    1: "rectangle", 2: "roundedRect", 5: "ellipse",
  }
  const kind = kindMap[type]
  if (!kind) return null
  const bb = item.keyOriginShapeBoundingBox
  if (!bb) return null
  const left = unwrapPsdUnits(bb.left), top = unwrapPsdUnits(bb.top)
  const right = unwrapPsdUnits(bb.right), bottom = unwrapPsdUnits(bb.bottom)
  if (right <= left || bottom <= top) return null
  let cornerRadius = 0
  if (kind === "roundedRect" && item.keyOriginRRectRadii) {
    cornerRadius = unwrapPsdUnits(item.keyOriginRRectRadii.topLeft)
  }
  const vf = layer.vectorFill
  const fill = (vf?.type === "color" && vf.color) ? {
    kind: "solid" as const, color: colorToHex(vf.color),
  } : null
  const vs = layer.vectorStroke
  const stroke = (vs && vs.strokeEnabled !== false) ? {
    color: (vs.content?.type === "color" && vs.content.color) ? colorToHex(vs.content.color) : "#000000",
    width: unwrapPsdUnits(vs.lineWidth) || 0,
  } : null
  return { kind, bbox: { left, top, right, bottom }, cornerRadius, fill, stroke }
}

const px = (n: number) => ({ value: n, units: "Pixels" as const })

console.log("Step 1: roundedRect com cornerRadius preservado")
const layer1 = {
  vectorOrigination: {
    keyDescriptorList: [{
      keyOriginType: 2,
      keyOriginShapeBoundingBox: {
        left: px(100), top: px(50), right: px(500), bottom: px(250),
      },
      keyOriginRRectRadii: {
        topLeft: px(20), topRight: px(20),
        bottomLeft: px(20), bottomRight: px(20),
      },
    }],
  },
  vectorFill: { type: "color", color: { r: 255, g: 100, b: 50 } },
  vectorStroke: {
    strokeEnabled: true,
    content: { type: "color", color: { r: 0, g: 0, b: 0 } },
    lineWidth: px(4),
  },
}
const r1 = detectParametricShape(layer1)
console.log("  kind =", r1?.kind, "cornerRadius =", r1?.cornerRadius)
console.log("  bbox =", r1?.bbox)
console.log("  fill =", r1?.fill, "stroke =", r1?.stroke)
if (r1?.kind !== "roundedRect") { console.error("✗ kind"); process.exit(1) }
if (r1.cornerRadius !== 20) { console.error("✗ cornerRadius"); process.exit(1) }
if (r1.fill?.color !== "#ff6432") { console.error("✗ fill color"); process.exit(1) }
if (r1.stroke?.width !== 4) { console.error("✗ stroke width"); process.exit(1) }
console.log("  ✓ roundedRect detectado com cornerRadius=20")

console.log("\nStep 2: rectangle sharp (keyOriginType=1)")
const layer2 = {
  vectorOrigination: { keyDescriptorList: [{
    keyOriginType: 1,
    keyOriginShapeBoundingBox: { left: px(0), top: px(0), right: px(200), bottom: px(100) },
  }]},
  vectorFill: { type: "color", color: { r: 255, g: 213, b: 0 } },
}
const r2 = detectParametricShape(layer2)
if (r2?.kind !== "rectangle") { console.error("✗ kind"); process.exit(1) }
if (r2.cornerRadius !== 0) { console.error("✗ cornerRadius"); process.exit(1) }
console.log(`  ✓ rectangle sharp detectado (cornerRadius=0)`)

console.log("\nStep 3: ellipse")
const layer3 = {
  vectorOrigination: { keyDescriptorList: [{
    keyOriginType: 5,
    keyOriginShapeBoundingBox: { left: px(0), top: px(0), right: px(100), bottom: px(100) },
  }]},
  vectorFill: { type: "color", color: { r: 100, g: 200, b: 250 } },
}
const r3 = detectParametricShape(layer3)
if (r3?.kind !== "ellipse") { console.error("✗ kind"); process.exit(1) }
console.log(`  ✓ ellipse detectado`)

console.log("\nStep 4: keyOriginType=4 (Line) ou desconhecido — retorna null (fallback raster)")
const layer4 = {
  vectorOrigination: { keyDescriptorList: [{ keyOriginType: 4 }] },
  vectorFill: { type: "color", color: { r: 0, g: 0, b: 0 } },
}
if (detectParametricShape(layer4) !== null) { console.error("✗ esperava null"); process.exit(1) }
console.log(`  ✓ Line (type=4) retorna null — fallback raster correto`)

console.log("\nStep 5: sem vectorOrigination — null (path complexo, fallback raster)")
const layer5 = {
  vectorMask: { paths: [{ knots: [] }] },
  vectorFill: { type: "color", color: { r: 0, g: 0, b: 0 } },
}
if (detectParametricShape(layer5) !== null) { console.error("✗ esperava null"); process.exit(1) }
console.log(`  ✓ sem vogk → null (path complexo arbitrario, fallback raster)`)

console.log("\n✓ SHAPE PARAMETRIC IMPORT OK — PSD com Shape Tool preserva cornerRadius+fill+stroke")
