import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { writeFile, readFile, unlink, mkdir } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

/**
 * Download proxy — resolve problema de Chrome bloqueando <a>.click() programatico.
 * Persiste em DISCO (nao memoria) porque Next Fast Refresh recarrega o module
 * entre POST e GET, resetando o Map. Disco persiste sempre.
 *
 * Flow:
 *  1. Client POST blob multipart + filename → server salva /tmp/zzosy-download-{id}.bin
 *     + .meta.json com filename/mime, retorna { url }
 *  2. Client cria <iframe src=url> → GET stream do disco com Content-Disposition
 *  3. Apos GET, arquivos sao deletados (single-use)
 */

const TMP_DIR = join(tmpdir(), "zzosy-downloads")
const TTL_MS = 60 * 1000

async function ensureTmpDir() {
  if (!existsSync(TMP_DIR)) await mkdir(TMP_DIR, { recursive: true })
}

function fileFor(id: string) { return join(TMP_DIR, `${id}.bin`) }
function metaFor(id: string) { return join(TMP_DIR, `${id}.json`) }

export async function POST(req: NextRequest) {
  await ensureTmpDir()
  const form = await req.formData()
  const file = form.get("file") as File | null
  if (!file) return NextResponse.json({ error: "missing file" }, { status: 400 })
  const filename = (form.get("filename") as string) || "download.bin"
  const buf = Buffer.from(await file.arrayBuffer())
  const id = randomUUID()
  await writeFile(fileFor(id), buf)
  await writeFile(metaFor(id), JSON.stringify({
    filename,
    mime: file.type || "application/octet-stream",
    createdAt: Date.now(),
  }))
  return NextResponse.json({ id, url: `/api/download-proxy?id=${id}` })
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 })
  }
  const dataPath = fileFor(id)
  const metaPath = metaFor(id)
  if (!existsSync(dataPath) || !existsSync(metaPath)) {
    return NextResponse.json({ error: "not found or expired" }, { status: 404 })
  }
  const meta = JSON.parse(await readFile(metaPath, "utf-8"))
  if (Date.now() - (meta.createdAt ?? 0) > TTL_MS) {
    await unlink(dataPath).catch(() => {})
    await unlink(metaPath).catch(() => {})
    return NextResponse.json({ error: "expired" }, { status: 404 })
  }
  const buf = await readFile(dataPath)
  // Cleanup single-use: agenda delete async (nao bloqueia response)
  setTimeout(async () => {
    await unlink(dataPath).catch(() => {})
    await unlink(metaPath).catch(() => {})
  }, 1000)
  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      "Content-Type": meta.mime ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${(meta.filename ?? "download.bin").replace(/"/g, "")}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  })
}
