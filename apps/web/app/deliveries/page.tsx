"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PageShell } from "@/components/layout/PageShell"
import { RowThumb } from "@/components/ui/RowThumb"
import { Button } from "@/components/ui/Button"

interface Delivery {
  id: string
  name: string | null
  status: string
  zipUrl: string | null
  zipSize: number | null
  createdAt: string
  formats: string | null
  campaign: { id: string; name: string; client?: { name: string } | null; keyVision?: { thumbnailUrl?: string | null } | null }
  deliveredBy?: { id: string; name: string | null; email: string } | null
  _count: { pieces: number }
}

function fmtSize(b: number | null) {
  if (!b) return "—"
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024).toFixed(0)} KB`
}
function fmtDate(s: string) {
  return new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
}

export default function DeliveriesPage() {
  const router = useRouter()
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)

  function load() {
    fetch("/api/deliveries", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { setDeliveries(Array.isArray(d) ? d : []); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  async function handleDelete(id: string, skipConfirm = false) {
    if (!skipConfirm && !confirm("Apagar esta entrega? O ZIP físico e o registro serão removidos.")) return
    const res = await fetch(`/api/deliveries/${id}`, { method: "DELETE" })
    if (res.ok) load()
    else alert("Falha ao apagar")
  }

  return (
    <PageShell>
      <div style={{ padding: 32 }}>
        {loading ? (
          <div style={{ color: "#888", fontSize: 13 }}>Carregando...</div>
        ) : deliveries.length === 0 ? (
          <div style={{ color: "#888", fontSize: 13, padding: 32, textAlign: "center", border: "1px dashed #ddd", borderRadius: 8 }}>
            Nenhuma entrega registrada ainda.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", border: "1px solid #eee", borderRadius: 6 }}>
            <thead>
              <tr style={{ background: "#fafafa", textAlign: "left", fontSize: 12, color: "#666" }}>
                <th style={{ padding: 8, width: 72 }}></th>
                <th style={{ padding: 10 }}>Data</th>
                <th style={{ padding: 10 }}>Campanha</th>
                <th style={{ padding: 10 }}>Entregue por</th>
                <th style={{ padding: 10 }}>Peças</th>
                <th style={{ padding: 10 }}>Tamanho</th>
                <th style={{ padding: 10, textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map(d => (
                <tr key={d.id} style={{ borderTop: "1px solid #f0f0f0", fontSize: 13 }}>
                  <td style={{ padding: 8, cursor: "pointer" }} onClick={() => router.push(`/deliveries/${d.id}`)}>
                    <RowThumb src={d.campaign?.keyVision?.thumbnailUrl} alt={d.campaign?.name} fallbackText={d.campaign?.name} />
                  </td>
                  <td style={{ padding: 10 }}>{fmtDate(d.createdAt)}</td>
                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 600 }}>{d.campaign?.name ?? "—"}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>{d.campaign?.client?.name ?? ""}</div>
                  </td>
                  <td style={{ padding: 10 }}>{d.deliveredBy?.name || d.deliveredBy?.email || "—"}</td>
                  <td style={{ padding: 10 }}>{d._count?.pieces ?? 0}</td>
                  <td style={{ padding: 10 }}>{fmtSize(d.zipSize)}</td>
                  <td style={{ padding: 10, textAlign: "right" }}>
                    <button onClick={() => router.push(`/deliveries/${d.id}`)}
                      style={{ marginRight: 6, padding: "6px 12px", border: "1px solid #ddd", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 12 }}>
                      Visualizar
                    </button>
                    {d.zipUrl && (
                      <a href={d.zipUrl} download
                        style={{ marginRight: 6, padding: "6px 12px", border: "1px solid #ddd", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 12, textDecoration: "none", color: "#111", display: "inline-block" }}>
                        Download
                      </a>
                    )}
                    <Button variant="danger" size="sm" onClick={(e) => handleDelete(d.id, e.altKey)}
                      title="Option/Alt+click pra apagar sem confirmação">
                      Apagar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  )
}
