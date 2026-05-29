/**
 * autoCleanup — modulo compartilhado que apaga arquivos orfaos do
 * /public/uploads/. Usado por:
 *   - LocalFileStorageAdapter.put (rescue automatico em ENOSPC)
 *   - /api/admin/cleanup-uploads (cleanup manual via UI)
 *   - scripts/cleanup-uploads.ts (cleanup manual via CLI)
 *
 * Politica: apaga so o que NAO tem referencia em nenhum campo de DB.
 *
 * IMPORTANTE — toda nova coluna de URL no schema precisa entrar em
 * collectDbUrls(). Esquecer = cleanup APAGA arquivos referenciados por
 * essas colunas como "orfaos". Bug grave de perda de dados.
 *
 * Cobertura atual (toda coluna *Url/*Path de @db.LongText/Text):
 *   - Tenant.brandLogoUrl, Tenant.brandSecondaryLogoUrl
 *   - Client.brandLogoUrl, Client.customFontUrl
 *   - Campaign.psdUrl
 *   - CampaignAsset.imageUrl
 *   - ClientLibraryAsset.imageUrl/thumbnailUrl
 *   - ClientLibrarySmartObjectFile.filePath
 *   - SmartObjectFile.filePath
 *   - KeyVision.thumbnailUrl
 *   - Piece.imageUrl/thumbnailUrl + data.steps[].imageUrl/thumbnailUrl
 *   - Delivery.zipUrl
 */
import fs from "fs/promises"
import path from "path"
import { prisma } from "@/lib/prisma"

export interface OrphanCleanupResult {
  totalFiles: number
  totalBytes: number
  orphanFiles: number
  orphanBytes: number
  deletedFiles: number
  deletedBytes: number
  failedDeletes: number
  top10: { path: string; sizeMB: string }[]
}

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

async function collectDbUrls(): Promise<Set<string>> {
  const dbUrls = new Set<string>()
  // Coleta TODA coluna de URL/Path do schema. Esquecer 1 tabela = cleanup
  // apaga arquivos referenciados so por ela como "orfaos" (bug 2026-05-29
  // descoberto via screenshot: 4 IMAGE assets do library com broken images
  // — ClientLibraryAsset.imageUrl ficou de fora ate aqui).
  const [
    tenants, clients, campaigns, campaignAssets,
    libraryAssets, librarySmartObjects,
    pieces, deliveries, sos, kvs,
  ] = await Promise.all([
    prisma.tenant.findMany({ select: { brandLogoUrl: true, brandSecondaryLogoUrl: true } }),
    prisma.client.findMany({ select: { brandLogoUrl: true, customFontUrl: true } }),
    prisma.campaign.findMany({ select: { psdUrl: true } }),
    prisma.campaignAsset.findMany({ select: { imageUrl: true } }),
    prisma.clientLibraryAsset.findMany({ select: { imageUrl: true, thumbnailUrl: true } }),
    prisma.clientLibrarySmartObjectFile.findMany({ select: { filePath: true } }),
    prisma.piece.findMany({ select: { imageUrl: true, thumbnailUrl: true, data: true } }),
    prisma.delivery.findMany({ select: { zipUrl: true } }),
    prisma.smartObjectFile.findMany({ select: { filePath: true } }),
    prisma.keyVision.findMany({ select: { thumbnailUrl: true } }),
  ])
  for (const t of tenants) {
    if (t.brandLogoUrl) dbUrls.add(t.brandLogoUrl)
    if (t.brandSecondaryLogoUrl) dbUrls.add(t.brandSecondaryLogoUrl)
  }
  for (const c of clients) {
    if (c.brandLogoUrl) dbUrls.add(c.brandLogoUrl)
    if (c.customFontUrl) dbUrls.add(c.customFontUrl)
  }
  for (const c of campaigns) if (c.psdUrl) dbUrls.add(c.psdUrl)
  for (const ca of campaignAssets) if (ca.imageUrl) dbUrls.add(ca.imageUrl)
  for (const la of libraryAssets) {
    if (la.imageUrl) dbUrls.add(la.imageUrl)
    if (la.thumbnailUrl) dbUrls.add(la.thumbnailUrl)
  }
  for (const lso of librarySmartObjects) if (lso.filePath) dbUrls.add(lso.filePath)
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
  return dbUrls
}

export async function runOrphanCleanup(opts: { dryRun?: boolean } = {}): Promise<OrphanCleanupResult> {
  const dryRun = opts.dryRun === true
  const ROOT = path.resolve(process.cwd(), "public/uploads")

  const dbUrls = await collectDbUrls()
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
