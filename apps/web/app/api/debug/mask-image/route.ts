import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// GET /api/debug/mask-image?campaignId=X&layerIdx=N — retorna a mask raster
// do layer N do KV como PNG (extraído do dataUrl).
export async function GET(req: NextRequest) {
  const cid = req.nextUrl.searchParams.get("campaignId")
  const idx = Number(req.nextUrl.searchParams.get("layerIdx") ?? "0")
  if (!cid) return NextResponse.json({ error: "campaignId" }, { status: 400 })
  const allKvs = await prisma.keyVision.findMany({ select: { campaignId: true } })
  const kv = await prisma.keyVision.findFirst({ where: { campaignId: cid } })
  if (!kv) return NextResponse.json({ error: "no kv for cid=" + cid, allCids: allKvs.map(k => k.campaignId) }, { status: 404 })
  const layers = kv.layers ? JSON.parse(kv.layers) : []
  const layer = layers[idx]
  if (!layer?.mask?.raster?.dataUrl) return NextResponse.json({ error: "no mask raster" }, { status: 404 })
  const dataUrl: string = layer.mask.raster.dataUrl
  const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl)
  if (!m) return NextResponse.json({ error: "invalid dataUrl" }, { status: 400 })
  const buf = Buffer.from(m[2], "base64")
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": `image/${m[1]}` } })
}
