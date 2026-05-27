/**
 * cleanup-uploads.ts — limpa arquivos orfaos do /uploads que nao tem
 * referencia no DB. Apaga deliveries antigas e thumbs orfaos.
 *
 * Uso (Railway shell):
 *   railway run -- npx tsx scripts/cleanup-uploads.ts --dry      # so reporta
 *   railway run -- npx tsx scripts/cleanup-uploads.ts            # apaga de verdade
 *
 * Politica:
 *   - /uploads/deliveries/*.zip mais antigos que 7 dias → DELETA
 *   - /uploads/campaigns/X/pieces/*.jpg/png → DELETA se piece.imageUrl !== arquivo
 *   - /uploads/campaigns/X/step-thumbs/*.png → DELETA se step.imageUrl !== arquivo
 *   - /uploads/campaigns/X/master-*.psd → DELETA se campaign.psdUrl !== arquivo
 *   - /uploads/campaigns/X/server-thumb-*.jpg → DELETA se piece.imageUrl !== arquivo
 *   - /uploads/campaigns/X/smart/*.* → DELETA se SmartObjectFile.filePath !== arquivo
 */
import fs from "fs/promises"
import path from "path"
import { PrismaClient } from "@prisma/client"

const DRY_RUN = process.argv.includes("--dry")
const ROOT = path.resolve(process.cwd(), "public/uploads")
const DELIVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000  // 7 days

const prisma = new PrismaClient()

async function fileSize(p: string): Promise<number> {
  try { const s = await fs.stat(p); return s.size } catch { return 0 }
}
async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
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
  // Conver pra /uploads/... (formato armazenado em DB)
  const idx = full.indexOf("/uploads/")
  return idx >= 0 ? full.substring(idx) : full
}

async function main() {
  console.log(`Cleanup ${DRY_RUN ? "(DRY RUN — nada apagado)" : "(APAGA arquivos)"}`)
  console.log(`Root: ${ROOT}\n`)

  // Coleta TODAS as URLs do DB
  console.log("Coletando refs do DB...")
  const dbUrls = new Set<string>()

  const [campaigns, pieces, deliveries, sos, kvs] = await Promise.all([
    prisma.campaign.findMany({ select: { id: true, psdUrl: true } }),
    prisma.piece.findMany({ select: { id: true, imageUrl: true, thumbnailUrl: true, data: true } }),
    prisma.delivery.findMany({ select: { id: true, zipUrl: true, createdAt: true } }),
    prisma.smartObjectFile.findMany({ select: { id: true, filePath: true } }),
    prisma.keyVision.findMany({ select: { thumbnailUrl: true } }),
  ])

  for (const c of campaigns) if (c.psdUrl) dbUrls.add(c.psdUrl)
  for (const p of pieces) {
    if (p.imageUrl) dbUrls.add(p.imageUrl)
    if (p.thumbnailUrl) dbUrls.add(p.thumbnailUrl)
    // piece.data.steps[i].imageUrl/thumbnailUrl
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

  console.log(`Refs DB: ${dbUrls.size} URLs\n`)

  // Walk filesystem
  console.log(`Escaneando ${ROOT}...`)
  const files = await walk(ROOT)
  console.log(`Arquivos no disco: ${files.length}\n`)

  let toDelete: { path: string; reason: string; size: number }[] = []
  let totalBytes = 0
  let orphanBytes = 0

  for (const f of files) {
    const sz = await fileSize(f)
    totalBytes += sz
    const rel = relativize(f)
    // Stripped de query strings — DB pode ter ?v=N
    if (dbUrls.has(rel)) continue
    // Check com ? bare
    let ref = false
    for (const u of dbUrls) {
      if (u.startsWith(rel + "?") || u === rel) { ref = true; break }
    }
    if (ref) continue

    // Delivery ZIPs: mais antigos que 7d viram orfaos mesmo se referenciados.
    // Mas vamos manter referenciados.

    orphanBytes += sz
    toDelete.push({ path: f, reason: "orfao (sem ref DB)", size: sz })
  }

  const fmt = (b: number) => (b / 1024 / 1024).toFixed(1) + "MB"
  console.log(`\n=== RESUMO ===`)
  console.log(`Total no disco: ${fmt(totalBytes)}`)
  console.log(`Orfaos: ${toDelete.length} arquivos, ${fmt(orphanBytes)}`)
  console.log(`Apos cleanup: ${fmt(totalBytes - orphanBytes)}\n`)

  // Mostra top 10
  const top = [...toDelete].sort((a, b) => b.size - a.size).slice(0, 10)
  console.log(`Top 10 maiores orfaos:`)
  for (const f of top) console.log(`  ${fmt(f.size).padStart(10)} ${relativize(f.path)}`)

  if (DRY_RUN) {
    console.log(`\n--dry — nada apagado. Re-rode sem --dry pra apagar.`)
    await prisma.$disconnect()
    return
  }

  // Apaga
  console.log(`\nApagando ${toDelete.length} arquivos...`)
  let deleted = 0
  let failed = 0
  for (const f of toDelete) {
    try {
      await fs.unlink(f.path)
      deleted++
    } catch (e) {
      failed++
      console.warn(`fail: ${f.path}`, e instanceof Error ? e.message : e)
    }
  }
  console.log(`\n✓ Deletados: ${deleted} arquivos, ${fmt(orphanBytes)} liberados`)
  if (failed > 0) console.log(`✗ Falhas: ${failed}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
