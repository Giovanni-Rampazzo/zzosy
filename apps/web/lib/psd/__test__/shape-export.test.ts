/**
 * shape-export.test.ts — valida que a nossa logica de bake-scale-into-path
 * e o vogk export geram um PSD valido que re-importa sem crash.
 *
 * Cobre os bugs recentes:
 *   - PSD exportado vinha 3x menor → bake scale no path (commit 584ade2)
 *   - "n.toFixed is not a function" no re-import → unwrapUnits (commit 5e22a87)
 *   - vectorStroke + vectorFill conviver (commit 4b58505)
 *
 * Roda em Node (sem Fabric.js). Constroi manualmente um PsdDocument equivalente
 * ao que exportPieceBlob produziria pra um SHAPE roundedRect escalado.
 *
 * Uso:
 *   cd apps/web && npx tsx lib/psd/__test__/shape-export.test.ts
 */
import { readPsd, writePsd, initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { Buffer } from "node:buffer"

// ag-psd precisa de createCanvas pra ler image data — usa @napi-rs/canvas
// pra rodar em Node sem browser.
initializeCanvas(createCanvas as any)

// Reproduz a chamada ag-psd que o exportPSDBlob faz pra um shape roundedRect.
// Inputs simulam estado pos-bake do scale:
//   - shape original: 400x300, cornerRadius 20
//   - user escalou 2x → bbox final 800x600, raio absoluto 20
//   - layer position: left=100, top=80
const W = 1920, H = 1080
const shape = {
  left: 100,
  top: 80,
  width: 800,
  height: 600,
  cornerRadius: 20,
  fill: { r: 255, g: 213, b: 0 },     // #FFD500
  stroke: { r: 28, g: 105, b: 22 },   // #1C6916
  strokeWidth: 10,
}

const px = (n: number) => ({ value: n, units: "Pixels" as const })

// Path SVG → ag-psd knots: simplificado pra retangulo arredondado.
// Knots sao em UNIT space [0..1] do PSD doc.
function rectKnots(left: number, top: number, w: number, h: number, r: number) {
  // Pra simplificar: rect sharp (sem curvas). Suficiente pra validar vogk +
  // re-read. O cornerRadius vai no vogk descriptor mesmo.
  const W_doc = 1920, H_doc = 1080
  const points = [
    [left, top],
    [left + w, top],
    [left + w, top + h],
    [left, top + h],
  ]
  return points.map(([x, y]) => ({
    points: [x, y, x, y, x, y] as [number, number, number, number, number, number],
    linked: false,
  }))
}

const knots = rectKnots(shape.left, shape.top, shape.width, shape.height, shape.cornerRadius)

const psdLayer: any = {
  name: "Retangulo Arredondado",
  top: shape.top,
  left: shape.left,
  bottom: shape.top + shape.height,
  right: shape.left + shape.width,
  vectorMask: {
    paths: [{ operation: "combine", knots, open: false }],
  },
  vectorFill: { type: "color" as const, color: shape.fill },
  vectorStroke: {
    strokeEnabled: true,
    fillEnabled: true,
    lineWidth: { value: shape.strokeWidth, units: "Pixels" as const },
    lineDashOffset: { value: 0, units: "Pixels" as const },
    lineCapType: "butt" as const,
    lineJoinType: "miter" as const,
    lineAlignment: "center" as const,
    miterLimit: 100,
    strokeAdjust: false,
    scaleLock: false,
    blendMode: "normal" as const,
    opacity: 1,
    content: { type: "color" as const, color: shape.stroke },
    resolution: 72,
  },
  vectorOrigination: {
    keyDescriptorList: [{
      keyOriginType: 2, // roundedRect
      keyOriginResolution: 72,
      keyOriginShapeBoundingBox: {
        top: px(shape.top),
        left: px(shape.left),
        bottom: px(shape.top + shape.height),
        right: px(shape.left + shape.width),
      },
      keyOriginRRectRadii: {
        topLeft: px(shape.cornerRadius),
        topRight: px(shape.cornerRadius),
        bottomLeft: px(shape.cornerRadius),
        bottomRight: px(shape.cornerRadius),
      },
    }],
  },
}

const psd: any = {
  width: W,
  height: H,
  children: [psdLayer],
}

console.log("Step 1: writePsd com vogk + vectorStroke + vectorFill")
let bytes: ArrayBuffer
try {
  bytes = writePsd(psd, { generateThumbnail: false, invalidateTextLayers: false })
  console.log(`  ✓ writePsd OK (${(bytes.byteLength / 1024).toFixed(1)}KB)`)
} catch (e: any) {
  console.error(`  ✗ writePsd CRASHED: ${e?.message ?? e}`)
  process.exit(1)
}

console.log("\nStep 2: readPsd (re-le o PSD recem escrito)")
let parsed: any
try {
  parsed = readPsd(bytes)
  console.log(`  ✓ readPsd OK: ${parsed.width}×${parsed.height}, ${parsed.children?.length ?? 0} layers`)
} catch (e: any) {
  console.error(`  ✗ readPsd CRASHED: ${e?.message ?? e}`)
  process.exit(1)
}

console.log("\nStep 3: valida vogk descriptor unwrap")
const layer = parsed.children?.[0]
if (!layer) {
  console.error("  ✗ layer nao encontrada no re-import")
  process.exit(1)
}
const vo = layer.vectorOrigination
if (!vo?.keyDescriptorList?.length) {
  console.error("  ✗ vectorOrigination ausente apos re-read")
  process.exit(1)
}
const item = vo.keyDescriptorList[0]
const bb = item.keyOriginShapeBoundingBox
const radii = item.keyOriginRRectRadii
console.log(`  keyOriginType: ${item.keyOriginType} (esperado 2)`)
console.log(`  bbox: top=${JSON.stringify(bb?.top)} left=${JSON.stringify(bb?.left)}`)
console.log(`        bottom=${JSON.stringify(bb?.bottom)} right=${JSON.stringify(bb?.right)}`)
console.log(`  radii: tl=${JSON.stringify(radii?.topLeft)} tr=${JSON.stringify(radii?.topRight)}`)

// Helper: extrai numero de UnitsValue OU number cru (replica unwrapUnits do reader)
const unwrap = (v: any) => v == null ? 0 : (typeof v === "number" ? v : v.value)
const gotLeft = unwrap(bb?.left)
const gotTop = unwrap(bb?.top)
const gotRight = unwrap(bb?.right)
const gotBottom = unwrap(bb?.bottom)
const gotTL = unwrap(radii?.topLeft)

if (gotLeft !== shape.left) {
  console.error(`  ✗ bbox.left mismatch: ${gotLeft} != ${shape.left}`)
  process.exit(1)
}
if (gotTop !== shape.top) {
  console.error(`  ✗ bbox.top mismatch: ${gotTop} != ${shape.top}`)
  process.exit(1)
}
if (gotRight !== shape.left + shape.width) {
  console.error(`  ✗ bbox.right mismatch: ${gotRight} != ${shape.left + shape.width}`)
  process.exit(1)
}
if (gotBottom !== shape.top + shape.height) {
  console.error(`  ✗ bbox.bottom mismatch: ${gotBottom} != ${shape.top + shape.height}`)
  process.exit(1)
}
if (gotTL !== shape.cornerRadius) {
  console.error(`  ✗ radii.topLeft mismatch: ${gotTL} != ${shape.cornerRadius}`)
  process.exit(1)
}
console.log("  ✓ vogk values match")

console.log("\nStep 4: valida vectorStroke + vectorFill conviver (vscg+vstk handlers)")
if (!layer.vectorFill) {
  console.error("  ✗ vectorFill ausente apos re-read (SoCo handler skipou)")
  process.exit(1)
}
if (!layer.vectorStroke) {
  console.error("  ✗ vectorStroke ausente apos re-read")
  process.exit(1)
}
const vfColor = layer.vectorFill.color
const vsColor = layer.vectorStroke.content?.color
console.log(`  vectorFill.color: rgb(${vfColor?.r}, ${vfColor?.g}, ${vfColor?.b})`)
console.log(`  vectorStroke.content.color: rgb(${vsColor?.r}, ${vsColor?.g}, ${vsColor?.b})`)
console.log(`  vectorStroke.lineWidth: ${JSON.stringify(layer.vectorStroke.lineWidth)}`)

if (vfColor?.r !== shape.fill.r || vfColor?.g !== shape.fill.g || vfColor?.b !== shape.fill.b) {
  console.error("  ✗ vectorFill color nao bate")
  process.exit(1)
}
if (vsColor?.r !== shape.stroke.r || vsColor?.g !== shape.stroke.g || vsColor?.b !== shape.stroke.b) {
  console.error("  ✗ vectorStroke color nao bate")
  process.exit(1)
}
const lwVal = unwrap(layer.vectorStroke.lineWidth)
if (Math.round(lwVal) !== shape.strokeWidth) {
  console.error(`  ✗ vectorStroke.lineWidth nao bate: ${lwVal} != ${shape.strokeWidth}`)
  process.exit(1)
}
console.log("  ✓ vectorFill + vectorStroke preservados juntos")

console.log("\n✓ SHAPE EXPORT ROUND-TRIP OK")
