/**
 * vogk-unwrap.test.ts — valida que tryReadVogkPath (no nosso reader) trata
 * corretamente bbox/radii que vem como UnitsValue object {value, units} do
 * ag-psd parseUnits.
 *
 * Reproduz o bug "n.toFixed is not a function" que crashava quando user
 * tentava reimportar PSD gerado pelo proprio ZZOSY (commit 5e22a87).
 *
 * Uso: npx tsx lib/psd/__test__/vogk-unwrap.test.ts
 */
import { readPsd, writePsd, initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { readPsdDocument } from "../reader"

initializeCanvas(createCanvas as any)

// Constroi um PSD com vogk descriptor (roundedRect, raio 25) — mesmo formato
// que nosso exportPieceBlob escreve. ag-psd parseUnits no read retorna
// {value, units} pra cada campo de bbox/radii.
const px = (n: number) => ({ value: n, units: "Pixels" as const })
const W = 1920, H = 1080

const psd: any = {
  width: W,
  height: H,
  children: [{
    name: "RoundedRect Test",
    top: 100,
    left: 200,
    bottom: 700,
    right: 1100,
    vectorMask: {
      paths: [{
        operation: "combine",
        knots: [
          // 4 corners (simplificado — sem curvas)
          { points: [200, 100, 200, 100, 200, 100], linked: false },
          { points: [1100, 100, 1100, 100, 1100, 100], linked: false },
          { points: [1100, 700, 1100, 700, 1100, 700], linked: false },
          { points: [200, 700, 200, 700, 200, 700], linked: false },
        ],
        open: false,
      }],
    },
    vectorFill: { type: "color" as const, color: { r: 100, g: 200, b: 50 } },
    vectorOrigination: {
      keyDescriptorList: [{
        keyOriginType: 2,
        keyOriginResolution: 72,
        keyOriginShapeBoundingBox: {
          top: px(100), left: px(200), bottom: px(700), right: px(1100),
        },
        keyOriginRRectRadii: {
          topLeft: px(25), topRight: px(25),
          bottomLeft: px(25), bottomRight: px(25),
        },
      }],
    },
  }],
}

console.log("Step 1: write PSD com vogk")
const bytes = writePsd(psd, { generateThumbnail: false })
console.log(`  ✓ ${(bytes.byteLength / 1024).toFixed(1)}KB`)

console.log("\nStep 2: readPsdDocument (nosso reader com unwrapUnits)")
let r: any
try {
  r = readPsdDocument(bytes, { includeImageData: false, includeComposite: false })
} catch (e: any) {
  console.error(`  ✗ CRASH: ${e?.message ?? e}`)
  console.error(e?.stack)
  process.exit(1)
}
console.log(`  ✓ ${r.document.width}×${r.document.height}, ${r.document.layers.length} layers`)

const layer = r.document.layers[0] as any
console.log(`  layer type: ${layer.type}`)
if (layer.type !== "shape") {
  console.error(`  ✗ esperava type='shape', got '${layer.type}'`)
  process.exit(1)
}
console.log(`  path: ${layer.path?.substring(0, 100)}...`)
if (!layer.path || !layer.path.includes("M ")) {
  console.error("  ✗ path SVG nao gerado pelo tryReadVogkPath")
  process.exit(1)
}
console.log(`  ✓ path gerado corretamente (sem .toFixed crash)`)

console.log("\n✓ VOGK UNWRAP OK — re-import de PSD ZZOSY-gerado nao crasha")
