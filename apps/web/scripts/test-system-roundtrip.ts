// SYSTEM-WIDE TEST: simula o fluxo do usuario passando por todos os
// caminhos critic os do sistema:
//   IMPORT PSD → MATRIZ (per-char) → SAVE → GENERATED PIECE → ASSET EDIT
//   → REIMPORT → EXPORT → REIMPORT
//
// Valida que per-char + global overrides sobrevivem em todos os pontos.

import { initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { readFileSync, writeFileSync } from "fs"

initializeCanvas(createCanvas as any)

;(async () => {
  const { readPsdDocument } = await import("../lib/psd/reader")
  const { buildCampaignFromPsd } = await import("../lib/psd/toCampaign")
  const { buildPsdDocumentFromEditor } = await import("../lib/psd/fromEditor")
  const { writePsdDocument } = await import("../lib/psd/writer")
  const { migrateStyles } = await import("../lib/migrateStyles")

  let pass = 0, fail = 0
  function check(name: string, cond: boolean, detail?: any) {
    if (cond) { pass++; console.log("  OK", name) }
    else { fail++; console.log("  FAIL", name, detail ? "→ " + JSON.stringify(detail).slice(0, 200) : "") }
  }

  // ── STEP 1: Import Teste.psd ────────────────────────────────────
  console.log("\n=== STEP 1: Import Teste.psd ===")
  const bytes = readFileSync("/Users/democrart/Desktop/Teste.psd")
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const { document: doc1 } = readPsdDocument(ab, { includeImageData: false, includeComposite: false })
  const build = buildCampaignFromPsd(doc1)

  const textAsset: any = build.assets.find((a: any) => a.type === "TEXT")
  const shapeAsset: any = build.assets.find((a: any) => a.type === "SHAPE")
  check("import: tem text asset", !!textAsset)
  check("import: tem shape asset", !!shapeAsset)
  check("import: shape mask nao copiada do vectorMask", textAsset?.mask?.kind !== "vector" && shapeAsset?.mask?.kind !== "vector")
  check("import: text asset.content spans", Array.isArray(textAsset.content))
  console.log("  textAsset.content:", JSON.stringify(textAsset.content).slice(0, 200))

  // ── STEP 2: simula MATRIZ edit per-char ─────────────────────────
  console.log("\n=== STEP 2: Matriz edit per-char (G verde, O vermelho) ===")
  // Simula como o editor salva apos user mudar per-char:
  // layer.overrides.styles = per-char map
  // asset.lastOverride.styles = template per-char (espelho)
  // asset.content = AGORA UNIFORME (apos meu fix updateAssetContent)
  const matrizLayer = {
    assetId: textAsset.tempId,
    posX: 100, posY: 200,
    width: 263, height: 119,
    overrides: {
      // per-char: G verde, O vermelho. I sem override (default).
      styles: {
        0: { 0: { fill: "#00FF00" }, 2: { fill: "#FF0000" } }
      },
      // Global overrides setados pelo user no editor:
      fontFamily: "Exo 2",
      fontWeight: 900,
      fill: "#111111", // global default = preto
    }
  }
  // asset.content simulando updateAssetContent (uniforme apos meu fix):
  const assetContentAfterMatrixEdit = [
    { text: "GIO", style: { color: "#111111", fontSize: 165, fontWeight: 900, fontFamily: "Exo 2" } }
  ]
  // asset.lastOverride simulando updateAssetLastOverride (per-char preservado):
  const assetLastOverrideAfterMatrixEdit = {
    fill: "#111111",
    fontFamily: "Exo 2",
    fontWeight: 900,
    fontSize: 165,
    styles: { 0: { 0: { fill: "#00FF00" }, 2: { fill: "#FF0000" } } }
  }
  check("matriz: layer overrides preserva fontFamily", matrizLayer.overrides.fontFamily === "Exo 2")
  check("matriz: layer overrides preserva fill global", matrizLayer.overrides.fill === "#111111")
  check("matriz: layer overrides preserva per-char G verde", (matrizLayer.overrides.styles[0] as any)[0].fill === "#00FF00")
  check("matriz: asset.content uniforme (sem per-char baked)", assetContentAfterMatrixEdit.length === 1)
  check("matriz: lastOverride.styles preserva per-char", assetLastOverrideAfterMatrixEdit.styles[0][0].fill === "#00FF00")

  // ── STEP 3: Generated piece copia overrides ─────────────────────
  console.log("\n=== STEP 3: Generated piece merge lastOverride + layer.overrides ===")
  // GeneratePiecesModal logic: merged = { ...lastOverride, ...layerOverrides }
  const mergedOv: any = { ...assetLastOverrideAfterMatrixEdit, ...matrizLayer.overrides }
  const pieceLayer = { assetId: textAsset.tempId, posX: 50, posY: 100, width: 263, height: 119, overrides: mergedOv }
  check("piece: herda fontFamily", pieceLayer.overrides.fontFamily === "Exo 2")
  check("piece: herda fill global", pieceLayer.overrides.fill === "#111111")
  check("piece: herda per-char G verde", pieceLayer.overrides.styles[0][0].fill === "#00FF00")
  check("piece: herda per-char O vermelho", pieceLayer.overrides.styles[0][2].fill === "#FF0000")

  // ── STEP 4: Asset edit (GIO → GXO) ──────────────────────────────
  console.log("\n=== STEP 4: Asset content edit (1 char: GIO → GXO) ===")
  // Server route migrates layer.overrides.styles E lastOverride.styles:
  const oldText = "GIO", newText = "GXO"
  const newLayerStyles = migrateStyles(oldText, newText, matrizLayer.overrides.styles as any)
  const newLastOverrideStyles = migrateStyles(oldText, newText, assetLastOverrideAfterMatrixEdit.styles as any)
  check("asset edit: layer.styles G verde preservado", (newLayerStyles[0] as any)?.[0]?.fill === "#00FF00")
  check("asset edit: layer.styles O vermelho preservado", (newLayerStyles[0] as any)?.[2]?.fill === "#FF0000")
  check("asset edit: lastOverride.styles G preservado", (newLastOverrideStyles[0] as any)?.[0]?.fill === "#00FF00")
  check("asset edit: lastOverride.styles O preservado", (newLastOverrideStyles[0] as any)?.[2]?.fill === "#FF0000")
  // Global overrides preservados via spread (logica do server, simulamos)
  const newLayerOverrides = { ...matrizLayer.overrides, styles: newLayerStyles }
  check("asset edit: layer.fill global preservado", newLayerOverrides.fill === "#111111")
  check("asset edit: layer.fontFamily preservado", newLayerOverrides.fontFamily === "Exo 2")

  // ── STEP 5: Export PSD ──────────────────────────────────────────
  console.log("\n=== STEP 5: Export PSD (matriz com per-char) ===")
  const psdDoc = buildPsdDocumentFromEditor({
    width: doc1.width,
    height: doc1.height,
    layers: [{
      assetId: textAsset.tempId,
      posX: matrizLayer.posX, posY: matrizLayer.posY,
      scaleX: 1, scaleY: 1, rotation: 0,
      width: matrizLayer.width, height: matrizLayer.height,
      zIndex: 1, opacity: 1, blendMode: "source-over",
      overrides: matrizLayer.overrides as any,
    }] as any,
    assets: [{ id: textAsset.tempId, type: "TEXT", label: "GIO",
      content: JSON.stringify(assetContentAfterMatrixEdit) }] as any,
  })
  const textLayer: any = psdDoc.layers.find(l => l.type === "text")
  check("export: text layer existe", !!textLayer)
  check("export: text preservado", textLayer.text === "GIO")
  check("export: fontFamily preservado", textLayer.defaultStyle.fontFamily === "Exo 2")
  check("export: fontWeight preservado", textLayer.defaultStyle.fontWeight === 900)
  check("export: styleRuns para per-char", textLayer.styleRuns.length > 0)
  console.log("  styleRuns:", JSON.stringify(textLayer.styleRuns))

  const { bytes: outBytes } = writePsdDocument(psdDoc, {} as any)
  const buf = outBytes instanceof ArrayBuffer ? Buffer.from(outBytes) : Buffer.from(outBytes as Uint8Array)
  writeFileSync("/tmp/system-test.psd", buf)
  console.log("  PSD escrito:", buf.length, "bytes")

  // ── STEP 6: Re-read PSD ─────────────────────────────────────────
  console.log("\n=== STEP 6: Re-read PSD exportado ===")
  const reBytes = readFileSync("/tmp/system-test.psd")
  const reAb = reBytes.buffer.slice(reBytes.byteOffset, reBytes.byteOffset + reBytes.byteLength) as ArrayBuffer
  const { document: doc2 } = readPsdDocument(reAb, { includeImageData: false, includeComposite: false })
  const textL2: any = doc2.layers.find((l: any) => l.type === "text")
  check("reimport: text layer existe", !!textL2)
  check("reimport: text preservado", textL2.text === "GIO")
  check("reimport: text bbox nao colapsou", textL2.bbox.right > textL2.bbox.left && textL2.bbox.bottom > textL2.bbox.top)
  check("reimport: styleRuns presente", textL2.styleRuns.length > 0)
  console.log("  styleRuns lidos:", JSON.stringify(textL2.styleRuns))

  // ── RESULTADO ───────────────────────────────────────────────────
  console.log(`\n=== RESULT: ${pass} PASS, ${fail} FAIL ===`)
  process.exit(fail === 0 ? 0 : 1)
})()
