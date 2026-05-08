/**
 * Clipboard interno do editor (in-memory, escopo aba do browser).
 *
 * Guarda 1 objeto Fabric serializado pra colar em outra peca/matriz da
 * MESMA campanha. Cross-campanha bloqueado por enquanto pq o asset nao
 * existiria na campanha alvo.
 *
 * Limpa ao fechar a aba. Sem persistencia.
 */

interface ClipboardItem {
  campaignId: string
  json: any
  copiedAt: number
}

let clipboard: ClipboardItem | null = null

export function setClipboard(item: ClipboardItem) {
  clipboard = item
}

export function getClipboard(): ClipboardItem | null {
  return clipboard
}

export function clearClipboard() {
  clipboard = null
}
