/**
 * text-italic-percharrun.test.ts — valida que buildStyleRuns emite fauxItalic
 * per-run quando styles[lineIdx][colIdx].fontStyle === 'italic'.
 *
 * Antes do fix, so o defaultStyle do textbox tinha fauxItalic; chars marcados
 * individualmente perdiam o estilo no PSD. Reader ja le `fauxItalic` per-run
 * em mapCharStylePartial — agora export tambem emite.
 *
 * Uso: npx tsx lib/psd/__test__/text-italic-percharrun.test.ts
 *
 * NOTA: testa direto a logica de buildStyleRuns importando do exportPiece.
 * exportPiece tem 'use client' header — usamos eval do source pra extrair so
 * a funcao pura (sem touch nos imports browser-only).
 */

import * as fs from "node:fs"
import * as path from "node:path"

// Le o arquivo, extrai a funcao buildStyleRuns + helpers necessarios
const src = fs.readFileSync(
  path.resolve(__dirname, "../../exportPiece.ts"),
  "utf8"
)

// Parser ingenuo: encontra `function buildStyleRuns` e captura o bloco ate o
// fechamento de `}`. Como o codigo eh bem-formado, contamos braces.
function extractFunction(src: string, name: string): string {
  const re = new RegExp(`function\\s+${name}\\s*\\(`)
  const m = re.exec(src)
  if (!m) throw new Error(`function ${name} nao encontrada`)
  let i = src.indexOf("{", m.index)
  if (i < 0) throw new Error(`{ ausente apos ${name}`)
  let depth = 0
  const start = m.index
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1) }
  }
  throw new Error("nao fechou")
}

const buildStyleRunsSrc = extractFunction(src, "buildStyleRuns")
  // remove TS type annotations grosseiras pra eval rodar como JS
  .replace(/: any\[\]/g, "")
  .replace(/: number\s*=\s*1/g, " = 1")
  .replace(/: (string|number|any|boolean)(\[\])?/g, "")
  .replace(/<[A-Za-z0-9_,\s]+>/g, "")
  // strip "as Tipo" casts (ex: textbox as any)
  .replace(/\bas\s+\w+/g, "")

// Stubs minimos pra eval da funcao
const toPSFont = (family: string, _bold: boolean) => ({ name: family, fauxBold: false })
const parseColor = (c: string) => c
const fabricCharSpacingToPsTracking = (cs: number) => cs * 1000
// silence ts unused var warnings — usados implicitamente via eval closure
void toPSFont; void parseColor; void fabricCharSpacingToPsTracking

const buildStyleRuns = eval(`(${buildStyleRunsSrc})`) as (textbox: any, fullText: string, scale?: number) => any[]

// Testbed: textbox com 3 chars normais + 4 chars italicos + 3 normais.
const textbox = {
  text: "AAAITALNORM",
  fontSize: 48,
  fontFamily: "Helvetica",
  fontWeight: 400,
  fontStyle: "normal",
  fill: "#000000",
  styles: {
    0: {
      // chars 3-6 (ITAL) marcados italicos
      3: { fontStyle: "italic" },
      4: { fontStyle: "italic" },
      5: { fontStyle: "italic" },
      6: { fontStyle: "italic" },
    },
  },
  charSpacing: 0,
  lineHeight: 1,
}

console.log("Step 1: buildStyleRuns(textbox) com 4 chars italicos no meio")
const runs = buildStyleRuns(textbox, textbox.text)
console.log(`  total runs: ${runs.length}`)
for (const r of runs) {
  console.log(`  len=${r.length} italic=${r.style.fauxItalic ?? false}`)
}

// Esperado: 3 runs — [normal x3, italic x4, normal x4]
if (runs.length < 3) {
  console.error(`  ✗ esperava >=3 runs, got ${runs.length}`)
  process.exit(1)
}

const hasItalicRun = runs.some(r => r.style.fauxItalic === true)
if (!hasItalicRun) {
  console.error("  ✗ nenhum run com fauxItalic=true — italic per-char perdido no export")
  process.exit(1)
}
console.log(`  ✓ pelo menos um run com fauxItalic=true`)

const hasNormalRun = runs.some(r => !r.style.fauxItalic)
if (!hasNormalRun) {
  console.error("  ✗ nenhum run normal — todos saiariam italicos (regressao)")
  process.exit(1)
}
console.log(`  ✓ pelo menos um run normal (chars nao-italic preservados)`)

console.log("\n✓ PER-CHAR ITALIC OK — fauxItalic emitido per-run")
