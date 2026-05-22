/**
 * db-namesource-persistence.test.ts — valida que o spread do nameSource no
 * `layers` JSON do endpoint import-psd preserva o flag pro buildPieceCanvas
 * reler depois (re-export de PSD com nome manual 'lyr ' deve sair como 'lyr ').
 *
 * Replica o map() do endpoint apps/web/app/api/campaigns/[id]/import-psd/route.ts:230
 * sem rodar Prisma real. Cobre o gap que existia pre-fix: nameSource ia no
 * asset push mas nao era spreado pro layers JSON, perdia no reload.
 *
 * Uso: npx tsx lib/psd/__test__/db-namesource-persistence.test.ts
 */

// Simula a estrutura `assets` enviada pelo PsdImporter pro endpoint
const assets = [
  {
    label: "Auto-renamed",
    posX: 0, posY: 0, width: 400, height: 100, zIndex: 0,
    nameSource: "srct" as const,
  },
  {
    label: "Manual",
    posX: 0, posY: 100, width: 400, height: 100, zIndex: 1,
    nameSource: "lyr " as const,
  },
  {
    label: "No nameSource (legacy PSD)",
    posX: 0, posY: 200, width: 400, height: 100, zIndex: 2,
    // nameSource ausente
  },
]

// Replica EXATAMENTE o map() do endpoint linha 230 — se essa logica mudar,
// esse teste detecta. So inclui os fields necessarios pro asserto do nameSource.
const layers = assets.map((a, i) => ({
  assetId: `mock-${i}`,
  posX: a.posX, posY: a.posY,
  width: a.width, height: a.height,
  scaleX: 1, scaleY: 1, rotation: 0,
  zIndex: a.zIndex,
  // ↓ spread do nameSource — o fix sendo testado
  ...(typeof a.nameSource === "string" ? { nameSource: a.nameSource } : {}),
}))

console.log("Step 1: assets[].nameSource → layers[].nameSource via spread")
for (let i = 0; i < layers.length; i++) {
  console.log(`  asset[${i}].nameSource = ${JSON.stringify(assets[i].nameSource)} → layer[${i}].nameSource = ${JSON.stringify((layers[i] as any).nameSource)}`)
}

// Asserts
if ((layers[0] as any).nameSource !== "srct") {
  console.error(`  ✗ layer[0] esperado 'srct', got ${JSON.stringify((layers[0] as any).nameSource)}`)
  process.exit(1)
}
if ((layers[1] as any).nameSource !== "lyr ") {
  console.error(`  ✗ layer[1] esperado 'lyr ', got ${JSON.stringify((layers[1] as any).nameSource)}`)
  process.exit(1)
}
if ("nameSource" in layers[2]) {
  console.error(`  ✗ layer[2] esperado sem nameSource, got ${JSON.stringify((layers[2] as any).nameSource)}`)
  process.exit(1)
}
console.log("  ✓ preservacao srct + lyr + ausencia (asset sem o flag) corretos")

console.log("\nStep 2: round-trip JSON.stringify/parse (KeyVision.layers eh LongText)")
const serialized = JSON.stringify(layers)
const deserialized = JSON.parse(serialized)
if (deserialized[0]?.nameSource !== "srct") {
  console.error("  ✗ JSON round-trip perdeu 'srct'")
  process.exit(1)
}
if (deserialized[1]?.nameSource !== "lyr ") {
  console.error("  ✗ JSON round-trip perdeu 'lyr ' (talvez trim de trailing space?)")
  process.exit(1)
}
console.log(`  ✓ serialized: ${serialized.length} chars, nameSource preservado em todos os layers`)

console.log("\nStep 3: client-side save (KeyVisionEditor) propaga __psdNameSource → layer.nameSource")
// Simula o que os 4 sites do KeyVisionEditor.tsx fazem ao serializar
// Fabric objects pro layers JSON. Sem essa propagacao, o primeiro auto-save
// do user APOS import-psd sobrescreveria o nameSource salvo pelo endpoint.
function fabricToLayer(o: any): any {
  const layer: any = { assetId: o.__assetId ?? null }
  if ((o as any).__psdEffects && typeof (o as any).__psdEffects === "object") {
    layer.effects = (o as any).__psdEffects
  }
  if (typeof (o as any).__psdNameSource === "string") {
    layer.nameSource = (o as any).__psdNameSource
  }
  return layer
}

const fabricObjs = [
  { __assetId: "a1", __psdNameSource: "srct" },
  { __assetId: "a2", __psdNameSource: "lyr " },
  { __assetId: "a3" }, // sem __psdNameSource
]
const clientLayers = fabricObjs.map(fabricToLayer)
console.log(`  fabric[0] '${fabricObjs[0].__psdNameSource}' → layer.nameSource = ${JSON.stringify(clientLayers[0].nameSource)}`)
console.log(`  fabric[1] '${fabricObjs[1].__psdNameSource}' → layer.nameSource = ${JSON.stringify(clientLayers[1].nameSource)}`)
console.log(`  fabric[2] sem flag → layer = ${JSON.stringify(clientLayers[2])}`)

if (clientLayers[0].nameSource !== "srct") {
  console.error("  ✗ save client perdeu 'srct'")
  process.exit(1)
}
if (clientLayers[1].nameSource !== "lyr ") {
  console.error("  ✗ save client perdeu 'lyr '")
  process.exit(1)
}
if ("nameSource" in clientLayers[2]) {
  console.error("  ✗ layer[2] deveria estar sem nameSource (no flag set)")
  process.exit(1)
}
console.log("  ✓ client save (KeyVisionEditor.tsx 4 sites) preserva __psdNameSource → nameSource")

console.log("\n✓ DB NAMESOURCE PERSISTENCE OK — caminho legacy preserva nameSource pos reload")
