import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// POST /api/pieces/[id]/clear-thumbs
// Limpa imageUrl/thumbnailUrl da peca E de todos os steps em data.
// Resultado: proxima vez que o user abrir a peca no editor, autoGen
// dispara e regenera todos os thumbs com a logica atual.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const piece = await prisma.piece.findUnique({ where: { id } })
  if (!piece) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const data = piece.data ? JSON.parse(piece.data) : {}
  if (Array.isArray(data.steps)) {
    data.steps = data.steps.map((s: any) => ({ ...s, imageUrl: null, thumbnailUrl: null }))
  }
  await prisma.piece.update({
    where: { id },
    data: {
      imageUrl: null,
      data: JSON.stringify(data),
    },
  })
  return NextResponse.json({ ok: true, cleared: Array.isArray(data.steps) ? data.steps.length : 0 })
}
