/**
 * shape-paths.test.ts — valida que buildShapePath (lib/shapePaths.ts) gera
 * paths corretos pros 3 kinds parametricos.
 */
import { buildShapePath } from "../../shapePaths"

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); pass++ }
  else { console.log(`  ✗ ${name} ${detail}`); fail++ }
}

console.log("Step 1: rectangle paths")
const rect = buildShapePath("rectangle", 400, 300)
check("rect starts at origin", rect.startsWith("M 0 0"))
check("rect ends with Z", rect.trim().endsWith("Z"))
check("rect contains W,0", rect.includes("L 400 0"))
check("rect contains W,H", rect.includes("L 400 300"))
check("rect contains 0,H", rect.includes("L 0 300"))

console.log("\nStep 2: roundedRect paths")
const round = buildShapePath("roundedRect", 400, 300, 20)
check("roundedRect tem 4 curvas C", (round.match(/\bC /g) ?? []).length === 4)
check("roundedRect comeca em (r, 0)", round.startsWith("M 20 0"))
check("roundedRect tem Z", round.trim().endsWith("Z"))

console.log("\nStep 3: roundedRect com r=0 vira rectangle")
const r0 = buildShapePath("roundedRect", 400, 300, 0)
check("r=0 sem curvas C", !r0.includes("C "))
check("r=0 mesma forma do rectangle", r0 === buildShapePath("rectangle", 400, 300))

console.log("\nStep 4: roundedRect clamp em r > min/2")
const rClamp = buildShapePath("roundedRect", 400, 300, 500) // r=500 mas max=150
const rExpected = buildShapePath("roundedRect", 400, 300, 150)
check("r=500 clampa pra 150 (min(W,H)/2)", rClamp === rExpected)

console.log("\nStep 5: ellipse path")
const ell = buildShapePath("ellipse", 400, 300)
check("ellipse tem 4 curvas C (4 quarter arcs)", (ell.match(/\bC /g) ?? []).length === 4)
check("ellipse comeca no topo (cx, 0)", ell.startsWith("M 200 0"))

console.log("\nStep 6: scaled dimensions")
const scaled = buildShapePath("roundedRect", 800, 600, 20)
check("path 2x maior tem W=800 nas coords", scaled.includes("L 780 0"))
check("path 2x maior tem H=600 nas coords", scaled.includes("L 800 580"))

console.log(`\n${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
console.log("✓ SHAPE PATHS OK")
