"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { PIECE_STATUS_LIST, statusMeta } from "@/lib/pieceStatus"

interface Piece {
  id: string
  name: string
  status: string
  campaignId: string
  mediaFormatId: string | null
  data: any
  imageUrl: string | null
  createdAt: string
}

// ENTREGUE eh marcador automatico (set apenas pelo backend ao criar entrega).
const STATUS_OPTIONS = PIECE_STATUS_LIST.filter(s => s !== "ENTREGUE").map(s => ({ value: s, label: statusMeta(s).label }))

export default function PiecePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [piece, setPiece] = useState<Piece | null>(null)
  const [name, setName] = useState("")
  const [status, setStatus] = useState("STANDBY")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`/api/pieces/${id}`).then(r => r.json()).then(d => {
      if (d.error) return
      setPiece(d)
      setName(d.name ?? "")
      setStatus(d.status ?? "STANDBY")
    })
  }, [id])

  async function save() {
    setSaving(true)
    await fetch(`/api/pieces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, status }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function deletePiece(skipConfirm = false) {
    if (!skipConfirm && !confirm("Apagar esta peça?")) return
    await fetch(`/api/pieces/${id}`, { method: "DELETE" })
    router.push(piece?.campaignId ? `/pieces?campaignId=${piece.campaignId}` : "/pieces")
  }

  if (!piece) return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "80vh", color: "#888" }}>Carregando...</div>
    </div>
  )

  return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          <div>
            <button onClick={() => router.push(piece?.campaignId ? `/pieces?campaignId=${piece.campaignId}` : "/pieces")} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13, marginBottom: 8, padding: 0 }}>
              ← Voltar para Peças
            </button>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Editar Peça</h1>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={(e) => deletePiece(e.altKey)} title="Option/Alt+click pra apagar sem confirmação" style={{ background: "transparent", border: "1px solid #f87171", color: "#f87171", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
              🗑 Apagar
            </button>
            <button onClick={save} disabled={saving} style={{ background: "#F5C400", border: "none", color: "#111", padding: "8px 20px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              {saving ? "Salvando..." : saved ? "✓ Salvo" : "Salvar"}
            </button>
          </div>
        </div>

        {/* Form */}
        <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#888", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Nome da peça</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14, outline: "none", boxSizing: "border-box" }}
              placeholder="Ex: Instagram Feed - Versão A"
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#888", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Status</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14, outline: "none", background: "white" }}
            >
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {piece.imageUrl && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#888", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Preview</label>
              <img src={piece.imageUrl} alt="preview" style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid #E0E0E0" }} />
            </div>
          )}

          <div style={{ padding: "12px 16px", background: "#F8F9FA", borderRadius: 6, fontSize: 12, color: "#888" }}>
            Criada em {new Date(piece.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>

        {/* Abrir editor */}
        <div style={{ marginTop: 16 }}>
          <button
            onClick={() => router.push(`/editor?campaignId=${piece.campaignId}&pieceId=${piece.id}`)}
            style={{ width: "100%", padding: "12px", background: "#111", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            ✏️ Abrir no Editor
          </button>
        </div>
      </div>
    </div>
  )
}
