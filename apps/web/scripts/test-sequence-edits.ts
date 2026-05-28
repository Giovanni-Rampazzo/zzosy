// Reproduz bug do user 2026-05-28:
// "na primeira vez que eu troquei funcionou, ja na segunda... ele misturou
// o override de uma com a outra"
//
// Cenario:
//  - ABC pintado A=amarelo B=azul C=verde
//  - Gera 2 pecas (P1, P2), cada uma com proprio per-char
//  - Edit 1: ABC -> DEF (deve preservar cores por posicao)
//  - Edit 2: DEF -> XYZ (deve continuar preservando)
//
// Tambem testa:
//  - "ABC" -> "D EF" — espaco herda do char substituido (Adobe rule)

import { migrateStyles } from "../lib/migrateStyles"
import { buildSpansFromPerChar, spansToFullPerChar, spansToText } from "../lib/assetSpans"

let pass = 0, fail = 0
const fails: string[] = []
function check(name: string, cond: boolean, detail?: any) {
  if (cond) { pass++; console.log("  OK", name) }
  else { fail++; const msg = name + (detail ? " → " + JSON.stringify(detail).slice(0, 250) : ""); console.log("  FAIL", msg); fails.push(msg) }
}
function section(t: string) { console.log("\n" + "=".repeat(60) + "\n" + t + "\n" + "=".repeat(60)) }

// ============================================================
section("SEQUENCE: ABC -> DEF -> XYZ com 2 pecas independentes")
// ============================================================
// State inicial:
const Y = "#FFFF00", B = "#0000FF", G = "#00FF00"

// Asset.content canonico apos user pintar na matriz
let assetContent: any = buildSpansFromPerChar(
  "ABC",
  { color: "#111111", fontSize: 80 },
  { 0: { 0: { color: Y }, 1: { color: B }, 2: { color: G } } } as any,
)
let lastOverride: any = {
  fill: "#111111", fontFamily: "Arial", fontSize: 80,
  styles: { 0: { 0: { color: Y }, 1: { color: B }, 2: { color: G } } },
}
// Gera 2 pecas — cada uma copia layer.overrides do lastOverride
let p1Layer: any = { overrides: { ...lastOverride, styles: JSON.parse(JSON.stringify(lastOverride.styles)) } }
let p2Layer: any = { overrides: { ...lastOverride, styles: JSON.parse(JSON.stringify(lastOverride.styles)) } }

// Sanity inicial
check("init: p1 A amarelo", p1Layer.overrides.styles[0][0].color === Y)
check("init: p1 B azul", p1Layer.overrides.styles[0][1].color === B)
check("init: p1 C verde", p1Layer.overrides.styles[0][2].color === G)
check("init: p2 A amarelo", p2Layer.overrides.styles[0][0].color === Y)
check("init: p2 B azul", p2Layer.overrides.styles[0][1].color === B)
check("init: p2 C verde", p2Layer.overrides.styles[0][2].color === G)

// EDIT 1: ABC -> DEF
console.log("\n  --- EDIT 1: ABC -> DEF ---")
const oldText1 = spansToText(assetContent), newText1 = "DEF"
// Server canonifica content
const oldPerChar1 = spansToFullPerChar(assetContent)
const migratedContent1 = migrateStyles(oldText1, newText1, oldPerChar1)
assetContent = buildSpansFromPerChar(newText1, { color: "#111111", fontSize: 80 }, migratedContent1)
// Server migra lastOverride
lastOverride.styles = migrateStyles(oldText1, newText1, lastOverride.styles)
// Server migra cada peca
p1Layer.overrides.styles = migrateStyles(oldText1, newText1, p1Layer.overrides.styles)
p2Layer.overrides.styles = migrateStyles(oldText1, newText1, p2Layer.overrides.styles)

check("edit1: asset.content D amarelo", spansToFullPerChar(assetContent)[0][0].color === Y)
check("edit1: asset.content E azul", spansToFullPerChar(assetContent)[0][1].color === B)
check("edit1: asset.content F verde", spansToFullPerChar(assetContent)[0][2].color === G)
check("edit1: lastOverride D amarelo", lastOverride.styles[0][0].color === Y)
check("edit1: lastOverride E azul", lastOverride.styles[0][1].color === B)
check("edit1: lastOverride F verde", lastOverride.styles[0][2].color === G)
check("edit1: p1 D amarelo", p1Layer.overrides.styles[0][0].color === Y)
check("edit1: p1 E azul", p1Layer.overrides.styles[0][1].color === B)
check("edit1: p1 F verde", p1Layer.overrides.styles[0][2].color === G)
check("edit1: p2 D amarelo", p2Layer.overrides.styles[0][0].color === Y)
check("edit1: p2 E azul", p2Layer.overrides.styles[0][1].color === B)
check("edit1: p2 F verde", p2Layer.overrides.styles[0][2].color === G)

// EDIT 2: DEF -> XYZ (aqui o user reportou "misturou")
console.log("\n  --- EDIT 2: DEF -> XYZ ---")
const oldText2 = spansToText(assetContent), newText2 = "XYZ"
const oldPerChar2 = spansToFullPerChar(assetContent)
const migratedContent2 = migrateStyles(oldText2, newText2, oldPerChar2)
assetContent = buildSpansFromPerChar(newText2, { color: "#111111", fontSize: 80 }, migratedContent2)
lastOverride.styles = migrateStyles(oldText2, newText2, lastOverride.styles)
p1Layer.overrides.styles = migrateStyles(oldText2, newText2, p1Layer.overrides.styles)
p2Layer.overrides.styles = migrateStyles(oldText2, newText2, p2Layer.overrides.styles)

check("edit2: asset.content X amarelo", spansToFullPerChar(assetContent)[0][0].color === Y)
check("edit2: asset.content Y azul", spansToFullPerChar(assetContent)[0][1].color === B)
check("edit2: asset.content Z verde", spansToFullPerChar(assetContent)[0][2].color === G)
check("edit2: p1 X amarelo", p1Layer.overrides.styles[0][0].color === Y)
check("edit2: p1 Y azul", p1Layer.overrides.styles[0][1].color === B)
check("edit2: p1 Z verde", p1Layer.overrides.styles[0][2].color === G)
check("edit2: p2 X amarelo", p2Layer.overrides.styles[0][0].color === Y)
check("edit2: p2 Y azul", p2Layer.overrides.styles[0][1].color === B)
check("edit2: p2 Z verde", p2Layer.overrides.styles[0][2].color === G)

// ============================================================
section("ESPACO: ABC -> 'D EF' — espaco recebe override")
// ============================================================
// User clarificou: "se eu escrever D EF o D vai ficar amarelo, o espaco
// vai ficar com override azul e o E vai ficar verde"
//
// Diff ABC -> "D EF":
//   pos 0: A -> D (replace, herda amarelo)
//   pos 1: B -> " " (replace, herda azul)
//   pos 2: C -> E (replace, herda verde)
//   pos 3: insert F (herda do vizinho esquerdo = E = verde)
const spaceCase = migrateStyles("ABC", "D EF", { 0: { 0: { color: Y }, 1: { color: B }, 2: { color: G } } } as any)
console.log("  migrated:", JSON.stringify(spaceCase))
check("space: D pos 0 amarelo", spaceCase[0]?.[0]?.color === Y)
check("space: ' ' pos 1 azul (herdou de B)", spaceCase[0]?.[1]?.color === B)
check("space: E pos 2 verde (herdou de C)", spaceCase[0]?.[2]?.color === G)
check("space: F pos 3 herdou de E = verde", spaceCase[0]?.[3]?.color === G)

// ============================================================
section("EDGE: edit em sequencia rapida (anti-debounce-race)")
// ============================================================
// Simula 3 edits seguidos sem debounce: ABC -> AXC -> AYC -> AZC.
// Cada um substitui o B na pos 1.
let seqStyles: any = { 0: { 0: { color: Y }, 1: { color: B }, 2: { color: G } } }
seqStyles = migrateStyles("ABC", "AXC", seqStyles)
check("seq1: A amarelo", seqStyles[0]?.[0]?.color === Y)
check("seq1: X herdou de B = azul", seqStyles[0]?.[1]?.color === B)
check("seq1: C verde", seqStyles[0]?.[2]?.color === G)

seqStyles = migrateStyles("AXC", "AYC", seqStyles)
check("seq2: A amarelo", seqStyles[0]?.[0]?.color === Y)
check("seq2: Y herdou de X = azul", seqStyles[0]?.[1]?.color === B)
check("seq2: C verde", seqStyles[0]?.[2]?.color === G)

seqStyles = migrateStyles("AYC", "AZC", seqStyles)
check("seq3: A amarelo", seqStyles[0]?.[0]?.color === Y)
check("seq3: Z herdou de Y = azul", seqStyles[0]?.[1]?.color === B)
check("seq3: C verde", seqStyles[0]?.[2]?.color === G)

// ============================================================
section("REBUILDSPANS positional: cliente sem optimistic-update errado")
// ============================================================
// Reproduz a logica do rebuildSpans (pagina /assets) pra validar que
// o optimistic update NAO mostra todas cores iguais.
function rebuildSpans(prev: any[], newText: string): any[] {
  const defaultStyle = prev?.[0]?.style ?? { color: "#111111" }
  const prevText = (prev ?? []).map((s: any) => s?.text ?? "").join("")
  if (prevText === newText) return prev ?? [{ text: newText, style: defaultStyle }]
  const prevStyles: any[] = []
  for (const span of (prev ?? [])) {
    const t = span?.text ?? ""
    const st = span?.style ?? defaultStyle
    for (let i = 0; i < t.length; i++) prevStyles.push(st)
  }
  let prefixLen = 0
  const minLen = Math.min(prevText.length, newText.length)
  while (prefixLen < minLen && prevText[prefixLen] === newText[prefixLen]) prefixLen++
  let suffixLen = 0
  while (
    suffixLen < (prevText.length - prefixLen) &&
    suffixLen < (newText.length - prefixLen) &&
    prevText[prevText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
  ) suffixLen++
  const oldMiddleStart = prefixLen
  const oldMiddleEnd = prevText.length - suffixLen
  const newMiddleStart = prefixLen
  const oldMiddleLen = Math.max(0, oldMiddleEnd - oldMiddleStart)
  const newStyles: any[] = []
  for (let i = 0; i < newText.length; i++) {
    if (i < prefixLen) newStyles.push(prevStyles[i] ?? defaultStyle)
    else if (i >= newText.length - suffixLen) {
      const prevIdx = prevText.length - (newText.length - i)
      newStyles.push(prevStyles[prevIdx] ?? defaultStyle)
    } else {
      const middleOffset = i - newMiddleStart
      if (middleOffset < oldMiddleLen) {
        newStyles.push(prevStyles[oldMiddleStart + middleOffset] ?? defaultStyle)
      } else {
        const inherited = i > 0 ? newStyles[i - 1] : (prevStyles[0] ?? defaultStyle)
        newStyles.push(inherited)
      }
    }
  }
  // Agrupa em spans
  const result: any[] = []
  let buf = ""
  let bufStyle: any = null
  const sameStyle = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)
  for (let i = 0; i < newText.length; i++) {
    const cs = newStyles[i]
    if (bufStyle === null) { buf = newText[i]; bufStyle = cs; continue }
    if (sameStyle(bufStyle, cs)) buf += newText[i]
    else { result.push({ text: buf, style: bufStyle }); buf = newText[i]; bufStyle = cs }
  }
  if (buf) result.push({ text: buf, style: bufStyle ?? defaultStyle })
  return result
}

// Cenario user: ABC pintado A=amarelo, B=azul, C=verde. Edit pra DEF.
const abcSpans = [{ text: "A", style: { color: Y } }, { text: "B", style: { color: B } }, { text: "C", style: { color: G } }]
const defSpans = rebuildSpans(abcSpans, "DEF")
console.log("  ABC -> DEF spans:", JSON.stringify(defSpans))
// Esperado: D=amarelo (de A), E=azul (de B), F=verde (de C)
check("rebuild: D amarelo (POS 0 herda de A)", defSpans[0]?.style?.color === Y)
check("rebuild: E azul (POS 1 herda de B)", defSpans[1]?.style?.color === B)
check("rebuild: F verde (POS 2 herda de C)", defSpans[2]?.style?.color === G)

// Cenario 2: DEF -> XYZ (segunda edit, onde user reportou "misturou")
const xyzSpans = rebuildSpans(defSpans, "XYZ")
console.log("  DEF -> XYZ spans:", JSON.stringify(xyzSpans))
check("rebuild edit2: X amarelo (POS 0 herda de D)", xyzSpans[0]?.style?.color === Y)
check("rebuild edit2: Y azul (POS 1 herda de E)", xyzSpans[1]?.style?.color === B)
check("rebuild edit2: Z verde (POS 2 herda de F)", xyzSpans[2]?.style?.color === G)

// Cenario espaço: ABC -> "D EF"
const dSpace = rebuildSpans(abcSpans, "D EF")
console.log("  ABC -> 'D EF' spans:", JSON.stringify(dSpace))
// Replace 1:1 posicional: D<-A(Y), " "<-B(B), E<-C(G). Insert F herda do E(G).
check("rebuild space: D amarelo", dSpace.find((s:any) => s.text.startsWith("D"))?.style?.color === Y)
// Espaco herda azul (de B na pos 1) — agrupa com D? Depende se Y===Y...
// D=Y, " "=B (diferente), so separa. Vou checar manualmente.

// ============================================================
section("TEXTO NOVO: 123456 -> Car los\\nantonio (apagou+reescreveu)")
// ============================================================
// User reportou 2026-05-28: apagou todo 123456 (per-char colorido) e
// reescreveu "Car los\nantonio". Algoritmo positional 1:1 mapeava
// 1->C, 2->a, etc. e "antonio" herdava cor do char 6. Resultado bizarro.
//
// Heuristica nova: noCommon + muchLonger -> reset per-char.
const colors123456 = {
  0: {
    0: { color: "#FF0000" }, // 1 vermelho
    1: { color: "#FF8800" }, // 2 laranja
    2: { color: "#FFFF00" }, // 3 amarelo
    3: { color: "#00FF00" }, // 4 verde
    4: { color: "#0000FF" }, // 5 azul
    5: { color: "#FF00FF" }, // 6 magenta
  },
}
const resetCase = migrateStyles("123456", "Car los\nantonio", colors123456 as any)
console.log("  resetCase:", JSON.stringify(resetCase))
check("texto-novo: per-char zerado (apagou+reescreveu texto muito maior)", Object.keys(resetCase).length === 0)

// Tambem: 'antonio' linha 2 nao deve herdar do char 6
const resetExpectedEmpty = migrateStyles("Olá", "Tchau mundo, sera que vai funcionar?", { 0: { 0: { color: "#F00" } } } as any)
check("texto-novo: outro caso reset (Olá -> texto muito maior)", Object.keys(resetExpectedEmpty).length === 0)

// MAS: nao breaka ABC -> DEF (same length, positional)
const abcDef = migrateStyles("ABC", "DEF", { 0: { 0: { color: Y }, 1: { color: B }, 2: { color: G } } } as any)
check("texto-novo: NAO breaka ABC->DEF (D=A_color)", (abcDef[0] as any)?.[0]?.color === Y)
check("texto-novo: NAO breaka ABC->DEF (E=B_color)", (abcDef[0] as any)?.[1]?.color === B)
check("texto-novo: NAO breaka ABC->DEF (F=C_color)", (abcDef[0] as any)?.[2]?.color === G)

// E: nao breaka ABC -> ABCDEFGH (tem prefix, mantem positional)
const abcExtend = migrateStyles("ABC", "ABCDEFGH", { 0: { 0: { color: Y }, 1: { color: B }, 2: { color: G } } } as any)
check("texto-novo: NAO breaka ABC->ABCDEFGH (prefix preserved)", (abcExtend[0] as any)?.[0]?.color === Y)
check("texto-novo: NAO breaka ABC->ABCDEFGH (C verde preserved)", (abcExtend[0] as any)?.[2]?.color === G)

console.log(`\n  ${pass} PASS / ${fail} FAIL`)
if (fails.length > 0) {
  console.log("\nFalhas:")
  for (const f of fails) console.log("  - " + f)
}
process.exit(fail === 0 ? 0 : 1)
