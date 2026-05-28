// Test CORE 1: asset.content canonico preserva per-char ao editar via /assets.
//
// Cenario do bug 2026-05-28: user pintou G verde + I preto + O vermelho na
// matriz. Editou via /assets pra GXO. Resultado bug: todas letras mesma cor.
// Esperado: G verde, X preto (replaceou I), O vermelho.

import { spansToFullPerChar, buildSpansFromPerChar, spansDefaultStyle, spansToText } from "../lib/assetSpans"
import { migrateStyles } from "../lib/migrateStyles"

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail?: any) {
  if (cond) { pass++; console.log("  OK", name) }
  else { fail++; console.log("  FAIL", name, detail ? "→ " + JSON.stringify(detail) : "") }
}

// ============================================================
console.log("\n=== STEP 1: Matriz editor cria GIO com per-char ===")
// updateAssetContent (versao CORE 1) preserva per-char nos spans.
// Simula: textbox com obj.fill=#111111, obj.styles={0:{0:verde, 2:vermelho}}.
const defaultStyle = { color: "#111111", fontSize: 80, fontFamily: "Arial", fontWeight: "normal" }
const perChar1 = {
  0: {
    0: { color: "#00FF00" },  // G verde
    2: { color: "#FF0000" },  // O vermelho
  },
}
const matrixSpans = buildSpansFromPerChar("GIO", defaultStyle, perChar1 as any)
console.log("  matrixSpans:", JSON.stringify(matrixSpans))
check("step1: tem sentinela vazio no inicio", matrixSpans[0].text === "" && matrixSpans[0].style.color === "#111111")
check("step1: spansToText reconstroi 'GIO'", spansToText(matrixSpans) === "GIO")
check("step1: defaultStyle preservado", spansDefaultStyle(matrixSpans).color === "#111111")
const extracted1 = spansToFullPerChar(matrixSpans)
check("step1: per-char G verde extraido", (extracted1[0] as any)?.[0]?.color === "#00FF00")
check("step1: per-char I preto extraido", (extracted1[0] as any)?.[1]?.color === "#111111")
check("step1: per-char O vermelho extraido", (extracted1[0] as any)?.[2]?.color === "#FF0000")

// ============================================================
console.log("\n=== STEP 2: Server migra GIO -> GXO via /assets PUT ===")
// Page /assets envia content qualquer (pode ser uniforme). Server canonifica.
const newSpansFromClient = [{ text: "GXO", style: defaultStyle }]  // simula client rebuildSpans
const oldText = spansToText(matrixSpans)
const newText = spansToText(newSpansFromClient)
check("step2: oldText=GIO", oldText === "GIO")
check("step2: newText=GXO", newText === "GXO")
const oldPerCharFull = spansToFullPerChar(matrixSpans)
const migrated = migrateStyles(oldText, newText, oldPerCharFull)
console.log("  migrated:", JSON.stringify(migrated))
check("step2: G verde preservado (equal)", (migrated[0] as any)?.[0]?.color === "#00FF00")
check("step2: X preto herdado (replace I)", (migrated[0] as any)?.[1]?.color === "#111111")
check("step2: O vermelho preservado (equal)", (migrated[0] as any)?.[2]?.color === "#FF0000")
const newDefault = spansDefaultStyle(newSpansFromClient)
const canonicalAfterEdit = buildSpansFromPerChar(newText, newDefault, migrated)
console.log("  canonicalAfterEdit:", JSON.stringify(canonicalAfterEdit))
check("step2: spans canonicos tem sentinela", canonicalAfterEdit[0].text === "" && canonicalAfterEdit[0].style.color === "#111111")
check("step2: texto final = GXO", spansToText(canonicalAfterEdit) === "GXO")
const extractedAfterEdit = spansToFullPerChar(canonicalAfterEdit)
check("step2: G verde sobreviveu", (extractedAfterEdit[0] as any)?.[0]?.color === "#00FF00")
check("step2: X preto sobreviveu", (extractedAfterEdit[0] as any)?.[1]?.color === "#111111")
check("step2: O vermelho sobreviveu", (extractedAfterEdit[0] as any)?.[2]?.color === "#FF0000")

// ============================================================
console.log("\n=== STEP 3: Re-load do editor le content canonico ===")
// spansToTextboxData (no editor) usa spans[0].style como defaultStyle. Com
// sentinela, isso sempre eh o default correto.
const reloaded = canonicalAfterEdit
const def = reloaded[0].style ?? {}
check("step3: defaultStyle no reload = preto", def.color === "#111111")
// Constroi styles map (compativel com Fabric)
const styles: any = {}
let line = 0, col = 0
for (const span of reloaded) {
  const t = span.text ?? ""
  if (t.length === 0) continue
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === "\n") { line++; col = 0; continue }
    const sKey = JSON.stringify(span.style)
    const dKey = JSON.stringify(def)
    if (sKey !== dKey) {
      if (!styles[line]) styles[line] = {}
      styles[line][col] = span.style
    }
    col++
  }
}
console.log("  fabric styles:", JSON.stringify(styles))
check("step3: char 0 (G) tem entry verde", styles[0]?.[0]?.color === "#00FF00")
check("step3: char 1 (X) SEM entry (igual default)", styles[0]?.[1] === undefined)
check("step3: char 2 (O) tem entry vermelho", styles[0]?.[2]?.color === "#FF0000")

// ============================================================
console.log("\n=== STEP 4: Edge - editar para INSERIR caracter (GIO -> GXIO) ===")
const insertText = "GXIO"
const migratedInsert = migrateStyles("GIO", insertText, oldPerCharFull)
console.log("  insert migrated:", JSON.stringify(migratedInsert))
check("step4: G verde mantem (pos 0)", (migratedInsert[0] as any)?.[0]?.color === "#00FF00")
// X inserido na pos 1 — herda do anterior (G verde)
check("step4: X inserido herda do anterior (G verde)", (migratedInsert[0] as any)?.[1]?.color === "#00FF00")
check("step4: I (pos 2) mantem preto", (migratedInsert[0] as any)?.[2]?.color === "#111111")
check("step4: O (pos 3) mantem vermelho", (migratedInsert[0] as any)?.[3]?.color === "#FF0000")

// ============================================================
console.log(`\n=== RESULT: ${pass} PASS, ${fail} FAIL ===`)
process.exit(fail === 0 ? 0 : 1)
