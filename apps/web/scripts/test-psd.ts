/**
 * test-psd.ts — runner sequencial dos 4 testes do pipeline PSD.
 *
 * Uso:
 *   npm run psd:test -- "<caminho-do-psd>"
 *   ou: npx tsx scripts/test-psd.ts "<caminho-do-psd>"
 *
 * Roda em ordem (para no primeiro erro):
 *   1. reader.test       — le PSD, valida warnings + estrutura
 *   2. roundtrip.test    — read → write → re-read estrutural
 *   3. fromEditor.test   — fixture sintetica (per-char styles + bg)
 *   4. e2e.test          — pipeline COMPLETO real (PSD → editor → PSD)
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import fs from "node:fs"

// Junta argv[2..] em 1 string e normaliza whitespace — terminal multi-linha
// (paste com wrap) parte o path em varios args ou poe \n no meio. Se o path
// "cru" nao existir, tenta com whitespace colapsado (\s+ → " ").
function resolvePsdPath(): string | null {
  const raw = process.argv.slice(2).join(" ").trim()
  if (!raw) return null
  if (fs.existsSync(raw)) return raw
  const collapsed = raw.replace(/\s+/g, " ")
  if (fs.existsSync(collapsed)) return collapsed
  return null
}

const PSD = resolvePsdPath()
if (!PSD) {
  const tried = process.argv.slice(2).join(" ").trim()
  console.error("Uso: npm run psd:test -- \"<caminho-do-psd>\"")
  if (tried) {
    console.error(`Arquivo nao existe: ${tried}`)
    console.error("Dica: se o nome tem espaco, arraste o arquivo pro terminal em vez de digitar.")
  }
  process.exit(1)
}

const APPS_WEB = path.resolve(__dirname, "..")
const T = (p: string) => path.join(APPS_WEB, "lib/psd/__test__", p)

const suites: { name: string; file: string; args: string[] }[] = [
  { name: "1/4 reader.test      ", file: T("reader.test.ts"), args: [PSD] },
  { name: "2/4 roundtrip.test   ", file: T("roundtrip.test.ts"), args: [PSD] },
  { name: "3/4 fromEditor.test  ", file: T("fromEditor.test.ts"), args: [] },
  { name: "4/4 e2e.test         ", file: T("e2e.test.ts"), args: [PSD] },
]

const BAR = "─".repeat(60)
let passed = 0
const failed: string[] = []
const t0 = Date.now()

for (const s of suites) {
  if (!fs.existsSync(s.file)) {
    console.error(`${s.name} ✗ arquivo nao existe: ${s.file}`)
    failed.push(s.name)
    continue
  }
  console.log(`\n${BAR}\n${s.name}  →  ${path.basename(s.file)}\n${BAR}`)
  const r = spawnSync("npx", ["tsx", s.file, ...s.args], { stdio: "inherit", cwd: APPS_WEB })
  if (r.status === 0) {
    passed++
  } else {
    failed.push(s.name)
    console.error(`\n${s.name} ✗ exit code ${r.status}`)
    break // para no primeiro erro
  }
}

const dur = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\n${BAR}`)
console.log(`RESULTADO: ${passed}/${suites.length} suites passaram em ${dur}s`)
if (failed.length > 0) {
  console.log(`Falhas: ${failed.join(", ")}`)
  process.exit(1)
}
console.log("✓ TODOS OS TESTES PASSARAM")
