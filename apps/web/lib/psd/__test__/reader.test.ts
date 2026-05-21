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
import { buildCampaignFromPsd } from "../toCampaign"

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
console.log()

// ── Fase 1 (toCampaign): valida mapping pro modelo do editor ──────
console.log("=== buildCampaignFromPsd ===")
const build = buildCampaignFromPsd(document)
console.log(`  canvas:       ${build.width}×${build.height}`)
console.log(`  bgColor:      ${build.bgColor}`)
console.log(`  assets:       ${build.assets.length} (${build.assets.filter(a => a.type === "TEXT").length} TEXT, ${build.assets.filter(a => a.type === "IMAGE").length} IMAGE)`)
console.log(`  kvLayers:     ${build.kvLayers.length}`)
console.log(`  imageBlobs:   ${build.imageBlobs.length}`)
console.log(`  warnings:     ${build.warnings.length}`)
if (build.warnings.length > 0) {
  for (const w of build.warnings) console.log(`    [${w.kind}] ${w.layerName}: ${w.message}`)
}
console.log()

// Sample: text com effects
const textsWithEffects = build.assets.filter(a => a.type === "TEXT" && a.effects)
console.log(`=== TEXTS COM EFFECTS (${textsWithEffects.length}) ===`)
for (const t of textsWithEffects) {
  const fxKeys = Object.keys(t.effects ?? {}).join(",")
  console.log(`  "${t.label}" — effects=[${fxKeys}] pixelsIncludeEffects=${t.pixelsIncludeEffects}`)
}
console.log()

// Sample: smart objects com pixelsIncludeEffects=true
const sosBaked = build.assets.filter(a => a.type === "IMAGE" && a.pixelsIncludeEffects)
console.log(`=== SMART OBJECTS (pixels com effects baked: ${sosBaked.length}) ===`)
for (const s of sosBaked) {
  const fxKeys = Object.keys(s.effects ?? {}).join(",") || "(none)"
  console.log(`  "${s.label}" — effects metadata=[${fxKeys}] (editor NAO adiciona shadow extra)`)
}
