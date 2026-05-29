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
import crypto from "crypto"
import mysql from "mysql2/promise"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const UPLOADS_DIR = "/app/apps/web/public/uploads"

// Token min 32 chars. Sem isso, falha aberta (vide checkToken). Forca o ops
// a escolher token forte mesmo em dev.
const MIN_TOKEN_LEN = 32

function checkToken(sent: string | null): boolean {
  const expected = process.env.ADMIN_SYNC_TOKEN
  if (!expected || expected.length < MIN_TOKEN_LEN) return false
  if (!sent || sent.length !== expected.length) return false
  // Comparacao timing-safe pra prevenir token brute via measure de latencia.
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))
}

async function extractTar(tarPath: string, dest: string): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    // 'xf' autodetecta compressao (gzip ou raw tar).
    // Flags de seguranca CRITICAS:
    //   --no-absolute-paths : remove leading / dos paths no tar — sem isso
    //                         tar absoluto pode escrever em /etc/, /root/, etc.
    //   --no-same-owner     : nao tenta restaurar uid/gid do tar (dest container)
    //   --no-same-permissions: idem pra perms (evita setuid/sticky bits)
    //   -P NAO PASSADO      : tar segue por default link/path safety
    // Combinado com `-C dest`, garante que escrita fica dentro de dest.
    const child = spawn("tar", [
      "--no-absolute-paths",
      "--no-same-owner",
      "--no-same-permissions",
      "-xf", tarPath,
      "-C", dest,
    ], { stdio: ["ignore", "pipe", "pipe"] })
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
  if (!checkToken(token)) {
    // Log SEM o token recebido (security).
    console.warn("[admin/sync] unauthorized attempt", {
      ip: req.headers.get("x-forwarded-for") ?? "?",
      ua: req.headers.get("user-agent")?.slice(0, 100) ?? "?",
      ts: new Date().toISOString(),
    })
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  // Log de toda chamada autorizada (audit trail). Token NUNCA logado.
  console.warn("[admin/sync] AUTHORIZED call", {
    ip: req.headers.get("x-forwarded-for") ?? "?",
    ua: req.headers.get("user-agent")?.slice(0, 100) ?? "?",
    ts: new Date().toISOString(),
  })

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
