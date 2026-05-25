/**
 * Helper centralizado pra mutar KeyVision.layers JSON.
 * Pattern: layers e armazenado como string JSON em KeyVision.layers; mutacoes
 * precisam parsear, manipular array, re-stringify.
 *
 * Sem este helper, qualquer caller que esqueca de tocar KV.layers ao criar
 * CampaignAsset gera asset orfao no banco (existe mas nao renderiza no canvas).
 *
 * Padroniza shape de layer pra compatibilidade com /import-psd.
 */
import { prisma } from "@/lib/prisma"

export interface KvLayerInput {
  assetId: string
  posX?: number
  posY?: number
  width?: number
  height?: number
  scaleX?: number
  scaleY?: number
  rotation?: number
  /** Indice no z-order. Se omitido, append no final. */
  zIndex?: number
  /** Per-layer overrides (text local com \n, cor per-char, etc) */
  overrides?: any
  /** Effects PSD herdados do asset (drop shadow, glow, stroke) */
  effects?: any
  /** Mask raster/vector/clipping herdada */
  mask?: any
  /** Group hierarchy do Photoshop */
  groupPath?: string[]
  /** Flag pra Smart Object com pixels ja com effects baked */
  pixelsIncludeEffects?: boolean
  /** PSD 'lnsr' tag pro round-trip */
  nameSource?: string
  hidden?: boolean
  locked?: boolean
  opacity?: number
  blendMode?: string
}

/**
 * Adiciona layer(s) ao KeyVision da campanha. Cria KV se nao existir.
 *
 * Side-effect: persiste no DB. Idempotente: chamar 2x cria 2 layers do mesmo
 * assetId (precisa caller checar duplicates antes se aplicavel).
 *
 * zIndex auto = max(layers.zIndex) + 1 se omitido.
 */
export async function addLayersToKv(
  campaignId: string,
  newLayers: KvLayerInput | KvLayerInput[],
): Promise<void> {
  const inputs = Array.isArray(newLayers) ? newLayers : [newLayers]
  if (inputs.length === 0) return

  const kv = await prisma.keyVision.findUnique({ where: { campaignId } })

  let existing: any[] = []
  if (kv?.layers) {
    try {
      const parsed = typeof kv.layers === "string" ? JSON.parse(kv.layers) : kv.layers
      if (Array.isArray(parsed)) existing = parsed
    } catch { existing = [] }
  }

  const maxZ = existing.reduce((m, l) => Math.max(m, l?.zIndex ?? 0), -1)
  let nextZ = maxZ + 1

  const newEntries = inputs.map(i => buildLayerEntry(i, nextZ++))
  const merged = [...existing, ...newEntries]

  if (kv) {
    await prisma.keyVision.update({
      where: { campaignId },
      data: { layers: JSON.stringify(merged) },
    })
  } else {
    // KV nao existe — cria com defaults razoaveis. Caller deve garantir
    // canvas dimensions corretas antes (via update separado se precisar).
    await prisma.keyVision.create({
      data: {
        campaignId,
        data: "{}",
        bgColor: "#ffffff",
        layers: JSON.stringify(merged),
        width: 1920,
        height: 1080,
      },
    })
  }
}

/**
 * Remove layers do KV pelo assetId. Util quando DELETE asset e queremos limpar
 * referencias orfas. Cascade do Prisma SO deleta CampaignAsset; KV.layers e JSON.
 */
export async function removeLayersFromKv(
  campaignId: string,
  assetIds: string[],
): Promise<void> {
  if (assetIds.length === 0) return
  const ids = new Set(assetIds)
  const kv = await prisma.keyVision.findUnique({ where: { campaignId } })
  if (!kv?.layers) return
  let existing: any[] = []
  try {
    const parsed = typeof kv.layers === "string" ? JSON.parse(kv.layers) : kv.layers
    if (Array.isArray(parsed)) existing = parsed
  } catch { return }
  const filtered = existing.filter(l => !ids.has(l?.assetId))
  if (filtered.length === existing.length) return // nada removido
  await prisma.keyVision.update({
    where: { campaignId },
    data: { layers: JSON.stringify(filtered) },
  })
}

function buildLayerEntry(input: KvLayerInput, zIndex: number): any {
  return {
    assetId: input.assetId,
    posX: typeof input.posX === "number" ? input.posX : 100,
    posY: typeof input.posY === "number" ? input.posY : 100,
    width: input.width ?? 400,
    height: input.height ?? 100,
    scaleX: input.scaleX ?? 1,
    scaleY: input.scaleY ?? 1,
    rotation: input.rotation ?? 0,
    zIndex: typeof input.zIndex === "number" ? input.zIndex : zIndex,
    ...(input.overrides ? { overrides: input.overrides } : {}),
    ...(input.effects && Object.keys(input.effects).length > 0 ? { effects: input.effects } : {}),
    ...(input.mask ? { mask: input.mask } : {}),
    ...(input.groupPath && input.groupPath.length > 0 ? { groupPath: input.groupPath } : {}),
    ...(input.pixelsIncludeEffects === true ? { pixelsIncludeEffects: true } : {}),
    ...(typeof input.nameSource === "string" ? { nameSource: input.nameSource } : {}),
    ...(input.hidden === true ? { hidden: true } : {}),
    ...(input.locked === true ? { locked: true } : {}),
    ...(typeof input.opacity === "number" && input.opacity < 1 ? { opacity: input.opacity } : {}),
    ...(input.blendMode && input.blendMode !== "source-over" ? { blendMode: input.blendMode } : {}),
  }
}
