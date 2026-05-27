/**
 * Mask round-trip test: valida pipeline completo de masks
 *   PSD original → reader → toCampaign → writer → re-read
 *
 * Pra cada mask no PSD original, verifica:
 *   - Reader extrai (l.mask.kind)
 *   - toCampaign propaga pro asset.mask (com type apropriado)
 *   - Writer escreve no PSD output (l.mask.imageData / l.vectorMask / l.clipping)
 *   - Re-read confirma sobrevivencia
 *
 * Uso: npx tsx lib/psd/__test__/mask-roundtrip.test.ts <psd>
 */
import fs from "fs"
import { readPsdDocument } from "../reader"
import { writePsdDocument, prepareImageDataAsync } from "../writer"
import { buildCampaignFromPsd } from "../toCampaign"
import { initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"

initializeCanvas(createCanvas as any)

const PSD_PATH = process.argv[2]
if (!PSD_PATH || !fs.existsSync(PSD_PATH)) {
  console.error("Uso: npx tsx lib/psd/__test__/mask-roundtrip.test.ts <psd>")
  process.exit(1)
}

async function main() {
const bytes = fs.readFileSync(PSD_PATH!)
console.log(`PSD: ${PSD_PATH} (${(bytes.length / 1024 / 1024).toFixed(1)}MB)\n`)

// ===== STEP 1: reader =====
console.log("=== STEP 1: readPsdDocument ===")
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const r1 = readPsdDocument(ab, { includeImageData: true, includeComposite: true })

interface MaskInfo {
  layerName: string
  kind: string | null
  hasImageData: boolean
  hasVectorPath: boolean
  isClipping: boolean
}

function collectMasks(layers: any[], path = ""): MaskInfo[] {
  const out: MaskInfo[] = []
  for (const l of layers) {
    const layerPath = path ? `${path}/${l.name}` : l.name
    if (l.mask) {
      out.push({
        layerName: layerPath,
        kind: l.mask.kind ?? null,
        hasImageData: !!l.mask.imageData,
        hasVectorPath: !!(l.mask.vectorPath || l.vectorMask),
        isClipping: l.clipping === true,
      })
    } else if (l.clipping === true) {
      // Clipping pode estar so na flag, sem mask object
      out.push({
        layerName: layerPath,
        kind: "clipping-flag-only",
        hasImageData: false,
        hasVectorPath: false,
        isClipping: true,
      })
    }
    if (l.children) out.push(...collectMasks(l.children, layerPath))
  }
  return out
}

const masksOriginal = collectMasks(r1.document.layers)
console.log(`  Layers totais (recursivo): ${countLayers(r1.document.layers)}`)
console.log(`  Layers com mask: ${masksOriginal.length}`)
for (const m of masksOriginal.slice(0, 15)) {
  console.log(`    • ${m.layerName} kind=${m.kind} img=${m.hasImageData} vec=${m.hasVectorPath} clip=${m.isClipping}`)
}
if (masksOriginal.length > 15) console.log(`    ...+${masksOriginal.length - 15}`)

function countLayers(layers: any[]): number {
  let c = 0
  for (const l of layers) { c++; if (l.children) c += countLayers(l.children) }
  return c
}

if (masksOriginal.length === 0) {
  console.log("\n  ⚠️ Este PSD nao tem masks — teste so valida que reader/writer nao quebram, sem assert real")
}
console.log()

// ===== STEP 2: toCampaign =====
console.log("=== STEP 2: buildCampaignFromPsd ===")
const build = buildCampaignFromPsd(r1.document)
console.log(`  Assets gerados: ${build.assets.length}`)
console.log(`  KV layers: ${build.kvLayers.length}`)
const assetsWithMask = build.assets.filter(a => a.mask)
console.log(`  Assets com asset.mask: ${assetsWithMask.length}`)
const maskTypes = new Map<string, number>()
for (const a of assetsWithMask) {
  const t = (a.mask as any)?.type ?? "?"
  maskTypes.set(t, (maskTypes.get(t) ?? 0) + 1)
}
for (const [t, n] of maskTypes) console.log(`    type=${t}: ${n}`)
console.log()

// ===== STEP 3: writer =====
console.log("=== STEP 3: writePsdDocument ===")
let writeResult
try {
  // CRITICO 2026-05-27: prepareImageDataAsync converte dataUrl → canvas.
  // Sem isso, writer dropa masks raster (encontrado via teste em 5/8 PSDs).
  await prepareImageDataAsync(r1.document)
  writeResult = writePsdDocument(r1.document, { generateThumbnail: false, invalidateTextLayers: false })
  console.log(`  Bytes escritos: ${(writeResult.bytes.byteLength / 1024 / 1024).toFixed(2)}MB`)
  console.log(`  Warnings: ${writeResult.warnings.length}`)
  const maskWarnings = writeResult.warnings.filter(w => /mask|clip/i.test(w.message))
  if (maskWarnings.length > 0) {
    console.log(`  Warnings sobre mask:`)
    for (const w of maskWarnings.slice(0, 8)) console.log(`    [${w.kind}] ${w.layerName}: ${w.message}`)
  }
} catch (e: any) {
  console.error(`  ✗ WRITE FAILED: ${e?.message ?? e}`)
  process.exit(1)
}
console.log()

// ===== STEP 4: re-read =====
console.log("=== STEP 4: re-read PSD escrito ===")
let r2
try {
  r2 = readPsdDocument(writeResult.bytes, { includeImageData: true, includeComposite: false })
  console.log(`  Re-read OK: ${r2.document.width}×${r2.document.height}, ${countLayers(r2.document.layers)} layers`)
} catch (e: any) {
  console.error(`  ✗ RE-READ FAILED: ${e?.message ?? e}`)
  process.exit(1)
}
const masksAfter = collectMasks(r2.document.layers)
console.log(`  Layers com mask APOS round-trip: ${masksAfter.length}`)
console.log()

// ===== ASSERT =====
console.log("=== COMPARISON ===")
const ok = masksAfter.length >= masksOriginal.length
const lossy = masksOriginal.length - masksAfter.length
console.log(`  Original masks: ${masksOriginal.length}`)
console.log(`  Apos round-trip: ${masksAfter.length}`)
if (ok) {
  console.log(`  ✓ MASK ROUND-TRIP OK`)
  process.exit(0)
} else {
  console.log(`  ✗ MASK PERDIDOS: ${lossy}`)
  // Mostra primeiras diferenças
  const beforeNames = new Set(masksOriginal.map(m => m.layerName))
  const afterNames = new Set(masksAfter.map(m => m.layerName))
  const lostNames = [...beforeNames].filter(n => !afterNames.has(n))
  if (lostNames.length > 0) {
    console.log(`  Layers que perderam mask:`)
    for (const n of lostNames.slice(0, 10)) console.log(`    - ${n}`)
  }
  process.exit(1)
}
}
main().catch(e => { console.error(e); process.exit(1) })
