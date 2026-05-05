"use client"
import { useState } from "react"
import { PIECE_STATUS_LIST, statusMeta, type PieceStatus } from "@/lib/pieceStatus"

interface Props {
  pieceId: string
  status: string
  size?: "sm" | "md"
  onChange?: (newStatus: PieceStatus) => void
  disabled?: boolean
}

export function StatusBadge({ pieceId, status, size = "md", onChange, disabled }: Props) {
  const [current, setCurrent] = useState<string>(status || "STANDBY")
  const [open, setOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const meta = statusMeta(current)
  const padding = size === "sm" ? "2px 8px" : "4px 12px"
  const fontSize = size === "sm" ? 11 : 12

  // ENTREGUE eh marcador automatico (set apenas pelo backend ao criar entrega).
  // Nao deixar usuario escolher manualmente.
  const choices = PIECE_STATUS_LIST.filter(s => s !== "ENTREGUE")

  async function pick(s: PieceStatus) {
    setOpen(false)
    if (s === current) return
    setUpdating(true)
    const prev = current
    setCurrent(s)
    try {
      const res = await fetch(`/api/pieces/${pieceId}`, {
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
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4,
          background: "#fff", border: "1px solid #e5e5e5", borderRadius: 6,
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 10,
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
