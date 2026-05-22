"use client"
/**
 * Dropdown de segmento de peca. Lista sugestoes (segmentos ja existentes na
 * campanha), permite criar novo, salva via PATCH /api/pieces/[id].
 *
 * Usado em /campaigns/[id] (grid + lista) e /pieces (grid).
 */
import { useEffect, useState } from "react"

interface Props {
  pieceId: string
  initial: string | null | undefined
  suggestions: string[]
  onChange: (next: string | null) => void
}

export function SegmentPicker({ pieceId, initial, suggestions, onChange }: Props) {
  const [value, setValue] = useState(initial ?? "")
  const [saving, setSaving] = useState(false)
  useEffect(() => { setValue(initial ?? "") }, [initial, pieceId])

  async function persist(next: string) {
    const trimmed = next.trim()
    setValue(trimmed)
    onChange(trimmed || null)
    setSaving(true)
    try {
      await fetch(`/api/pieces/${pieceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segment: trimmed || null }),
      })
    } catch (e) { console.warn("[SegmentPicker] save fail:", e) }
    finally { setSaving(false) }
  }

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value
    if (v === "__new__") {
      const name = prompt("Novo segmento:")
      if (name && name.trim()) persist(name.trim())
      return
    }
    persist(v)
  }

  // Garante que o valor atual esta na lista de options (caso seja um segmento
  // antigo que ja nao existe nas sugestoes ativas).
  const allOptions = Array.from(new Set([...(value ? [value] : []), ...suggestions])).sort((a, b) => a.localeCompare(b, "pt-BR"))

  return (
    <div style={{ position: "relative" }}>
      <select
        value={value}
        onChange={handleSelect}
        style={{
          width: "100%", padding: "5px 8px", borderRadius: 4,
          border: "1px solid #E0E0E0", fontSize: 11, fontFamily: "inherit",
          background: "white", color: value ? "#222" : "#888",
          cursor: "pointer", outline: "none",
        }}
        title="Segmento da peca (usado pra agrupar na apresentacao)"
      >
        <option value="">Sem segmento</option>
        {allOptions.map(s => <option key={s} value={s}>{s}</option>)}
        <option value="__new__">+ Novo segmento…</option>
      </select>
      {saving && (
        <span style={{ position: "absolute", right: 24, top: 7, fontSize: 9, color: "#aaa" }}>…</span>
      )}
    </div>
  )
}
