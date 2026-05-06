"use client"
import { useEffect, useState } from "react"

interface ClientData {
  id: string
  name: string
  contact?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
}

interface Props {
  client: ClientData
  onClose: () => void
  onSaved: (updated: ClientData) => void
}

export function ClientEditModal({ client, onClose, onSaved }: Props) {
  const [name, setName] = useState(client.name ?? "")
  const [contact, setContact] = useState(client.contact ?? "")
  const [email, setEmail] = useState(client.email ?? "")
  const [phone, setPhone] = useState(client.phone ?? "")
  const [address, setAddress] = useState(client.address ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Esc fecha
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !saving) onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [saving, onClose])

  async function save() {
    if (!name.trim()) { setError("Nome é obrigatório"); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          contact: contact.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          address: address.trim() || null,
        }),
      })
      if (!res.ok) throw new Error()
      const updated = await res.json()
      onSaved(updated)
      onClose()
    } catch {
      setError("Falha ao salvar. Tente de novo.")
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
        style={{ background: "#fff", borderRadius: 10, width: "100%", maxWidth: 520, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 20, borderBottom: "1px solid #eee" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Editar cliente</h2>
        </div>

        <div style={{ padding: 20, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Nome*</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} autoFocus />
          </div>
          <div>
            <label style={labelStyle}>Contato</label>
            <input value={contact} onChange={e => setContact(e.target.value)} style={inputStyle} placeholder="Pessoa responsável" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>E-mail</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Telefone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Endereço</label>
            <input value={address} onChange={e => setAddress(e.target.value)} style={inputStyle} />
          </div>

          {error && <div style={{ color: "#dc2626", fontSize: 12 }}>{error}</div>}
        </div>

        <div style={{ padding: 16, borderTop: "1px solid #eee", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding: "8px 16px", border: "1px solid #ddd", borderRadius: 6, background: "#fff", cursor: saving ? "default" : "pointer", fontSize: 13 }}>
            Cancelar
          </button>
          <button onClick={save} disabled={saving}
            style={{ padding: "8px 20px", border: "none", borderRadius: 6, background: "#F5C400", color: "#111", cursor: saving ? "default" : "pointer", fontSize: 13, fontWeight: 700, opacity: saving ? 0.5 : 1 }}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  )
}
