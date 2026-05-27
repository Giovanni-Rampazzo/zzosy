// POST /api/campaigns/[id]/server-render-thumbs
//
// Renderiza thumbs de TODAS pieces sem imageUrl via @napi-rs/canvas
// server-side. Pula pieces ja com thumb. Render simplificado (sem texto)
// mas mostra fotos + shapes — instant visual preview.
//
// User pediu 2026-05-27: thumbs lentos pos-relink. Server render eh ~10x
// mais rapido que client render porque:
//  - Sem download de Fabric.js + parse no client
//  - Imagens carregadas direto do storage local (no network roundtrip)
//  - Paralelismo controlado por worker pool
//
// Trade-off: texto nao renderizado server-side. Aparece quando user abre
// a peca + auto-regen client roda completo.
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"
import { renderAllPiecesThumbsServer } from "@/lib/serverThumbRender"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 120

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any)?.tenantId
    const { id } = await ctx.params
    // Tenant filter
    const campaign = await prisma.campaign.findFirst({
      where: { id, ...(tenantId ? { client: { tenantId } } : {}) },
      select: { id: true },
    })
    if (!campaign) return apiErrors.notFound()
    const t0 = Date.now()
    const result = await renderAllPiecesThumbsServer(id, 4)
    return NextResponse.json({ ...result, durationMs: Date.now() - t0 })
  } catch (e: any) {
    console.error("[server-render-thumbs]", e)
    return NextResponse.json({ error: e?.message ?? "Erro", stack: e?.stack?.split("\n").slice(0, 6).join("\n") }, { status: 500 })
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(req.url)}`, req.url))
  const { searchParams } = new URL(req.url)
  if (searchParams.get("confirm") !== "1") {
    return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Server render thumbs</title></head><body style="font-family:system-ui;padding:32px;max-width:640px;margin:0 auto">
<h2>⚡ Server render thumbs</h2>
<p>Gera previews server-side (sem fabric no browser). ~10x mais rápido que regen client.</p>
<p>Trade-off: texto não é renderizado server-side — vem quando você abre a peça + auto-regen completar.</p>
<p>Skipa pieces que já têm imageUrl.</p>
<p><a href="?confirm=1" style="display:inline-block;background:#F5C400;color:#111;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700">✓ Render Server</a></p>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
  // Verifica tenant
  const tenantId = (session.user as any)?.tenantId
  const campaign = await prisma.campaign.findFirst({
    where: { id, ...(tenantId ? { client: { tenantId } } : {}) },
    select: { id: true },
  })
  if (!campaign) {
    return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px"><h2>❌ Campanha nao encontrada</h2><p><a href="/campaigns">← Voltar</a></p></body></html>`, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
  try {
    const t0 = Date.now()
    const result = await renderAllPiecesThumbsServer(id, 4)
    const dur = Date.now() - t0
    return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>OK</title><meta http-equiv="refresh" content="3;url=/campaigns/${id}"></head><body style="font-family:system-ui;padding:32px;max-width:640px;margin:0 auto">
<h2>✅ Server render completo!</h2>
<ul>
  <li><strong>${result.ok}</strong> pieces com thumb gerado</li>
  ${result.failed > 0 ? `<li><strong>${result.failed}</strong> pieces falharam</li>` : ""}
  <li>Duração: <strong>${(dur/1000).toFixed(1)}s</strong></li>
</ul>
<p>Redirecionando pra campanha em 3 segundos…</p>
<p><a href="/campaigns/${id}">→ Ir agora</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  } catch (e: any) {
    const stack = e?.stack?.split("\n").slice(0, 8).join("\n") ?? "no stack"
    return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px;max-width:800px;margin:0 auto">
<h2>❌ Falha</h2><p><strong>${e?.message ?? String(e)}</strong></p>
<pre style="background:#f4f4f4;padding:12px;font-size:11px">${stack}</pre>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
}
