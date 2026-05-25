/**
 * Storage abstraction — interface portatil pra arquivos binarios (imagens,
 * PSBs, cartridges). Implementacoes plugaveis: LocalFile (dev), R2/S3/Bunny
 * (prod).
 *
 * Padrao "ports & adapters" — todas rotas usam StorageAdapter; trocar provider
 * = trocar adapter na factory `getStorage()`. Sem isso, GAM (e import-psd
 * legacy) quebra em qualquer container ephemeral (Vercel/Railway).
 *
 * Convencao de keys:
 *   clients/{clientId}/library/images/{uuid}.png
 *   clients/{clientId}/library/smart/{uuid}.psb
 *   campaigns/{campaignId}/layer-{uuid}.png
 *   campaigns/{campaignId}/smart/{guid}.{ext}
 *   campaigns/{campaignId}/master-{uuid}.psd
 *
 * URL retornado por `put()` ou `urlFor()`:
 *   - LocalFile: "/uploads/{key}" (Next.js public/ serving)
 *   - S3/R2: "https://{cdn-domain}/{key}" OU signed URL
 *
 * DB armazena o URL completo (resolved by adapter). Migracao entre providers:
 *   - URLs antigos (/uploads/...) continuam servindo via Next.js durante
 *     transicao (mesmo se novo storage for S3)
 *   - Migration script (futuro) copia binaries → S3 + atualiza DB URLs
 */

export interface PutResult {
  /** URL publico/canonico do arquivo. Persistir em DB. */
  url: string
  /** Key interna do storage (sem URL). Util pra delete/get posteriores. */
  key: string
  /** Bytes escritos (post-encoding). */
  size: number
}

export interface StorageAdapter {
  /** Nome do adapter (pra logging/debug). */
  readonly name: string

  /**
   * Escreve bytes no storage. Cria diretorios intermediarios se necessario.
   * @param key Path relativo (sem leading slash). Ex: "clients/X/library/images/uuid.png"
   * @param data Bytes
   * @param contentType MIME opcional pra metadata (S3 usa; LocalFile ignora)
   */
  put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<PutResult>

  /**
   * Le bytes do storage. Retorna null se nao existir.
   * @param key Path relativo OU URL completa (adapter resolve)
   */
  get(key: string): Promise<Buffer | null>

  /**
   * Apaga arquivo. Idempotente (nao throw se nao existir).
   */
  delete(key: string): Promise<void>

  /** Verifica existencia. */
  exists(key: string): Promise<boolean>

  /** URL publico do key (sem IO). */
  urlFor(key: string): string

  /**
   * Reverso: extrai key a partir de URL. Retorna null se URL nao for deste storage.
   * Util pra operar sobre URL armazenada em DB.
   */
  keyFromUrl(url: string): string | null
}
