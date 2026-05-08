import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

/**
 * POST /api/pieces/duplicate
 * body: { ids: string[] }
 * Duplica peças. Para cada peça original cria uma nova com:
 *  - mesmo campaignId, mediaFormatId, data (snapshot do canvas)
 *  - status sempre "STANDBY" (saimos do fluxo de aprovacao)
 *  - imageUrl COPIADO (thumbnail re-gerado on-demand)
 *  - name = "<original> (cópia)" (ou "<original> (cópia N)" se ja existir)
 *  - createdAt novo
 * Retorna lista de pecas criadas.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === "string") : []
  if (!ids.length) return NextResponse.json({ error: "ids vazio" }, { status: 400 })

  const originals = await prisma.piece.findMany({
    where: { id: { in: ids } },
    include: { campaign: { select: { id: true } } },
  })
  if (!originals.length) return NextResponse.json({ error: "Nenhuma peca encontrada" }, { status: 404 })

  // Calcula sufixo "(cópia N)" para evitar duplicar nome quando ja existirem copias
  const created = []
  for (const orig of originals) {
    const baseName = orig.name ?? "Peça"
    // Procura quantas copias dessa peca ja existem na mesma campanha
    const baseStripped = baseName.replace(/\s*\(cópia(?:\s+\d+)?\)\s*$/, "")
    const existing = await prisma.piece.count({
      where: {
        campaignId: orig.campaignId,
        name: { startsWith: baseStripped },
      },
    })
    const suffix = existing === 0 ? " (cópia)" : ` (cópia ${existing})`
    const newName = baseStripped + suffix

    const newPiece = await prisma.piece.create({
      data: {
        campaignId: orig.campaignId,
        mediaFormatId: orig.mediaFormatId,
        name: newName,
        status: "STANDBY",
        data: orig.data ?? undefined,
        imageUrl: orig.imageUrl ?? undefined,
      },
    })
    created.push(newPiece)
  }

  return NextResponse.json({ ok: true, count: created.length, pieces: created })
}
