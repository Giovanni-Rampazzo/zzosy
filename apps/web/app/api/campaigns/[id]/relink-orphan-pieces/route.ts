// POST/GET /api/campaigns/[id]/relink-orphan-pieces
//
// Recovery PIECES: pra pieces com assetIds orfaos, re-vincula aos NOVOS
// assetIds da KV reconstruida via full-recover-from-psd. Match por ORDEM
// (zIndex) no array — pieces geradas herdaram ordem da matriz original.
//
// User pediu 2026-05-27: "tenta recuperar o que ja tinhamos funcionado antes".
// Apos full-recover, matriz volta com novos assetIds. Mas pieces continuam
// referenciando ids antigos. Esse endpoint re-vincula por posicao.
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

interface RelinkResult {
  ok: true
  campaignId: string
  piecesScanned: number
  piecesUpdated: number
  totalOrphanLayersFixed: number
  totalOrphanLayersUnfixable: number
  details: Array<{ pieceId: string; pieceName: string | null; layersFixed: number; layersStillOrphan: number }>
}

async function executeRelink(id: string, tenantId: string | null): Promise<RelinkResult | { error: string; status: number }> {
  const campaign = await prisma.campaign.findFirst({
    where: { id, ...(tenantId ? { client: { tenantId } } : {}) },
    include: { keyVision: true, pieces: true, assets: { select: { id: true } } },
  })
  if (!campaign) return { error: "Campaign not found", status: 404 }
  if (!campaign.keyVision?.data) return { error: "Campanha sem matriz (rode full-recover-from-psd primeiro)", status: 400 }

  let kvData: any
  try { kvData = JSON.parse(campaign.keyVision.data) } catch {
    return { error: "KV.data malformado", status: 500 }
  }
  const kvLayers: any[] = Array.isArray(kvData?.layers) ? kvData.layers : []
  if (kvLayers.length === 0) return { error: "KV sem layers", status: 400 }

  // Ordena KV layers por zIndex pra match consistente
  const kvLayersSorted = [...kvLayers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
  const validAssetIds = new Set(campaign.assets.map(a => a.id))

  const details: any[] = []
  let totalFixed = 0
  let totalUnfixable = 0
  let piecesUpdated = 0

  for (const p of campaign.pieces) {
    let pData: any
    try { pData = p.data ? JSON.parse(p.data) : null } catch { continue }
    if (!pData) continue
    const layers: any[] = Array.isArray(pData.layers) ? pData.layers : []
    if (layers.length === 0) continue

    // Layers da piece ordenadas por zIndex
    const sorted = [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

    let layersFixed = 0
    let layersStillOrphan = 0
    let modified = false

    for (let i = 0; i < sorted.length; i++) {
      const layer = sorted[i]
      const aid = layer.assetId
      if (!aid) continue
      if (validAssetIds.has(aid)) continue  // ja valido — skip

      // Orphan. Match pelo zIndex correspondente na KV.
      // Se piece tem mais layers que KV, sobra orphan unfixable.
      const kvLayer = kvLayersSorted[i]
      if (kvLayer && validAssetIds.has(kvLayer.assetId)) {
        layer.assetId = kvLayer.assetId
        layersFixed++
        modified = true
      } else {
        layersStillOrphan++
      }
    }

    if (modified) {
      // Re-write pData.layers (pode ter sido sorted-em-place mas pode estar
      // diferente da ordem original — mantemos ordem original do array
      // mas com assetIds atualizados).
      // Solucao: itera layers ORIGINAL e atualiza assetIds pelos da sorted.
      // Como modificamos sorted em-place E sorted aponta pros mesmos objects
      // de layers (spread shallow), na verdade os layers originais ja foram
      // mutados. Save:
      pData.layers = layers
      await prisma.piece.update({
        where: { id: p.id },
        data: {
          data: JSON.stringify(pData),
          dataBackup: p.data ?? null,
          imageUrl: null,  // forca regen thumb
        },
      })
      piecesUpdated++
    }

    totalFixed += layersFixed
    totalUnfixable += layersStillOrphan
    details.push({
      pieceId: p.id,
      pieceName: p.name,
      layersFixed,
      layersStillOrphan,
    })
  }

  return {
    ok: true,
    campaignId: id,
    piecesScanned: campaign.pieces.length,
    piecesUpdated,
    totalOrphanLayersFixed: totalFixed,
    totalOrphanLayersUnfixable: totalUnfixable,
    details,
  }
}

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any)?.tenantId
    const { id } = await ctx.params
    const result = await executeRelink(id, tenantId ?? null)
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  } catch (e: any) {
    console.error("[relink-orphan-pieces]", e)
    return NextResponse.json({ error: e?.message ?? "Erro", stack: e?.stack?.split("\n").slice(0, 6).join("\n") }, { status: 500 })
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(req.url)}`, req.url))
  const { searchParams } = new URL(req.url)
  if (searchParams.get("confirm") !== "1") {
    return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Relink pieces</title></head><body style="font-family:system-ui;padding:32px;max-width:640px;margin:0 auto">
<h2>🔗 Re-vincular peças aos novos assets</h2>
<p>Esta ação tenta restaurar as <strong>peças geradas</strong> da campanha, vinculando-as aos novos assetIds da matriz (que você recuperou via full-recover-from-psd).</p>
<p>Match feito por <strong>posição zIndex</strong> — layers no mesmo slot da matriz e da peça batem.</p>
<p>Layers extras (que não tinham equivalente na matriz) podem ficar órfãs.</p>
<p>Backup automático preservado.</p>
<p><a href="?confirm=1" style="display:inline-block;background:#F5C400;color:#111;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">✓ Executar Relink</a></p>
<p><a href="/campaigns/${id}">← Voltar sem fazer nada</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }

  const tenantId = (session.user as any)?.tenantId
  try {
    const result = await executeRelink(id, tenantId ?? null)
    if ("error" in result) {
      return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px;max-width:800px;margin:0 auto">
<h2>❌ Erro</h2><p>${result.error}</p>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { status: result.status, headers: { "Content-Type": "text/html; charset=utf-8" } })
    }
    return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Relink OK</title><meta http-equiv="refresh" content="4;url=/campaigns/${id}"></head><body style="font-family:system-ui;padding:32px;max-width:720px;margin:0 auto">
<h2>✅ Re-link concluído!</h2>
<ul>
  <li><strong>${result.piecesUpdated}</strong> peças atualizadas (de ${result.piecesScanned} scaneadas)</li>
  <li><strong>${result.totalOrphanLayersFixed}</strong> layers órfãos re-vinculados</li>
  ${result.totalOrphanLayersUnfixable > 0 ? `<li><strong style="color:#a00">${result.totalOrphanLayersUnfixable}</strong> layers ainda órfãos (sem equivalente na matriz nova)</li>` : ""}
</ul>
<p>Redirecionando pra campanha em 4 segundos…</p>
<p><a href="/campaigns/${id}">→ Ir agora</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  } catch (e: any) {
    const stack = e?.stack?.split("\n").slice(0, 8).join("\n") ?? "no stack"
    return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px;max-width:800px;margin:0 auto">
<h2>❌ Falha</h2>
<p><strong>${e?.message ?? String(e)}</strong></p>
<pre style="background:#f4f4f4;padding:12px;font-size:11px;overflow:auto">${stack}</pre>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
}
