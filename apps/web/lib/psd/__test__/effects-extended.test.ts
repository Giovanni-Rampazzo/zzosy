/**
 * effects-extended.test.ts — valida que writer V2 emite gradientOverlay,
 * satin, bevel E que reader V2 le de volta corretamente (round-trip MODEL
 * via readPsdDocument, nao so readPsd raw).
 *
 * V1 deste teste so usava readPsd raw — passava com bug do reader que
 * tratava bevel/satin como array (`fx.bevel?.[0]`) quando ag-psd retorna
 * single object. Bug pre-existente silencioso ate 2026-05-22.
 *
 * Cobertura aqui: writePsdDocument → readPsdDocument retorna modelo
 * canonical com TODOS os campos preservados (style com espacos, strength→
 * depth, angle/altitude).
 *
 * Uso: npx tsx lib/psd/__test__/effects-extended.test.ts
 */
import { initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { writePsdDocument } from "../writer"
import { readPsdDocument } from "../reader"
import type { PsdDocument, PsdShapeLayer, PsdLayerEffects } from "../types"

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

function makeDoc(effects: PsdLayerEffects): PsdDocument {
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

function roundtripEffects(effects: PsdLayerEffects): PsdLayerEffects {
  const r = writePsdDocument(makeDoc(effects))
  const d = readPsdDocument(r.bytes, { includeImageData: false, includeComposite: false })
  return (d.document.layers[0] as any).effects
}

let fail = 0
function expect(name: string, got: unknown, expected: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  console.log(`  ${ok ? "✓" : "✗"} ${name}: expected=${JSON.stringify(expected)} got=${JSON.stringify(got)}`)
  if (!ok) fail++
}

console.log("Step 1: gradientOverlay roundtrip (model→PSD→model)")
const gradFx: PsdLayerEffects = {
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
}
const re1 = roundtripEffects(gradFx)
console.log(`  go presente: ${!!re1.gradientOverlay}`)
if (!re1.gradientOverlay) { console.error("  ✗ gradientOverlay PERDIDO no readPsdDocument"); fail++ }
else {
  expect("kind", re1.gradientOverlay.gradient.kind, "linear")
  expect("angle", re1.gradientOverlay.angle, 45)
  expect("scale", re1.gradientOverlay.scale, 100)
  expect("opacity", re1.gradientOverlay.opacity, 0.8)
  expect("blendMode", re1.gradientOverlay.blendMode, "multiply")
  expect("stops.length", re1.gradientOverlay.gradient.stops.length, 2)
  expect("stop[0].color", re1.gradientOverlay.gradient.stops[0].color, "#ff0000")
}

console.log("\nStep 2: satin roundtrip")
const satFx: PsdLayerEffects = {
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
}
const re2 = roundtripEffects(satFx)
console.log(`  satin presente: ${!!re2.satin}`)
if (!re2.satin) { console.error("  ✗ satin PERDIDO no readPsdDocument"); fail++ }
else {
  expect("color", re2.satin.color, "#330011")
  expect("opacity", re2.satin.opacity, 0.5)
  expect("angle", re2.satin.angle, 19)
  expect("distance", re2.satin.distance, 11)
  expect("size", re2.satin.size, 14)
  expect("invert", re2.satin.invert, true)
  expect("blendMode", re2.satin.blendMode, "multiply")
}

console.log("\nStep 3: bevel roundtrip COMPLETO (style espaco, technique espaco, depth, angle, altitude)")
const bevFx: PsdLayerEffects = {
  bevel: {
    enabled: true,
    style: "outerBevel",
    technique: "chiselHard",
    depth: 200,
    direction: "down",
    size: 8,
    soften: 2,
    highlightColor: "#FFFFFF",
    highlightBlendMode: "screen",
    highlightOpacity: 0.75,
    shadowColor: "#000000",
    shadowBlendMode: "multiply",
    shadowOpacity: 0.75,
    angle: 90,
    altitude: 45,
  },
}
const re3 = roundtripEffects(bevFx)
console.log(`  bevel presente: ${!!re3.bevel}`)
if (!re3.bevel) { console.error("  ✗ bevel PERDIDO no readPsdDocument"); fail++ }
else {
  expect("style", re3.bevel.style, "outerBevel")
  expect("technique", re3.bevel.technique, "chiselHard")
  expect("depth", re3.bevel.depth, 200)
  expect("direction", re3.bevel.direction, "down")
  expect("size", re3.bevel.size, 8)
  expect("soften", re3.bevel.soften, 2)
  expect("highlightOpacity", re3.bevel.highlightOpacity, 0.75)
  expect("shadowOpacity", re3.bevel.shadowOpacity, 0.75)
  expect("angle", re3.bevel.angle, 90)
  expect("altitude", re3.bevel.altitude, 45)
}

console.log("\nStep 4: outerGlow + innerGlow tambem agora roundtrip (bug pre-existente)")
const glowFx: PsdLayerEffects = {
  outerGlow: {
    enabled: true,
    color: "#FF6432",
    opacity: 0.5,
    blur: 20,
    spread: 0,
    blendMode: "screen",
    source: "edge",
  },
  innerGlow: {
    enabled: true,
    color: "#FFFF00",
    opacity: 0.6,
    blur: 15,
    spread: 0,
    blendMode: "screen",
  },
}
const re4 = roundtripEffects(glowFx)
console.log(`  outerGlow presente: ${!!re4.outerGlow}`)
console.log(`  innerGlow presente: ${!!re4.innerGlow}`)
if (!re4.outerGlow) { console.error("  ✗ outerGlow PERDIDO"); fail++ }
if (!re4.innerGlow) { console.error("  ✗ innerGlow PERDIDO"); fail++ }
if (re4.outerGlow) expect("outerGlow.color", re4.outerGlow.color, "#ff6432")
if (re4.innerGlow) expect("innerGlow.color", re4.innerGlow.color, "#ffff00")

if (fail > 0) {
  console.error(`\n✗ ${fail} asserts falharam`)
  process.exit(1)
}
console.log("\n✓ EXTENDED EFFECTS V2 OK — gradientOverlay/satin/bevel/outerGlow/innerGlow roundtrip via readPsdDocument")
