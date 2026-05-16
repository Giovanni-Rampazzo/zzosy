import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

/**
 * POST /api/pieces/duplicate
 * body: { ids: string[]; mediaFormatId?: string }
 * Duplica peças. Para cada peça original cria uma nova com:
 *  - mesmo campaignId, data (snapshot do canvas), imageUrl, segment, copy
 *  - mediaFormatId: se passado no body, usa o novo formato (atualiza
 *    piece.data.width/height/dpi); senao mantem o do original
 *  - status sempre "STANDBY" (saimos do fluxo de aprovacao)
 *  - name = "<original> (cópia)" (ou "<original> (cópia N)" se ja existir)
 *  - createdAt novo
 *
 * Quando o formato muda, o thumbnail antigo nao bate com a nova dimensao
 * — descartamos (imageUrl=undefined) pra forçar re-geração no proximo render.
 * Layers ficam nas mesmas coords do original (usuario reposiciona no editor).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === "string") : []
  const newMediaFormatId: string | undefined = typeof body?.mediaFormatId === "string" && body.mediaFormatId ? body.mediaFormatId : undefined
  if (!ids.length) return NextResponse.json({ error: "ids vazio" }, { status: 400 })

  // Se body passou mediaFormatId, busca pra ter width/height/dpi
  let newFormat: { id: string; width: number; height: number; dpi: number } | null = null
  if (newMediaFormatId) {
    const mf = await prisma.mediaFormat.findUnique({ where: { id: newMediaFormatId } })
    if (!mf) return NextResponse.json({ error: "mediaFormatId nao encontrado" }, { status: 404 })
    newFormat = { id: mf.id, width: mf.width, height: mf.height, dpi: mf.dpi ?? 72 }
  }

  const originals = await prisma.piece.findMany({
    where: { id: { in: ids } },
    include: { campaign: { select: { id: true } } },
  })
  if (!originals.length) return NextResponse.json({ error: "Nenhuma peca encontrada" }, { status: 404 })

  const created = []
  for (const orig of originals) {
    const baseName = orig.name ?? "Peça"
    const baseStripped = baseName.replace(/\s*\(cópia(?:\s+\d+)?\)\s*$/, "")
    const existing = await prisma.piece.count({
      where: { campaignId: orig.campaignId, name: { startsWith: baseStripped } },
    })
    const suffix = existing === 0 ? " (cópia)" : ` (cópia ${existing})`
    const newName = baseStripped + suffix

    // Se trocou formato, atualiza data.width/height/dpi + descarta thumb antigo
    let newData: any = orig.data ?? undefined
    let newImageUrl: string | undefined = orig.imageUrl ?? undefined
    if (newFormat && newFormat.id !== orig.mediaFormatId) {
      try {
        const parsed = typeof orig.data === "string" ? JSON.parse(orig.data) : (orig.data ?? {})
        newData = { ...parsed, width: newFormat.width, height: newFormat.height, dpi: newFormat.dpi }
      } catch { newData = { width: newFormat.width, height: newFormat.height, dpi: newFormat.dpi } }
      newImageUrl = undefined
    }

    const newPiece = await prisma.piece.create({
      data: {
        campaignId: orig.campaignId,
        mediaFormatId: newFormat?.id ?? orig.mediaFormatId,
        name: newName,
        status: "STANDBY",
        data: newData,
        imageUrl: newImageUrl,
        segment: orig.segment ?? undefined,
        copy: orig.copy ?? undefined,
      },
    })
    created.push(newPiece)
  }

  return NextResponse.json({ ok: true, count: created.length, pieces: created })
}
