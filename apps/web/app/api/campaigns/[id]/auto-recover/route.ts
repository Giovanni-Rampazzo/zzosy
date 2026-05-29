// GET /api/campaigns/[id]/auto-recover  → pagina HTML com botao POST de confirmacao
// POST /api/campaigns/[id]/auto-recover → executa regenerate-empty-pieces
//
// Atalho 1-click: user cola URL no browser autenticado, ve pagina de confirmacao,
// clica botao (form submit POST), endpoint dispara regenerate-empty-pieces e
// retorna pagina HTML de status.
//
// User pediu 2026-05-27: "FAZ POR MIM" — maxima urgencia. Sem console,
// sem curl, sem cookie copy. So colar URL no browser.
//
// SEC: GET nao executa (CSRF mitigation — antes era GET com ?confirm=1, que
// disparava via <img src> em pagina same-site). Execucao via POST exclusivamente.
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { regenerateEmptyPiecesForCampaign } from "@/lib/regenerateEmptyPieces"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(req.url)}`, req.url))
  }
  // GET nao executa — so renderiza confirmacao com form POST.
  return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Confirmar recovery</title></head><body style="font-family:system-ui;padding:32px;max-width:600px;margin:0 auto">
<h2>⚠️ Confirmar recovery</h2>
<p>Esta ação vai REGENERAR todas as peças vazias da campanha a partir da matriz atual.</p>
<p>Peças com conteúdo NÃO serão tocadas. Backup automático preserva o estado anterior.</p>
<form method="POST" action="">
  <button type="submit" style="background:#F5C400;color:#111;padding:12px 24px;border-radius:6px;border:0;font-weight:700;cursor:pointer">✓ Confirmar e Executar</button>
</form>
<p style="margin-top:16px"><a href="/campaigns/${id}">← Voltar sem fazer nada</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(req.url)}`, req.url))
  }

  // Auth tenant: valida que a campanha pertence ao tenant do user.
  const tenantId = (session.user as any)?.tenantId
  if (!tenantId) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(req.url)}`, req.url))
  }
  const campaign = await prisma.campaign.findFirst({
    where: { id, client: { tenantId } },
    select: { id: true },
  })
  if (!campaign) {
    return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px">
<h2>❌ Campanha nao encontrada ou sem acesso</h2>
<p><a href="/campaigns">← Voltar</a></p>
</body></html>`, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } })
  }

  // Executa direto via lib (sem self-fetch — antes o fetch interno falhava
  // em runtime Next, causando 'Falha interna - fetch failed').
  const wantsHtml = (req.headers.get("accept") ?? "").includes("text/html")
  try {
    const result = await regenerateEmptyPiecesForCampaign(id)
    if ("error" in result) {
      if (!wantsHtml) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px;max-width:600px;margin:0 auto">
<h2>❌ Erro na recovery</h2>
<p><strong>${result.error}</strong></p>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { status: result.status, headers: { "Content-Type": "text/html; charset=utf-8" } })
    }
    if (!wantsHtml) return NextResponse.json(result)
    return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recovery OK</title><meta http-equiv="refresh" content="2;url=/campaigns/${id}"></head><body style="font-family:system-ui;padding:32px;max-width:600px;margin:0 auto">
<h2>✅ Recovery completa</h2>
<p><strong>${result.regeneratedCount}</strong> peça(s) regenerada(s) a partir da matriz.</p>
${result.skippedCount > 0 ? `<p>${result.skippedCount} peça(s) com conteúdo OK — não tocadas.</p>` : ""}
<p>Redirecionando pra campanha em 2 segundos…</p>
<p><a href="/campaigns/${id}">→ Ir agora</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  } catch (e: any) {
    const stack = e?.stack ?? String(e)
    const name = e?.name ?? "Error"
    const msg = e?.message ?? String(e)
    const cause = e?.cause ? `\nCAUSE: ${JSON.stringify(e.cause, null, 2)}` : ""
    console.error("[auto-recover] catch:", e)
    if (!wantsHtml) return NextResponse.json({ error: msg, stack: stack.split("\n").slice(0, 6).join("\n") }, { status: 500 })
    return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px;max-width:900px;margin:0 auto">
<h2>❌ Falha interna</h2>
<p><strong>${name}:</strong> ${msg}</p>
<details open><summary>Stack trace</summary>
<pre style="background:#f4f4f4;padding:12px;font-size:11px;overflow:auto">${stack}${cause}</pre>
</details>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
}
