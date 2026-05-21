/**
 * postProcess — operacoes que rodam APOS o reader, sobre o PsdDocument
 * estruturado. Diferente do reader (1:1 com ag-psd), aqui podemos analisar
 * o documento INTEIRO e tomar decisoes globais.
 *
 * Operacoes Fase 2:
 *   - detectWrapperSmartObjects: identifica Smart Objects que duplicam o
 *     design completo (caso PA do Sicredi)
 *   - resolveClippingChains: ja existe no reader, mas pode ser re-chamado
 *     se postProcess for usado independente
 */
import type { PsdDocument, PsdLayer, PsdSmartObjectLayer, PsdBBox } from "./types"

// ────────────────────────────────────────────────────────────────────
// Wrapper SO Detection
// ────────────────────────────────────────────────────────────────────

const WRAPPER_COVERAGE_THRESHOLD = 0.40 // cobre >= 40% do canvas
const WRAPPER_OVERLAP_THRESHOLD = 0.5   // outros layers com >= 50% bbox dentro
const WRAPPER_OVERLAPPING_COUNT = 2      // pelo menos 2 layers acima sobrepondo
const WRAPPER_MIN_AREA = 100              // ignora layers minusculos no count

/**
 * Detecta Smart Objects "wrapper" — placedLayers grandes que contem o
 * design completo embedded + tem layers menores acima desenhando por cima.
 * Marca `isWrapper=true` em cada PsdSmartObjectLayer detectado.
 *
 * Padrao tipico: designer importa um design (.ai/.psd/.psb) como Smart
 * Object pra preview rapido + replica os elementos editaveis como layers
 * separadas acima. Quando ag-psd entrega o canvas raster do SO ja com tudo
 * desenhado, e o renderer ainda desenha os layers acima → duplicacao visual.
 *
 * Detecta heuristicamente (mesmas regras que autoHideWrapperSmartObjects
 * legacy, mas roda sobre PsdDocument):
 *   1. Smart Object com bbox cobrindo >= 40% do canvas
 *   2. Tem >= 2 layers superiores na hierarquia com bbox >50% contido no SO
 *
 * Quando os 3 batem: marca isWrapper=true. Toolchain (toCampaign / editor)
 * decide o que fazer: marcar como hidden por default? Renderizar com opacity
 * reduzida? Mostrar warning visual? Por ora, marcamos hidden=false (visible)
 * mas isWrapper=true — UI exibe badge. Decisao final na Fase 7.
 */
export function detectWrapperSmartObjects(doc: PsdDocument): { detected: string[] } {
  const detected: string[] = []
  const canvasArea = doc.width * doc.height

  // Coleta flat de layers (folhas + smart objects + groups) com indice
  // global ag-psd-ordem (bottom→top no PSD).
  const flat: Array<{ layer: PsdLayer; idx: number }> = []
  function collect(layers: PsdLayer[]) {
    for (const l of layers) {
      flat.push({ layer: l, idx: flat.length })
      if (l.type === "group") collect(l.children)
    }
  }
  collect(doc.layers)

  for (let i = 0; i < flat.length; i++) {
    const { layer } = flat[i]
    if (layer.type !== "smartObject") continue
    if (!layer.visible) continue

    const so = layer as PsdSmartObjectLayer
    const area = bboxArea(so.bbox)
    if (area < canvasArea * WRAPPER_COVERAGE_THRESHOLD) continue

    // Conta layers ACIMA (idx > i na flat) com bbox CONTIDO no SO
    let overlapping = 0
    for (let j = i + 1; j < flat.length; j++) {
      const above = flat[j].layer
      if (!above.visible) continue
      if (above.type === "group" || above.type === "adjustment") continue
      const aboveArea = bboxArea(above.bbox)
      if (aboveArea < WRAPPER_MIN_AREA) continue
      const overlap = bboxIntersectionArea(so.bbox, above.bbox)
      if (overlap / aboveArea > WRAPPER_OVERLAP_THRESHOLD) overlapping++
    }

    if (overlapping >= WRAPPER_OVERLAPPING_COUNT) {
      so.isWrapper = true
      detected.push(so.name)
    }
  }

  return { detected }
}

// ────────────────────────────────────────────────────────────────────
// Helpers de geometria
// ────────────────────────────────────────────────────────────────────

function bboxArea(b: PsdBBox): number {
  return Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top)
}

function bboxIntersectionArea(a: PsdBBox, b: PsdBBox): number {
  const iL = Math.max(a.left, b.left)
  const iT = Math.max(a.top, b.top)
  const iR = Math.min(a.right, b.right)
  const iB = Math.min(a.bottom, b.bottom)
  if (iR <= iL || iB <= iT) return 0
  return (iR - iL) * (iB - iT)
}
