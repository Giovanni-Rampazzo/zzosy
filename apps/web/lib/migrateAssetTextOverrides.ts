/**
 * Helper centralizado pra propagar text edit de um asset pra todas as suas
 * "downstream" references — KV layers da matriz + piece.data.layers das pecas.
 *
 * Usado em 2 lugares:
 *   1. PUT /api/campaigns/[id]/assets/[assetId] (asset edit dentro da campanha)
 *   2. PUT /api/clients/[id]/library/assets/[assetId] (library edit propaga
 *      pra TODAS instances em todas as campanhas que linkam)
 *
 * Sem este helper centralizado, library PUT pulava migrateOverrideText +
 * migrateStyles → peças com override text/styles ficavam com indices broken.
 *
 * Por-instância (não batch): recebe oldText, newText, campaignId + assetId.
 * Caller decide se executa em loop (1 instance) ou batch (N library instances).
 */
import { prisma } from "@/lib/prisma"
import { migrateStyles } from "@/lib/migrateStyles"

/**
 * Migra overrides.text quando asset.content muda. Preserva estrutura de
 * quebras (\n) em termos de "tokens por linha". Espelha lib do route asset PUT.
 */
export function migrateOverrideText(oldOverrideText: string, newAssetCleanText: string): string {
  if (!oldOverrideText.includes("\n")) return ""
  const oldLines = oldOverrideText.split("\n")
  const lineTokenCounts = oldLines.map(line =>
    line.trim().split(/\s+/).filter(t => t.length > 0).length
  )
  const newTokens = newAssetCleanText.trim().split(/\s+/).filter(t => t.length > 0)
  if (newTokens.length === 0) return ""
  const newLines: string[] = []
  let cursor = 0
  for (let i = 0; i < lineTokenCounts.length - 1; i++) {
    const take = lineTokenCounts[i]
    const lineTokens = newTokens.slice(cursor, cursor + take)
    cursor += take
    newLines.push(lineTokens.join(" "))
  }
  newLines.push(newTokens.slice(cursor).join(" "))
  while (newLines.length > 1 && newLines[newLines.length - 1] === "") newLines.pop()
  return newLines.join("\n")
}

export function spansToText(spans: any[]): string {
  return Array.isArray(spans) ? spans.map(s => s?.text ?? "").join("") : ""
}

export function parseContent(raw: any): any[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

/**
 * Constroi as ops Prisma pra migrar TODAS as referencias downstream de UMA
 * instancia de asset (KV layer matriz + piece layers).
 *
 * Não executa nada — devolve array de prisma operations pra caller incluir na
 * sua transaction. Permite library PUT batch N instances em 1 transaction.
 *
 * Retorna [] se nada precisa migrar (skipMigrate ou text inalterado).
 */
export async function buildMigrationOps(
  campaignId: string,
  assetId: string,
  oldText: string,
  newText: string,
): Promise<any[]> {
  const textChanged = oldText !== newText
  const skipMigrate = newText.trim().length === 0
  if (!textChanged || skipMigrate) return []

  const ops: any[] = []

  // KV migration
  const kv = await prisma.keyVision.findUnique({ where: { campaignId } })
  if (kv) {
    let kvLayers: any[] = []
    try {
      const parsed = typeof kv.layers === "string" ? JSON.parse(kv.layers) : kv.layers
      if (Array.isArray(parsed)) kvLayers = parsed
    } catch { kvLayers = [] }

    let kvTouched = false
    const newKvLayers = kvLayers.map((l: any) => {
      if (l?.assetId !== assetId) return l
      const newOverrides = { ...(l.overrides ?? {}) }
      let layerChanged = false
      if (l.overrides?.styles && Object.keys(l.overrides.styles).length > 0) {
        newOverrides.styles = migrateStyles(oldText, newText, l.overrides.styles)
        layerChanged = true
      }
      if (typeof l.overrides?.text === "string" && l.overrides.text.includes("\n")) {
        newOverrides.text = migrateOverrideText(l.overrides.text, newText)
        layerChanged = true
      }
      if (layerChanged) { kvTouched = true; return { ...l, overrides: newOverrides } }
      return l
    })
    if (kvTouched) {
      ops.push(prisma.keyVision.update({
        where: { campaignId },
        data: { layers: JSON.stringify(newKvLayers) },
      }))
    }
  }

  // Piece migration
  const pieces = await prisma.piece.findMany({ where: { campaignId } })
  for (const p of pieces) {
    let pdata: any = null
    try { pdata = typeof p.data === "string" ? JSON.parse(p.data as string) : p.data } catch {}
    if (!pdata || !Array.isArray(pdata.layers)) continue
    let touched = false
    const newLayers = pdata.layers.map((l: any) => {
      if (l?.assetId !== assetId) return l
      const newOverrides = { ...(l.overrides ?? {}) }
      let layerChanged = false
      if (l.overrides?.styles && Object.keys(l.overrides.styles).length > 0) {
        newOverrides.styles = migrateStyles(oldText, newText, l.overrides.styles)
        layerChanged = true
      }
      if (typeof l.overrides?.text === "string" && l.overrides.text.includes("\n")) {
        newOverrides.text = migrateOverrideText(l.overrides.text, newText)
        layerChanged = true
      }
      if (layerChanged) { touched = true; return { ...l, overrides: newOverrides } }
      return l
    })
    if (touched) {
      ops.push(prisma.piece.update({
        where: { id: p.id },
        data: { data: JSON.stringify({ ...pdata, layers: newLayers }) },
      }))
    }
  }

  return ops
}
