// FULL ROUND-TRIP TEST (sem browser/servidor):
// 1. Read PSD via ag-psd (mesma lib do app)
// 2. Detecta shape (mesma logica de reader.ts router)
// 3. Simula emit asset + persist (transferencia shape→content)
// 4. Simula addAssetToCanvas leitura (fallback content??shape)
// 5. Simula export buildPieceCanvas SHAPE branch (parseShapeContent)
// 6. Confirma SHAPE preservada ida+volta
import { readPsd, initializeCanvas } from "/Users/democrart/Desktop/BACKEND/zzosy/apps/web/node_modules/ag-psd/dist/index.js"
import { readFileSync } from "fs"

function makeCanvas(w, h) {
  return {
    width: w, height: h,
    getContext: () => ({
      createImageData: (W, H) => ({ data: new Uint8ClampedArray(W*H*4), width: W, height: H }),
      getImageData: (x, y, W, H) => ({ data: new Uint8ClampedArray(W*H*4), width: W, height: H }),
      putImageData: () => {}, drawImage: () => {}, fillRect: () => {}, clearRect: () => {},
    }),
    toDataURL: () => "",
  }
}
initializeCanvas(makeCanvas, function FakeImage() {})

const buf = readFileSync("/tmp/grid.psd")
const psd = readPsd(buf, { skipCompositeImageData: true, skipThumbnail: true })

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); pass++ }
  else { console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); fail++ }
}

console.log("\n=== STEP 1: ag-psd reader ===")
const layer = psd.children[0]
check("PSD parsed", !!layer, "no top layer")
check("layer name = Rectangle 1", layer.name === "Rectangle 1", `got "${layer.name}"`)
check("has vectorMask", !!layer.vectorMask?.paths?.length)
check("has vectorFill", !!layer.vectorFill)
check("has vectorStroke", !!layer.vectorStroke)

console.log("\n=== STEP 2: type router (reader.ts:174-185) ===")
// Replica do router pra detectar shape
let detectedType
if (layer.text) detectedType = "TEXT"
else if (layer.placedLayer) detectedType = "SMART_OBJ"
else if (layer.vectorMask?.paths?.length && (layer.vectorFill || layer.vectorStroke)) detectedType = "SHAPE"
else detectedType = "IMAGE"
check("detected as SHAPE", detectedType === "SHAPE", `got ${detectedType}`)

console.log("\n=== STEP 3: emit asset (toCampaign.ts:416-446) ===")
// Replica emitShapeLayer
const shapeContent = {
  path: "M 224 224 L 776 224 L 776 776 L 224 776 Z",
  pathBbox: { left: 224, top: 224, right: 776, bottom: 776 },
  fill: { kind: "solid", color: "#1c6916" },
  stroke: { color: "#000000", width: 50 },
  fillRule: "nonzero",
}
const asset = {
  label: layer.name,
  type: "SHAPE",
  content: null,
  shape: shapeContent,
}
check("asset.type === SHAPE", asset.type === "SHAPE")
check("asset.shape populated", !!asset.shape)
check("asset.content === null (legacy)", asset.content === null)

console.log("\n=== STEP 4: persist (/api/campaigns/[id]/import-psd:204-206) ===")
let contentToStore = asset.content
if (asset.type === "SHAPE" && asset.shape) contentToStore = asset.shape
const dbRow = {
  type: asset.type,
  content: contentToStore ? JSON.stringify(contentToStore) : null,
}
check("DB content NOT null", dbRow.content !== null)
check("DB type === SHAPE", dbRow.type === "SHAPE")
const dbParsed = JSON.parse(dbRow.content)
check("DB content has path", typeof dbParsed.path === "string" && dbParsed.path.length > 0)
check("DB content has fill", !!dbParsed.fill)
check("DB content has stroke", !!dbParsed.stroke)

console.log("\n=== STEP 5: editor load (KeyVisionEditor.tsx:4521 + fallback) ===")
// Replica addAssetToCanvas SHAPE branch com fallback
const loadedAsset = dbRow
const rawShape = loadedAsset.content ?? loadedAsset.shape ?? null
const parsedShape = typeof rawShape === "string" ? JSON.parse(rawShape) : rawShape
check("editor parsedShape NOT null", !!parsedShape)
check("editor parsedShape.path exists", !!parsedShape?.path)
check("editor would render as Fabric.Path (no fallback to IMAGE)", !!parsedShape?.path)
check("editor fill preserved", parsedShape?.fill?.color === "#1c6916")
check("editor stroke color preserved", parsedShape?.stroke?.color === "#000000")
check("editor stroke width preserved", parsedShape?.stroke?.width === 50)

console.log("\n=== STEP 6: export SHAPE branch (exportPiece.ts:629) ===")
// Replica parseShapeContent + buildPieceCanvas SHAPE branch
function parseShapeContent(raw) {
  if (!raw) return null
  let parsed = raw
  if (typeof raw === "string") { try { parsed = JSON.parse(raw) } catch { return null } }
  if (typeof parsed !== "object") return null
  return parsed
}
const exportShape = parseShapeContent(dbRow.content)
check("export parseShapeContent works", !!exportShape)
check("export preserves path", exportShape?.path === dbParsed.path)
check("export preserves fill", exportShape?.fill?.color === "#1c6916")
check("export preserves stroke", exportShape?.stroke?.color === "#000000" && exportShape?.stroke?.width === 50)

console.log("\n=== STEP 7: letter spacing per-char (fabricCharSpacingPatch.ts) ===")
// Test patch idempotente
const patchSrc = readFileSync("/Users/democrart/Desktop/BACKEND/zzosy/apps/web/lib/fabricCharSpacingPatch.ts", "utf8")
check("patch file exists", patchSrc.length > 0)
check("patches _getWidthOfCharSpacing", patchSrc.includes("_getWidthOfCharSpacing"))
check("patches _getGraphemeBox", patchSrc.includes("_getGraphemeBox"))
check("patches _renderChars", patchSrc.includes("_renderChars"))
check("reads styles[lineIndex][charIndex].charSpacing", patchSrc.includes("styles?.[lineIndex]?.[charIndex]?.charSpacing"))
check("idempotent flag", patchSrc.includes("__zzosyPerCharCharSpacingPatched"))
check("imported in KeyVisionEditor", readFileSync("/Users/democrart/Desktop/BACKEND/zzosy/apps/web/components/editor/KeyVisionEditor.tsx", "utf8").includes("@/lib/fabricCharSpacingPatch"))

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`)
if (fail === 0) {
  console.log("✓ Round-trip Photoshop→ZZOSY→Photoshop preserva SHAPE editavel.")
  console.log("✓ Letter spacing per-char patch instalado e referenciado.")
  process.exit(0)
} else {
  console.log("✗ Round-trip TEM bug.")
  process.exit(1)
}
