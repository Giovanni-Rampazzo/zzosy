/**
 * fromEditor.test.ts — valida o pipeline editor → PSD → bytes → re-read.
 *
 * Fase 7. Fixture sintetica (nao precisa de PSD externo).
 *
 * Uso:
 *   cd apps/web && npx tsx lib/psd/__test__/fromEditor.test.ts
 */
import { buildPsdDocumentFromEditor, type EditorBuildInput } from "../fromEditor"
import { writePsdDocument } from "../writer"
import { readPsdDocument } from "../reader"

const input: EditorBuildInput = {
  width: 1080,
  height: 1080,
  dpi: 72,
  assets: [
    { id: "a-title", type: "TEXT", label: "Title", value: "Hello ZZOSY",
      content: [{ text: "Hello ZZOSY", style: { fontFamily: "Arial", fontSize: 96, fontWeight: 700, color: "#222222" } }] },
    { id: "a-sub", type: "TEXT", label: "Subtitle", value: "PSD round-trip",
      content: [{ text: "PSD round-trip", style: { fontFamily: "Arial", fontSize: 32, fontWeight: 400, color: "#666666" } }] },
    { id: "a-shape", type: "SHAPE", label: "Bar",
      content: { path: "M 0 0 L 200 0 L 200 40 L 0 40 Z", fill: { kind: "solid", color: "#ff4500" } } },
  ],
  layers: [
    { assetId: "a-title", posX: 80, posY: 200, width: 920, zIndex: 1, opacity: 1, overrides: {} },
    { assetId: "a-sub", posX: 80, posY: 340, width: 920, zIndex: 2, opacity: 1, overrides: {} },
    { assetId: "a-shape", posX: 80, posY: 520, width: 200, height: 40, zIndex: 3, opacity: 0.9,
      effects: { dropShadow: { color: "#000000", offsetX: 4, offsetY: 6, blur: 8, opacity: 0.4 } } },
  ],
}

console.log("Step 1: buildPsdDocumentFromEditor")
const doc = buildPsdDocumentFromEditor(input)
console.log(`  ${doc.width}×${doc.height}, ${doc.layers.length} layers`)
for (const l of doc.layers) {
  console.log(`  - [${l.type}] ${l.name} bbox=(${l.bbox.left},${l.bbox.top})→(${l.bbox.right},${l.bbox.bottom}) opacity=${l.opacity}`)
}

console.log("\nStep 2: writePsdDocument")
let writeResult
try {
  writeResult = writePsdDocument(doc, { generateThumbnail: false, invalidateTextLayers: true })
  console.log(`  bytes: ${(writeResult.bytes.byteLength / 1024).toFixed(1)}KB`)
  console.log(`  warnings: ${writeResult.warnings.length}`)
  for (const w of writeResult.warnings.slice(0, 5)) {
    console.log(`    [${w.kind}] ${w.layerName}: ${w.message}`)
  }
} catch (e: any) {
  console.error(`  WRITE FAILED: ${e?.message ?? e}`)
  process.exit(1)
}

console.log("\nStep 3: readPsdDocument (re-le bytes)")
try {
  const r2 = readPsdDocument(writeResult.bytes, { includeImageData: false, includeComposite: false })
  console.log(`  ${r2.document.width}×${r2.document.height}, ${r2.document.layers.length} top-level`)
  console.log(`  warnings: ${r2.warnings.length}`)

  console.log("\n=== COMPARISON ===")
  const dimMatch = doc.width === r2.document.width && doc.height === r2.document.height
  const layerCountMatch = doc.layers.length === r2.document.layers.length
  console.log(`  dimensions: ${dimMatch ? "✓" : "✗"} (${doc.width}×${doc.height} → ${r2.document.width}×${r2.document.height})`)
  console.log(`  layer count: ${layerCountMatch ? "✓" : "✗"} (${doc.layers.length} → ${r2.document.layers.length})`)

  if (dimMatch && layerCountMatch) {
    console.log("\n✓ EDITOR → PSD ROUND-TRIP OK")
  } else {
    console.log("\n✗ MISMATCH")
    process.exit(1)
  }
} catch (e: any) {
  console.error(`  RE-READ FAILED: ${e?.message ?? e}`)
  process.exit(1)
}
