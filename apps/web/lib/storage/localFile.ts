/**
 * LocalFileStorageAdapter — implementacao default pra dev local.
 * Salva em `public/uploads/{key}`, serve via Next.js automatic public folder.
 *
 * NAO usar em produçao com container ephemeral (Vercel/Railway). Trocar pra
 * S3StorageAdapter (futuro) via env STORAGE_DRIVER=s3.
 */
import { writeFile, readFile, unlink, mkdir, stat } from "fs/promises"
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
    await writeFile(full, buf)
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
