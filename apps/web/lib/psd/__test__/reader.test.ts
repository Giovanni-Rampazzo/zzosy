/**
 * Test fixture pra validar psdReader contra um PSD real.
 *
 * Roda fora do contexto Next (script direto):
 *   cd apps/web && npx tsx lib/psd/__test__/reader.test.ts
 *
 * Output: parse dos primeiros N layers + estatistica de warnings.
 *
 * Pra Fase 1 essa validacao e feita manualmente. Fase 2+ vira testes
 * automatizados com snapshots.
 */
import fs from "fs"
import { readPsdDocument, resolveClippingChains } from "../reader"

const PSD_PATH = process.argv[2]
if (!PSD_PATH || !fs.existsSync(PSD_PATH)) {
  console.error("Uso: tsx reader.test.ts <caminho-do-psd>")
  process.exit(1)
}

const bytes = fs.readFileSync(PSD_PATH)
const sizeMB = (bytes.length / 1024 / 1024).toFixed(1)
console.log(`Lendo PSD: ${PSD_PATH} (${sizeMB}MB)\n`)

const { document, warnings } = readPsdDocument(bytes.buffer, {
  includeImageData: false, // pula raster pra inspect rapido
  includeComposite: false,
})
resolveClippingChains(document)

console.log("=== DOCUMENT ===")
console.log(`  ${document.width}×${document.height} @ ${document.dpi}dpi, ${document.colorMode}/${document.bitDepth}-bit`)
console.log(`  ${document.layers.length} top-level layers`)
console.log()

console.log("=== LAYERS ===")
function dump(layers: any[], depth = 0) {
  const indent = "  ".repeat(depth)
  for (const l of layers) {
    const v = l.visible ? "●" : "○"
    const c = l.clipping ? "↩" : " "
    const m = l.mask ? `M(${l.mask.kind[0]})` : "   "
    const t = l.type.toUpperCase().padEnd(11)
    const fxKeys = Object.keys(l.effects ?? {})
    const fx = fxKeys.length > 0 ? ` fx=[${fxKeys.join(",")}]` : ""
    const bbox = `[${l.bbox.left},${l.bbox.top}→${l.bbox.right},${l.bbox.bottom}]`
    const baseInfo = l.mask?.kind === "clipping" ? ` →base=${l.mask.baseLayerId || "?"}` : ""
    console.log(`${indent}${v}${c}${m} ${t} "${l.name}" ${bbox} blend=${l.blendMode} op=${l.opacity}${fx}${baseInfo}`)
    if (l.type === "group" && l.children) dump(l.children, depth + 1)
  }
}
dump(document.layers)
console.log()

console.log("=== WARNINGS ===")
if (warnings.length === 0) {
  console.log("  (none)")
} else {
  for (const w of warnings) console.log(`  [${w.kind}] ${w.layerName}: ${w.message}`)
}
console.log()

// Sumario tipo de layer
const counts = { text: 0, image: 0, shape: 0, smartObject: 0, group: 0, adjustment: 0 }
function count(layers: any[]) {
  for (const l of layers) {
    counts[l.type as keyof typeof counts]++
    if (l.children) count(l.children)
  }
}
count(document.layers)
console.log("=== COUNTS ===")
for (const [k, n] of Object.entries(counts)) console.log(`  ${k.padEnd(12)} ${n}`)
