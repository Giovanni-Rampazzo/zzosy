// Test: export PSD com asset.content canonico (sentinela + per-char) gera
// styleRuns corretos no PSD.

import { initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { writeFileSync, readFileSync } from "fs"
import { buildSpansFromPerChar } from "../lib/assetSpans"

initializeCanvas(createCanvas as any)

;(async () => {
  const { buildPsdDocumentFromEditor } = await import("../lib/psd/fromEditor")
  const { writePsdDocument } = await import("../lib/psd/writer")
  const { readPsdDocument } = await import("../lib/psd/reader")

  let pass = 0, fail = 0
  function check(name: string, cond: boolean, detail?: any) {
    if (cond) { pass++; console.log("  OK", name) }
    else { fail++; console.log("  FAIL", name, detail ? "→ " + JSON.stringify(detail).slice(0, 200) : "") }
  }

  // ============================================================
  console.log("\n=== Asset.content canonico com sentinela + per-char ===")
  // Cria asset.content com formato canonico: sentinela + G verde + I preto + O vermelho.
  const canonicalContent = buildSpansFromPerChar(
    "GIO",
    { color: "#111111", fontSize: 165, fontFamily: "Exo 2", fontWeight: 900 },
    { 0: { 0: { color: "#00FF00" }, 2: { color: "#FF0000" } } } as any,
  )
  console.log("  spans:", JSON.stringify(canonicalContent).slice(0, 200))
  check("sentinela presente", canonicalContent[0].text === "" && canonicalContent[0].style.color === "#111111")
  check("spans >= 2 (export precisa)", canonicalContent.length >= 2)

  // ============================================================
  console.log("\n=== Export PSD via buildPsdDocumentFromEditor ===")
  const psdDoc = buildPsdDocumentFromEditor({
    width: 1080, height: 1080,
    layers: [{
      assetId: "txt-1",
      posX: 100, posY: 200,
      scaleX: 1, scaleY: 1, rotation: 0,
      width: 800, height: 200,
      zIndex: 1, opacity: 1, blendMode: "source-over",
      overrides: {},
    }] as any,
    assets: [{ id: "txt-1", type: "TEXT", label: "GIO", content: JSON.stringify(canonicalContent) }] as any,
  })
  const textLayer: any = psdDoc.layers.find(l => l.type === "text")
  check("text layer existe", !!textLayer)
  check("text preservado", textLayer.text === "GIO")
  check("defaultStyle.fontFamily", textLayer.defaultStyle.fontFamily === "Exo 2")
  check("defaultStyle.fontWeight", textLayer.defaultStyle.fontWeight === 900)
  check("defaultStyle.color = #111111", textLayer.defaultStyle.color === "#111111")
  console.log("  styleRuns:", JSON.stringify(textLayer.styleRuns))
  check("styleRuns.length === 2", textLayer.styleRuns.length === 2)
  if (textLayer.styleRuns.length === 2) {
    check("run 0: start=0 length=1 verde", textLayer.styleRuns[0].start === 0 && textLayer.styleRuns[0].length === 1 && textLayer.styleRuns[0].style.color === "#00FF00")
    check("run 1: start=2 length=1 vermelho", textLayer.styleRuns[1].start === 2 && textLayer.styleRuns[1].length === 1 && textLayer.styleRuns[1].style.color === "#FF0000")
  }

  // ============================================================
  console.log("\n=== Write + Re-read roundtrip ===")
  const { bytes } = writePsdDocument(psdDoc, {} as any)
  const buf = bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from(bytes as Uint8Array)
  writeFileSync("/tmp/canonical-export.psd", buf)
  const reBytes = readFileSync("/tmp/canonical-export.psd")
  const reAb = reBytes.buffer.slice(reBytes.byteOffset, reBytes.byteOffset + reBytes.byteLength) as ArrayBuffer
  const { document: doc2 } = readPsdDocument(reAb, { includeImageData: false, includeComposite: false })
  const textL2: any = doc2.layers.find((l: any) => l.type === "text")
  check("re-read: text layer existe", !!textL2)
  check("re-read: text preservado", textL2.text === "GIO")
  console.log("  re-read styleRuns:", JSON.stringify(textL2.styleRuns))
  function colorAt(runs: any[], pos: number): string | null {
    let cur = 0
    for (const r of runs) {
      if (pos >= cur && pos < cur + r.length) return (r.style?.color ?? "").toLowerCase()
      cur += r.length
    }
    return null
  }
  check("re-read: char 0 (G) verde", colorAt(textL2.styleRuns, 0) === "#00ff00")
  check("re-read: char 1 (I) #111111 default", colorAt(textL2.styleRuns, 1) === "#111111")
  check("re-read: char 2 (O) vermelho", colorAt(textL2.styleRuns, 2) === "#ff0000")

  console.log(`\n=== RESULT: ${pass} PASS, ${fail} FAIL ===`)
  process.exit(fail === 0 ? 0 : 1)
})()
