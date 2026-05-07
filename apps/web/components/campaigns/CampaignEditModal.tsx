"use client"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/Button"

interface CampaignData {
  id: string
  name: string
}

interface Props {
  campaign: CampaignData
  onClose: () => void
  onSaved: (updated: CampaignData) => void
}

export function CampaignEditModal({ campaign, onClose, onSaved }: Props) {
  const [name, setName] = useState(campaign.name ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !saving) onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [saving, onClose])

  async function save() {
    if (!name.trim()) { setError("Nome é obrigatório"); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) throw new Error()
      const updated = await res.json()
      onSaved(updated)
      onClose()
    } catch {
      setError("Falha ao salvar.")
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", borderRadius: 6,
    border: "1px solid #E0E0E0", fontSize: 13, fontFamily: "inherit", outline: "none",
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: "#888", marginBottom: 4, display: "block", fontWeight: 500,
  }

  return (
    <div onMouseDown={(e) => { if (!saving && e.target === e.currentTarget) onClose() }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div
        style={{ background: "#fff", borderRadius: 10, width: "100%", maxWidth: 480, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 20, borderBottom: "1px solid #eee" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Editar campanha</h2>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Nome*</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} autoFocus />
          </div>
          {error && <div style={{ color: "#dc2626", fontSize: 12 }}>{error}</div>}
        </div>
        <div style={{ padding: 16, borderTop: "1px solid #eee", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} loading={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </div>
      </div>
    </div>
  )
}
