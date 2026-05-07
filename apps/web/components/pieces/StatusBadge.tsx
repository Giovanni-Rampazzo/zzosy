"use client"
import { useState, useRef, useEffect } from "react"
import { PIECE_STATUS_LIST, statusMeta, type PieceStatus } from "@/lib/pieceStatus"

interface Props {
  /** ID da entidade (piece ou campaign) */
  pieceId: string
  /** Tipo da entidade — define qual endpoint chamar. Default: piece (back-compat). */
  entityType?: "piece" | "campaign"
  status: string
  size?: "sm" | "md"
  onChange?: (newStatus: PieceStatus) => void
  disabled?: boolean
}

export function StatusBadge({ pieceId, entityType = "piece", status, size = "md", onChange, disabled }: Props) {
  const [current, setCurrent] = useState<string>(status || "STANDBY")
  const [open, setOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const meta = statusMeta(current)
  const padding = size === "sm" ? "2px 8px" : "4px 12px"
  const fontSize = size === "sm" ? 11 : 12

  // ENTREGUE eh marcador automatico (set apenas pelo backend ao criar entrega).
  // Nao deixar usuario escolher manualmente.
  const choices = PIECE_STATUS_LIST.filter(s => s !== "ENTREGUE")
  const endpoint = entityType === "campaign" ? `/api/campaigns/${pieceId}` : `/api/pieces/${pieceId}`
  const MENU_HEIGHT = choices.length * 33 + 8 // aprox

  // Quando abre, calcula posicao com base no viewport — drop pra baixo OU drop pra cima
  // se nao couber. position:fixed evita ser cortado por overflow:hidden de tabelas/cards.
  useEffect(() => {
    if (!open || !btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const dropDown = spaceBelow >= MENU_HEIGHT + 8
    setMenuPos({
      top: dropDown ? rect.bottom + 4 : rect.top - MENU_HEIGHT - 4,
      left: rect.left,
    })
  }, [open])

  // Fecha ao clicar fora ou ao rolar a pagina
  useEffect(() => {
    if (!open) return
    function close() { setOpen(false) }
    document.addEventListener("scroll", close, true)
    document.addEventListener("mousedown", close)
    return () => {
      document.removeEventListener("scroll", close, true)
      document.removeEventListener("mousedown", close)
    }
  }, [open])

  async function pick(s: PieceStatus) {
    setOpen(false)
    if (s === current) return
    setUpdating(true)
    const prev = current
    setCurrent(s)
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: s }),
      })
      if (!res.ok) throw new Error()
      onChange?.(s)
    } catch {
      setCurrent(prev)
      alert("Falha ao atualizar status")
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }} onClick={e => e.stopPropagation()}>
      <button
        ref={btnRef}
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled || updating}
        style={{
          background: meta.bg, color: meta.color,
          border: "none", borderRadius: 4, padding,
          fontSize, fontWeight: 600,
          cursor: disabled ? "default" : "pointer",
          opacity: updating ? 0.5 : 1,
        }}
      >
        {meta.label} {!disabled && "▾"}
      </button>
      {open && menuPos && (
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: "fixed", top: menuPos.top, left: menuPos.left,
            background: "#fff", border: "1px solid #e5e5e5", borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 1000,
            minWidth: 140,
          }}>
          {choices.map(s => {
            const m = statusMeta(s)
            return (
              <button key={s} onClick={() => pick(s)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "8px 12px", border: "none", background: "transparent",
                  cursor: "pointer", fontSize: 12,
                  color: m.color,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f5f5f5")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: m.bg, marginRight: 8 }} />
                {m.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
