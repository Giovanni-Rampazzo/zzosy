"use client"
import { useEffect, useRef, useState } from "react"

interface Props {
  value: string
  onSave: (newValue: string) => Promise<void> | void
  variant?: "h1" | "h2" | "inline"
  placeholder?: string
}

const VARIANT_STYLES: Record<string, React.CSSProperties> = {
  h1: { fontSize: 24, fontWeight: 700 },
  h2: { fontSize: 20, fontWeight: 700 },
  inline: { fontSize: 14, fontWeight: 500 },
}

export function EditableText({ value, onSave, variant = "h1", placeholder = "Sem nome" }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  async function commit() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === value) { setEditing(false); setDraft(value); return }
    setSaving(true)
    try {
      await onSave(trimmed)
      setEditing(false)
    } catch {
      alert("Falha ao salvar")
      setDraft(value)
    } finally {
      setSaving(false)
    }
  }
  function cancel() { setDraft(value); setEditing(false) }

  const style = VARIANT_STYLES[variant]

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); commit() }
            else if (e.key === "Escape") { e.preventDefault(); cancel() }
          }}
          disabled={saving}
          placeholder={placeholder}
          style={{
            ...style,
            padding: "2px 6px",
            border: "2px solid #F5C400",
            borderRadius: 4,
            outline: "none",
            background: "#fffbeb",
            minWidth: 200,
            opacity: saving ? 0.6 : 1,
          }}
        />
      ) : (
        <>
          <span style={style}>{value || <span style={{ color: "#aaa" }}>{placeholder}</span>}</span>
          <button
            onClick={() => setEditing(true)}
            style={{
              padding: "5px 12px",
              fontSize: 11,
              fontWeight: 600,
              background: "#f0f0f0",
              color: "#555",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Editar
          </button>
        </>
      )}
    </span>
  )
}
