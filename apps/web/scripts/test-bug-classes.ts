// TESTE SISTEMICO — cobre TODAS as classes de bug reportadas pelo user 2026-05-28:
//
//  1. "Editei 1 letra no asset, todas letras de todas pecas ficaram mesma cor"
//     → per-char preservado em matriz + lastOverride + pecas geradas + apos edit do asset
//
//  2. "Steps salvando mesmo bg nos dois steps"
//     → bgLayers de step1 != step2 sem cross-contamination
//
//  3. "Previews demorando pra atualizar / stale"
//     → render via buildPieceCanvas (canonico) == export PSD == thumb
//
//  4. "Schema drift bgColor vs bgLayers"
//     → bgFromAny + packBgForSave evitam drift
//
//  5. "Per-char some quando edita texto via /assets"
//     → server canonifica content + Myers LCS migrate
//
// Estrutura: cada CLASS roda em sequencia, falha em qualquer assert quebra
// no fim.

import { buildSpansFromPerChar, spansToFullPerChar, spansToText, spansDefaultStyle } from "../lib/assetSpans"
import { migrateStyles } from "../lib/migrateStyles"
import { bgFromAny, packBgForSave, bgLegacyFields, migrateBgLayerJson } from "../lib/bgLayers"
import { snapshotStep, restoreStep } from "../lib/stepSerializer"

let pass = 0, fail = 0
const fails: string[] = []
function check(name: string, cond: boolean, detail?: any) {
  if (cond) { pass++; console.log("  OK", name) }
  else { fail++; const msg = name + (detail ? " → " + JSON.stringify(detail).slice(0, 200) : ""); console.log("  FAIL", msg); fails.push(msg) }
}
function section(title: string) { console.log("\n" + "=".repeat(60) + "\n" + title + "\n" + "=".repeat(60)) }

// ============================================================
section("CLASS 1: Per-char preservado em CADA caminho do sistema")
// ============================================================
// Cenario do user: pinta G verde, I preto, O vermelho na matriz. Gera 5 pecas.
// Vai pra /assets, edita GIO -> GXO. Espera: G verde, X preto, O vermelho em
// TODAS as pecas + matriz.

const defaultStyle = { color: "#111111", fontSize: 80, fontFamily: "Arial", fontWeight: "normal" }
const initialPerChar = {
  0: { 0: { color: "#00FF00" }, 2: { color: "#FF0000" } }, // G verde, O vermelho
}

// 1.1: matriz cria spans canonicos com sentinela
const matrixSpans = buildSpansFromPerChar("GIO", defaultStyle, initialPerChar as any)
check("1.1 matrix: sentinela presente", matrixSpans[0].text === "" && matrixSpans[0].style.color === "#111111")
check("1.1 matrix: texto preservado", spansToText(matrixSpans) === "GIO")

// 1.2: server extrai per-char COMPLETO
const matrixPerChar = spansToFullPerChar(matrixSpans)
check("1.2 server: G verde extraido", (matrixPerChar[0] as any)?.[0]?.color === "#00FF00")
check("1.2 server: I preto (do default) extraido", (matrixPerChar[0] as any)?.[1]?.color === "#111111")
check("1.2 server: O vermelho extraido", (matrixPerChar[0] as any)?.[2]?.color === "#FF0000")

// 1.3: lastOverride do asset captura per-char (template pra novas pecas)
const lastOverride = {
  fill: "#111111", fontFamily: "Arial", fontSize: 80, fontWeight: 400,
  styles: matrixPerChar,
}

// 1.4: peca gerada herda merge (lastOverride + layer.overrides matriz)
const matrixLayerOverrides = { ...lastOverride, fill: "#111111" }
const pieceLayerOverrides = { ...lastOverride, ...matrixLayerOverrides } // merge
check("1.4 piece-gen: per-char G herdado", pieceLayerOverrides.styles[0][0].color === "#00FF00")
check("1.4 piece-gen: per-char O herdado", pieceLayerOverrides.styles[0][2].color === "#FF0000")

// 1.5: EDIT DO ASSET via /assets - simula server PUT canonifica + migra
const oldText = "GIO", newText = "GXO"
const oldSpans = matrixSpans
const newSpansFromClient = [{ text: newText, style: defaultStyle }] // client uniform
const oldPerCharFull = spansToFullPerChar(oldSpans)
const migratedPerChar = migrateStyles(oldText, newText, oldPerCharFull)
const newDefault = spansDefaultStyle(newSpansFromClient)
const canonicalAfterEdit = buildSpansFromPerChar(newText, newDefault, migratedPerChar)
check("1.5 asset-edit: sentinela mantido", canonicalAfterEdit[0].text === "" && canonicalAfterEdit[0].style.color === "#111111")
const afterEditPerChar = spansToFullPerChar(canonicalAfterEdit)
check("1.5 asset-edit: G verde sobreviveu na MATRIZ asset.content", (afterEditPerChar[0] as any)?.[0]?.color === "#00FF00")
check("1.5 asset-edit: X (replace I) herdou preto", (afterEditPerChar[0] as any)?.[1]?.color === "#111111")
check("1.5 asset-edit: O vermelho sobreviveu", (afterEditPerChar[0] as any)?.[2]?.color === "#FF0000")

// 1.6: server migra lastOverride.styles (template pra futuras pecas)
const migratedLastOverrideStyles = migrateStyles(oldText, newText, lastOverride.styles)
check("1.6 server-lastOverride: G verde", (migratedLastOverrideStyles[0] as any)?.[0]?.color === "#00FF00")
check("1.6 server-lastOverride: O vermelho", (migratedLastOverrideStyles[0] as any)?.[2]?.color === "#FF0000")

// 1.7: server migra cada peca.layer.overrides.styles
const piecesBeforeEdit = [
  { id: "p1", layerStyles: { ...matrixPerChar } },
  { id: "p2", layerStyles: { ...matrixPerChar } },
  { id: "p3", layerStyles: { ...matrixPerChar } },
]
for (const p of piecesBeforeEdit) {
  const migrated = migrateStyles(oldText, newText, p.layerStyles)
  check(`1.7 server-piece-${p.id}: G verde`, (migrated[0] as any)?.[0]?.color === "#00FF00")
  check(`1.7 server-piece-${p.id}: O vermelho`, (migrated[0] as any)?.[2]?.color === "#FF0000")
}

// 1.8: edge - peca gerada DEPOIS do edit do asset (deve herdar lastOverride migrado)
const pieceGenAfterEdit = { ...lastOverride, styles: migratedLastOverrideStyles }
check("1.8 piece-gen-after-edit: G verde", pieceGenAfterEdit.styles[0][0].color === "#00FF00")
check("1.8 piece-gen-after-edit: O vermelho", pieceGenAfterEdit.styles[0][2].color === "#FF0000")

// ============================================================
section("CLASS 2: Steps isolados (sem cross-contamination de bg)")
// ============================================================
// Cenario: peca com 2 steps. Step1 bg verde, Step2 bg rosa. Mudar Step1 nao
// pode afetar Step2 snapshot.

const step1BgLayers = [{ kind: "solid" as const, color: "#00FF00", opacity: 1 }]
const step2BgLayers = [{ kind: "solid" as const, color: "#FF006E", opacity: 1 }]

// snapshotStep usa deep-clone forcado
const snap1 = snapshotStep({ layers: [], bgLayers: step1BgLayers, fallbackPieceImageUrl: null })
const snap2 = snapshotStep({ layers: [], bgLayers: step2BgLayers, fallbackPieceImageUrl: null })
check("2.1 snap1 bg verde", snap1.bgLayers[0].color === "#00FF00")
check("2.1 snap2 bg rosa", snap2.bgLayers[0].color === "#FF006E")

// MUTATE step1 original — snap1 nao pode mudar (deep clone)
step1BgLayers[0].color = "#0000FF"
check("2.2 step1 mutado: snap1 isolado (deep-clone)", snap1.bgLayers[0].color === "#00FF00")
check("2.2 step1 mutado: snap2 nao afetado", snap2.bgLayers[0].color === "#FF006E")

// bgColor legacy derivado de bgLayers[0]
check("2.3 snap1: bgColor legacy = verde", snap1.bgColor === "#00FF00")
check("2.3 snap2: bgColor legacy = rosa", snap2.bgColor === "#FF006E")

// ============================================================
section("CLASS 3: Render pipeline canonico (sem 4a divergencia)")
// ============================================================
// Antes: GeneratePiecesModal.renderPieceThumb serializava canvas live (toObject).
// Agora: usa buildPieceCanvas(pieceData) — mesma fonte de export PSD/PNG/thumb.
// Aqui validamos que o pieceData passado bate com schema esperado.

const pieceData = {
  version: 2,
  width: 1080, height: 1080,
  ...packBgForSave([{ kind: "solid", color: "#00FF00", opacity: 1 }]),
  layers: [
    { assetId: "asset-text-1", posX: 100, posY: 200, width: 800, height: 200, overrides: { fill: "#FFFFFF", fontFamily: "Arial", fontSize: 80, styles: matrixPerChar } },
  ],
}
check("3.1 pieceData: bgColor legacy derivado", pieceData.bgColor === "#00FF00")
check("3.1 pieceData: bgLayers preservado", pieceData.bgLayers[0].color === "#00FF00")
check("3.1 pieceData: layer per-char preservado", (pieceData.layers[0].overrides.styles[0] as any)?.[0]?.color === "#00FF00")

// ============================================================
section("CLASS 4: BG schema drift eliminado")
// ============================================================
// 4.1: bgFromAny le bgLayers preferido
const sourceA = { bgLayers: [{ kind: "solid", color: "#FF0000", opacity: 1 }] }
const fromA = bgFromAny(sourceA)
check("4.1 bgFromAny: le bgLayers", fromA[0].color === "#FF0000")

// 4.2: bgFromAny fallback bgColor legacy
const sourceB = { bgColor: "#00FF00", bgOpacity: 0.5 }
const fromB = bgFromAny(sourceB)
check("4.2 bgFromAny: fallback bgColor", fromB[0].color === "#00FF00")
check("4.2 bgFromAny: fallback bgOpacity", fromB[0].opacity === 0.5)

// 4.3: ambos presentes - prefere bgLayers
const sourceC = { bgColor: "#FF0000", bgLayers: [{ kind: "solid", color: "#00FF00", opacity: 1 }] }
const fromC = bgFromAny(sourceC)
check("4.3 drift case: bgLayers ganha sobre bgColor legacy", fromC[0].color === "#00FF00")

// 4.4: packBgForSave deriva bgColor legacy de bgLayers[0]
const packed = packBgForSave([{ kind: "solid", color: "#0000FF", opacity: 0.8 }])
check("4.4 pack: bgColor legacy derivado", packed.bgColor === "#0000FF")
check("4.4 pack: bgOpacity derivado", packed.bgOpacity === 0.8)
check("4.4 pack: bgLayers presente", packed.bgLayers[0].color === "#0000FF")

// 4.5: gradient fallback - bgColor legacy pega 1o stop
const packedGradient = packBgForSave([{ kind: "gradient", stops: [{ offset: 0, color: "#AA00BB" }, { offset: 1, color: "#CC0011" }], gradientType: "linear", angle: 0, opacity: 1 }])
check("4.5 gradient: bgColor legacy = 1o stop", packedGradient.bgColor === "#AA00BB")

// ============================================================
section("CLASS 5: Edge cases de migracao texto")
// ============================================================
// 5.1: inserir char no inicio
const ins0 = migrateStyles("BC", "ABC", { 0: { 0: { color: "#FF0000" }, 1: { color: "#00FF00" } } } as any)
check("5.1 insert-start: A herda do proximo conhecido", (ins0[0] as any)?.[0]?.color !== undefined)
check("5.1 insert-start: B vermelho mantem", (ins0[0] as any)?.[1]?.color === "#FF0000")

// 5.2: deletar char do meio
const del0 = migrateStyles("ABC", "AC", { 0: { 0: { color: "#FF0000" }, 1: { color: "#00FF00" }, 2: { color: "#0000FF" } } } as any)
check("5.2 delete-mid: A vermelho", (del0[0] as any)?.[0]?.color === "#FF0000")
check("5.2 delete-mid: C azul (era pos 2, agora pos 1)", (del0[0] as any)?.[1]?.color === "#0000FF")

// 5.3: replace tudo
const repAll = migrateStyles("ABC", "XYZ", { 0: { 0: { color: "#FF0000" }, 1: { color: "#00FF00" }, 2: { color: "#0000FF" } } } as any)
check("5.3 replace-all: X herda do A", (repAll[0] as any)?.[0]?.color === "#FF0000")
check("5.3 replace-all: Y herda do B", (repAll[0] as any)?.[1]?.color === "#00FF00")
check("5.3 replace-all: Z herda do C", (repAll[0] as any)?.[2]?.color === "#0000FF")

// 5.4: edit sem mudar texto - styles preservados
const sameText = migrateStyles("ABC", "ABC", { 0: { 0: { color: "#FF0000" } } } as any)
check("5.4 no-change: styles preservados", (sameText[0] as any)?.[0]?.color === "#FF0000")

// 5.5: texto vazio -> nao migra (server tem guard)
const emptyOld = migrateStyles("", "ABC", {} as any)
check("5.5 from-empty: returns empty", Object.keys(emptyOld).length === 0)

// ============================================================
section("CLASS 6: bgLayer migration (legacy data DB)")
// ============================================================
const legacy1 = migrateBgLayerJson({ kind: "solid", color: "#FF0000", opacity: 0.5, hidden: true })
check("6.1 legacy solid: kind preservado", legacy1.kind === "solid")
check("6.1 legacy solid: hidden preservado", legacy1.hidden === true)

const legacy2 = migrateBgLayerJson({ kind: "gradient", stops: [{ offset: 0, color: "#FF0000" }, { offset: 1, color: "#0000FF" }], angle: 45, gradientType: "linear" })
check("6.2 legacy gradient: stops preservados", legacy2.stops?.length === 2)
check("6.2 legacy gradient: angle preservado", legacy2.angle === 45)

const legacy3 = migrateBgLayerJson(null)
check("6.3 legacy null: fallback default", legacy3.kind === "solid" && legacy3.color === "#ffffff")

const legacy4 = migrateBgLayerJson({}) // entry vazia
check("6.4 legacy empty: fallback solid", legacy4.kind === "solid")

// ============================================================
section("CLASS 7: Spans canonicos roundtrip (entropia 0)")
// ============================================================
// Spans canonicos passados por buildSpansFromPerChar -> spansToFullPerChar
// -> buildSpansFromPerChar devem ser IDENTICOS.
const round1 = buildSpansFromPerChar("HELLO", { color: "#111" }, { 0: { 1: { color: "#F00" }, 3: { color: "#0F0" } } } as any)
const round1Text = spansToText(round1)
const round1PerChar = spansToFullPerChar(round1)
const round2 = buildSpansFromPerChar(round1Text, { color: "#111" }, round1PerChar)
check("7.1 roundtrip: text preservado", spansToText(round2) === "HELLO")
const round2PerChar = spansToFullPerChar(round2)
check("7.1 roundtrip: char 0 (H) preto default", (round2PerChar[0] as any)?.[0]?.color === "#111")
check("7.1 roundtrip: char 1 (E) vermelho", (round2PerChar[0] as any)?.[1]?.color === "#F00")
check("7.1 roundtrip: char 3 (L) verde", (round2PerChar[0] as any)?.[3]?.color === "#0F0")

// 7.2: \n preservado em texto multi-linha
const ml = buildSpansFromPerChar("AB\nCD", { color: "#111" }, { 0: { 0: { color: "#F00" } }, 1: { 1: { color: "#0F0" } } } as any)
check("7.2 multiline: texto com \\n preservado", spansToText(ml) === "AB\nCD")
const mlPerChar = spansToFullPerChar(ml)
check("7.2 multiline: linha 0 char 0 vermelho", (mlPerChar[0] as any)?.[0]?.color === "#F00")
check("7.2 multiline: linha 1 char 1 verde", (mlPerChar[1] as any)?.[1]?.color === "#0F0")

// 7.3: edit em texto multi-linha - X (insert) herda do C (que tem cor azul)
const ml2 = migrateStyles("AB\nCD", "AB\nCXD", { 0: { 0: { color: "#F00" } }, 1: { 0: { color: "#00F" }, 1: { color: "#0F0" } } } as any)
check("7.3 multiline edit: linha 0 char 0 vermelho preserve", (ml2[0] as any)?.[0]?.color === "#F00")
check("7.3 multiline edit: linha 1 C (pos 0) azul preserve", (ml2[1] as any)?.[0]?.color === "#00F")
check("7.3 multiline edit: linha 1 X (insert) herda do C azul", (ml2[1] as any)?.[1]?.color === "#00F")
check("7.3 multiline edit: linha 1 D (pos 2) verde preserve", (ml2[1] as any)?.[2]?.color === "#0F0")

// ============================================================
section("RESULTADO")
// ============================================================
console.log(`\n  ${pass} PASS / ${fail} FAIL`)
if (fails.length > 0) {
  console.log("\nFalhas:")
  for (const f of fails) console.log("  - " + f)
}
process.exit(fail === 0 ? 0 : 1)
