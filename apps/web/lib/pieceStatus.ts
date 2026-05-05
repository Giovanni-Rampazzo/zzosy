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

export function statusMeta(status: string | null | undefined) {
  if (!status) return PIECE_STATUSES.STANDBY
  return (PIECE_STATUSES as any)[status] ?? PIECE_STATUSES.STANDBY
}
