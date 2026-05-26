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

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const UPLOADS_DIR = "/app/apps/web/public/uploads"

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
