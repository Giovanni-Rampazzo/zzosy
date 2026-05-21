import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const { id } = await ctx.params

  const piece = await prisma.piece.findUnique({ where: { id } })
  if (!piece) return NextResponse.json({ error: "Piece not found" }, { status: 404 })

  const camp = await prisma.campaign.findUnique({
    where: { id: piece.campaignId },
    include: { assets: true, keyVision: true }
  })

  let pdata: any = null
  let pdataParseError: string | null = null
  try {
    pdata = typeof piece.data === "string" ? JSON.parse(piece.data as string) : piece.data
  } catch (e: any) {
    pdataParseError = e?.message ?? String(e)
  }

  // Debug summary
  return NextResponse.json({
    pieceId: piece.id,
    pieceName: piece.name,
    pieceDataRawType: typeof piece.data,
    pieceDataRawLength: typeof piece.data === "string" ? (piece.data as string).length : null,
    pdataParseError,
    pdataKeys: pdata ? Object.keys(pdata) : null,
    pdataVersion: pdata?.version ?? null,
    pdataWidth: pdata?.width ?? null,
    pdataHeight: pdata?.height ?? null,
    pdataLayersCount: Array.isArray(pdata?.layers) ? pdata.layers.length : null,
    pdataLayersFirst: Array.isArray(pdata?.layers) ? pdata.layers[0] : null,
    pdataHasCanvasData: !!pdata?.canvasData,
    campaignAssetsCount: camp?.assets.length ?? 0,
    campaignAssetIds: camp?.assets.map(a => a.id) ?? [],
    pieceLayerAssetIds: Array.isArray(pdata?.layers) ? pdata.layers.map((l: any) => l.assetId) : [],
    matchingAssets: Array.isArray(pdata?.layers) && camp?.assets
      ? pdata.layers.filter((l: any) => camp.assets.some(a => a.id === l.assetId)).length
      : 0,
  })
}
