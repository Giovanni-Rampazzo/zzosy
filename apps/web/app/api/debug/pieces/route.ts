import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

/**
 * GET /api/debug/pieces?campaignId=<id>&limit=5
 * Lista pe\u00e7as recentes (so dimensoes basicas pra escolher qual debugar).
 * REMOVER apos diagnostico.
 */
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaignId")
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "5", 10)

  const pieces = await prisma.piece.findMany({
    where: campaignId ? { campaignId } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      campaignId: true,
      status: true,
      createdAt: true,
      data: true,
    },
  })

  return NextResponse.json({
    pieces: pieces.map(p => ({
      id: p.id,
      name: p.name,
      campaignId: p.campaignId,
      status: p.status,
      createdAt: p.createdAt,
      data_size: p.data?.length || 0,
      debug_url: `/api/debug/piece?id=${p.id}`,
    })),
  })
}
