/**
 * Round-trip test (Fase 6):
 *   1. Le PSD via readPsdDocument
 *   2. Escreve de volta via writePsdDocument
 *   3. Le o novo PSD
 *   4. Compara estruturas: mesmo numero de layers, mesmas dimensoes, etc
 *
 * Uso:
 *   cd apps/web && npx tsx lib/psd/__test__/roundtrip.test.ts <psd>
 */
import fs from "fs"
import { readPsdDocument } from "../reader"
import { writePsdDocument } from "../writer"

const PSD_PATH = process.argv[2]
if (!PSD_PATH || !fs.existsSync(PSD_PATH)) {
  console.error("Uso: tsx roundtrip.test.ts <caminho-do-psd>")
  process.exit(1)
}

const bytes = fs.readFileSync(PSD_PATH)
console.log(`Original: ${PSD_PATH} (${(bytes.length / 1024 / 1024).toFixed(1)}MB)\n`)

// ROUND 1: le
console.log("Step 1: readPsdDocument")
const r1 = readPsdDocument(bytes.buffer, { includeImageData: false, includeComposite: false })
console.log(`  ${r1.document.width}×${r1.document.height}, ${r1.document.layers.length} top-level layers, ${r1.warnings.length} warnings`)
function countLayers(layers: any[]): number {
  let c = 0
  for (const l of layers) {
    c++
    if (l.children) c += countLayers(l.children)
  }
  return c
}
const totalLayers1 = countLayers(r1.document.layers)
console.log(`  total layers (incl children): ${totalLayers1}`)
console.log()

// ROUND 2: escreve
console.log("Step 2: writePsdDocument")
let writeResult
try {
  writeResult = writePsdDocument(r1.document, { generateThumbnail: false, invalidateTextLayers: true })
  console.log(`  bytes: ${(writeResult.bytes.byteLength / 1024 / 1024).toFixed(2)}MB`)
  console.log(`  warnings: ${writeResult.warnings.length}`)
  for (const w of writeResult.warnings.slice(0, 10)) {
    console.log(`    [${w.kind}] ${w.layerName}: ${w.message}`)
  }
  if (writeResult.warnings.length > 10) console.log(`    ...e mais ${writeResult.warnings.length - 10}`)
} catch (e: any) {
  console.error(`  WRITE FAILED: ${e?.message ?? e}`)
  process.exit(1)
}
console.log()

// ROUND 3: re-le o que escrevemos pra validar estrutura
console.log("Step 3: readPsdDocument (validacao do bytes escritos)")
try {
  const r2 = readPsdDocument(writeResult.bytes, { includeImageData: false, includeComposite: false })
  const totalLayers2 = countLayers(r2.document.layers)
  console.log(`  ${r2.document.width}×${r2.document.height}, ${r2.document.layers.length} top-level, total=${totalLayers2}`)

  // Compara
  console.log()
  console.log("=== COMPARISON ===")
  const dimMatch = r1.document.width === r2.document.width && r1.document.height === r2.document.height
  const topMatch = r1.document.layers.length === r2.document.layers.length
  const totalMatch = totalLayers1 === totalLayers2
  console.log(`  dimensions: ${dimMatch ? "✓" : "✗"} (${r1.document.width}×${r1.document.height} → ${r2.document.width}×${r2.document.height})`)
  console.log(`  top-level layers: ${topMatch ? "✓" : "✗"} (${r1.document.layers.length} → ${r2.document.layers.length})`)
  console.log(`  total layers: ${totalMatch ? "✓" : "✗"} (${totalLayers1} → ${totalLayers2})`)

  if (dimMatch && topMatch && totalMatch) {
    console.log("\n✓ ROUND-TRIP STRUCTURAL OK")
  } else {
    console.log("\n✗ ROUND-TRIP MISMATCH — estrutura nao preservada")
  }
} catch (e: any) {
  console.error(`  RE-READ FAILED: ${e?.message ?? e}`)
  console.error(`  Bytes escritos podem nao ser PSD valido.`)
  process.exit(1)
}
