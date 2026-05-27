/**
 * LocalFileStorageAdapter — implementacao default pra dev local.
 * Salva em `public/uploads/{key}`, serve via Next.js automatic public folder.
 *
 * NAO usar em produçao com container ephemeral (Vercel/Railway). Trocar pra
 * S3StorageAdapter (futuro) via env STORAGE_DRIVER=s3.
 */
import { writeFile, readFile, unlink, mkdir, stat, readdir, copyFile } from "fs/promises"
import path from "path"
import type { StorageAdapter, PutResult } from "./types"

const URL_PREFIX = "/uploads"

// AUTO-CLEANUP 2026-05-27: promise compartilhada pra dedup de uploads paralelos
// que batem ENOSPC ao mesmo tempo. Resetada apos 1h pra permitir nova rodada
// se disco encher de novo.
let __sharedCleanup: Promise<{ deletedBytes: number; deletedFiles: number }> | null = null

async function runSharedCleanup(): Promise<{ deletedBytes: number; deletedFiles: number }> {
  if (__sharedCleanup) return __sharedCleanup
  __sharedCleanup = (async () => {
    console.warn("[storage] ENOSPC detectado — disparando auto-cleanup de orfaos...")
    try {
      const { runOrphanCleanup } = await import("./autoCleanup")
      const r = await runOrphanCleanup()
      console.warn(`[storage] auto-cleanup: ${r.deletedFiles} arquivos, ${(r.deletedBytes/1024/1024).toFixed(1)}MB liberados`)
      return { deletedBytes: r.deletedBytes, deletedFiles: r.deletedFiles }
    } catch (cleanupErr) {
      console.error("[storage] auto-cleanup falhou:", cleanupErr)
      return { deletedBytes: 0, deletedFiles: 0 }
    } finally {
      // Reset apos 1h. Permite nova passada se disco encher de novo,
      // mas evita re-rodar cleanup desnecessariamente em writes proximos.
      setTimeout(() => { __sharedCleanup = null }, 60 * 60 * 1000)
    }
  })()
  return __sharedCleanup
}

export class LocalFileStorageAdapter implements StorageAdapter {
  readonly name = "local-file"
  private readonly rootDir: string

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? path.join(process.cwd(), "public", "uploads")
  }

  private fullPath(key: string): string {
    // Sanitiza: remove leading /, blocks .. traversal
    const safe = normalizeKey(key)
    return path.join(this.rootDir, safe)
  }

  async put(key: string, data: Buffer | Uint8Array, _contentType?: string): Promise<PutResult> {
    const safe = normalizeKey(key)
    const full = this.fullPath(safe)
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
    // AUTO-CLEANUP 2026-05-27 (revisado): disk full → limpa orfaos e retenta.
    // mkdir TAMBEM dentro do try — disco lotado tambem afeta criacao de dirs.
    // Refatorado pra usar PROMISE compartilhada (em vez de flag boolean) —
    // 5 uploads paralelos que falham ENOSPC simultaneamente compartilham o
    // mesmo cleanup em vez de so 1 limpar e os outros 4 erroarem.
    const doWrite = async () => {
      await mkdir(path.dirname(full), { recursive: true })
      await writeFile(full, buf)
    }
    try {
      await doWrite()
    } catch (e: any) {
      if (e?.code !== "ENOSPC") throw e
      // Comparte cleanup entre callers paralelos. Se ja existe promise em vooo,
      // espera ela. Senao cria nova. Apos resultado, decide se retenta.
      const result = await runSharedCleanup()
      if (result.deletedBytes === 0) {
        console.error("[storage] ENOSPC + cleanup nao liberou nada (0 orfaos). Disco realmente cheio.")
        throw e
      }
      console.warn(`[storage] auto-cleanup liberou ${(result.deletedBytes/1024/1024).toFixed(1)}MB — retentando write`)
      await doWrite()  // pode falhar de novo se write eh > espaco liberado
    }
    return {
      url: this.urlFor(safe),
      key: safe,
      size: buf.length,
    }
  }

  async get(keyOrUrl: string): Promise<Buffer | null> {
    const key = this.keyFromUrl(keyOrUrl) ?? normalizeKey(keyOrUrl)
    try {
      return await readFile(this.fullPath(key))
    } catch (e: any) {
      if (e?.code === "ENOENT") return null
      throw e
    }
  }

  async delete(keyOrUrl: string): Promise<void> {
    const key = this.keyFromUrl(keyOrUrl) ?? normalizeKey(keyOrUrl)
    try {
      await unlink(this.fullPath(key))
    } catch (e: any) {
      if (e?.code === "ENOENT") return // idempotente
      throw e
    }
  }

  async exists(keyOrUrl: string): Promise<boolean> {
    const key = this.keyFromUrl(keyOrUrl) ?? normalizeKey(keyOrUrl)
    try {
      await stat(this.fullPath(key))
      return true
    } catch {
      return false
    }
  }

  urlFor(key: string): string {
    return `${URL_PREFIX}/${normalizeKey(key)}`
  }

  keyFromUrl(url: string): string | null {
    if (typeof url !== "string") return null
    if (url.startsWith(`${URL_PREFIX}/`)) return url.slice(URL_PREFIX.length + 1)
    if (url.startsWith(URL_PREFIX)) return url.slice(URL_PREFIX.length).replace(/^\/+/, "")
    return null
  }

  async list(prefix: string): Promise<string[]> {
    const safe = normalizeKey(prefix.endsWith("/") ? prefix : `${prefix}/`)
    const baseDir = path.join(this.rootDir, safe)
    try {
      // Walk recursivo. NAO segue symlinks (defesa).
      const out: string[] = []
      await walk(baseDir, safe, out)
      return out
    } catch (e: any) {
      if (e?.code === "ENOENT") return []
      throw e
    }
  }

  async copy(srcKeyOrUrl: string, dstKey: string): Promise<boolean> {
    const src = this.keyFromUrl(srcKeyOrUrl) ?? normalizeKey(srcKeyOrUrl)
    const dst = normalizeKey(dstKey)
    const srcFull = path.join(this.rootDir, src)
    const dstFull = path.join(this.rootDir, dst)
    try {
      await mkdir(path.dirname(dstFull), { recursive: true })
      await copyFile(srcFull, dstFull)
      return true
    } catch (e: any) {
      if (e?.code === "ENOENT") return false
      throw e
    }
  }
}

async function walk(absDir: string, relPrefix: string, out: string[]): Promise<void> {
  let entries: any[]
  try { entries = await readdir(absDir, { withFileTypes: true }) }
  catch { return }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue // skip symlinks
    const relPath = `${relPrefix}${e.name}`
    if (e.isDirectory()) {
      await walk(path.join(absDir, e.name), `${relPath}/`, out)
    } else if (e.isFile()) {
      out.push(relPath)
    }
  }
}

/**
 * Normaliza key: remove leading slashes, valida que nao tem ".." (traversal).
 * Throws se invalida — defesa contra path injection.
 */
function normalizeKey(input: string): string {
  if (typeof input !== "string") throw new Error("storage key must be string")
  const stripped = input.replace(/^\/+/, "")
  if (stripped.includes("..")) throw new Error(`storage key traversal: ${input}`)
  if (stripped.length === 0) throw new Error("storage key empty")
  return stripped
}
