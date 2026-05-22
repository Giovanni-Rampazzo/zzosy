/**
 * effects-extended.test.ts — valida que writer V2 emite gradientOverlay,
 * satin, bevel (antes ignorados em silencio).
 *
 * Auditoria reportou: "Effects gradientOverlay/satin/bevel — read but
 * never written" (writer.ts:365 comentario antigo).
 *
 * Uso: npx tsx lib/psd/__test__/effects-extended.test.ts
 */
import { readPsd, initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { writePsdDocument } from "../writer"
import type { PsdDocument, PsdShapeLayer } from "../types"

initializeCanvas(createCanvas as any)

const baseShape: Omit<PsdShapeLayer, "effects"> = {
  id: "s1",
  name: "Shape with extended effects",
  bbox: { left: 100, top: 100, right: 700, bottom: 500 },
  visible: true,
  opacity: 1,
  blendMode: "normal",
  mask: null,
  locked: false,
  groupPath: [],
  clipping: false,
  type: "shape",
  path: "M 100 100 L 700 100 L 700 500 L 100 500 Z",
  pathBbox: { left: 100, top: 100, right: 700, bottom: 500 },
  fill: { kind: "solid", color: "#FFD500" },
  stroke: null,
  fillRule: "nonzero",
}

function makeDoc(effects: PsdShapeLayer["effects"]): PsdDocument {
  return {
    width: 800,
    height: 600,
    layers: [{ ...baseShape, effects }],
    dpi: 72,
    colorMode: "rgb",
    bitDepth: 8,
    composite: null,
    metadata: {},
  }
}

console.log("Step 1: gradientOverlay roundtrip")
const doc1 = makeDoc({
  gradientOverlay: {
    enabled: true,
    gradient: {
      kind: "linear",
      stops: [
        { position: 0, color: "#FF0000", opacity: 1 },
        { position: 1, color: "#0000FF", opacity: 0.5 },
      ],
    },
    opacity: 0.8,
    blendMode: "multiply",
    angle: 45,
    scale: 100,
    reverse: false,
  },
})
const r1 = writePsdDocument(doc1)
const p1: any = readPsd(r1.bytes)
const go = p1.children?.[0]?.effects?.gradientOverlay
if (!go || !Array.isArray(go) || go.length === 0) {
  console.error(`  ✗ gradientOverlay ausente no PSD final: ${JSON.stringify(p1.children?.[0]?.effects)}`)
  process.exit(1)
}
const go0 = go[0]
console.log(`  ✓ gradientOverlay: type=${go0.type} angle=${go0.angle} opacity=${go0.opacity}`)
console.log(`  ✓ colorStops: ${go0.gradient?.colorStops?.length} stops`)
if (!go0.enabled) { console.error("  ✗ disabled"); process.exit(1) }
if (go0.gradient?.colorStops?.length !== 2) { console.error("  ✗ stops mismatch"); process.exit(1) }

console.log("\nStep 2: satin roundtrip")
const doc2 = makeDoc({
  satin: {
    enabled: true,
    color: "#330011",
    opacity: 0.5,
    angle: 19,
    distance: 11,
    size: 14,
    blendMode: "multiply",
    invert: true,
  },
})
const r2 = writePsdDocument(doc2)
const p2: any = readPsd(r2.bytes)
const sa = p2.children?.[0]?.effects?.satin
if (!sa) { console.error("  ✗ satin ausente"); process.exit(1) }
console.log(`  ✓ satin: color=rgb(${sa.color?.r},${sa.color?.g},${sa.color?.b}) angle=${sa.angle}`)
console.log(`  ✓ distance=${JSON.stringify(sa.distance)} size=${JSON.stringify(sa.size)} invert=${sa.invert}`)
if (!sa.enabled) { console.error("  ✗ disabled"); process.exit(1) }
if (sa.invert !== true) { console.error("  ✗ invert nao preservado"); process.exit(1) }

console.log("\nStep 3: bevel roundtrip")
const doc3 = makeDoc({
  bevel: {
    enabled: true,
    style: "innerBevel",
    technique: "chiselHard",
    depth: 200,
    direction: "up",
    size: 8,
    soften: 2,
    highlightColor: "#FFFFFF",
    highlightBlendMode: "screen",
    highlightOpacity: 0.75,
    shadowColor: "#000000",
    shadowBlendMode: "multiply",
    shadowOpacity: 0.75,
  },
})
const r3 = writePsdDocument(doc3)
const p3: any = readPsd(r3.bytes)
const bv = p3.children?.[0]?.effects?.bevel
if (!bv) { console.error("  ✗ bevel ausente"); process.exit(1) }
console.log(`  ✓ bevel: style=${bv.style} technique=${bv.technique} direction=${bv.direction}`)
console.log(`  ✓ size=${JSON.stringify(bv.size)} soften=${JSON.stringify(bv.soften)}`)
console.log(`  ✓ highlight: ${bv.highlightBlendMode} opacity=${bv.highlightOpacity}`)
console.log(`  ✓ shadow: ${bv.shadowBlendMode} opacity=${bv.shadowOpacity}`)
if (!bv.enabled) { console.error("  ✗ disabled"); process.exit(1) }
if (bv.style !== "inner bevel") { console.error(`  ✗ style esperado 'inner bevel', got '${bv.style}'`); process.exit(1) }
if (bv.technique !== "chisel hard") { console.error(`  ✗ technique esperado 'chisel hard', got '${bv.technique}'`); process.exit(1) }

console.log("\n✓ EXTENDED EFFECTS V2 OK — gradientOverlay/satin/bevel roundtrip funcionando")
