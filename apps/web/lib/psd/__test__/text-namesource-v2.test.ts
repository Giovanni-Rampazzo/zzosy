/**
 * text-namesource-v2.test.ts — valida que o caminho V2 (PsdDocument →
 * writePsdDocument → ag-psd) emite nameSource='srct' por default e preserva
 * o valor original quando setado no PsdTextLayer.
 *
 * Cobre o gap P0 que existia: o caminho legacy ja emitia nameSource='srct'
 * (fix em exportPiece.ts), mas o V2 (writer.ts) nao tinha o flag — quando o
 * user ativava localStorage["zzosy:psdExport"]="v2", o bug do "PS nao
 * auto-renomeia" voltava.
 *
 * Uso: npx tsx lib/psd/__test__/text-namesource-v2.test.ts
 */
import { readPsd, initializeCanvas } from "ag-psd"
import { createCanvas } from "@napi-rs/canvas"
import { writePsdDocument } from "../writer"
import type { PsdDocument, PsdTextLayer } from "../types"

initializeCanvas(createCanvas as any)

const identityTransform = { corners: [0, 0, 100, 0, 100, 100, 0, 100] as [number, number, number, number, number, number, number, number] }

function makeTextLayer(text: string, opts: { nameSource?: string } = {}): PsdTextLayer {
  return {
    id: "t1",
    name: text,
    bbox: { left: 0, top: 0, right: 600, bottom: 100 },
    visible: true,
    opacity: 1,
    blendMode: "normal",
    mask: null,
    effects: {},
    locked: false,
    groupPath: [],
    clipping: false,
    type: "text",
    text,
    styleRuns: [],
    defaultStyle: {
      fontFamily: "Helvetica",
      fontWeight: 400,
      fontStyle: "normal",
      fontSize: 48,
      color: "#000000",
      tracking: 0,
    },
    paragraph: { align: "left" },
    transform: identityTransform,
    ...(opts.nameSource !== undefined ? { nameSource: opts.nameSource } : {}),
  }
}

function makeDoc(layer: PsdTextLayer): PsdDocument {
  return {
    width: 800,
    height: 600,
    layers: [layer],
    dpi: 72,
    colorMode: "rgb",
    bitDepth: 8,
    composite: null,
    metadata: {},
  }
}

console.log("Step 1: V2 writer — default 'srct' quando layer.nameSource undefined")
const doc1 = makeDoc(makeTextLayer("HEADLINE"))
const r1 = writePsdDocument(doc1)
const p1: any = readPsd(r1.bytes)
const ns1 = (p1.children?.[0]?.nameSource ?? "").trim()
if (ns1 !== "srct") {
  console.error(`  ✗ esperado 'srct', got '${p1.children?.[0]?.nameSource}'`)
  process.exit(1)
}
console.log(`  ✓ default 'srct' aplicado`)

console.log("\nStep 2: V2 writer — preserva 'lyr ' (manual) quando vem do reader")
const doc2 = makeDoc(makeTextLayer("ManualName", { nameSource: "lyr " }))
const r2 = writePsdDocument(doc2)
const p2: any = readPsd(r2.bytes)
const ns2 = (p2.children?.[0]?.nameSource ?? "")
if (ns2.trim() !== "lyr") {
  console.error(`  ✗ esperado 'lyr ', got '${ns2}'`)
  process.exit(1)
}
console.log(`  ✓ 'lyr ' preservado (round-trip de nome manual funciona)`)

console.log("\n✓ TEXT NAMESOURCE V2 OK")
