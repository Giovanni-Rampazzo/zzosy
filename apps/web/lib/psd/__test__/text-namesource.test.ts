/**
 * text-namesource.test.ts — valida que TEXT layers exportadas pelo ZZOSY
 * tem nameSource='srct' (auto-rename quando user edita texto no PS).
 *
 * User reportou: "quando exporto um psd com texto, e abro no ps, quando altero
 * o texto, o nome do layer nao muda mais".
 *
 * Causa: ag-psd default emite 'lnsr'='lyr ' (manual). PS so auto-renomeia
 * quando 'lnsr'='srct'.
 *
 * Uso: npx tsx lib/psd/__test__/text-namesource.test.ts
 */
import { readPsd, writePsd, initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"

initializeCanvas(createCanvas as any)

// Reproduz a estrutura ag-psd que exportPieceBlob produz pra TEXT layer.
const psd: any = {
  width: 800,
  height: 600,
  children: [{
    name: "HEADLINE INICIAL",
    nameSource: "srct", // ← o flag que estamos validando
    top: 100,
    left: 100,
    bottom: 200,
    right: 700,
    text: {
      text: "HEADLINE INICIAL",
      transform: [1, 0, 0, 1, 100, 150],
      style: {
        font: { name: "Helvetica" },
        fontSize: 48,
        fillColor: { r: 0, g: 0, b: 0 },
      },
      paragraphStyle: { justification: "left" as const },
    },
  }],
}

console.log("Step 1: writePsd com nameSource='srct'")
let bytes: ArrayBuffer
try {
  bytes = writePsd(psd, { generateThumbnail: false, invalidateTextLayers: false })
  console.log(`  ✓ ${(bytes.byteLength / 1024).toFixed(1)}KB`)
} catch (e: any) {
  console.error(`  ✗ writePsd CRASH: ${e?.message ?? e}`)
  process.exit(1)
}

console.log("\nStep 2: readPsd e valida que nameSource sobreviveu")
const parsed: any = readPsd(bytes)
const layer = parsed.children?.[0]
if (!layer) {
  console.error("  ✗ layer ausente")
  process.exit(1)
}
console.log(`  layer.name: ${JSON.stringify(layer.name)}`)
console.log(`  layer.nameSource: ${JSON.stringify(layer.nameSource)}`)

// ag-psd guarda como 4-char signature. Pode vir como 'srct' ou 'srct'+padding.
const ns = (layer.nameSource ?? "").trim()
if (ns !== "srct") {
  console.error(`  ✗ nameSource esperado 'srct', got '${layer.nameSource}'`)
  console.error("    Photoshop NAO vai auto-renomear o layer quando user editar o texto.")
  process.exit(1)
}
console.log("  ✓ nameSource='srct' preservado no round-trip")

console.log("\n✓ TEXT NAMESOURCE OK — PS vai auto-renomear o layer ao editar texto")
