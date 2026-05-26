// Route handler dinamico pra servir /uploads/*. Bypassa Next.js static-file
// serving que cacheia 404 negativo: em prod, ao requestar um arquivo que ainda
// nao existia no boot, Next.js retorna prerender 404 e mantem essa resposta
// cacheada mesmo apos o arquivo ser escrito (regen/upload runtime).
//
// next.config.js rewrites /uploads/:path* -> /api/uploads/:path* (beforeFiles),
// entao URLs em DB continuam /uploads/... e nada precisa migrar.
import { NextRequest, NextResponse } from "next/server"
import { promises as fs, createReadStream } from "fs"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const ROOT = path.join(process.cwd(), "public", "uploads")
const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif",
  ".pdf": "application/pdf", ".json": "application/json", ".txt": "text/plain",
  ".psd": "image/vnd.adobe.photoshop", ".zip": "application/zip",
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { path: parts } = await ctx.params
  if (!Array.isArray(parts) || parts.length === 0) {
    return new NextResponse("not found", { status: 404 })
  }
  // Sanitize: bloqueia traversal e nomes ocultos
  for (const p of parts) {
    if (typeof p !== "string" || p.includes("..") || p.includes("\0") || p.startsWith(".")) {
      return new NextResponse("invalid path", { status: 400 })
    }
  }
  const abs = path.normalize(path.join(ROOT, ...parts))
  // Defesa final: garante que abs ainda esta dentro de ROOT
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) {
    return new NextResponse("invalid path", { status: 400 })
  }

  let stat
  try { stat = await fs.stat(abs) }
  catch (e: any) {
    if (e?.code === "ENOENT") return new NextResponse("not found", { status: 404 })
    return new NextResponse("error", { status: 500 })
  }
  if (!stat.isFile()) return new NextResponse("not found", { status: 404 })

  const ext = path.extname(abs).toLowerCase()
  const mime = MIME[ext] ?? "application/octet-stream"

  // Stream pra arquivos grandes; readFile pra pequenos (<2MB)
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Length": String(stat.size),
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Last-Modified": stat.mtime.toUTCString(),
  }
  if (stat.size < 2 * 1024 * 1024) {
    const buf = await fs.readFile(abs)
    return new NextResponse(buf, { status: 200, headers })
  }
  const stream = createReadStream(abs)
  // ReadableStream<Uint8Array> via Web Streams
  const webStream = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk
        controller.enqueue(new Uint8Array(buf))
      })
      stream.on("end", () => controller.close())
      stream.on("error", (err) => controller.error(err))
    },
    cancel() { stream.destroy() },
  })
  return new NextResponse(webStream, { status: 200, headers })
}
