// Test: parse PSD server-side e roda toCampaign sem precisar de browser.
import { initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { readFileSync } from "fs"

// CRITICO: initialize canvas adapter ANTES de importar reader/toCampaign
// (eles dependem de ag-psd interna que precisa do canvas pra parse blob).
initializeCanvas(createCanvas as any)

;(async () => {
  const { readPsdDocument } = await import("../lib/psd/reader")
  const { buildCampaignFromPsd } = await import("../lib/psd/toCampaign")

  const psdPath = "/Users/democrart/Desktop/WhatsApp/PSD/91918-PROGRAMA-DE-RECOMPENSAS-LATAM-JUNHO_WhatsApp-Card_1080x1080.psd"
  const bytes = readFileSync(psdPath)
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

  const { document } = readPsdDocument(ab, { includeImageData: true, includeComposite: false })
  console.log("PSD:", document.width, "x", document.height)
  console.log("Layers no doc:", document.layers.length)

  const build = buildCampaignFromPsd(document)
  console.log("\n=== toCampaign output ===")
  console.log("Assets:", build.assets.length)
  console.log("KV Layers:", build.kvLayers.length)
  console.log("Image blobs:", build.imageBlobs.length)
  console.log("Linked blobs:", build.linkedBlobs.length)

  console.log("\n=== Asset labels ===")
  build.assets.forEach((a, i) => {
    console.log(`  ${i}. [${a.type}] ${a.label}`)
  })

  console.log("\n=== KV Layers ===")
  build.kvLayers.forEach((l, i) => {
    console.log(`  zIndex=${l.zIndex} assetIdx? layer=${JSON.stringify(l).slice(0, 100)}`)
  })
})()
