/**
 * Versionador de URLs de imagem de pecas. Browser cacheia /uploads/foo.png
 * agressivamente — quando a imagem regenera (mesmo path), o user ve a stale
 * ate Cmd+Shift+R. Adicionando ?v=<updatedAt> o URL muda quando piece muda,
 * forcando refetch.
 *
 * Aplicado em /api/pieces (lista) e /api/pieces/[id] (detalhe) — antes so a
 * lista versionava, detalhe servia URL raw e mostrava thumb stale (audit F2.2).
 */
export function stampUrl(url: string | null | undefined, version: number | string | null | undefined): string | null {
  if (!url) return null
  const v = String(version ?? Date.now())
  return `${url}${url.includes("?") ? "&" : "?"}v=${v}`
}

/**
 * Stampa imageUrl + steps.thumbnailUrl/imageUrl de uma peca pelo updatedAt.
 * Mutua o objeto retornado (preserva todos os outros fields).
 */
export function stampPiece<T extends { updatedAt?: Date | string | null; imageUrl?: string | null; data?: any }>(
  piece: T
): T & { imageUrl: string | null } {
  const v = piece.updatedAt instanceof Date ? piece.updatedAt.getTime() : new Date(piece.updatedAt ?? Date.now()).getTime()
  const imageUrl = stampUrl(piece.imageUrl ?? null, v)
  let data = piece.data
  try {
    const d = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
    if (d && Array.isArray(d.steps)) {
      const stampedSteps = d.steps.map((s: any) => ({
        ...s,
        thumbnailUrl: stampUrl(s.thumbnailUrl, v),
        imageUrl: stampUrl(s.imageUrl, v),
      }))
      data = typeof piece.data === "string" ? JSON.stringify({ ...d, steps: stampedSteps }) : { ...d, steps: stampedSteps }
    }
  } catch {}
  return { ...piece, imageUrl, data }
}
