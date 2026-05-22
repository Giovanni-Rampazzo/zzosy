/**
 * shape-effects.test.ts — valida que PSD effects (drop shadow, etc) sobrevivem
 * no export quando o layer tem __psdEffects.
 *
 * User reportou: "quando exporto o psd ele nao mantem o effects no layer".
 *
 * Reproduz a estrutura ag-psd que buildPieceCanvas+exportPSDBlob produzem
 * pra um SHAPE com effects.dropShadow.
 */
import { readPsd, writePsd, initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"

initializeCanvas(createCanvas as any)

const px = (n: number) => ({ value: n, units: "Pixels" as const })

const psd: any = {
  width: 1920,
  height: 1080,
  children: [{
    name: "Shape com sombra",
    top: 100, left: 200, bottom: 700, right: 1100,
    vectorMask: {
      paths: [{
        operation: "combine",
        knots: [
          { points: [200, 100, 200, 100, 200, 100], linked: false },
          { points: [1100, 100, 1100, 100, 1100, 100], linked: false },
          { points: [1100, 700, 1100, 700, 1100, 700], linked: false },
          { points: [200, 700, 200, 700, 200, 700], linked: false },
        ],
        open: false,
      }],
    },
    vectorFill: { type: "color" as const, color: { r: 255, g: 213, b: 0 } },
    // Layer effect — drop shadow + outer glow. distance/size DEVEM ser
    // UnitsValue {value, units} senao ag-psd writeP crash.
    effects: {
      dropShadow: [{
        enabled: true,
        color: { r: 0, g: 0, b: 0 },
        opacity: 0.75,
        angle: 135,
        distance: px(10),
        size: px(15),
        blendMode: "multiply" as const,
        useGlobalLight: false,
      }],
      outerGlow: {
        enabled: true,
        color: { r: 255, g: 100, b: 50 },
        opacity: 0.5,
        size: px(20),
        choke: px(0),
        blendMode: "screen" as const,
      },
    },
  }],
}

console.log("Step 1: write PSD com layer effects")
let bytes: ArrayBuffer
try {
  bytes = writePsd(psd, { generateThumbnail: false })
  console.log(`  ✓ ${(bytes.byteLength / 1024).toFixed(1)}KB`)
} catch (e: any) {
  console.error(`  ✗ writePsd CRASH: ${e?.message ?? e}`)
  process.exit(1)
}

console.log("\nStep 2: re-le e valida que effects estao preservados")
let parsed: any
try {
  parsed = readPsd(bytes)
} catch (e: any) {
  console.error(`  ✗ readPsd CRASH: ${e?.message ?? e}`)
  process.exit(1)
}
const layer = parsed.children?.[0]
if (!layer) {
  console.error("  ✗ layer ausente")
  process.exit(1)
}
console.log(`  ✓ layer "${layer.name}" re-lida`)
const fx = layer.effects
if (!fx) {
  console.error("  ✗ effects ausentes no re-read")
  process.exit(1)
}
console.log(`  effects keys: ${Object.keys(fx).join(", ")}`)

const ds = Array.isArray(fx.dropShadow) ? fx.dropShadow[0] : fx.dropShadow
if (!ds || !ds.enabled) {
  console.error("  ✗ dropShadow ausente ou disabled")
  process.exit(1)
}
console.log(`  dropShadow: angle=${ds.angle} distance=${JSON.stringify(ds.distance)} size=${JSON.stringify(ds.size)}`)
console.log(`  dropShadow.color: rgb(${ds.color?.r}, ${ds.color?.g}, ${ds.color?.b})`)

const og = fx.outerGlow
if (!og || !og.enabled) {
  console.error("  ✗ outerGlow ausente ou disabled")
  process.exit(1)
}
console.log(`  outerGlow.color: rgb(${og.color?.r}, ${og.color?.g}, ${og.color?.b}) opacity=${og.opacity}`)

console.log("\n✓ LAYER EFFECTS ROUND-TRIP OK")
