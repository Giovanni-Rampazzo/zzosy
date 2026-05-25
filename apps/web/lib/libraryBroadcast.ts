/**
 * Realtime cross-tab pra GAM library. Alinhado com prerrogativa ZZOSY
 * "preview realtime em tudo" (memoria: feedback_realtime_preview_everywhere).
 *
 * Padrao: client emite no sucesso da mutacao (POST/PATCH/PUT/DELETE),
 * outras tabs ouvem e refetch automaticamente.
 *
 * Channel: "zzosy:library" — separado de "zzosy:pieces" e "zzosy:campaigns"
 * pra que listeners possam filtrar sem rebobinar tudo a cada evento.
 */

export type LibraryEventKind =
  | "asset-created"
  | "asset-updated"
  | "asset-deleted"
  | "cartridge-imported"
  | "cartridge-applied"

export interface LibraryEvent {
  kind: LibraryEventKind
  clientId: string
  /** Asset id afetado (quando aplicavel). */
  assetId?: string
  /** Campaign id (quando cartridge-applied). */
  campaignId?: string
  /** Optional payload livre. */
  meta?: Record<string, unknown>
  /** Timestamp pra dedupe / debug. */
  ts: number
}

/** Emite evento. SSR-safe (no-op se BroadcastChannel ausente). */
export function broadcastLibrary(event: Omit<LibraryEvent, "ts">): void {
  try {
    if (typeof BroadcastChannel === "undefined") return
    const bc = new BroadcastChannel("zzosy:library")
    bc.postMessage({ ...event, ts: Date.now() } satisfies LibraryEvent)
    bc.close()
  } catch { /* swallow */ }
}

/**
 * Subscribe a eventos de library. Retorna funcao de cleanup.
 *
 * @param clientId Se passado, filtra eventos do cliente. Sem clientId = todos.
 * @param onEvent Callback. Dispatcher chamado fora de React render (use
 *   `flushSync` / `requestIdleCallback` se precisar batching).
 */
export function subscribeLibrary(
  clientId: string | null,
  onEvent: (e: LibraryEvent) => void,
): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {}
  const bc = new BroadcastChannel("zzosy:library")
  const handler = (msg: MessageEvent<LibraryEvent>) => {
    const e = msg.data
    if (!e || typeof e !== "object") return
    if (clientId && e.clientId !== clientId) return
    onEvent(e)
  }
  bc.addEventListener("message", handler)
  return () => {
    bc.removeEventListener("message", handler)
    bc.close()
  }
}
