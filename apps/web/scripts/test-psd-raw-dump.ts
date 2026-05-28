// Dump RAW ag-psd parsed layers from Teste.psd and /tmp/teste-roundtrip.psd
// pra ver QUE FIELDS o PS espera no shape layer original que falta no nosso.
import { initializeCanvas, readPsd } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { readFileSync } from "fs"

initializeCanvas(createCanvas as any)

function dumpLayer(label: string, l: any) {
  console.log(`\n--- ${label} ---`)
  const keys = Object.keys(l).filter(k => !["children"].includes(k))
  for (const k of keys) {
    const v = l[k]
    if (v == null) continue
    let s: string
    if (typeof v === "object") {
      try { s = JSON.stringify(v).slice(0, 250) } catch { s = "[obj]" }
    } else {
      s = String(v).slice(0, 150)
    }
    console.log(`  ${k}: ${s}`)
  }
}

;(async () => {
  for (const file of ["/Users/democrart/Desktop/Teste.psd", "/tmp/teste-roundtrip.psd"]) {
    console.log(`\n========== ${file} ==========`)
    const bytes = readFileSync(file)
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const psd = readPsd(ab, { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true })
    console.log(`Canvas: ${psd.width}x${psd.height}, ${psd.children?.length ?? 0} top-level layers`)
    function walk(layers: any[], depth = 0) {
      for (const l of layers) {
        if (l.children) {
          console.log(`${"  ".repeat(depth)}GROUP "${l.name}"`)
          walk(l.children, depth + 1)
        } else {
          dumpLayer(`Layer "${l.name}"`, l)
        }
      }
    }
    walk(psd.children ?? [])
  }
})()
