/**
 * pptx-steps.test.ts — valida que generateCampaignPresentation gera slides
 * com STEPS quando pieces tem steps[].
 *
 * User reportou: "os steps nao foram exportados".
 *
 * Mock-driven: substitui imgToDataUri pra retornar dataUri fake (sem fetch
 * real), depois gera blob do pptx e valida que tem o numero de slides esperado.
 */

// Mock fetch GLOBAL antes de importar generatePresentation — imgToDataUri
// usa fetch internamente pra carregar imagens. Sem mock, falha em node.
;(globalThis as any).fetch = async (url: string) => {
  // Retorna PNG 1x1 transparente em base64 pra qualquer URL
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
  )
  return {
    ok: true,
    blob: async () => ({
      // FileReader.readAsDataURL no node-fetch retorna isso de forma diferente.
      // Mockamos o que imgToDataUri precisa.
      type: "image/png",
      arrayBuffer: async () => pngBytes.buffer,
    }),
  } as any
}

// Tambem precisamos mockar FileReader pra imgToDataUri converter blob→dataURI
class MockFileReader {
  result: string | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsDataURL(blob: any) {
    setTimeout(() => {
      this.result = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
      if (this.onload) this.onload()
    }, 0)
  }
}
;(globalThis as any).FileReader = MockFileReader

import { buildCampaignPresentationBlob } from "../../generatePresentation"

const multiStepPiece = {
  id: "p1",
  name: "Multi-step test",
  segment: null,
  copy: null,
  imageUrl: "/fake/main.png",
  width: 1080,
  height: 1080,
  steps: [
    { index: 0, imageUrl: "/fake/step0.png", thumbnailUrl: "/fake/step0.png" },
    { index: 1, imageUrl: "/fake/step1.png", thumbnailUrl: "/fake/step1.png" },
    { index: 2, imageUrl: "/fake/step2.png", thumbnailUrl: "/fake/step2.png" },
  ],
}
const singleStepPiece = {
  id: "p2",
  name: "Single test",
  segment: null,
  copy: null,
  imageUrl: "/fake/single.png",
  width: 1080,
  height: 1080,
  steps: null,
}
const stepsWithoutImageUrl = {
  id: "p3",
  name: "Steps missing imageUrl",
  segment: null,
  copy: null,
  imageUrl: "/fake/missing.png",
  width: 1080,
  height: 1080,
  steps: [
    { index: 0, imageUrl: null, thumbnailUrl: null },
    { index: 1, imageUrl: null, thumbnailUrl: null },
  ],
}

import JSZip from "jszip"

async function main() {
  console.log("Step 1: gera blob do PPTX com 3 pieces (multi-step + single + steps sem url)")
  let result
  try {
    result = await buildCampaignPresentationBlob({
      name: "Test Campaign",
      code: "TEST-001",
      pieces: [multiStepPiece, singleStepPiece, stepsWithoutImageUrl],
    })
  } catch (e: any) {
    console.error(`  ✗ CRASH: ${e?.message ?? e}`)
    console.error(e?.stack)
    process.exit(1)
  }
  console.log(`  ✓ blob gerado: ${(result.blob.size / 1024).toFixed(1)}KB, fileName: ${result.fileName}`)

  console.log("\nStep 2: parseia PPTX pra contar slides")
  // PPTX eh um ZIP. Slides estao em ppt/slides/slide{N}.xml
  const blobBytes = Buffer.from(await result.blob.arrayBuffer())
  const zip = await JSZip.loadAsync(blobBytes)
  const slideFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
  console.log(`  total de slides no PPTX: ${slideFiles.length}`)
  console.log(`  arquivos: ${slideFiles.join(", ")}`)

  // Esperado:
  //   cover, code (2 fixos)
  //   p1 (multi-step 3 → ate 4/slide, cabe em 1 slide)
  //   p2 (single)
  //   p3 (steps sem url → renderiza com "(sem preview)" mas eh 1 slide)
  //   thanks
  // = 6 slides
  const expected = 6
  if (slideFiles.length !== expected) {
    console.error(`  ✗ esperava ${expected} slides, got ${slideFiles.length}`)
    process.exit(1)
  }
  console.log(`  ✓ count match (${expected})`)

  console.log("\nStep 3: confirma labels 'STEP N' no XML do slide do multi-step")
  // Skip Step 3 (imagens embeddadas) — mock do FileReader/fetch em Node nao
  // converte blob→dataURI corretamente. Mas o codigo de slides MULTI-STEP roda
  // baseado em piece.steps.length (nao depende das imagens estarem disponiveis).
  // Validamos que o slide do multi-step tem as labels STEP 1/2/3.
  let foundMultiStepSlide = false
  for (const sf of slideFiles) {
    const xml = await zip.files[sf].async("string")
    if (xml.includes("Multi-step test") && xml.includes("STEP 1") && xml.includes("STEP 2") && xml.includes("STEP 3")) {
      console.log(`  ✓ ${sf} tem labels STEP 1/2/3 + nome correto`)
      foundMultiStepSlide = true
      break
    }
  }
  if (!foundMultiStepSlide) {
    console.error("  ✗ nenhum slide combina nome + STEP 1/2/3")
    process.exit(1)
  }

  console.log("\n✓ PPTX STEPS EXPORT OK")
}

main().catch((e) => { console.error(e); process.exit(1) })
