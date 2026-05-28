// STEP SERIALIZER (CORE 4/5 — 2026-05-28)
//
// Snapshot / restore de UM step da peca, com DEEP-CLONE forcado em todo
// retorno. Sem isso, snapshots compartilham referencia com bgLayersRef +
// canvas styles + mask, e mutacoes posteriores (mudar bg/per-char no step
// ativo) vazavam pros snapshots dos OUTROS steps.
//
// User reportou: 'a porra dos steps esta salvando o mesmo background nos
// 2 steps'.
//
// Helper centraliza:
//  - bg packing canonico (via bgLayers helper)
//  - deep-clone de layers + bg
//  - preserve de thumb URLs do step ativo

import { bgFromAny, packBgForSave, type BgLayerData } from "./bgLayers"

export interface StepSnapshot {
  layers: any[]
  bgColor: string
  bgOpacity: number
  bgLayers: BgLayerData[]
  imageUrl?: string | null
  thumbnailUrl?: string | null
}

export interface SnapshotInputs {
  layers: any[]              // serializados pelo caller (canvas.getObjects().map(...))
  bgLayers: BgLayerData[]    // bgLayersRef.current
  previousStepDb?: { imageUrl?: string | null; thumbnailUrl?: string | null } | null
  fallbackPieceImageUrl?: string | null  // pra single→multi step transition
}

/**
 * Cria snapshot DEEP-CLONED do step. NUNCA retorna refs do bgLayersRef ou
 * dos objects Fabric — sempre via JSON parse/stringify.
 */
export function snapshotStep(input: SnapshotInputs): StepSnapshot {
  const cloneLayers = JSON.parse(JSON.stringify(input.layers))
  const cloneBg = JSON.parse(JSON.stringify(input.bgLayers))
  const bgPacked = packBgForSave(cloneBg)
  const imageUrl = input.previousStepDb?.imageUrl ?? input.fallbackPieceImageUrl ?? null
  const thumbnailUrl = input.previousStepDb?.thumbnailUrl ?? input.fallbackPieceImageUrl ?? null
  return {
    layers: cloneLayers,
    ...bgPacked,
    imageUrl,
    thumbnailUrl,
  }
}

/**
 * Carrega step de raw data (ex: pdata.steps[i]) pra estado deep-cloned
 * pronto pra setar em bgLayersRef e layers.
 */
export function restoreStep(rawStep: any): { bgLayers: BgLayerData[]; layers: any[] } {
  if (!rawStep || typeof rawStep !== "object") {
    return { bgLayers: bgFromAny(null), layers: [] }
  }
  // bg via helper canonico (le bgLayers, fallback bgColor legacy).
  const bgLayers = bgFromAny(rawStep)
  // Deep-clone das layers pra isolar do raw.
  const layers = Array.isArray(rawStep.layers)
    ? JSON.parse(JSON.stringify(rawStep.layers))
    : []
  return { bgLayers, layers }
}
