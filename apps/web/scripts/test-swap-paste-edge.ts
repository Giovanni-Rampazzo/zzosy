// Cenarios EDGE de swap, paste, multi-step, asset shared entre matriz e pecas.
// Cobre fluxos onde per-char foi reportado quebrando.

import { buildSpansFromPerChar, spansToFullPerChar, spansToText, spansDefaultStyle } from "../lib/assetSpans"
import { migrateStyles } from "../lib/migrateStyles"
import { bgFromAny, packBgForSave } from "../lib/bgLayers"
import { snapshotStep, restoreStep } from "../lib/stepSerializer"

let pass = 0, fail = 0
const fails: string[] = []
function check(name: string, cond: boolean, detail?: any) {
  if (cond) { pass++; console.log("  OK", name) }
  else { fail++; const msg = name + (detail ? " → " + JSON.stringify(detail).slice(0, 200) : ""); console.log("  FAIL", msg); fails.push(msg) }
}
function section(t: string) { console.log("\n" + "=".repeat(60) + "\n" + t + "\n" + "=".repeat(60)) }

// ============================================================
section("SWAP 1: troca asset preservando overrides do layer")
// ============================================================
// Cenario: peca tem layer com asset "ABC" + override fill amarelo + per-char A vermelho.
// User swap pra asset "DEF" (que tem lastOverride fill branco + per-char D azul).
// Esperado: layer apos swap usa lastOverride do DEF, escalado pra dim da peca.
// Per-char do ABC NAO eh transferido pro DEF.

const assetABC = {
  id: "abc", type: "TEXT",
  content: buildSpansFromPerChar("ABC", { color: "#111", fontSize: 80 }, { 0: { 0: { color: "#F00" } } } as any),
  lastOverride: { fill: "#FFCD00", fontSize: 80, fontFamily: "Arial", styles: { 0: { 0: { color: "#F00" } } }, width: 400 },
}
const assetDEF = {
  id: "def", type: "TEXT",
  content: buildSpansFromPerChar("DEF", { color: "#111", fontSize: 80 }, { 0: { 0: { color: "#00F" } } } as any),
  lastOverride: { fill: "#FFFFFF", fontSize: 80, fontFamily: "Arial", styles: { 0: { 0: { color: "#00F" } } }, width: 400 },
}
const pieceLayer = { assetId: "abc", overrides: { fill: "#FFCD00", fontSize: 40, styles: { 0: { 0: { color: "#F00" } } } } } // peca tem ratio 0.5

// Swap: usa lastOverride do DEF, escala fontSize pelo ratio atual (40/80=0.5)
const ratio = pieceLayer.overrides.fontSize / assetABC.lastOverride.fontSize // 0.5
const newOverridesRaw: any = { ...assetDEF.lastOverride }
const newOverrides: any = { ...newOverridesRaw, fontSize: newOverridesRaw.fontSize * ratio }
if (newOverridesRaw.styles) {
  const scaled: any = {}
  for (const lk of Object.keys(newOverridesRaw.styles)) {
    scaled[lk] = {}
    for (const ck of Object.keys(newOverridesRaw.styles[lk])) {
      const cs = { ...newOverridesRaw.styles[lk][ck] }
      scaled[lk][ck] = cs
    }
  }
  newOverrides.styles = scaled
}
check("swap.1 newLayer fontSize escalado", newOverrides.fontSize === 40)
check("swap.1 newLayer fill = DEF white", newOverrides.fill === "#FFFFFF")
check("swap.1 newLayer per-char D azul", newOverrides.styles[0][0].color === "#00F")
// MUTATE newOverrides — não pode afetar assetDEF.lastOverride original
newOverrides.styles[0][0].color = "#FFF"
check("swap.1 mutate isolated do DEF original", assetDEF.lastOverride.styles[0][0].color === "#00F")

// ============================================================
section("SWAP 2: ABC -> DEF -> ABC (back) preserva ABC original")
// ============================================================
// Cenario: depois de swap pra DEF, swap de volta pra ABC. Cada asset tem
// seu lastOverride independente. Volta pra ABC vermelho.
const swapBack: any = { ...assetABC.lastOverride, fontSize: assetABC.lastOverride.fontSize * 0.5 }
check("swap.2 back to ABC: fill amarelo restaurado", swapBack.fill === "#FFCD00")
check("swap.2 back to ABC: per-char A vermelho restaurado", swapBack.styles[0][0].color === "#F00")

// ============================================================
section("PASTE: duplicate layer preserva overrides + isolated")
// ============================================================
// User copia layer com per-char overrides. Cole na peca. Novo layer deep-cloned.
const origLayer = { assetId: "abc", posX: 100, posY: 200, overrides: { fill: "#FFCD00", fontSize: 40, styles: { 0: { 0: { color: "#F00" }, 2: { color: "#0F0" } } } } }
const pastedLayer = JSON.parse(JSON.stringify(origLayer))
pastedLayer.posX = 150 // simula offset paste
check("paste: per-char A vermelho clonado", pastedLayer.overrides.styles[0][0].color === "#F00")
check("paste: per-char C verde clonado", pastedLayer.overrides.styles[0][2].color === "#0F0")
// MUTATE pasted — orig nao pode mudar
pastedLayer.overrides.styles[0][0].color = "#000"
check("paste: mutate pasted nao afeta orig", origLayer.overrides.styles[0][0].color === "#F00")

// ============================================================
section("MULTI-STEP: bg + per-char isolado entre steps")
// ============================================================
const step1 = { bgLayers: [{ kind: "solid" as const, color: "#FF0000", opacity: 1 }], layers: [{ assetId: "abc", overrides: { fill: "#000", styles: { 0: { 0: { color: "#FFF" } } } } }] }
const step2 = { bgLayers: [{ kind: "solid" as const, color: "#00FF00", opacity: 1 }], layers: [{ assetId: "abc", overrides: { fill: "#FFF", styles: { 0: { 0: { color: "#000" } } } } }] }
const snap1 = snapshotStep({ layers: step1.layers, bgLayers: step1.bgLayers, fallbackPieceImageUrl: null })
const snap2 = snapshotStep({ layers: step2.layers, bgLayers: step2.bgLayers, fallbackPieceImageUrl: null })
check("multistep: snap1 bg vermelho", snap1.bgColor === "#FF0000")
check("multistep: snap2 bg verde", snap2.bgColor === "#00FF00")
check("multistep: snap1 per-char branco", snap1.layers[0].overrides.styles[0][0].color === "#FFF")
check("multistep: snap2 per-char preto", snap2.layers[0].overrides.styles[0][0].color === "#000")
// MUTATE snap1 layers - snap2 isolado
snap1.layers[0].overrides.styles[0][0].color = "#0000FF"
check("multistep: mutate snap1 nao afeta snap2", snap2.layers[0].overrides.styles[0][0].color === "#000")
// MUTATE step1.bgLayers original (depois do snapshot) - snap nao mexe
step1.bgLayers[0].color = "#FFF"
check("multistep: mutate raw step1 nao afeta snap1", snap1.bgColor === "#FF0000")

// ============================================================
section("ASSET COMPARTILHADO: edit em /assets propaga sem perder per-char DAS PECAS")
// ============================================================
// Cenario chave reportado: asset "GIO" compartilhado entre matriz + 3 pecas.
// User pinta per-char G verde / O vermelho na matriz. Cada peca tambem tem
// per-char similar nos layers. User edita asset GIO -> GXO via /assets.
// EXPECTED: server migra TODAS layers (matriz + 3 pecas + lastOverride) E
// canonifica asset.content. Per-char sobrevive em TUDO.

const matrixContent = buildSpansFromPerChar("GIO", { color: "#111", fontSize: 80 }, { 0: { 0: { color: "#0F0" }, 2: { color: "#F00" } } } as any)
const matrixLayerOv = { fill: "#111", fontSize: 80, styles: { 0: { 0: { color: "#0F0" }, 2: { color: "#F00" } } } }
const lastOverride = { fill: "#111", fontSize: 80, styles: { 0: { 0: { color: "#0F0" }, 2: { color: "#F00" } } } }
const piecesLayerOvs = [
  { id: "p1", styles: { 0: { 0: { color: "#0F0" }, 2: { color: "#F00" } } } },
  { id: "p2", styles: { 0: { 0: { color: "#0F0" }, 2: { color: "#F00" } } } },
  { id: "p3", styles: { 0: { 0: { color: "#0F0" }, 2: { color: "#F00" } } } },
]

// Simula edit GIO -> GXO via server PUT
const oldText = "GIO", newText = "GXO"
// Server: canonifica asset.content
const oldPerCharContent = spansToFullPerChar(matrixContent)
const migratedContent = migrateStyles(oldText, newText, oldPerCharContent)
const newContent = buildSpansFromPerChar(newText, { color: "#111", fontSize: 80 }, migratedContent)
// Server: migra lastOverride
const migratedLastOv = { ...lastOverride, styles: migrateStyles(oldText, newText, lastOverride.styles) }
// Server: migra matriz layer
const migratedMatrixOv = { ...matrixLayerOv, styles: migrateStyles(oldText, newText, matrixLayerOv.styles) }
// Server: migra TODAS pecas
const migratedPieces = piecesLayerOvs.map(p => ({ id: p.id, styles: migrateStyles(oldText, newText, p.styles) }))

// Validacoes em CADA destino
check("shared: asset.content G verde mantem", spansToFullPerChar(newContent)[0][0].color === "#0F0")
check("shared: asset.content X preto (replace inherit)", spansToFullPerChar(newContent)[0][1].color === "#111")
check("shared: asset.content O vermelho mantem", spansToFullPerChar(newContent)[0][2].color === "#F00")
check("shared: lastOverride G verde", (migratedLastOv.styles as any)[0][0].color === "#0F0")
check("shared: lastOverride O vermelho", (migratedLastOv.styles as any)[0][2].color === "#F00")
check("shared: matriz layer G verde", (migratedMatrixOv.styles as any)[0][0].color === "#0F0")
check("shared: matriz layer O vermelho", (migratedMatrixOv.styles as any)[0][2].color === "#F00")
for (const mp of migratedPieces) {
  check(`shared: piece-${mp.id} G verde`, (mp.styles as any)[0][0].color === "#0F0")
  check(`shared: piece-${mp.id} O vermelho`, (mp.styles as any)[0][2].color === "#F00")
}

// ============================================================
section("EMPTY EDIT: trim texto pra zero nao zera per-char")
// ============================================================
// User apaga tudo pra re-digitar. Server tem guard skipMigrate.
const emptyMigrate = migrateStyles("GIO", "", { 0: { 0: { color: "#0F0" } } } as any)
check("empty: migrate to empty returns empty", Object.keys(emptyMigrate).length === 0)

// ============================================================
section("MULTILINE: edit em linha 2 nao mexe em linha 1")
// ============================================================
const oldML = "ABC\nDEF"
const newML = "ABC\nDXF"
const mlStyles: any = {
  0: { 0: { color: "#F00" }, 1: { color: "#0F0" }, 2: { color: "#00F" } },
  1: { 0: { color: "#FF0" }, 1: { color: "#0FF" }, 2: { color: "#F0F" } },
}
const mlMigrated = migrateStyles(oldML, newML, mlStyles)
check("multiline: linha 1 A vermelho preserve", mlMigrated[0]?.[0]?.color === "#F00")
check("multiline: linha 1 B verde preserve", mlMigrated[0]?.[1]?.color === "#0F0")
check("multiline: linha 1 C azul preserve", mlMigrated[0]?.[2]?.color === "#00F")
check("multiline: linha 2 D amarelo preserve", mlMigrated[1]?.[0]?.color === "#FF0")
check("multiline: linha 2 X (replace E) herdou ciano", mlMigrated[1]?.[1]?.color === "#0FF")
check("multiline: linha 2 F magenta preserve", mlMigrated[1]?.[2]?.color === "#F0F")

// ============================================================
section("BG GRADIENT: preserva estrutura no save+load")
// ============================================================
const gradientBg = [{
  kind: "gradient" as const,
  gradientType: "linear" as const,
  angle: 45,
  stops: [{ offset: 0, color: "#FF0000" }, { offset: 1, color: "#0000FF" }],
  opacity: 1,
}]
const packed = packBgForSave(gradientBg)
check("gradient: bgColor legacy = 1o stop vermelho", packed.bgColor === "#FF0000")
const reloaded = bgFromAny({ bgLayers: packed.bgLayers, bgColor: packed.bgColor })
check("gradient: reloaded kind", reloaded[0].kind === "gradient")
check("gradient: reloaded angle", (reloaded[0] as any).angle === 45)
check("gradient: reloaded stops[0]", (reloaded[0] as any).stops[0].color === "#FF0000")
check("gradient: reloaded stops[1]", (reloaded[0] as any).stops[1].color === "#0000FF")

// ============================================================
section("RESULTADO")
// ============================================================
console.log(`\n  ${pass} PASS / ${fail} FAIL`)
if (fails.length > 0) {
  console.log("\nFalhas:")
  for (const f of fails) console.log("  - " + f)
}
process.exit(fail === 0 ? 0 : 1)
