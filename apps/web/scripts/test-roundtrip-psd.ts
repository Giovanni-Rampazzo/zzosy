// Round-trip test: Teste.psd → reader → toCampaign → fromEditor → writer → reader.
// Valida que shape (path/fill/stroke) e text (font/weight/color/align) sobrevivem.
import { initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { readFileSync, writeFileSync } from "fs"

initializeCanvas(createCanvas as any)

;(async () => {
  const { readPsdDocument } = await import("../lib/psd/reader")
  const { buildCampaignFromPsd } = await import("../lib/psd/toCampaign")
  const { buildPsdDocumentFromEditor } = await import("../lib/psd/fromEditor")
  const { writePsdDocument } = await import("../lib/psd/writer")

  const psdPath = "/Users/democrart/Desktop/Teste.psd"
  const bytes = readFileSync(psdPath)
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

  console.log("=== STEP 1: Read original Teste.psd ===")
  const { document: doc1 } = readPsdDocument(ab, { includeImageData: false, includeComposite: false })
  console.log(`PSD ${doc1.width}x${doc1.height}, ${doc1.layers.length} layers`)
  for (const l of doc1.layers) {
    if ((l as any).type === "shape") {
      const s: any = l
      console.log(`  SHAPE ${s.name}: fill=${JSON.stringify(s.fill)} stroke=${JSON.stringify(s.stroke)}`)
    }
    if ((l as any).type === "text") {
      const t: any = l
      console.log(`  TEXT "${t.text}" font=${t.defaultStyle.fontFamily}/w${t.defaultStyle.fontWeight}/s${t.defaultStyle.fontSize} color=${t.defaultStyle.color} align=${t.paragraph?.align ?? "?"}`)
    }
  }

  console.log("\n=== STEP 2: toCampaign ===")
  const build = buildCampaignFromPsd(doc1)
  console.log(`Assets: ${build.assets.length}, kvLayers: ${build.kvLayers.length}`)

  console.log("\n=== STEP 3: fromEditor (editor → PsdDocument) ===")
  // Simula "editor layers" usando as kvLayers + assets gerados (sem edits).
  const editorLayers = build.kvLayers.map((kl: any) => ({
    assetId: kl.assetId,
    posX: kl.posX,
    posY: kl.posY,
    scaleX: kl.scaleX ?? 1,
    scaleY: kl.scaleY ?? 1,
    rotation: kl.rotation ?? 0,
    width: kl.width,
    height: kl.height,
    zIndex: kl.zIndex,
    hidden: kl.hidden,
    opacity: kl.opacity,
    blendMode: kl.blendMode,
    overrides: {},
  }))
  // Persistencia (route.ts) move asset.shape → asset.content como JSON string.
  // Simula essa transformacao aqui pra fromEditor receber content populado.
  const editorAssets = build.assets.map((a: any) => {
    if (a.type === "SHAPE" && a.shape) {
      return { id: a.tempId, type: a.type, label: a.label, content: JSON.stringify(a.shape) }
    }
    return { id: a.tempId, type: a.type, label: a.label, content: typeof a.content === "string" ? a.content : JSON.stringify(a.content) }
  })
  const psdDoc = buildPsdDocumentFromEditor({
    width: doc1.width,
    height: doc1.height,
    layers: editorLayers as any,
    assets: editorAssets as any,
  })
  console.log(`Doc reconstruido: ${psdDoc.layers.length} layers`)
  for (const l of psdDoc.layers) {
    if (l.type === "shape") {
      console.log(`  SHAPE: bbox=${JSON.stringify(l.bbox)} path[0:80]=${l.path?.slice(0, 80)}`)
      console.log(`    fill=${JSON.stringify(l.fill)} stroke=${JSON.stringify(l.stroke)}`)
    }
    if (l.type === "text") {
      console.log(`  TEXT "${l.text}" bbox=${JSON.stringify(l.bbox)} align=${l.paragraph.align}`)
      console.log(`    defaultStyle=${JSON.stringify(l.defaultStyle)}`)
    }
  }

  console.log("\n=== STEP 4: writer (PsdDocument → bytes) ===")
  const { bytes: outBytes, warnings } = writePsdDocument(psdDoc, {} as any)
  const len = outBytes instanceof ArrayBuffer ? outBytes.byteLength : (outBytes as any).length
  console.log(`Output bytes: ${len}`)
  if (warnings.length > 0) {
    console.log("Warnings:")
    for (const w of warnings) console.log(`  [${w.kind}] ${w.layerName}: ${w.message}`)
  }
  const outPath = "/tmp/teste-roundtrip.psd"
  const buf = outBytes instanceof ArrayBuffer ? Buffer.from(outBytes) : Buffer.from(outBytes as Uint8Array)
  writeFileSync(outPath, buf)
  console.log(`Saved to ${outPath}`)

  console.log("\n=== STEP 5: Re-read /tmp/teste-roundtrip.psd ===")
  const outBuf = readFileSync(outPath)
  const outAb = outBuf.buffer.slice(outBuf.byteOffset, outBuf.byteOffset + outBuf.byteLength) as ArrayBuffer
  const { document: doc2 } = readPsdDocument(outAb, { includeImageData: false, includeComposite: false })
  console.log(`Re-read PSD ${doc2.width}x${doc2.height}, ${doc2.layers.length} layers`)
  for (const l of doc2.layers) {
    if ((l as any).type === "shape") {
      const s: any = l
      console.log(`  SHAPE ${s.name}: pathBbox=${JSON.stringify(s.pathBbox)} fill=${JSON.stringify(s.fill)} stroke=${JSON.stringify(s.stroke)}`)
    }
    if ((l as any).type === "text") {
      const t: any = l
      console.log(`  TEXT "${t.text}" bbox=${JSON.stringify(t.bbox)} font=${t.defaultStyle.fontFamily}/w${t.defaultStyle.fontWeight}/s${t.defaultStyle.fontSize} color=${t.defaultStyle.color} align=${t.paragraph?.align}`)
    }
  }

  console.log("\n=== DIFF SUMMARY ===")
  const shapeIn: any = doc1.layers.find(l => (l as any).type === "shape")
  const shapeOut: any = doc2.layers.find(l => (l as any).type === "shape")
  if (shapeIn && shapeOut) {
    const fillOk = shapeIn.fill?.color === shapeOut.fill?.color
    const strokeOk = shapeIn.stroke?.color === shapeOut.stroke?.color
      && shapeIn.stroke?.width === shapeOut.stroke?.width
      && shapeIn.stroke?.position === shapeOut.stroke?.position
    const bboxDelta = {
      L: shapeOut.pathBbox.left - shapeIn.pathBbox.left,
      T: shapeOut.pathBbox.top - shapeIn.pathBbox.top,
      R: shapeOut.pathBbox.right - shapeIn.pathBbox.right,
      B: shapeOut.pathBbox.bottom - shapeIn.pathBbox.bottom,
    }
    console.log(`SHAPE fill ${fillOk ? "OK" : "FAIL"} stroke ${strokeOk ? "OK" : "FAIL"} pathBbox delta=${JSON.stringify(bboxDelta)}`)
  }
  const textIn: any = doc1.layers.find(l => (l as any).type === "text")
  const textOut: any = doc2.layers.find(l => (l as any).type === "text")
  if (textIn && textOut) {
    const textOk = textIn.text === textOut.text
    const fontOk = textIn.defaultStyle.fontFamily === textOut.defaultStyle.fontFamily
    const weightOk = Math.abs((textIn.defaultStyle.fontWeight ?? 400) - (textOut.defaultStyle.fontWeight ?? 400)) <= 100
    const colorOk = textIn.defaultStyle.color === textOut.defaultStyle.color
    const sizeOk = Math.abs(textIn.defaultStyle.fontSize - textOut.defaultStyle.fontSize) < 2
    console.log(`TEXT text=${textOk?"OK":"FAIL"} font=${fontOk?"OK":"FAIL"} weight=${weightOk?"OK":"FAIL"} color=${colorOk?"OK":"FAIL"} size=${sizeOk?"OK":"FAIL"}`)
    console.log(`  fauxBold reader: in=${textIn.defaultStyle.fauxBold} out=${textOut.defaultStyle.fauxBold}`)
  }
})()
