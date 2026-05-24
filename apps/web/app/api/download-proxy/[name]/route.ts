import { NextRequest, NextResponse } from "next/server"
import { readFile, unlink } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

/**
 * GET /api/download-proxy/{filename}?id={uuid}
 *
 * Filename no PATH é crítico: alguns Chromes IGNORAM Content-Disposition e
 * usam o último segmento da URL como nome. Antes a rota era
 * /api/download-proxy?id=UUID → Chrome usava 'download-proxy' ou o UUID
 * como nome. Agora /api/download-proxy/Deep-Dish_X.psd?id=UUID → Chrome
 * usa o filename mesmo se ignorar header.
 *
 * O cache em disco persiste em /tmp/zzosy-downloads/{uuid}.bin (ver
 * route.ts pai pra POST que armazena).
 */

const TMP_DIR = join(tmpdir(), "zzosy-downloads")
const TTL_MS = 60 * 1000

function fileFor(id: string) { return join(TMP_DIR, `${id}.bin`) }
function metaFor(id: string) { return join(TMP_DIR, `${id}.json`) }

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params
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
  // Cleanup single-use atrasado pra dar tempo do download iniciar
  setTimeout(async () => {
    await unlink(dataPath).catch(() => {})
    await unlink(metaPath).catch(() => {})
  }, 5000)
  // Prefer filename do PATH (URL-encoded pelo client) sobre o meta — defensive,
  // ambos devem ser iguais.
  const filename = (() => {
    try { return decodeURIComponent(name) }
    catch { return meta.filename ?? name }
  })()
  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      "Content-Type": meta.mime ?? "application/octet-stream",
      // RFC 5987 — Chrome respeita filename* (UTF-8 encoded) com prioridade
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
