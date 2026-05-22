/**
 * group-passthrough.test.ts — valida que folders com blendMode "pass through"
 * sobrevivem no round-trip V2 (read → write).
 *
 * Auditoria reportou: "Group passThrough mode — read but never written".
 * Esse teste verifica se o caminho atual ja preserva (via common.blendMode).
 *
 * Uso: npx tsx lib/psd/__test__/group-passthrough.test.ts
 */
import { readPsd, writePsd, initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { readPsdDocument } from "../reader"
import { writePsdDocument } from "../writer"

initializeCanvas(createCanvas as any)

console.log("Step 1: write PSD com grupo blendMode='pass through' via ag-psd raw")
const initial: any = {
  width: 400,
  height: 300,
  children: [
    {
      name: "PassThroughFolder",
      blendMode: "pass through",
      opened: true,
      children: [
        {
          name: "Inner",
          blendMode: "multiply",
          left: 0, top: 0, right: 100, bottom: 100,
          canvas: (() => {
            const c = createCanvas(100, 100)
            const ctx = c.getContext("2d")!
            ctx.fillStyle = "red"
            ctx.fillRect(0, 0, 100, 100)
            return c as any
          })(),
        },
      ],
    },
  ],
}

const bytes0 = writePsd(initial, { generateThumbnail: false })
console.log(`  ✓ ${(bytes0.byteLength / 1024).toFixed(1)}KB`)

console.log("\nStep 2: readPsdDocument captura passThrough=true no PsdGroupLayer")
const r = readPsdDocument(bytes0, { includeImageData: false, includeComposite: false })
const group = r.document.layers[0] as any
console.log(`  group.type: ${group.type}, passThrough: ${group.passThrough}, blendMode: ${group.blendMode}`)
if (group.type !== "group") {
  console.error(`  ✗ esperava type='group', got '${group.type}'`)
  process.exit(1)
}
if (group.passThrough !== true) {
  console.error(`  ✗ passThrough deveria ser true, got ${group.passThrough}`)
  process.exit(1)
}
if (group.blendMode !== "passThrough") {
  console.error(`  ✗ blendMode esperado 'passThrough', got '${group.blendMode}'`)
  process.exit(1)
}
console.log(`  ✓ passThrough capturado corretamente`)

console.log("\nStep 3: writePsdDocument preserva pass through no PSD final?")
const { bytes: bytes1 } = writePsdDocument(r.document)
const parsed: any = readPsd(bytes1)
const g2 = parsed.children?.[0]
console.log(`  group.blendMode (ag-psd raw): ${JSON.stringify(g2?.blendMode)}`)
if (g2?.blendMode !== "pass through") {
  console.error(`  ✗ blendMode no PSD final: esperado 'pass through', got '${g2?.blendMode}' — passThrough QUEBROU`)
  process.exit(1)
}
console.log(`  ✓ blendMode='pass through' preservado no writer V2`)

console.log("\n✓ GROUP PASSTHROUGH ROUND-TRIP OK")
