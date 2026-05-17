import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { stat } from "fs/promises"
import path from "path"

/**
 * GET /api/debug/piece-thumb?id=<pieceId>
 *
 * Diagnostico do thumbnail da piece. Mostra:
 * - piece.imageUrl + piece.updatedAt + url versionada que o frontend usaria
 * - mtime do arquivo no filesystem (se /public/uploads)
 * - Se mtime > updatedAt: thumb foi regerado depois do ultimo save (cascade OK)
 *   Se mtime <= updatedAt: thumb NAO foi atualizado pelo cascade (bug)
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id obrigatorio" }, { status: 400 })

  const piece = await prisma.piece.findUnique({ where: { id } })
  if (!piece) return NextResponse.json({ error: "piece not found" }, { status: 404 })

  let fileMtime: string | null = null
  let fileSize: number | null = null
  let fileExists = false
  if (piece.imageUrl?.startsWith("/uploads/")) {
    const localPath = path.join(process.cwd(), "public", piece.imageUrl)
    try {
      const st = await stat(localPath)
      fileExists = true
      fileMtime = st.mtime.toISOString()
      fileSize = st.size
    } catch {
      fileExists = false
    }
  }

  const v = new Date(piece.updatedAt).getTime()
  const versionedUrl = piece.imageUrl ? `${piece.imageUrl}${piece.imageUrl.includes("?") ? "&" : "?"}v=${v}` : null

  return NextResponse.json({
    pieceId: piece.id,
    name: piece.name,
    imageUrl: piece.imageUrl,
    versionedUrl,
    updatedAt: piece.updatedAt.toISOString(),
    file: {
      exists: fileExists,
      mtime: fileMtime,
      sizeBytes: fileSize,
    },
    diagnostic: fileMtime && piece.updatedAt
      ? (new Date(fileMtime).getTime() >= new Date(piece.updatedAt).getTime() - 5000
          ? "OK: thumb mtime >= piece.updatedAt (thumb foi regenerado junto/depois do save)"
          : "BUG: thumb mtime ANTERIOR ao piece.updatedAt — cascade nao re-gerou thumb pra essa peca")
      : "Sem dados pra comparar",
  })
}
