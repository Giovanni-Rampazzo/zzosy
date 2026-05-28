// Test do Teste.psd que o user esta usando — shape + texto round-trip.
import { initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { readFileSync } from "fs"

initializeCanvas(createCanvas as any)

;(async () => {
  const { readPsdDocument } = await import("../lib/psd/reader")
  const { buildCampaignFromPsd } = await import("../lib/psd/toCampaign")

  const psdPath = "/Users/democrart/Desktop/Teste.psd"
  const bytes = readFileSync(psdPath)
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

  const { document } = readPsdDocument(ab, { includeImageData: false, includeComposite: false })
  console.log("PSD:", document.width, "x", document.height)
  console.log("Layers no doc:", document.layers.length)
  document.layers.forEach((l, i) => {
    console.log(`  L${i}: type=${(l as any).type} name=${l.name} bbox=${JSON.stringify(l.bbox)}`)
    if ((l as any).type === "text") {
      const tl: any = l
      console.log(`    text="${tl.text}" defaultStyle=${JSON.stringify(tl.defaultStyle)}`)
      console.log(`    styleRuns=`, JSON.stringify(tl.styleRuns))
    }
    if ((l as any).type === "shape") {
      const sl: any = l
      console.log(`    path (1st 200 chars)=${(sl.path ?? "").slice(0, 200)}`)
      console.log(`    pathBbox=${JSON.stringify(sl.pathBbox)} fill=${JSON.stringify(sl.fill)} stroke=${JSON.stringify(sl.stroke)}`)
      console.log(`    mask=${sl.mask ? JSON.stringify({ kind: sl.mask.kind, bbox: sl.mask.bbox, disabled: sl.mask.disabled, defaultColor: sl.mask.defaultColor, fromClipping: sl.mask.__fromClipping }) : "null"}`)
    }
  })

  const build = buildCampaignFromPsd(document)
  console.log("\n=== Assets ===")
  build.assets.forEach((a: any, i) => {
    const c = typeof a.content === "string" ? a.content.slice(0, 200) : JSON.stringify(a.content).slice(0, 200)
    console.log(`  A${i}: type=${a.type} label=${a.label} mask=${a.mask ? JSON.stringify({ kind: a.mask.kind, bbox: a.mask.bbox }) : "null"}`)
    console.log(`     content=${c}`)
    if (a.shape) console.log(`     shape=${JSON.stringify(a.shape).slice(0, 200)}`)
  })

  console.log("\n=== KV Layers ===")
  build.kvLayers.forEach((l, i) => {
    console.log(`  KL${i}: ${JSON.stringify(l).slice(0, 300)}`)
  })
})()
