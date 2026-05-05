import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  const piece = await prisma.piece.findUnique({ where: { id } })
  if (!piece) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // DEBUG: log piece.data structure
  let pdata: any = null
  try {
    pdata = typeof piece.data === "string" ? JSON.parse(piece.data as string) : piece.data
  } catch {}
  console.log("[DEBUG-GET-PIECE]", id, "data keys:", pdata ? Object.keys(pdata) : "PARSE_FAIL",
    "version:", pdata?.version,
    "layersCount:", Array.isArray(pdata?.layers) ? pdata.layers.length : "NOT_ARRAY",
    "hasCanvasData:", !!pdata?.canvasData,
    "rawType:", typeof piece.data,
    "rawLen:", typeof piece.data === "string" ? (piece.data as string).length : null)

  return NextResponse.json(piece)
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  const body = await req.json()
  const piece = await prisma.piece.update({ where: { id }, data: body })
  return NextResponse.json(piece)
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  await prisma.piece.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
