// Sort de pecas em tabelas. Reusado em /pieces e /campaigns/[id].
import { PIECE_STATUS_LIST } from "./pieceStatus"

export type SortCol = "name" | "format" | "size" | "status" | "segment" | "media"
export type SortDir = "asc" | "desc"

export interface SortablePiece {
  name?: string
  format?: string
  width?: number
  height?: number
  status?: string
  segment?: string | null
  media?: string | null
}

const STATUS_ORDER: Record<string, number> = Object.fromEntries(
  PIECE_STATUS_LIST.map((s, i) => [s, i])
)

/**
 * Ordena lista de pecas por coluna+direcao.
 * - name/format: alfabetico
 * - size: por area (width × height)
 * - status: pela ordem do enum (Standby → Criacao → ... → Entregue)
 */
export function sortPieces<T extends SortablePiece>(items: T[], col: SortCol, dir: SortDir): T[] {
  const arr = [...items]
  arr.sort((a, b) => {
    let cmp = 0
    if (col === "name") {
      cmp = (a.name ?? "").localeCompare(b.name ?? "", "pt-BR", { sensitivity: "base" })
    } else if (col === "format") {
      cmp = (a.format ?? "").localeCompare(b.format ?? "", "pt-BR", { sensitivity: "base" })
    } else if (col === "size") {
      const aArea = (a.width ?? 0) * (a.height ?? 0)
      const bArea = (b.width ?? 0) * (b.height ?? 0)
      cmp = aArea - bArea
    } else if (col === "status") {
      const aIdx = STATUS_ORDER[a.status ?? "STANDBY"] ?? 99
      const bIdx = STATUS_ORDER[b.status ?? "STANDBY"] ?? 99
      cmp = aIdx - bIdx
    } else if (col === "segment") {
      cmp = (a.segment ?? "").localeCompare(b.segment ?? "", "pt-BR", { sensitivity: "base" })
    } else if (col === "media") {
      cmp = (a.media ?? "").localeCompare(b.media ?? "", "pt-BR", { sensitivity: "base" })
    }
    return dir === "asc" ? cmp : -cmp
  })
  return arr
}

/** Toggle: mesma coluna alterna asc/desc; coluna nova reseta pra asc. */
export function toggleSort(
  current: { col: SortCol; dir: SortDir } | null,
  clicked: SortCol
): { col: SortCol; dir: SortDir } {
  if (current?.col === clicked) {
    return { col: clicked, dir: current.dir === "asc" ? "desc" : "asc" }
  }
  return { col: clicked, dir: "asc" }
}
