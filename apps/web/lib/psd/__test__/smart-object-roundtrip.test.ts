/**
 * smart-object-roundtrip.test.ts — valida que writer V2 popula linkedFiles[]
 * no top-level pra preservar conteudo de Smart Objects (embedded + linked).
 *
 * Auditoria reportou (writer.ts:200): "Smart Object linked filePath read but
 * NOT written back" — pior, ate o EMBEDDED bytes eram perdidos.
 *
 * Cobre:
 *  1. SO embedded com bytes preservados via linkedFiles[].data
 *  2. SO linked com filePath preservado via linkedFiles[].name (sem data)
 *  3. Reader V2 le de volta o {kind, format/filePath} original
 *
 * Uso: npx tsx lib/psd/__test__/smart-object-roundtrip.test.ts
 */
import { readPsd, initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { writePsdDocument } from "../writer"
import { readPsdDocument } from "../reader"
import type { PsdDocument, PsdSmartObjectLayer } from "../types"

initializeCanvas(createCanvas as any)

const identityTransform = {
  corners: [0, 0, 600, 0, 600, 400, 0, 400] as [number, number, number, number, number, number, number, number],
}

function makeSO(content: PsdSmartObjectLayer["content"]): PsdSmartObjectLayer {
  return {
    id: "smart-1",
    name: "MySmartObj",
    bbox: { left: 100, top: 100, right: 700, bottom: 500 },
    visible: true,
    opacity: 1,
    blendMode: "normal",
    mask: null,
    effects: {},
    locked: false,
    groupPath: [],
    clipping: false,
    type: "smartObject",
    content,
    transform: identityTransform,
    composite: null,
    isWrapper: false,
  }
}

function makeDoc(layer: PsdSmartObjectLayer): PsdDocument {
  return {
    width: 800,
    height: 600,
    layers: [layer],
    dpi: 72,
    colorMode: "rgb",
    bitDepth: 8,
    composite: null,
    metadata: {},
  }
}

console.log("Step 1: SO EMBEDDED — bytes preservados em linkedFiles[].data")
// Bytes "fake" PNG (magic header 89 50 4E 47 + alguns bytes)
const fakeBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const docEmb = makeDoc(makeSO({ kind: "embedded", format: "png", bytes: fakeBytes }))
const rEmb = writePsdDocument(docEmb)
const psdEmb: any = readPsd(rEmb.bytes)
const lfEmb = psdEmb.linkedFiles
console.log(`  linkedFiles count: ${lfEmb?.length ?? 0}`)
if (!lfEmb || lfEmb.length === 0) {
  console.error("  ✗ linkedFiles[] vazio — bytes embedded perderam")
  process.exit(1)
}
console.log(`  ✓ linkedFile[0].id=${lfEmb[0].id?.slice(0, 12)}... name=${lfEmb[0].name}`)
if (!lfEmb[0].data || lfEmb[0].data.length !== fakeBytes.length) {
  console.error(`  ✗ data nao preservada: esperado ${fakeBytes.length} bytes, got ${lfEmb[0].data?.length ?? 0}`)
  process.exit(1)
}
console.log(`  ✓ data preservada (${lfEmb[0].data.length} bytes)`)

// Reader V2 le de volta como embedded com format detectado
const doc2Emb = readPsdDocument(rEmb.bytes, { includeImageData: false, includeComposite: false })
const so2Emb = doc2Emb.document.layers[0] as PsdSmartObjectLayer
if (so2Emb.type !== "smartObject") { console.error("  ✗ type mismatch"); process.exit(1) }
if (so2Emb.content.kind !== "embedded") {
  console.error(`  ✗ esperado kind=embedded, got ${so2Emb.content.kind}`)
  process.exit(1)
}
console.log(`  ✓ reader V2 leu de volta: kind=embedded format=${so2Emb.content.format}`)

console.log("\nStep 2: SO LINKED — filePath preservado em linkedFiles[].name (sem data)")
const docLnk = makeDoc(makeSO({ kind: "linked", filePath: "/Users/example/assets/logo.psb" }))
const rLnk = writePsdDocument(docLnk)
const psdLnk: any = readPsd(rLnk.bytes)
const lfLnk = psdLnk.linkedFiles
console.log(`  linkedFiles count: ${lfLnk?.length ?? 0}`)
if (!lfLnk || lfLnk.length === 0) {
  console.error("  ✗ linkedFiles[] vazio")
  process.exit(1)
}
console.log(`  ✓ linkedFile[0].name=${lfLnk[0].name} (filePath preservado)`)
if (lfLnk[0].name !== "/Users/example/assets/logo.psb") {
  console.error(`  ✗ filePath nao preservado`)
  process.exit(1)
}
console.log(`  ✓ data ausente como esperado (linked = sem bytes): ${lfLnk[0].data === undefined || lfLnk[0].data?.length === 0}`)

const doc2Lnk = readPsdDocument(rLnk.bytes, { includeImageData: false, includeComposite: false })
const so2Lnk = doc2Lnk.document.layers[0] as PsdSmartObjectLayer
if (so2Lnk.content.kind !== "linked") {
  console.error(`  ✗ esperado kind=linked, got ${so2Lnk.content.kind}`)
  process.exit(1)
}
console.log(`  ✓ reader V2 leu de volta: kind=linked filePath=${so2Lnk.content.filePath}`)

console.log("\n✓ SMART OBJECT ROUNDTRIP V2 OK — embedded bytes + linked filePath preservados")
