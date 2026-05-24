import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { writeFile, mkdir } from "fs/promises"
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
  // URL com filename como PATH segment — Chrome respeita o ultimo segmento
  // mesmo se ignorar Content-Disposition. Sem isso baixava com nome UUID.
  return NextResponse.json({ id, url: `/api/download-proxy/${encodeURIComponent(filename)}?id=${id}` })
}

// GET movido pra rota dinamica [name]/route.ts — filename no PATH garante
// que Chrome use o nome certo mesmo ignorando Content-Disposition.
