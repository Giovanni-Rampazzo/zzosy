/**
 * Storage factory — singleton baseado em env STORAGE_DRIVER.
 *
 * Atual: apenas "local" (LocalFileStorageAdapter).
 * Futuro: "s3" (S3StorageAdapter), "r2", "bunny" — switch case + import dinamico.
 *
 * Uso:
 *   import { getStorage } from "@/lib/storage"
 *   const storage = getStorage()
 *   const { url } = await storage.put("clients/X/img.png", buffer, "image/png")
 *   await prisma.x.update({ data: { imageUrl: url } })
 */
import type { StorageAdapter } from "./types"
import { LocalFileStorageAdapter } from "./localFile"
import { env } from "@/lib/env"

let instance: StorageAdapter | null = null

export function getStorage(): StorageAdapter {
  if (instance) return instance
  const driver = env.STORAGE_DRIVER // typed + validated por env.ts
  switch (driver) {
    case "local":
      // Railway: monta Volume em /app/apps/web/public/uploads pra persistir
      // entre deploys (containers sao ephemeral). Sem Volume, bytes somem
      // em rebuild.
      instance = new LocalFileStorageAdapter()
      break
    // case "s3": instance = new S3StorageAdapter({ ... }); break;
    // case "r2": instance = new R2StorageAdapter({ ... }); break;
    // case "bunny": instance = new BunnyStorageAdapter({ ... }); break;
    default:
      console.warn(`[storage] STORAGE_DRIVER="${driver}" unknown — falling back to local`)
      instance = new LocalFileStorageAdapter()
  }
  console.log(`[storage] initialized: ${instance.name}`)
  return instance
}

/**
 * Test helper — permite injetar adapter mock em testes.
 * NAO usar em codigo de producao.
 */
export function __setStorageForTesting(adapter: StorageAdapter | null) {
  instance = adapter
}

export type { StorageAdapter, PutResult } from "./types"
