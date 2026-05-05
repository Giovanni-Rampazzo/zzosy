import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { NextRequest } from "next/server"

type Ctx = { params: Promise<{ id: string }> }

function parseJson(val: any) {
  if (!val) return null
  if (typeof val === "string") { try { return JSON.parse(val) } catch { return null } }
  return val
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  const kv = await prisma.keyVision.findUnique({ where: { campaignId: id } })
  if (!kv) return NextResponse.json(null)
  return NextResponse.json({ ...kv, data: parseJson(kv.data), layers: parseJson(kv.layers) })
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  const body = await req.json()
  const bgColor = body.bgColor ?? "#ffffff"
  const newLayers = Array.isArray(body.layers) ? body.layers : []
  const layersStr = JSON.stringify(newLayers)
  const data = body.data != null ? JSON.stringify(body.data) : "{}"
  const matrixW = body.width ?? 1920
  const matrixH = body.height ?? 1080

  // Le estado anterior para comparar e propagar mudancas
  const prev = await prisma.keyVision.findUnique({ where: { campaignId: id } })
  const prevLayers: any[] = prev?.layers ? (parseJson(prev.layers) ?? []) : []

  const kv = await prisma.keyVision.upsert({
    where: { campaignId: id },
    create: { campaignId: id, data, bgColor, layers: layersStr, width: matrixW, height: matrixH },
    update: { data, bgColor, layers: layersStr, width: matrixW, height: matrixH },
  })

  // Sync com pecas v2 desta campanha
  try {
    const prevAssetIds = new Set(prevLayers.map((l: any) => l.assetId).filter(Boolean))
    const newAssetIds = new Set(newLayers.map((l: any) => l.assetId).filter(Boolean))
    const added = [...newAssetIds].filter(aid => !prevAssetIds.has(aid))
    const removed = [...prevAssetIds].filter(aid => !newAssetIds.has(aid))

    if (added.length > 0 || removed.length > 0) {
      const pieces = await prisma.piece.findMany({ where: { campaignId: id } })
      for (const piece of pieces) {
        const pdata: any = parseJson(piece.data)
        if (!pdata || pdata.version !== 2 || !Array.isArray(pdata.layers)) continue

        let pieceLayers = [...pdata.layers]

        // Remove layers cujos assetIds saíram da matriz
        if (removed.length > 0) {
          pieceLayers = pieceLayers.filter((pl: any) => !removed.includes(pl.assetId))
        }

        // Adiciona novos layers com posicao escalada da matriz
        if (added.length > 0) {
          const pw = pdata.width ?? matrixW
          const ph = pdata.height ?? matrixH
          const scale = Math.min(pw / matrixW, ph / matrixH)
          const offsetX = (pw - matrixW * scale) / 2
          const offsetY = (ph - matrixH * scale) / 2
          for (const aid of added) {
            const matrixLayer = newLayers.find((l: any) => l.assetId === aid)
            if (!matrixLayer) continue
            pieceLayers.push({
              assetId: aid,
              posX: Math.round((matrixLayer.posX ?? 0) * scale + offsetX),
              posY: Math.round((matrixLayer.posY ?? 0) * scale + offsetY),
              scaleX: (matrixLayer.scaleX ?? 1) * scale,
              scaleY: (matrixLayer.scaleY ?? 1) * scale,
              rotation: matrixLayer.rotation ?? 0,
              zIndex: matrixLayer.zIndex ?? 999,
              width: matrixLayer.width ?? 400,
              height: matrixLayer.height ?? 100,
              overrides: {},
            })
          }
        }

        const newPieceData = { ...pdata, layers: pieceLayers }
        await prisma.piece.update({
          where: { id: piece.id },
          data: { data: JSON.stringify(newPieceData) }
        })
      }
    }
  } catch (e) {
    console.warn("piece sync failed:", e)
  }

  return NextResponse.json({ ...kv, data: parseJson(kv.data), layers: parseJson(kv.layers) })
}
