import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

/**
 * Mostra a ULTIMA peca editada + ULTIMO KV editado, com flags hidden/locked
 * destacadas. Uso: abre a URL e ja ve se o save persistiu corretamente.
 *
 * URL: /api/debug/last-edited
 */
export async function GET() {
  const piece = await prisma.piece.findFirst({ orderBy: { updatedAt: "desc" } })
  const kv = await prisma.keyVision.findFirst({ orderBy: { updatedAt: "desc" } })

  function summarize(layersRaw: any) {
    if (!layersRaw) return null
    let layers: any[] = []
    try {
      const parsed = typeof layersRaw === "string" ? JSON.parse(layersRaw) : layersRaw
      layers = Array.isArray(parsed) ? parsed : (parsed?.layers ?? [])
    } catch { return { error: "JSON parse fail" } }
    return layers.map((l: any, i: number) => ({
      i,
      assetId: l.assetId ?? null,
      embedded: !!l.__embedded,
      type: l.type ?? "?",
      hidden: l.hidden === true,
      locked: l.locked === true,
    }))
  }

  return NextResponse.json({
    piece: piece ? {
      id: piece.id,
      name: piece.name,
      updatedAt: piece.updatedAt,
      layers: summarize(piece.data),
    } : null,
    keyVision: kv ? {
      campaignId: kv.campaignId,
      updatedAt: kv.updatedAt,
      layers: summarize(kv.layers),
    } : null,
  })
}
