// GET /api/campaigns/[id]/auto-recover?confirm=1
//
// Atalho 1-click: user cola URL no browser autenticado, endpoint dispara
// regenerate-empty-pieces internamente, depois REDIRECIONA pra /campaigns/[id]
// (que ja vai mostrar pecas regeneradas).
//
// User pediu 2026-05-27: "FAZ POR MIM" — maxima urgencia. Sem console,
// sem curl, sem cookie copy. So colar URL no browser.
//
// Pre-condicao: user precisa estar autenticado (NextAuth session cookie no
// browser). Se nao, getServerSession retorna null → redirect /login.
//
// confirm=1 obrigatorio pra evitar trigger acidental por crawlers/previews.
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const { searchParams } = new URL(req.url)
  if (searchParams.get("confirm") !== "1") {
    return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Confirmar recovery</title></head><body style="font-family:system-ui;padding:32px;max-width:600px;margin:0 auto">
<h2>⚠️ Confirmar recovery</h2>
<p>Esta ação vai REGENERAR todas as peças vazias da campanha a partir da matriz atual.</p>
<p>Peças com conteúdo NÃO serão tocadas. Backup automático preserva o estado anterior.</p>
<p><a href="?confirm=1" style="display:inline-block;background:#F5C400;color:#111;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700">✓ Confirmar e Executar</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }

  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(req.url)}`, req.url))
  }

  // Dispara o POST de regenerate-empty-pieces internamente.
  // Reusa a session-cookie automaticamente porque fetch dispara no mesmo host.
  const cookieHeader = req.headers.get("cookie") ?? ""
  const origin = new URL(req.url).origin
  const apiUrl = `${origin}/api/campaigns/${id}/regenerate-empty-pieces`
  let result: any = null
  try {
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: { "Cookie": cookieHeader },
      cache: "no-store",
    })
    result = await r.json().catch(() => ({ error: "resposta nao-JSON" }))
    if (!r.ok) {
      return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px;max-width:600px;margin:0 auto">
<h2>❌ Erro na recovery</h2>
<p>HTTP ${r.status}</p>
<pre>${JSON.stringify(result, null, 2)}</pre>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { status: r.status, headers: { "Content-Type": "text/html; charset=utf-8" } })
    }
  } catch (e: any) {
    return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px">
<h2>❌ Falha interna</h2><pre>${String(e?.message ?? e)}</pre>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } })
  }

  // Sucesso: tela bonita confirmando + auto-redirect em 2s.
  const count = result?.regeneratedCount ?? 0
  const skipped = result?.skippedCount ?? 0
  return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recovery OK</title><meta http-equiv="refresh" content="2;url=/campaigns/${id}"></head><body style="font-family:system-ui;padding:32px;max-width:600px;margin:0 auto">
<h2>✅ Recovery completa</h2>
<p><strong>${count}</strong> peça(s) regenerada(s) a partir da matriz.</p>
${skipped > 0 ? `<p>${skipped} peça(s) com conteúdo OK — não tocadas.</p>` : ""}
<p>Redirecionando pra campanha em 2 segundos…</p>
<p><a href="/campaigns/${id}">→ Ir agora</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
}
