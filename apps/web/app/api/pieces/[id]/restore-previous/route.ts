// POST /api/pieces/[id]/restore-previous
//
// Anti-falhas 2026-05-26: reverte piece.data pro dataBackup (versao salva
// ANTES do save mais recente). Recovery rapida quando save corrompeu conteudo.
//
// Flow:
//   piece.data = piece.dataBackup
//   piece.dataBackup = piece.data (swap — permite UNDO do restore)
//
// User sees: "Restaurada versao anterior". Pode clicar de novo pra desfazer
// (volta ao estado pre-restore).
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId

  const { id } = await ctx.params
  const piece = await prisma.piece.findFirst({
    where: { id, campaign: { client: { tenantId } } },
  })
  if (!piece) return apiErrors.notFound()
  const backup = (piece as any).dataBackup
  if (!backup) {
    return NextResponse.json({ error: "Sem backup disponivel" }, { status: 400 })
  }

  // Swap: dataAtual ↔ dataBackup. Permite "Desfazer restore" clicando o
  // mesmo botao de novo (cicla entre 2 versoes).
  const currentData = piece.data
  await prisma.piece.update({
    where: { id },
    data: {
      data: backup,
      dataBackup: currentData,
      imageUrl: null,  // forca regen thumb
    },
  })

  let layerCount = 0
  try {
    const parsed = JSON.parse(backup)
    if (Array.isArray(parsed?.layers)) layerCount = parsed.layers.length
  } catch {}

  return NextResponse.json({
    ok: true,
    pieceId: id,
    restoredLayerCount: layerCount,
    message: `Versao anterior restaurada (${layerCount} layers)`,
  })
}
