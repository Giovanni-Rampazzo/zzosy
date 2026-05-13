import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

/**
 * Inspecionar/normalizar steps de uma peca.
 *
 * GET /api/debug/fix-steps?pieceId=X         - mostra estado atual
 * POST /api/debug/fix-steps?pieceId=X        - corrige inconsistencias:
 *                                              - alinha steps.length com stepCount
 *                                              - reseta activeStepIndex se invalido
 *                                              - opcional: ?reset=1 zera tudo (volta a 1 step)
 */
export async function GET(req: NextRequest) {
  const pieceId = new URL(req.url).searchParams.get("pieceId")
  if (!pieceId) return NextResponse.json({ error: "pieceId obrigatorio" }, { status: 400 })
  const piece = await prisma.piece.findUnique({ where: { id: pieceId } })
  if (!piece) return NextResponse.json({ error: "Piece nao encontrada" }, { status: 404 })
  const data: any = piece.data ? JSON.parse(piece.data) : {}
  return NextResponse.json({
    id: piece.id,
    name: piece.name,
    activeStepIndex: data.activeStepIndex,
    stepCount: Array.isArray(data.steps) ? data.steps.length : 1,
    steps: Array.isArray(data.steps) ? data.steps.map((s: any, i: number) => ({
      index: i,
      hasLayers: Array.isArray(s.layers),
      layerCount: Array.isArray(s.layers) ? s.layers.length : 0,
      imageUrl: s.imageUrl ?? null,
      thumbnailUrl: s.thumbnailUrl ?? null,
    })) : null,
    hasLegacyLayers: Array.isArray(data.layers),
    legacyLayerCount: Array.isArray(data.layers) ? data.layers.length : 0,
  })
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const pieceId = url.searchParams.get("pieceId")
  const reset = url.searchParams.get("reset") === "1"
  if (!pieceId) return NextResponse.json({ error: "pieceId obrigatorio" }, { status: 400 })
  const piece = await prisma.piece.findUnique({ where: { id: pieceId } })
  if (!piece) return NextResponse.json({ error: "Piece nao encontrada" }, { status: 404 })
  const data: any = piece.data ? JSON.parse(piece.data) : {}

  if (reset) {
    // Zera tudo: peca volta a ter 1 step (o conteudo legado de layers).
    delete data.steps
    delete data.activeStepIndex
    await prisma.piece.update({ where: { id: pieceId }, data: { data: JSON.stringify(data) } })
    return NextResponse.json({ ok: true, action: "reset_to_single_step" })
  }

  // Normalizacao:
  // 1. Se nao tem steps mas activeStepIndex existe, remove activeStepIndex
  // 2. Se steps existe mas length <= 1, descarta steps
  // 3. Se activeStepIndex >= steps.length, reseta pra 0
  let changed = false
  if (!Array.isArray(data.steps) || data.steps.length <= 1) {
    if (data.steps !== undefined) { delete data.steps; changed = true }
    if (data.activeStepIndex !== undefined) { delete data.activeStepIndex; changed = true }
  } else {
    if (typeof data.activeStepIndex !== "number" || data.activeStepIndex < 0 || data.activeStepIndex >= data.steps.length) {
      data.activeStepIndex = 0
      changed = true
    }
  }

  if (changed) {
    await prisma.piece.update({ where: { id: pieceId }, data: { data: JSON.stringify(data) } })
  }
  return NextResponse.json({ ok: true, changed })
}
