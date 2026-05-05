"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { PageShell } from "@/components/layout/PageShell"

interface DeliveryDetail {
  id: string
  name: string | null
  status: string
  zipUrl: string | null
  zipSize: number | null
  createdAt: string
  formats: string | null
  campaign: { id: string; name: string; client?: { name: string } | null }
  deliveredBy?: { id: string; name: string | null; email: string } | null
  pieces: Array<{ piece: { id: string; name: string; imageUrl: string | null; status: string } }>
}

function fmtSize(b: number | null) {
  if (!b) return "—"
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024).toFixed(0)} KB`
}
function fmtDate(s: string) {
  return new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
}

export default function DeliveryDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const [d, setD] = useState<DeliveryDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    fetch(`/api/deliveries/${id}`, { cache: "no-store" })
      .then(r => r.json())
      .then(data => { setD(data); setLoading(false) })
  }, [id])

  if (loading) return <PageShell><div style={{ padding: 32, color: "#888" }}>Carregando...</div></PageShell>
  if (!d || (d as any).error) return <PageShell><div style={{ padding: 32 }}>Entrega não encontrada</div></PageShell>

  let formats: string[] = []
  try { formats = d.formats ? JSON.parse(d.formats) : [] } catch {}

  return (
    <PageShell>
      <div style={{ padding: 32 }}>
        <button onClick={() => router.push("/deliveries")}
          style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "6px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#111", marginBottom: 16 }}>
          ← Voltar para entregas
        </button>

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{d.name || "Entrega"}</h1>
          <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
            <strong>{d.campaign?.name}</strong> · {d.campaign?.client?.name}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
          <Info label="Data" value={fmtDate(d.createdAt)} />
          <Info label="Entregue por" value={d.deliveredBy?.name || d.deliveredBy?.email || "—"} />
          <Info label="Peças" value={String(d.pieces?.length ?? 0)} />
          <Info label="Tamanho" value={fmtSize(d.zipSize)} />
          <Info label="Formatos" value={formats.map(f => f.toUpperCase()).join(", ") || "—"} />
        </div>

        {d.zipUrl && (
          <div style={{ marginBottom: 24 }}>
            <a href={d.zipUrl} download
              style={{ background: "#111", color: "#fff", padding: "10px 18px", borderRadius: 6, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
              ↓ Download do ZIP
            </a>
          </div>
        )}

        <h3 style={{ fontSize: 14, marginBottom: 12, color: "#666" }}>Peças incluídas</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          {d.pieces?.map(({ piece }) => (
            <div key={piece.id} style={{ border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
              <div style={{ aspectRatio: "1/1", background: "#f5f5f5", marginBottom: 6, overflow: "hidden", borderRadius: 4 }}>
                {piece.imageUrl && <img src={piece.imageUrl} alt={piece.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{piece.name}</div>
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#fafafa", border: "1px solid #eee", borderRadius: 6, padding: 12 }}>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
    </div>
  )
}
