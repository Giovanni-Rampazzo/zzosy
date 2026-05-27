import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { appendToTaxonomy } from "@/lib/taxonomy"
import { PIECE_STATUS_LIST } from "@/lib/pieceStatus"
import { stampPiece } from "@/lib/stampPiece"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"

// Whitelist de campos aceitos em PATCH. Sem isso, qualquer field do schema
// podia ser sobrescrito (incluindo campaignId, createdAt, etc).
const PIECE_PATCH_FIELDS = new Set([
  "name", "segment", "copy", "status", "data", "imageUrl", "mediaFormatId",
])
const PIECE_STATUS_SET = new Set<string>(PIECE_STATUS_LIST as string[])

type Ctx = { params: Promise<{ id: string }> }

// Verifica que a peça (via campaign → client) pertence ao tenant da sessão.
// Retorna a peça ou null. Usado em GET/PATCH/DELETE pra evitar acesso cross-tenant.
async function findPieceForTenant(id: string, tenantId: string) {
  return prisma.piece.findFirst({
    where: { id, campaign: { client: { tenantId } } },
  })
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { id } = await ctx.params
  const piece = await findPieceForTenant(id, tenantId)
  if (!piece) return apiErrors.notFound()
  // Stampa imageUrl + steps com ?v=updatedAt — antes detalhe servia URL raw e
  // browser cacheava thumb stale (audit F2.2). Lista (/api/pieces) ja fazia.
  return NextResponse.json(stampPiece(piece))
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { id } = await ctx.params
  const existing = await findPieceForTenant(id, tenantId)
  if (!existing) return apiErrors.notFound()
  const body = await req.json()
  // Whitelist: so deixa passar fields conhecidos. Bloqueia tentativa de
  // mexer em campaignId, createdAt, FKs internas via PATCH.
  const data: any = {}
  for (const k of Object.keys(body ?? {})) {
    if (PIECE_PATCH_FIELDS.has(k)) data[k] = body[k]
  }
  // Validar status contra lista permitida.
  if (data.status !== undefined && !PIECE_STATUS_SET.has(String(data.status))) {
    return NextResponse.json({
      error: "Invalid status",
      allowed: Array.from(PIECE_STATUS_SET),
    }, { status: 400 })
  }
  // Status ENTREGUE eh marcador automatico setado em /api/deliveries POST.
  // Bloqueia mudanca manual pra "ENTREGUE" via PATCH; reverter de ENTREGUE
  // pra outro status (ex: REPROVADO depois de cliente recusar) eh permitido.
  if (data.status === "ENTREGUE") {
    return NextResponse.json({
      error: "Status ENTREGUE eh automatico — use /api/deliveries pra entregar",
    }, { status: 400 })
  }

  // ANTI-FALHAS 2026-05-26: guard + backup inteligente.
  //
  // Guard 409: rejeita save se newData.layers vazio MAS oldData.layers
  // tinha conteudo (sinal de save fantasma). Pode ser bypassado com
  // ?force=1 (user explicitamente quer apagar tudo).
  //
  // Backup smart: NUNCA sobrescreve dataBackup com estado degradado.
  // Se newLayerCount < oldLayerCount (perdeu layers), MANTEM backup
  // antigo (que tem mais conteudo). Sem isso, 2 bad saves consecutivos
  // perdiam o GOOD original — segundo save backuparia o primeiro bad.
  const { searchParams } = new URL(req.url)
  const forceEmpty = searchParams.get("force") === "1"
  if ("data" in data && typeof data.data === "string" && data.data.length > 0) {
    try {
      const newParsed = JSON.parse(data.data)
      const oldParsed = existing.data ? JSON.parse(existing.data) : null
      const newLayerCount = Array.isArray(newParsed?.layers) ? newParsed.layers.length : 0
      const oldLayerCount = Array.isArray(oldParsed?.layers) ? oldParsed.layers.length : 0
      const newStepsHasLayers = Array.isArray(newParsed?.steps) && newParsed.steps.some((s: any) => Array.isArray(s?.layers) && s.layers.length > 0)
      const oldStepsHasLayers = Array.isArray(oldParsed?.steps) && oldParsed.steps.some((s: any) => Array.isArray(s?.layers) && s.layers.length > 0)
      const newEmpty = newLayerCount === 0 && !newStepsHasLayers
      const oldHasContent = oldLayerCount > 0 || oldStepsHasLayers
      if (newEmpty && oldHasContent && !forceEmpty) {
        console.error("[piece PATCH] BLOQUEADO save vazio — oldLayers:", oldLayerCount, "stepsHadLayers:", oldStepsHasLayers)
        return NextResponse.json({
          error: "Save bloqueado — tentou gravar layers vazios sobre conteudo existente. Use ?force=1 pra forcar.",
          oldLayerCount,
          newLayerCount,
        }, { status: 409 })
      }
      // Smart backup: so atualiza dataBackup se newCount >= oldCount.
      // Preserva backup do estado GOOD mesmo se subsequent saves degradam.
      // Edge: se old eh null (primeira gravacao), backup = null. OK.
      const oldBackupParsed = (existing as any).dataBackup
        ? (() => { try { return JSON.parse((existing as any).dataBackup) } catch { return null } })()
        : null
      const backupLayerCount = Array.isArray(oldBackupParsed?.layers) ? oldBackupParsed.layers.length : 0
      if (existing.data) {
        // Se backup vazio ou o existing tem MAIS conteudo, atualiza.
        // Senao mantem backup antigo (tem mais layers — provavel GOOD original).
        if (backupLayerCount === 0 || oldLayerCount >= backupLayerCount) {
          data.dataBackup = existing.data
        }
        // else: NAO sobrescreve. Backup antigo tem mais conteudo que existing.
      }
    } catch (e) {
      console.warn("[piece PATCH] parse data falhou (passando sem backup):", e)
    }
  }

  const piece = await prisma.piece.update({ where: { id }, data })
  // Auto-merge: quando user grava segment numa peca, append na Tenant.taxonomy
  // (source-of-truth: gerenciado via ClientSettingsCard em /clients/[id]/edit
  // que persiste no mesmo Tenant.taxonomy). Sincronia bidirecional: segments
  // novos em pecas viram sugestoes no painel do cliente automaticamente.
  if (typeof body?.segment === "string" && body.segment.trim().length > 0) {
    try {
      const camp = await prisma.campaign.findUnique({
        where: { id: piece.campaignId },
        select: { client: { select: { tenantId: true } } },
      })
      const tenantId = camp?.client?.tenantId
      if (tenantId) {
        await appendToTaxonomy(prisma, tenantId, "segments", body.segment)
      }
    } catch (err) {
      console.warn("[piece PATCH] auto-append segment falhou:", err)
    }
  }
  return NextResponse.json(piece)
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { id } = await ctx.params
  const existing = await findPieceForTenant(id, tenantId)
  if (!existing) return apiErrors.notFound()
  await prisma.piece.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
