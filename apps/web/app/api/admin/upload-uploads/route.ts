// TEMPORARIO — endpoint pra migracao one-time dos /uploads do local pra prod.
// REMOVER apos uso. Protegido por MIGRATE_TOKEN env var.
import { NextRequest, NextResponse } from "next/server"
import { spawn } from "child_process"
import { promises as fs } from "fs"
import path from "path"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const UPLOADS_DIR = "/app/apps/web/public/uploads"

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-migrate-token")
  if (!token || token !== process.env.MIGRATE_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    const buf = Buffer.from(await req.arrayBuffer())
    const tarPath = "/tmp/incoming-uploads.tar.gz"
    await fs.writeFile(tarPath, buf)

    await fs.mkdir(UPLOADS_DIR, { recursive: true })

    const result = await new Promise<{ code: number; stderr: string }>((resolve) => {
      const child = spawn("tar", ["xzf", tarPath, "-C", UPLOADS_DIR], { stdio: ["ignore", "pipe", "pipe"] })
      let stderr = ""
      child.stderr.on("data", (d) => { stderr += d.toString() })
      child.on("close", (code) => resolve({ code: code ?? -1, stderr }))
    })

    await fs.unlink(tarPath).catch(() => {})

    if (result.code !== 0) {
      return NextResponse.json({ error: "tar failed", stderr: result.stderr }, { status: 500 })
    }

    const files: string[] = []
    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) await walk(p)
        else files.push(p)
      }
    }
    await walk(UPLOADS_DIR)

    return NextResponse.json({ ok: true, fileCount: files.length, bytes: buf.length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "unknown" }, { status: 500 })
  }
}
