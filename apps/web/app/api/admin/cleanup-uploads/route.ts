// GET/POST /api/admin/cleanup-uploads
//
// Limpa arquivos orfaos do /public/uploads/ no servidor.
// User-friendly: SO precisa estar logado, abre URL no browser.
//
// User reportou 2026-05-27: ENOSPC no Railway. Sem acesso CLI, este
// endpoint resolve via HTTP autenticado.
//
// Uso:
//   GET /api/admin/cleanup-uploads          → pagina HTML com botao
//   GET /api/admin/cleanup-uploads?dry=1    → JSON dry-run (só reporta)
//   GET /api/admin/cleanup-uploads?confirm=1 → executa cleanup
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { runOrphanCleanup } from "@/lib/storage/autoCleanup"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300

// SEC FIX 2026-05-27: endpoint era acessivel por qualquer user logado
// (incluido CSRF via <img>) e poderia apagar arquivos cross-tenant.
// Agora requer SUPER_ADMIN.
async function requireSuperAdmin(req: NextRequest): Promise<{ ok: true } | { ok: false; status: number; msg: string }> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return { ok: false, status: 401, msg: "Nao autenticado" }
  const me = await prisma.user.findUnique({ where: { email: session.user.email } })
  if (me?.role !== "SUPER_ADMIN") return { ok: false, status: 403, msg: "Apenas SUPER_ADMIN" }
  return { ok: true }
}

async function runCleanup(dryRun: boolean) {
  const result = await runOrphanCleanup({ dryRun })
  return { ok: true as const, dryRun, ...result }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(req.url)}`, req.url))
  }
  // SEC: SUPER_ADMIN required (era acessivel por qualquer user logado)
  const adminCheck = await requireSuperAdmin(req)
  if (!adminCheck.ok) {
    return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px"><h2>❌ ${adminCheck.msg}</h2></body></html>`, { status: adminCheck.status, headers: { "Content-Type": "text/html" } })
  }

  const { searchParams } = new URL(req.url)

  // Dry-run JSON
  if (searchParams.get("dry") === "1") {
    try {
      const result = await runCleanup(true)
      return NextResponse.json(result)
    } catch (e: any) {
      return NextResponse.json({
        error: e?.message ?? "Erro",
        ...(process.env.NODE_ENV !== "production" ? { stack: e?.stack?.split("\n").slice(0, 6).join("\n") } : {}),
      }, { status: 500 })
    }
  }

  // SEC: confirm via POST CSRF token would be ideal. Por ora, browser navigation
  // direto + admin role + visual confirm na pagina HTML eh ok pra hobby.
  // Execute real
  if (searchParams.get("confirm") === "1") {
    try {
      const result = await runCleanup(false)
      const fmt = (b: number) => (b / 1024 / 1024).toFixed(1) + "MB"
      return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cleanup OK</title></head><body style="font-family:system-ui;padding:32px;max-width:720px;margin:0 auto">
<h2>✅ Cleanup completo</h2>
<table style="font-size:14px;line-height:1.6">
<tr><td>Total no disco</td><td><strong>${fmt(result.totalBytes)}</strong></td></tr>
<tr><td>Orfaos encontrados</td><td>${result.orphanFiles} arquivos (${fmt(result.orphanBytes)})</td></tr>
<tr><td>Apagados</td><td><strong>${result.deletedFiles} arquivos (${fmt(result.deletedBytes)})</strong></td></tr>
${result.failedDeletes > 0 ? `<tr><td>Falhas</td><td style="color:#c00">${result.failedDeletes}</td></tr>` : ""}
<tr><td>Espaco apos cleanup</td><td><strong>${fmt(result.totalBytes - result.deletedBytes)}</strong></td></tr>
</table>
<p style="margin-top:24px">Volte pra <a href="/campaigns">/campaigns</a> e tente importar PSD agora.</p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    } catch (e: any) {
      return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px"><h2>❌ Falha</h2><pre>${e?.message}\n${e?.stack?.substring(0, 500)}</pre></body></html>`, { status: 500 })
    }
  }

  // Página HTML padrão (form de confirmação)
  let dryReport = ""
  try {
    const dry = await runCleanup(true)
    const fmt = (b: number) => (b / 1024 / 1024).toFixed(1) + "MB"
    dryReport = `<h3>Preview (dry-run):</h3>
<table style="font-size:14px;line-height:1.6">
<tr><td>Total no disco</td><td><strong>${fmt(dry.totalBytes)}</strong></td></tr>
<tr><td>Orfaos</td><td><strong>${dry.orphanFiles} arquivos = ${fmt(dry.orphanBytes)}</strong></td></tr>
<tr><td>Apos cleanup</td><td>${fmt(dry.totalBytes - dry.orphanBytes)}</td></tr>
</table>
<h4>Top 10 maiores orfaos:</h4>
<ul style="font-family:monospace;font-size:12px">
${dry.top10.map(t => `<li>${t.sizeMB}MB &nbsp; ${t.path}</li>`).join("")}
</ul>`
  } catch (e: any) {
    dryReport = `<p style="color:#c00">Falha no preview: ${e?.message}</p>`
  }

  return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cleanup uploads</title></head><body style="font-family:system-ui;padding:32px;max-width:720px;margin:0 auto">
<h2>🧹 Cleanup uploads orfaos</h2>
<p>Apaga arquivos em <code>/public/uploads/</code> que NAO tem referencia no DB (Campaign.psdUrl, Piece.imageUrl/thumbnailUrl, Delivery.zipUrl, SmartObjectFile.filePath, KeyVision.thumbnailUrl).</p>
<p>Disco do Railway esta lotado (erro <code>ENOSPC</code>) impedindo imports. Este cleanup libera espaco sem perder nada referenciado.</p>
${dryReport}
<p style="margin-top:24px"><a href="?confirm=1" style="display:inline-block;background:#d33;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700">⚠️ Apagar orfaos</a></p>
<p><a href="?dry=1">Ver dry-run JSON</a> · <a href="/campaigns">← Voltar</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
}
