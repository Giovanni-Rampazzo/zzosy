/**
 * e2e.test.ts — round-trip COMPLETO: PSD real → editor → PSD.
 *
 * Pipeline testado:
 *   1. readPsdDocument(file)       PSD bytes → modelo canonical
 *   2. buildCampaignFromPsd        modelo canonical → CampaignBuild (assets + layers)
 *   3. buildAdaptedEditorInput     CampaignBuild → EditorBuildInput
 *   4. buildPsdDocumentFromEditor  EditorBuildInput → modelo canonical (round-trip!)
 *   5. writePsdDocument            modelo canonical → bytes
 *   6. readPsdDocument(bytes)      validacao final
 *
 * Roda em Node (sem document/canvas). Skip de mascaras + image data heavy.
 *
 * Uso:
 *   cd apps/web && npx tsx lib/psd/__test__/e2e.test.ts <psd>
 */
import fs from "fs"
import { readPsdDocument, resolveClippingChains } from "../reader"
import { detectWrapperSmartObjects } from "../postProcess"
import { buildCampaignFromPsd } from "../toCampaign"
import { buildPsdDocumentFromEditor, type EditorBuildInput, type EditorAsset, type EditorLayer } from "../fromEditor"
import { writePsdDocument } from "../writer"

const PSD_PATH = process.argv[2]
if (!PSD_PATH || !fs.existsSync(PSD_PATH)) {
  console.error("Uso: tsx e2e.test.ts <caminho-do-psd>")
  process.exit(1)
}

const bytes = fs.readFileSync(PSD_PATH)
console.log(`Original: ${PSD_PATH} (${(bytes.length / 1024 / 1024).toFixed(1)}MB)\n`)

// ────────── Step 1: read original ──────────
console.log("Step 1: readPsdDocument (original)")
const r1 = readPsdDocument(bytes.buffer, { includeImageData: false, includeComposite: false })
const doc1 = r1.document
resolveClippingChains(doc1)
detectWrapperSmartObjects(doc1)
console.log(`  ${doc1.width}×${doc1.height}, ${doc1.layers.length} top-level, ${countLayers(doc1.layers)} total, ${r1.warnings.length} warnings`)
console.log(`  layer types: ${countLayersByType(doc1.layers)}`)

// ────────── Step 2: build campaign ──────────
console.log("\nStep 2: buildCampaignFromPsd")
const build = buildCampaignFromPsd(doc1)
console.log(`  assets: ${build.assets.length} (${countAssetsByType(build.assets)})`)
console.log(`  layers: ${build.kvLayers.length}`)
console.log(`  required fonts: ${build.requiredFonts.join(", ") || "(none)"}`)

// ────────── Step 3: adapt to editor input ──────────
console.log("\nStep 3: adapt CampaignBuild → EditorBuildInput")
const editorInput = adaptToEditorInput(build, doc1.width, doc1.height, doc1.dpi)
console.log(`  ${editorInput.assets.length} editorAssets, ${editorInput.layers.length} editorLayers`)

// ────────── Step 4: build PsdDocument from editor ──────────
console.log("\nStep 4: buildPsdDocumentFromEditor (round-trip)")
const doc2 = buildPsdDocumentFromEditor(editorInput)
console.log(`  ${doc2.width}×${doc2.height}, ${doc2.layers.length} top-level, ${countLayers(doc2.layers)} total`)

// ────────── Step 5: write ──────────
console.log("\nStep 5: writePsdDocument")
let writeResult
try {
  writeResult = writePsdDocument(doc2, { generateThumbnail: false, invalidateTextLayers: true })
  console.log(`  bytes: ${(writeResult.bytes.byteLength / 1024).toFixed(1)}KB, warnings: ${writeResult.warnings.length}`)
} catch (e: any) {
  console.error(`  WRITE FAILED: ${e?.message ?? e}`)
  process.exit(1)
}

// ────────── Step 6: read back ──────────
console.log("\nStep 6: readPsdDocument (re-le bytes)")
const r3 = readPsdDocument(writeResult.bytes, { includeImageData: false, includeComposite: false })
const doc3 = r3.document
console.log(`  ${doc3.width}×${doc3.height}, ${doc3.layers.length} top-level, ${countLayers(doc3.layers)} total, ${r3.warnings.length} warnings`)

// ────────── COMPARISON ──────────
console.log("\n=== COMPARISON (original ↔ e2e round-trip) ===")
const dimMatch = doc1.width === doc3.width && doc1.height === doc3.height
const editorVsRereadTop = doc2.layers.length === doc3.layers.length
const editorVsRereadTotal = countLayers(doc2.layers) === countLayers(doc3.layers)
console.log(`  dimensions:    ${dimMatch ? "✓" : "✗"} ${doc1.width}×${doc1.height} → ${doc3.width}×${doc3.height}`)
console.log(`  editor → reread top-level: ${editorVsRereadTop ? "✓" : "✗"} ${doc2.layers.length} → ${doc3.layers.length}`)
console.log(`  editor → reread total:     ${editorVsRereadTotal ? "✓" : "✗"} ${countLayers(doc2.layers)} → ${countLayers(doc3.layers)}`)
console.log(`  build assets: ${build.assets.length} | editor layers: ${editorInput.layers.length}`)
console.log(`  warnings (write): ${writeResult.warnings.length}`)

if (dimMatch && editorVsRereadTop && editorVsRereadTotal) {
  console.log("\n✓ E2E ROUND-TRIP OK")
} else {
  console.log("\n✗ E2E MISMATCH")
  process.exit(1)
}

// ────────── helpers ──────────

function countLayers(layers: any[]): number {
  let c = 0
  for (const l of layers) {
    c++
    if (l.children) c += countLayers(l.children)
  }
  return c
}

function countAssetsByType(assets: any[]): string {
  const counts: Record<string, number> = {}
  for (const a of assets) counts[a.type] = (counts[a.type] ?? 0) + 1
  return Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")
}

function countLayersByType(layers: any[]): string {
  const counts: Record<string, number> = {}
  function walk(ll: any[]) {
    for (const l of ll) {
      counts[l.type] = (counts[l.type] ?? 0) + 1
      if (l.children) walk(l.children)
    }
  }
  walk(layers)
  return Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")
}

/**
 * Converte CampaignBuild (saida de buildCampaignFromPsd) pro formato
 * EditorBuildInput esperado por buildPsdDocumentFromEditor.
 *
 * Esse adapter materializa o que o editor faria ao carregar a peca:
 *  - assets viram EditorAsset com content shape correto por tipo
 *  - layers viram EditorLayer com posX/posY/scaleX/scaleY/etc resolvidos
 */
function adaptToEditorInput(build: any, width: number, height: number, dpi: number): EditorBuildInput {
  const editorAssets: EditorAsset[] = build.assets.map((a: any) => ({
    id: a.tempId,
    type: a.type,
    label: a.label,
    value: a.type === "TEXT" && Array.isArray(a.content) ? a.content.map((s: any) => s.text).join("") : null,
    imageUrl: a.imageIndex != null ? `__blob:${a.imageIndex}` : null,
    content: a.type === "SHAPE" ? a.shape : a.content,
  }))

  const editorLayers: EditorLayer[] = build.kvLayers.map((l: any) => ({
    assetId: l.assetId,
    posX: l.posX,
    posY: l.posY,
    width: l.width,
    height: l.height,
    scaleX: l.scaleX,
    scaleY: l.scaleY,
    rotation: l.rotation,
    zIndex: l.zIndex,
    opacity: l.opacity,
    blendMode: l.blendMode,
    hidden: false,
    overrides: {},
  }))

  return { width, height, dpi, assets: editorAssets, layers: editorLayers }
}
