// Teste: simula edicao de 1 char em asset com piece tendo overrides per-char e global.
// Verifica se overrides sao preservados (fill, font, styles per-char).

import { migrateStyles } from "../lib/migrateStyles"

// Simula um layer tipico apos user mudar:
// - Global fill amarelo
// - Per-char: char 0 verde, char 2 vermelho
const oldOverrides: any = {
  fill: "#FFCD00",
  fontFamily: "Inter",
  fontWeight: 700,
  fontSize: 80,
  styles: {
    0: {
      0: { fill: "#00FF00" },
      2: { fill: "#FF0000" },
    }
  }
}

const oldText = "GIO"
const newText = "GIA"

// Replica migration logica do route.ts:
const newOverrides = { ...oldOverrides }
let layerChanged = false
if (oldOverrides.styles && Object.keys(oldOverrides.styles).length > 0) {
  newOverrides.styles = migrateStyles(oldText, newText, oldOverrides.styles)
  layerChanged = true
}
// (skip migrateOverrideText pq nao tem \n)

console.log("=== Test: edit 1 char (GIO → GIA) ===")
console.log("OLD overrides:", JSON.stringify(oldOverrides, null, 2))
console.log("NEW overrides:", JSON.stringify(newOverrides, null, 2))
console.log()
console.log("Preservado:")
console.log("  fill:", newOverrides.fill === oldOverrides.fill ? "OK" : "FAIL")
console.log("  fontFamily:", newOverrides.fontFamily === oldOverrides.fontFamily ? "OK" : "FAIL")
console.log("  fontWeight:", newOverrides.fontWeight === oldOverrides.fontWeight ? "OK" : "FAIL")
console.log("  fontSize:", newOverrides.fontSize === oldOverrides.fontSize ? "OK" : "FAIL")
console.log("  styles[0][0] (G verde):", JSON.stringify(newOverrides.styles?.[0]?.[0]))
console.log("  styles[0][2] (A herda do O):", JSON.stringify(newOverrides.styles?.[0]?.[2]))

console.log("\n=== Test 2: edit middle char (GIO → GAO) ===")
const newText2 = "GAO"
const ms2 = migrateStyles(oldText, newText2, oldOverrides.styles as any)
console.log("styles:", JSON.stringify(ms2, null, 2))
console.log("  G mantem verde:", JSON.stringify(ms2?.[0]?.[0]))
console.log("  A (nova posicao 1): undefined ou inherits", JSON.stringify(ms2?.[0]?.[1]))
console.log("  O mantem vermelho:", JSON.stringify(ms2?.[0]?.[2]))

console.log("\n=== Test 3: inserir char (GIO → GIOA) ===")
const newText3 = "GIOA"
const ms3 = migrateStyles(oldText, newText3, oldOverrides.styles as any)
console.log("styles:", JSON.stringify(ms3, null, 2))
console.log("  Char inserido (3) herda do anterior:", JSON.stringify(ms3?.[0]?.[3]))

console.log("\n=== Test 4: replace tudo (GIO → ABC) ===")
const newText4 = "ABC"
const ms4 = migrateStyles(oldText, newText4, oldOverrides.styles as any)
console.log("styles:", JSON.stringify(ms4, null, 2))
console.log("  Diff replace cada pos: herda do antigo na mesma pos")
