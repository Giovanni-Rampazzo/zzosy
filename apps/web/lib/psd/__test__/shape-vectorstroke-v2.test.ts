/**
 * shape-vectorstroke-v2.test.ts — valida que o V2 writer respeita o flag
 * `isNativeVectorStroke` do reader e emite vectorStroke em vez de cair em
 * Layer Style (effects.stroke).
 *
 * Round-trip: PSD com Shape Layer + native stroke → reader marca flag →
 * writer V2 preserva vectorStroke nativo (editavel via Properties Panel no PS).
 *
 * Uso: npx tsx lib/psd/__test__/shape-vectorstroke-v2.test.ts
 */
import { readPsd, initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { writePsdDocument } from "../writer"
import type { PsdDocument, PsdShapeLayer } from "../types"

initializeCanvas(createCanvas as any)

const shape: PsdShapeLayer = {
  id: "s1",
  name: "Yellow Box w/ Stroke",
  bbox: { left: 100, top: 100, right: 700, bottom: 500 },
  visible: true,
  opacity: 1,
  blendMode: "normal",
  mask: null,
  effects: {},
  locked: false,
  groupPath: [],
  clipping: false,
  type: "shape",
  path: "M 100 100 L 700 100 L 700 500 L 100 500 Z",
  pathBbox: { left: 100, top: 100, right: 700, bottom: 500 },
  fill: { kind: "solid", color: "#FFD500" },
  stroke: {
    width: 8,
    color: "#1C6916",
    position: "center",
    cap: "butt",
    join: "miter",
    isNativeVectorStroke: true, // ← reader marcou
  },
  fillRule: "nonzero",
}

const doc: PsdDocument = {
  width: 800,
  height: 600,
  layers: [shape],
  dpi: 72,
  colorMode: "rgb",
  bitDepth: 8,
  composite: null,
  metadata: {},
}

console.log("Step 1: writePsdDocument com shape.stroke.isNativeVectorStroke=true")
const r = writePsdDocument(doc)
console.log(`  ✓ ${(r.bytes.byteLength / 1024).toFixed(1)}KB`)

console.log("\nStep 2: readPsd e valida que vectorStroke NATIVO esta presente")
const parsed: any = readPsd(r.bytes)
const layer = parsed.children?.[0]
if (!layer) {
  console.error("  ✗ layer ausente")
  process.exit(1)
}
if (!layer.vectorFill) {
  console.error("  ✗ vectorFill ausente")
  process.exit(1)
}
if (!layer.vectorStroke) {
  console.error("  ✗ vectorStroke ausente — flag isNativeVectorStroke nao foi respeitada")
  process.exit(1)
}
console.log(`  ✓ vectorFill: rgb(${layer.vectorFill.color?.r}, ${layer.vectorFill.color?.g}, ${layer.vectorFill.color?.b})`)
console.log(`  ✓ vectorStroke: width=${JSON.stringify(layer.vectorStroke.lineWidth)} color=${JSON.stringify(layer.vectorStroke.content?.color)}`)
console.log(`  ✓ fillEnabled=${layer.vectorStroke.fillEnabled} (preciso ser true pra PS nao apagar fill)`)
if (layer.vectorStroke.fillEnabled !== true) {
  console.error("  ✗ fillEnabled deve ser true quando ha vectorFill (senao PS ignora o fill)")
  process.exit(1)
}

console.log("\nStep 3: shape SEM flag → NAO emite vectorStroke (cai em fallback warning)")
const shapeNoFlag: PsdShapeLayer = {
  ...shape,
  stroke: { ...shape.stroke!, isNativeVectorStroke: false }, // ← flag false
}
const doc2: PsdDocument = { ...doc, layers: [shapeNoFlag] }
const r2 = writePsdDocument(doc2)
const p2: any = readPsd(r2.bytes)
if (p2.children?.[0]?.vectorStroke) {
  console.error("  ✗ vectorStroke nao deveria sair quando isNativeVectorStroke=false")
  process.exit(1)
}
console.log(`  ✓ vectorStroke ausente como esperado (warnings: ${r2.warnings.length})`)

console.log("\n✓ SHAPE VECTORSTROKE V2 OK")
