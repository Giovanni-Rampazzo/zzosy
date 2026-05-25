"use client"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/Button"
import { useModalEscape } from "@/lib/useModalEscape"

interface Props {
  /** Asset que esta sendo salvo no library — label vira default name */
  defaultName: string
  defaultSlotKey?: string
  /** Lista de slotKeys ja em uso no client (pra warning real-time) */
  existingSlotKeys?: string[]
  onSave: (payload: { name: string; slotKey: string | null; tags: string[]; notes: string | null }) => Promise<void>
  onClose: () => void
}

/**
 * Modal pra salvar asset no Library. Substitui prompt() native em
 * /campaigns/[id]/assets > "↑ Library" button.
 *
 * UX: name (required), slotKey (optional + warning se ja em uso), tags
 * (comma-separated free-text), notes (textarea).
 */
export function SaveToLibraryModal({ defaultName, defaultSlotKey, existingSlotKeys, onSave, onClose }: Props) {
  const [name, setName] = useState(defaultName)
  const [slotKey, setSlotKey] = useState(defaultSlotKey ?? "")
  const [tagsRaw, setTagsRaw] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  useModalEscape(!saving, onClose)

  const slotConflict = slotKey.trim() && (existingSlotKeys ?? []).includes(slotKey.trim())

  async function submit() {
    if (!name.trim()) return
    if (slotConflict) {
      if (!confirm(`Slot "${slotKey}" já está em uso por outro asset. Continuar mesmo assim vai falhar no servidor. Deseja prosseguir?`)) return
    }
    setSaving(true)
    try {
      const tags = tagsRaw.split(",").map(t => t.trim()).filter(Boolean)
      await onSave({
        name: name.trim(),
        slotKey: slotKey.trim() || null,
        tags,
        notes: notes.trim() || null,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div style={{ background: "white", borderRadius: 12, width: 480, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #E0E0E0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Salvar no Library</div>
          <button onClick={onClose} disabled={saving} style={{ background: "transparent", border: 0, fontSize: 20, color: "#888", cursor: saving ? "wait" : "pointer" }}>✕</button>
        </div>
        <div style={{ padding: 24, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Nome" required>
            <input
              type="text" value={name} autoFocus
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) submit() }}
              style={inpStyle}
            />
          </Field>
          <Field label="Slot key (opcional)" sub="Chave estável pra match em cartridges. Ex: logo-primary, headline-text">
            <input
              type="text" value={slotKey}
              onChange={e => setSlotKey(e.target.value)}
              placeholder="logo-primary"
              style={{ ...inpStyle, border: slotConflict ? "1px solid #dc2626" : inpStyle.border }}
            />
            {slotConflict && (
              <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>
                ⚠ Slot já em uso por outro asset
              </div>
            )}
          </Field>
          <Field label="Tags" sub="Separadas por vírgula">
            <input
              type="text" value={tagsRaw}
              onChange={e => setTagsRaw(e.target.value)}
              placeholder="logo, marca, primary"
              style={inpStyle}
            />
          </Field>
          <Field label="Notas">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="(opcional)"
              style={{ ...inpStyle, fontFamily: "inherit", resize: "vertical" }}
            />
          </Field>
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid #E0E0E0", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={saving} disabled={!name.trim()}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
  )
}

const inpStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6,
  fontSize: 13, outline: "none", boxSizing: "border-box",
}

function Field({ label, sub, required, children }: { label: string; sub?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#888", marginBottom: 4 }}>
        {label}{required && <span style={{ color: "#dc2626", marginLeft: 4 }}>*</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: "#aaa", marginBottom: 6 }}>{sub}</div>}
      {children}
    </div>
  )
}
