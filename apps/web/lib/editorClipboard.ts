/**
 * Clipboard interno do editor.
 *
 * Persiste em localStorage pra sobreviver navegacao entre pecas/matriz da
 * mesma campanha (Photoshop-style: copia em uma peca, abre outra, cola
 * mantendo a posicao). Cross-campanha bloqueado pq o __assetId nao
 * existiria na campanha alvo.
 *
 * `sourcePieceId`: id da peca onde o copy aconteceu (null = matriz). Usado
 * pra decidir paste-in-place (source != current) vs duplicar com offset
 * (source == current).
 */

const STORAGE_KEY = "zzosy:editorClipboard"

interface ClipboardItem {
  campaignId: string
  sourcePieceId: string | null
  json: any
  copiedAt: number
}

export function setClipboard(item: ClipboardItem) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(item))
  } catch {
    // localStorage cheio ou desabilitado — silenciar
  }
}

export function getClipboard(): ClipboardItem | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ClipboardItem
  } catch {
    return null
  }
}

export function clearClipboard() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // silenciar
  }
}
