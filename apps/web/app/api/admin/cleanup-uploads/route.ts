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
import { prisma } from "@/lib/prisma"
import fs from "fs/promises"
import path from "path"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries: any[]
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return [] }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...await walk(full))
    else if (e.isFile()) out.push(full)
  }
  return out
}

function relativize(full: string): string {
  const idx = full.indexOf("/uploads/")
  return idx >= 0 ? full.substring(idx) : full
}

async function fileSize(p: string): Promise<number> {
  try { const s = await fs.stat(p); return s.size } catch { return 0 }
}

interface CleanupResult {
  ok: true
  dryRun: boolean
  totalFiles: number
  totalBytes: number
  orphanFiles: number
  orphanBytes: number
  deletedFiles: number
  deletedBytes: number
  failedDeletes: number
  top10: { path: string; sizeMB: string }[]
}

async function runCleanup(dryRun: boolean): Promise<CleanupResult> {
  const ROOT = path.resolve(process.cwd(), "public/uploads")
  // Coleta refs DB
  const dbUrls = new Set<string>()
  const [campaigns, pieces, deliveries, sos, kvs] = await Promise.all([
    prisma.campaign.findMany({ select: { psdUrl: true } }),
    prisma.piece.findMany({ select: { imageUrl: true, thumbnailUrl: true, data: true } }),
    prisma.delivery.findMany({ select: { zipUrl: true } }),
    prisma.smartObjectFile.findMany({ select: { filePath: true } }),
    prisma.keyVision.findMany({ select: { thumbnailUrl: true } }),
  ])
  for (const c of campaigns) if (c.psdUrl) dbUrls.add(c.psdUrl)
  for (const p of pieces) {
    if (p.imageUrl) dbUrls.add(p.imageUrl)
    if (p.thumbnailUrl) dbUrls.add(p.thumbnailUrl)
    if (p.data) {
      try {
        const d = JSON.parse(p.data)
        if (Array.isArray(d?.steps)) {
          for (const s of d.steps) {
            if (s?.imageUrl) dbUrls.add(s.imageUrl)
            if (s?.thumbnailUrl) dbUrls.add(s.thumbnailUrl)
          }
        }
      } catch { /* ignora */ }
    }
  }
  for (const d of deliveries) if (d.zipUrl) dbUrls.add(d.zipUrl)
  for (const so of sos) if (so.filePath) dbUrls.add(so.filePath)
  for (const kv of kvs) if (kv.thumbnailUrl) dbUrls.add(kv.thumbnailUrl)

  // Walk fs
  const files = await walk(ROOT)
  let totalBytes = 0
  let orphanBytes = 0
  const orphans: { path: string; size: number }[] = []
  for (const f of files) {
    const sz = await fileSize(f)
    totalBytes += sz
    const rel = relativize(f)
    let ref = dbUrls.has(rel)
    if (!ref) {
      for (const u of dbUrls) {
        if (u.startsWith(rel + "?")) { ref = true; break }
      }
    }
    if (ref) continue
    orphanBytes += sz
    orphans.push({ path: f, size: sz })
  }

  let deletedFiles = 0
  let deletedBytes = 0
  let failedDeletes = 0
  if (!dryRun) {
    for (const o of orphans) {
      try {
        await fs.unlink(o.path)
        deletedFiles++
        deletedBytes += o.size
      } catch { failedDeletes++ }
    }
  }

  const top10 = [...orphans].sort((a, b) => b.size - a.size).slice(0, 10).map(o => ({
    path: relativize(o.path),
    sizeMB: (o.size / 1024 / 1024).toFixed(1),
  }))

  return {
    ok: true,
    dryRun,
    totalFiles: files.length,
    totalBytes,
    orphanFiles: orphans.length,
    orphanBytes,
    deletedFiles,
    deletedBytes,
    failedDeletes,
    top10,
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(req.url)}`, req.url))
  }
  const { searchParams } = new URL(req.url)

  // Dry-run JSON
  if (searchParams.get("dry") === "1") {
    try {
      const result = await runCleanup(true)
      return NextResponse.json(result)
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "Erro", stack: e?.stack?.split("\n").slice(0, 6).join("\n") }, { status: 500 })
    }
  }

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
