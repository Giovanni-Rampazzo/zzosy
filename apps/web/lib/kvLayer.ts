import { prisma } from "@/lib/prisma"

/**
 * Adiciona uma layer no centro do canvas da matriz para um asset recém-criado.
 * Calcula posição centralizada com base nas dimensões padrão do asset.
 */
export async function addLayerToKVCenter(
  campaignId: string,
  assetId: string,
  defaults?: { width?: number; height?: number; }
) {
  const kv = await prisma.keyVision.findUnique({ where: { campaignId } })
  if (!kv) return

  let layers: any[] = []
  if (typeof kv.layers === "string") {
    try { layers = JSON.parse(kv.layers) } catch { layers = [] }
  } else if (Array.isArray(kv.layers)) layers = kv.layers as any[]

  const cw = kv.width ?? 1080
  const ch = kv.height ?? 1080
  const lw = defaults?.width ?? Math.round(cw * 0.4)
  const lh = defaults?.height ?? Math.round(ch * 0.15)

  const maxZ = layers.reduce((m, l) => Math.max(m, l?.zIndex ?? 0), 0)

  layers.push({
    assetId,
    posX: Math.round((cw - lw) / 2),
    posY: Math.round((ch - lh) / 2),
    scaleX: 1, scaleY: 1, rotation: 0,
    zIndex: maxZ + 1,
    width: lw, height: lh,
    overrides: {},
  })

  await prisma.keyVision.update({
    where: { campaignId },
    data: { layers: JSON.stringify(layers) }
  })
}
