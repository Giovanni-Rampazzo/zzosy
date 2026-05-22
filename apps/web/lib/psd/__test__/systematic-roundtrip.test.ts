/**
 * systematic-roundtrip.test.ts — exercita TODO field do PsdDocument canonical
 * via writePsdDocument → readPsdDocument. Cada field testado isoladamente
 * mostra qual nao sobrevive ao round-trip.
 *
 * Estrategia: cada teste constroi um PsdDocument minimo com 1 field nao-default,
 * write → read, compara. Se diferente → gap.
 *
 * Uso: npx tsx lib/psd/__test__/systematic-roundtrip.test.ts
 */
import { initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { writePsdDocument } from "../writer"
import { readPsdDocument } from "../reader"
import type { PsdDocument, PsdShapeLayer, PsdTextLayer, PsdImageLayer, PsdGroupLayer, PsdMaskData } from "../types"

initializeCanvas(createCanvas as any)

const identityTransform = { corners: [0, 0, 100, 0, 100, 100, 0, 100] as [number, number, number, number, number, number, number, number] }

function baseShape(): PsdShapeLayer {
  return {
    id: "s1", name: "Shape", bbox: { left: 100, top: 100, right: 500, bottom: 400 },
    visible: true, opacity: 1, blendMode: "normal", mask: null, locked: false,
    groupPath: [], clipping: false, effects: {}, type: "shape",
    path: "M 100 100 L 500 100 L 500 400 L 100 400 Z",
    pathBbox: { left: 100, top: 100, right: 500, bottom: 400 },
    fill: { kind: "solid", color: "#FFFF00" }, stroke: null, fillRule: "nonzero",
  }
}
function baseText(): PsdTextLayer {
  return {
    id: "t1", name: "Text", bbox: { left: 100, top: 100, right: 500, bottom: 200 },
    visible: true, opacity: 1, blendMode: "normal", mask: null, locked: false,
    groupPath: [], clipping: false, effects: {}, type: "text",
    text: "Hello",
    defaultStyle: {
      fontFamily: "Helvetica", fontWeight: 400, fontStyle: "normal",
      fontSize: 48, color: "#000000", tracking: 0,
    },
    styleRuns: [], paragraph: { align: "left" }, transform: identityTransform,
  }
}
function makeDoc(layer: any): PsdDocument {
  return {
    width: 800, height: 600, layers: [layer], dpi: 72,
    colorMode: "rgb", bitDepth: 8, composite: null, metadata: {},
  }
}
function roundtrip(layer: any): any {
  const r = writePsdDocument(makeDoc(layer))
  const d = readPsdDocument(r.bytes, { includeImageData: false, includeComposite: false })
  return d.document.layers[0]
}

const results: Array<{ category: string; field: string; ok: boolean; expected: any; got: any }> = []
function check(category: string, field: string, expected: any, got: any) {
  const ok = JSON.stringify(expected) === JSON.stringify(got)
  results.push({ category, field, ok, expected, got })
  console.log(`  ${ok ? "✓" : "✗"} ${category}.${field}: ${ok ? "" : `expected=${JSON.stringify(expected)} got=${JSON.stringify(got)}`}`)
}

// ─────────────────────────────────────────────────────────────────────
console.log("=== COMMON LAYER FIELDS ===")
{
  const layer = { ...baseShape(), name: "TestLayer", opacity: 0.5, visible: false, locked: true, clipping: true }
  const r = roundtrip(layer) as any
  check("common", "name", "TestLayer", r.name)
  check("common", "opacity", 0.5, r.opacity)
  check("common", "visible", false, r.visible)
  check("common", "locked", true, r.locked)
  check("common", "clipping", true, r.clipping)
}

console.log("\n=== BBOX ===")
{
  const layer = baseShape()
  layer.bbox = { left: 123, top: 45, right: 678, bottom: 567 }
  const r = roundtrip(layer) as any
  check("bbox", "left", 123, r.bbox.left)
  check("bbox", "top", 45, r.bbox.top)
  check("bbox", "right", 678, r.bbox.right)
  check("bbox", "bottom", 567, r.bbox.bottom)
}

console.log("\n=== BLEND MODES (sample) ===")
{
  for (const bm of ["multiply", "screen", "overlay", "softLight", "colorDodge"] as const) {
    const layer = baseShape(); layer.blendMode = bm
    const r = roundtrip(layer) as any
    check("blendMode", bm, bm, r.blendMode)
  }
}

console.log("\n=== SHAPE FILL ===")
{
  // Solid
  const layer1 = baseShape(); layer1.fill = { kind: "solid", color: "#FF6432" }
  const r1 = roundtrip(layer1) as any
  check("shape.fill", "solid.color", "#ff6432", r1.fill?.color)

  // Gradient (SUSPEITO — writer hoje so emite solid)
  const layer2 = baseShape()
  layer2.fill = {
    kind: "gradient",
    gradient: {
      kind: "linear",
      stops: [
        { position: 0, color: "#FF0000", opacity: 1 },
        { position: 1, color: "#0000FF", opacity: 1 },
      ],
    },
  }
  const r2 = roundtrip(layer2) as any
  check("shape.fill", "gradient.kind", "gradient", r2.fill?.kind)
  check("shape.fill", "gradient.stops.length", 2, r2.fill?.gradient?.stops?.length)
}

console.log("\n=== SHAPE STROKE NATIVO ===")
{
  const layer = baseShape()
  layer.stroke = {
    width: 12, color: "#1C6916", position: "center",
    cap: "round", join: "bevel", isNativeVectorStroke: true,
  }
  const r = roundtrip(layer) as any
  check("shape.stroke", "width", 12, r.stroke?.width)
  check("shape.stroke", "color", "#1c6916", r.stroke?.color)
  check("shape.stroke", "position", "center", r.stroke?.position)
  check("shape.stroke", "cap", "round", r.stroke?.cap)
  check("shape.stroke", "join", "bevel", r.stroke?.join)
  check("shape.stroke", "isNativeVectorStroke", true, r.stroke?.isNativeVectorStroke)
}

console.log("\n=== SHAPE STROKE DASH (suspeito) ===")
{
  const layer = baseShape()
  layer.stroke = {
    width: 4, color: "#000000", position: "center",
    cap: "butt", join: "miter", isNativeVectorStroke: true,
    dash: [10, 5, 2, 5],
  }
  const r = roundtrip(layer) as any
  check("shape.stroke", "dash", [10, 5, 2, 5], r.stroke?.dash)
}

console.log("\n=== TEXT FIELDS ===")
{
  const layer = baseText()
  layer.text = "MultiLine\nText"
  layer.defaultStyle = {
    fontFamily: "Arial", fontWeight: 700, fontStyle: "italic",
    fontSize: 36, color: "#FF00FF", tracking: 50, leading: 42,
    underline: true, strikethrough: true, fauxBold: true, fauxItalic: true,
  }
  layer.paragraph = {
    align: "right",
    firstLineIndent: 20,
    spaceBefore: 5,
    spaceAfter: 10,
  }
  const r = roundtrip(layer) as any
  check("text", "text", "MultiLine\nText", r.text)
  check("text", "defaultStyle.fontFamily", "Arial", r.defaultStyle?.fontFamily)
  check("text", "defaultStyle.fontWeight", 700, r.defaultStyle?.fontWeight)
  check("text", "defaultStyle.fontStyle", "italic", r.defaultStyle?.fontStyle)
  check("text", "defaultStyle.fontSize", 36, r.defaultStyle?.fontSize)
  check("text", "defaultStyle.color", "#ff00ff", r.defaultStyle?.color)
  check("text", "defaultStyle.tracking", 50, r.defaultStyle?.tracking)
  check("text", "defaultStyle.leading", 42, r.defaultStyle?.leading)
  check("text", "defaultStyle.underline", true, r.defaultStyle?.underline)
  check("text", "defaultStyle.strikethrough", true, r.defaultStyle?.strikethrough)
  check("text", "paragraph.align", "right", r.paragraph?.align)
  check("text", "paragraph.firstLineIndent", 20, r.paragraph?.firstLineIndent)
  check("text", "paragraph.spaceBefore", 5, r.paragraph?.spaceBefore)
  check("text", "paragraph.spaceAfter", 10, r.paragraph?.spaceAfter)
}

console.log("\n=== TEXT nameSource ===")
{
  const layer = baseText(); (layer as any).nameSource = "lyr "
  const r = roundtrip(layer) as any
  check("text", "nameSource", "lyr ", r.nameSource)
}

console.log("\n=== MASK (raster) ===")
{
  const layer = baseShape()
  const mask: PsdMaskData = {
    kind: "raster",
    imageData: { data: "", width: 100, height: 100, format: "dataUrl" },
    bbox: { left: 0, top: 0, right: 100, bottom: 100 },
    defaultColor: 255,
    disabled: true,
    invert: false,
  }
  layer.mask = mask
  const r = roundtrip(layer) as any
  check("mask", "kind", "raster", r.mask?.kind)
  check("mask", "defaultColor", 255, r.mask?.defaultColor)
  check("mask", "disabled", true, r.mask?.disabled)
}

console.log("\n=== EFFECTS — colorOverlay + stroke effect ===")
{
  const layer = baseShape()
  layer.effects = {
    colorOverlay: { enabled: true, color: "#00FF00", opacity: 0.7, blendMode: "multiply" },
  }
  const r = roundtrip(layer) as any
  check("effects.colorOverlay", "color", "#00ff00", r.effects?.colorOverlay?.color)
  check("effects.colorOverlay", "opacity", 0.7, r.effects?.colorOverlay?.opacity)
  check("effects.colorOverlay", "blendMode", "multiply", r.effects?.colorOverlay?.blendMode)
}
{
  const layer = baseShape()
  layer.effects = {
    stroke: { enabled: true, width: 6, fill: { kind: "solid", color: "#FF00FF" }, position: "outside", blendMode: "normal", opacity: 0.8 },
  }
  const r = roundtrip(layer) as any
  check("effects.stroke", "width", 6, r.effects?.stroke?.width)
  check("effects.stroke", "fill.color", "#ff00ff", r.effects?.stroke?.fill?.color)
  check("effects.stroke", "position", "outside", r.effects?.stroke?.position)
  check("effects.stroke", "opacity", 0.8, r.effects?.stroke?.opacity)
}

console.log("\n=== EFFECTS — dropShadow + innerShadow ===")
{
  const layer = baseShape()
  layer.effects = {
    dropShadow: { enabled: true, color: "#000000", opacity: 0.8, angle: 135, distance: 10, blur: 15, spread: 0.1, blendMode: "multiply" },
    innerShadow: { enabled: true, color: "#FF0000", opacity: 0.5, angle: 90, distance: 5, blur: 8, spread: 0, blendMode: "multiply" },
  }
  const r = roundtrip(layer) as any
  check("effects.dropShadow", "color", "#000000", r.effects?.dropShadow?.color)
  check("effects.dropShadow", "opacity", 0.8, r.effects?.dropShadow?.opacity)
  check("effects.dropShadow", "angle", 135, r.effects?.dropShadow?.angle)
  check("effects.dropShadow", "distance", 10, r.effects?.dropShadow?.distance)
  check("effects.dropShadow", "blur", 15, r.effects?.dropShadow?.blur)
  check("effects.innerShadow", "color", "#ff0000", r.effects?.innerShadow?.color)
  check("effects.innerShadow", "distance", 5, r.effects?.innerShadow?.distance)
}

console.log("\n=== GROUP passThrough ===")
{
  const group: PsdGroupLayer = {
    id: "g1", name: "Group", bbox: { left: 0, top: 0, right: 800, bottom: 600 },
    visible: true, opacity: 1, blendMode: "passThrough", mask: null, locked: false,
    groupPath: [], clipping: false, effects: {}, type: "group",
    children: [baseShape()],
    passThrough: true,
  }
  const r = roundtrip(group) as any
  check("group", "passThrough", true, r.passThrough)
  check("group", "children.length", 1, r.children?.length)
  check("group", "blendMode", "passThrough", r.blendMode)
}

// ─────────────────────────────────────────────────────────────────────
const fails = results.filter(r => !r.ok)
console.log(`\n${results.length - fails.length} pass, ${fails.length} fail (de ${results.length} asserts)`)
if (fails.length > 0) {
  console.log("\n=== GAPS DETECTADOS ===")
  for (const f of fails) {
    console.log(`  ✗ ${f.category}.${f.field}: expected=${JSON.stringify(f.expected)} got=${JSON.stringify(f.got)}`)
  }
  process.exit(1)
}
console.log("\n✓ SYSTEMATIC ROUNDTRIP OK — todos os fields preservados")
