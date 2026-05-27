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
    await mkdir(path.dirname(full), { recursive: true })
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
    try {
      await writeFile(full, buf)
    } catch (e: any) {
      // AUTO-CLEANUP 2026-05-27: disk full → tenta limpar orfaos e retentar.
      // User reportou ENOSPC bloqueando imports. Cleanup endpoint manual existia,
      // mas auto rescue eh mais defensivo. So roda 1x por process (flag).
      if (e?.code === "ENOSPC" && !(globalThis as any).__zzosyAutoCleanupRan) {
        ;(globalThis as any).__zzosyAutoCleanupRan = true
        console.warn("[storage] ENOSPC detectado — disparando auto-cleanup de orfaos...")
        try {
          const { runOrphanCleanup } = await import("./autoCleanup")
          const r = await runOrphanCleanup()
          console.warn(`[storage] auto-cleanup: ${r.deletedFiles} arquivos, ${(r.deletedBytes/1024/1024).toFixed(1)}MB liberados`)
          // Reset flag em 1h pra permitir nova passada se encher de novo
          setTimeout(() => { (globalThis as any).__zzosyAutoCleanupRan = false }, 60 * 60 * 1000)
          // Retenta o write
          await writeFile(full, buf)
        } catch (cleanupErr) {
          console.error("[storage] auto-cleanup falhou:", cleanupErr)
          throw e // re-throw original ENOSPC
        }
      } else {
        throw e
      }
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
