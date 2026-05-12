import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

/**
 * POST /api/debug/fix-piece-version?id=<pieceId>
 *
 * Migration TEMPORARIA: pe\u00e7as importadas via PsdPieceImporter antes do fix
 * d2... foram gravadas sem `version: 2` no data JSON. Editor exige version
 * pra entrar no branch v2 (loop de layers) — sem isso, a pe\u00e7a abre vazia.
 *
 * Esta rota adiciona version:2 ao data existente.
 * REMOVER apos diagnostico.
 */
export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id obrigatorio" }, { status: 400 })

  const piece = await prisma.piece.findUnique({ where: { id } })
  if (!piece) return NextResponse.json({ error: "piece not found" }, { status: 404 })
  if (!piece.data) return NextResponse.json({ error: "piece.data vazio" }, { status: 400 })

  let dataParsed: any
  try { dataParsed = JSON.parse(piece.data) }
  catch (e) { return NextResponse.json({ error: "data nao eh JSON valido" }, { status: 400 }) }

  if (dataParsed.version === 2) {
    return NextResponse.json({ ok: true, message: "ja tem version:2, nada a fazer", layers: dataParsed.layers?.length ?? 0 })
  }

  dataParsed.version = 2
  // Garante width/height na raiz (algumas pe\u00e7as antigas tinham so dentro de data, outras nao)
  if (!dataParsed.width) dataParsed.width = 1080
  if (!dataParsed.height) dataParsed.height = 1080
  if (!dataParsed.bgColor) dataParsed.bgColor = "#ffffff"

  const updated = await prisma.piece.update({
    where: { id },
    data: { data: JSON.stringify(dataParsed) },
  })

  return NextResponse.json({
    ok: true,
    message: "version: 2 adicionado, abre o editor de novo pra testar",
    width: dataParsed.width,
    height: dataParsed.height,
    layers: dataParsed.layers?.length ?? 0,
    piece_id: updated.id,
  })
}
