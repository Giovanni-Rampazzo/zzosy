// Sync endpoint: recebe DB dump SQL e/ou tarball /uploads de admin local.
// Protegido por ADMIN_SYNC_TOKEN (env, gerado no Railway + local .env).
// Path: NextAuth nao precisa — uso e direto local->prod via script CLI.
//
// Body: multipart/form-data com fields opcionais 'db' (.sql) e 'uploads' (.tar.gz).
// Header: x-sync-token = ADMIN_SYNC_TOKEN
import { NextRequest, NextResponse } from "next/server"
import { spawn } from "child_process"
import { promises as fs } from "fs"
import path from "path"
import mysql from "mysql2/promise"
import { getStorage } from "@/lib/storage"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const UPLOADS_DIR = "/app/apps/web/public/uploads"

// GET com token = diagnostico filesystem (cwd, storage rootDir, write+read test).
// Permite debugar discrepancia entre storage.put() runtime e static serving.
export async function GET(req: NextRequest) {
  const token = req.headers.get("x-sync-token")
  if (!token || !process.env.ADMIN_SYNC_TOKEN || token !== process.env.ADMIN_SYNC_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const diag: any = { cwd: process.cwd(), uploadsDir: UPLOADS_DIR }
  try {
    const storage = getStorage()
    diag.storageName = storage.name
    diag.storageRootDir = (storage as any).rootDir ?? null
  } catch (e: any) { diag.storageError = e?.message }

  for (const dir of [UPLOADS_DIR, path.join(process.cwd(), "public", "uploads")]) {
    try {
      const s = await fs.stat(dir)
      const entries = await fs.readdir(dir).catch(() => [])
      diag[`dir:${dir}`] = { exists: true, isDir: s.isDirectory(), entries: entries.slice(0, 10), count: entries.length }
    } catch (e: any) {
      diag[`dir:${dir}`] = { exists: false, err: e?.code }
    }
  }

  try {
    // Sem prefixo __ — Next.js reserva esse prefixo. Usa hexa simples.
    // Em subdir - como as pecas reais. Suspeita: arquivos no root de /uploads sao
    // tratados diferente que arquivos em subdir.
    const testKey = `diagtest-subdir/diagtest-${Date.now()}.png`
    // PNG bytes minimos (1x1 transparent)
    const buf = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082", "hex")
    const r = await getStorage().put(testKey, buf, "image/png")
    diag.testWrite = { key: testKey, url: r.url, size: r.size }
    const absPath = path.join((getStorage() as any).rootDir, testKey)
    diag.testWriteAbsPath = absPath
    diag.testReadStat = await fs.stat(absPath).then(s => ({ size: s.size, mtime: s.mtime })).catch(e => ({ err: e?.code }))
    // Deixa o arquivo no disco — vamos tentar fetch via HTTP pra ver se Next.js serve.
    diag.testFileUrl = r.url
  } catch (e: any) {
    diag.testWriteError = e?.message
  }

  // Contagem de arquivos no dir de pieces da campanha LinkedIn — pra ver se regen
  // realmente esta gravando (browser POSTou ~125 thumbs mas todos 404 no GET).
  try {
    const pieceDir = "/app/apps/web/public/uploads/campaigns/cmplhh7i6001hj6pb2jgm57r8/pieces"
    const entries = await fs.readdir(pieceDir).catch(() => [])
    diag.linkedinPiecesDirCount = entries.length
    diag.linkedinPiecesSample = entries.slice(-5)
  } catch (e: any) {
    diag.linkedinPiecesError = e?.message
  }

  return NextResponse.json(diag)
}

async function extractTar(tarPath: string, dest: string): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    // 'xf' autodetecta compressao (gzip ou raw tar). Suporta ambos formatos
    // pra retrocompatibilidade com clientes que ainda mandam .tar.gz.
    const child = spawn("tar", ["xf", tarPath, "-C", dest], { stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    child.stderr.on("data", (d) => { stderr += d.toString() })
    child.on("close", (code) => resolve({ ok: code === 0, stderr }))
  })
}

async function countFiles(dir: string): Promise<number> {
  let count = 0
  async function walk(d: string) {
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else count++
    }
  }
  await walk(dir)
  return count
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-sync-token")
  if (!token || !process.env.ADMIN_SYNC_TOKEN || token !== process.env.ADMIN_SYNC_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const result: any = { ok: true }

  try {
    const form = await req.formData()
    const dbFile = form.get("db") as File | null
    const uploadsFile = form.get("uploads") as File | null

    if (dbFile) {
      const sqlText = await dbFile.text()
      const conn = await mysql.createConnection({
        uri: process.env.DATABASE_URL!,
        multipleStatements: true,
      })
      try {
        await conn.query(sqlText)
      } finally {
        await conn.end()
      }
      result.db = { ok: true, bytes: sqlText.length }
    }

    if (uploadsFile) {
      const buf = Buffer.from(await uploadsFile.arrayBuffer())
      const tarPath = "/tmp/sync-uploads.tar"
      await fs.writeFile(tarPath, buf)
      await fs.mkdir(UPLOADS_DIR, { recursive: true })
      const ext = await extractTar(tarPath, UPLOADS_DIR)
      await fs.unlink(tarPath).catch(() => {})
      if (!ext.ok) {
        return NextResponse.json({ error: "tar failed", stderr: ext.stderr }, { status: 500 })
      }
      result.uploads = { ok: true, bytes: buf.length, totalFiles: await countFiles(UPLOADS_DIR) }
    }

    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "unknown", stack: e.stack }, { status: 500 })
  }
}
