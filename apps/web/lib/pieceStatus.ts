// Status de peças no fluxo zzosy
export const PIECE_STATUSES = {
  STANDBY:    { label: "Standby",    bg: "#f1f1f1", color: "#666" },
  CRIACAO:    { label: "Criação",    bg: "#fde68a", color: "#92400e" },
  CLIENTE:    { label: "Cliente",    bg: "#bfdbfe", color: "#1d4ed8" },
  APROVADO:   { label: "Aprovado",   bg: "#dcfce7", color: "#16a34a" },
  REPROVADO:  { label: "Reprovado",  bg: "#fee2e2", color: "#dc2626" },
  ENTREGUE:   { label: "Entregue",   bg: "#e0e7ff", color: "#4338ca" },
} as const

export type PieceStatus = keyof typeof PIECE_STATUSES

export const PIECE_STATUS_LIST: PieceStatus[] = ["STANDBY", "CRIACAO", "CLIENTE", "APROVADO", "REPROVADO", "ENTREGUE"]

// Status default em novas pieces / fallback de render. Antes era literal
// "STANDBY" espalhado em 12+ arquivos (audit F3.1).
export const DEFAULT_PIECE_STATUS: PieceStatus = "STANDBY"

// Status que o user pode escolher via UI (badge dropdown, filtros). Exclui
// ENTREGUE que e auto-setado em POST /api/deliveries. Antes era literal
// `PIECE_STATUS_LIST.filter(s => s !== "ENTREGUE")` duplicado em 4 lugares.
export const USER_SELECTABLE_STATUSES: PieceStatus[] = PIECE_STATUS_LIST.filter(s => s !== "ENTREGUE")

export function statusMeta(status: string | null | undefined) {
  if (!status) return PIECE_STATUSES.STANDBY
  return (PIECE_STATUSES as any)[status] ?? PIECE_STATUSES.STANDBY
}
