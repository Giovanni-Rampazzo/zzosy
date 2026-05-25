"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { Button } from "@/components/ui/Button"
import { broadcastLibrary } from "@/lib/libraryBroadcast"

interface LibraryAsset {
  id: string
  name: string
  slotKey: string | null
  type: string
  tags: string[]
  notes: string | null
  thumbnailUrl: string | null
  imageUrl: string | null
  version: number
  updatedAt: string
}

export default function EditLibraryAssetPage() {
  const { id, assetId } = useParams<{ id: string; assetId: string }>()
  const router = useRouter()
  const [asset, setAsset] = useState<LibraryAsset | null>(null)
  const [name, setName] = useState("")
  const [slotKey, setSlotKey] = useState("")
  const [tagsRaw, setTagsRaw] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/clients/${id}/library/assets/${assetId}`)
      .then(r => r.ok ? r.json() : null)
      .then(a => {
        if (!a) return
        setAsset(a)
        setName(a.name ?? "")
        setSlotKey(a.slotKey ?? "")
        setTagsRaw((a.tags ?? []).join(", "))
        setNotes(a.notes ?? "")
      })
  }, [id, assetId])

  async function save() {
    setSaving(true)
    const tags = tagsRaw.split(",").map(s => s.trim()).filter(Boolean)
    const res = await fetch(`/api/clients/${id}/library/assets/${assetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slotKey: slotKey.trim() || null, tags, notes: notes.trim() || null }),
    })
    setSaving(false)
    if (res.ok) {
      broadcastLibrary({ kind: "asset-updated", clientId: id, assetId })
      router.push(`/clients/${id}/library`)
    } else alert("Falha ao salvar")
  }

  if (!asset) return <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}><TopNav /><div style={{ padding: 32, color: "#888" }}>Carregando...</div></div>

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopNav />
      <div style={{ flex: 1, overflowY: "auto", padding: 32, background: "var(--zz-bg-page, #F5F5F0)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, gap: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>Editar asset · {asset.name}</div>
          <Button variant="view" size="md" onClick={() => router.push(`/clients/${id}/library`)}>← Library</Button>
        </div>

        <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", padding: 24, maxWidth: 720, display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label="Nome">
            <input type="text" value={name} onChange={e => setName(e.target.value)} style={inpStyle} />
          </Field>
          <Field label="Slot key" sub="Chave estável pra match em cartridges. Ex: logo-primary, headline-text, cta">
            <input type="text" value={slotKey} onChange={e => setSlotKey(e.target.value)} placeholder="(opcional)" style={inpStyle} />
          </Field>
          <Field label="Tags" sub="Separadas por vírgula">
            <input type="text" value={tagsRaw} onChange={e => setTagsRaw(e.target.value)} placeholder="logo, marca, primary" style={inpStyle} />
          </Field>
          <Field label="Notas">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} style={{ ...inpStyle, fontFamily: "inherit", resize: "vertical" }} />
          </Field>
          <div style={{ fontSize: 11, color: "#888" }}>
            Tipo: <strong>{asset.type}</strong> · Versão: <strong>{asset.version}</strong>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => router.push(`/clients/${id}/library`)} disabled={saving}>Cancelar</Button>
            <Button variant="primary" onClick={save} loading={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const inpStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6,
  fontSize: 13, outline: "none", boxSizing: "border-box",
}

function Field({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#888", marginBottom: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "#aaa", marginBottom: 6 }}>{sub}</div>}
      {children}
    </div>
  )
}
