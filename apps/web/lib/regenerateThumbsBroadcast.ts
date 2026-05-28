"use client"
// Helpers de broadcast cross-tab. Extraídos de regenerateThumbs.ts pra
// serem reutilizáveis sem importar todo o renderer Fabric.

export function broadcastPieceUpdated(pieceId: string, campaignId?: string) {
  try {
    if (typeof BroadcastChannel === "undefined") return
    const bc = new BroadcastChannel("zzosy:pieces")
    bc.postMessage({ type: "piece-updated", pieceId, campaignId, ts: Date.now() })
    bc.close()
  } catch {}
}

export function broadcastKvUpdated(campaignId: string) {
  try {
    if (typeof BroadcastChannel === "undefined") return
    const bc = new BroadcastChannel("zzosy:campaigns")
    bc.postMessage({ type: "kv-updated", campaignId, ts: Date.now() })
    bc.close()
  } catch {}
}
