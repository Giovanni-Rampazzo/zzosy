import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET /api/debug/piece-raw?id=<pieceId> — retorna piece.data RAW parseado
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id obrigatorio" }, { status: 400 })
  const p = await prisma.piece.findUnique({ where: { id } })
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 })
  let data: any = null
  try { data = p.data ? JSON.parse(p.data) : null } catch (e: any) { data = { parseError: e?.message } }
  return NextResponse.json({ pieceId: p.id, name: p.name, data })
}
