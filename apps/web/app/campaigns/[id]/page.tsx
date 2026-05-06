"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { StatusBadge } from "@/components/pieces/StatusBadge"
import { DeliveryDialog } from "@/components/deliveries/DeliveryDialog"
import { EditableText } from "@/components/EditableText"

interface Asset { id: string; type: string; label: string }
interface Campaign {
  id: string
  name: string
  client: { id: string; name: string }
  psdName?: string | null
  assets: Asset[]
  keyVision?: { width?: number; height?: number; bgColor?: string; thumbnailUrl?: string | null; updatedAt?: string } | null
}
interface Piece {
  id: string
  name: string
  format: string
  width: number
  height: number
  status: string
  imageUrl?: string | null
  createdAt: string
}

export default function CampaignOverviewPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [pieces, setPieces] = useState<Piece[]>([])
  const [loading, setLoading] = useState(true)
  const [loadTs, setLoadTs] = useState(Date.now())
  const [deliveryOpen, setDeliveryOpen] = useState(false)

  async function loadAll() {
    const [c, p] = await Promise.all([
      fetch(`/api/campaigns/${id}`, { cache: "no-store" }).then(r => r.json()),
      fetch(`/api/pieces?campaignId=${id}`, { cache: "no-store" }).then(r => r.json()),
    ])
    setCampaign(c)
    setPieces(Array.isArray(p) ? p : [])
    setLoadTs(Date.now())
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [id])

  // Sempre que a overview volta a ficar ativa, recarrega para pegar thumb novo do KV/peças.
  // Cobre todos os cenarios: troca de aba, navegacao SPA, back/forward, etc.
  useEffect(() => {
    function refetch() { loadAll() }
    window.addEventListener("focus", refetch)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refetch()
    })
    window.addEventListener("pageshow", refetch)
    return () => {
      window.removeEventListener("focus", refetch)
      window.removeEventListener("pageshow", refetch)
    }
  }, [id])

  async function deletePiece(pieceId: string) {
    if (!confirm("Apagar esta peça? Esta ação não pode ser desfeita.")) return
    await fetch(`/api/pieces/${pieceId}`, { method: "DELETE" })
    setPieces(p => p.filter(x => x.id !== pieceId))
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "80vh", color: "#888" }}>Carregando...</div>
    </div>
  )

  if (!campaign) return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "80vh", color: "#888" }}>Campanha não encontrada.</div>
    </div>
  )

  const kvW = campaign.keyVision?.width ?? 1920
  const kvH = campaign.keyVision?.height ?? 1080
  const kvBg = campaign.keyVision?.bgColor ?? "#ffffff"

  return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>

        {/* Breadcrumb + título */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
            <span style={{ cursor: "pointer" }} onClick={() => router.push(`/clients/${campaign.client.id}`)}>
              {campaign.client.name}
            </span> /
          </div>
          <h1 style={{ margin: 0 }}>
            <EditableText
              value={campaign.name}
              variant="h1"
              onSave={async (newName) => {
                const res = await fetch(`/api/campaigns/${id}`, {
                  method: "PATCH", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: newName }),
                })
                if (!res.ok) throw new Error()
                setCampaign(c => c ? { ...c, name: newName } : c)
              }}
            />
          </h1>
          {campaign.psdName && (
            <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>
              PSD: <strong>{campaign.psdName}</strong> · {campaign.assets?.length ?? 0} assets · {pieces.length} peça{pieces.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        {/* Preview KV + botões */}
        <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", padding: 24, marginBottom: 28, display: "grid", gridTemplateColumns: "1fr 220px", gap: 24, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700, marginBottom: 12 }}>Key Vision (Matriz)</div>
            <div style={{
              width: "100%",
              aspectRatio: `${kvW} / ${kvH}`,
              background: kvBg,
              borderRadius: 6,
              border: "1px solid #E0E0E0",
              maxHeight: 220,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#aaa", fontSize: 13, position: "relative", overflow: "hidden"
            }}>
              {campaign.keyVision?.thumbnailUrl ? (
                <img src={`${campaign.keyVision.thumbnailUrl}?v=${loadTs}`} alt="KV preview"
                  style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              ) : (
                <span>{kvW} × {kvH}</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              onClick={() => router.push(`/campaigns/${id}/assets`)}
              style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "12px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
            >
              Editar Assets
            </button>
            <button
              onClick={() => router.push(`/editor?campaignId=${id}`)}
              style={{ background: "white", border: "1px solid #E0E0E0", borderRadius: 6, padding: "12px 18px", fontWeight: 600, fontSize: 13, cursor: "pointer", color: "#333" }}
            >
              Abrir no Editor
            </button>
            <button
              onClick={async () => {
                if (!confirm("Duplicar esta campanha? Cria uma cópia com todos os assets e peças (status resetado para Standby).")) return
                try {
                  const res = await fetch(`/api/campaigns/${id}/duplicate`, { method: "POST" })
                  if (!res.ok) throw new Error()
                  const dup = await res.json()
                  router.push(`/campaigns/${dup.id}`)
                } catch {
                  alert("Falha ao duplicar campanha")
                }
              }}
              style={{ background: "white", border: "1px solid #E0E0E0", borderRadius: 6, padding: "12px 18px", fontWeight: 600, fontSize: 13, cursor: "pointer", color: "#333" }}
            >
              ⎘ Duplicar
            </button>
            <button
              onClick={() => setDeliveryOpen(true)}
              disabled={pieces.length === 0}
              style={{ background: pieces.length === 0 ? "#f5f5f5" : "#111", border: "none", borderRadius: 6, padding: "12px 18px", fontWeight: 600, fontSize: 13, cursor: pieces.length === 0 ? "default" : "pointer", color: pieces.length === 0 ? "#aaa" : "white" }}
            >
              ↗ Nova entrega
            </button>
          </div>
        </div>

        {/* Lista de peças */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>Peças geradas ({pieces.length})</div>
            {pieces.length > 0 && (
              <button onClick={() => router.push(`/pieces?campaignId=${id}`)}
                style={{ background: "transparent", border: "none", color: "#F5C400", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Ver todas →
              </button>
            )}
          </div>

          {pieces.length === 0 ? (
            <div style={{ background: "white", border: "1px dashed #E0E0E0", borderRadius: 10, padding: 40, textAlign: "center", color: "#888", fontSize: 13 }}>
              Nenhuma peça gerada ainda. Abra o editor e clique em "Gerar Peças".
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
              {pieces.map(p => (
                <div key={p.id} style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  <div
                    onClick={() => router.push(`/editor?campaignId=${id}&pieceId=${p.id}`)}
                    title="Editar peça"
                    style={{ height: 130, background: "#F5F5F0", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: "pointer" }}>
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    ) : (
                      <div style={{ textAlign: "center", color: "#aaa", fontSize: 11 }}>
                        <div style={{ fontWeight: 600 }}>{p.format}</div>
                        <div>{p.width} × {p.height}</div>
                      </div>
                    )}
                  </div>
                  <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#222", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>{p.width} × {p.height}</div>
                      <StatusBadge pieceId={p.id} status={p.status ?? "STANDBY"} size="sm" onChange={(s) => setPieces(prev => prev.map(x => x.id === p.id ? { ...x, status: s } : x))} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "auto" }}>
                      <button
                        onClick={() => deletePiece(p.id)}
                        style={{ background: "white", border: "1px solid #E0E0E0", borderRadius: 5, padding: "6px 10px", fontSize: 11, color: "#dc2626", cursor: "pointer" }}
                        title="Apagar"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {deliveryOpen && (
        <DeliveryDialog
          campaignId={id}
          campaignName={campaign.name}
          onClose={() => setDeliveryOpen(false)}
          onCreated={() => loadAll()}
        />
      )}
    </div>
  )
}
