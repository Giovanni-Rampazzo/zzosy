"use client"
import { useEffect, useState, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { regeneratePieceThumbsForAsset, regenerateKVThumb } from "@/lib/regenerateThumbs"
import TopNav from "@/components/TopNav"
import { PsdImporter } from "@/components/campaign/PsdImporter"

interface Asset {
  id: string
  type: string
  label: string
  value: string | null
  imageUrl: string | null
  content: any
  order: number
}
interface Campaign {
  id: string
  name: string
  client: { id: string; name: string }
  psdUrl?: string | null
  psdName?: string | null
  assets: Asset[]
}

function parseContent(raw: any): any[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

function getText(asset: Asset): string {
  const spans = parseContent(asset.content)
  if (spans.length) return spans.map((s: any) => s.text).join("")
  return asset.value ?? ""
}

export default function CampaignAssetsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({})
  const [showAddMenu, setShowAddMenu] = useState(false)
  const newImageInputRef = useRef<HTMLInputElement>(null)
  const saveTimers = useRef<Record<string, any>>({})

  async function addTextAsset() {
    setShowAddMenu(false)
    const defaultText = "Novo texto"
    const span = { text: defaultText, style: { color: "#111111", fontSize: 80, fontWeight: "normal", fontFamily: "Arial" } }
    const res = await fetch(`/api/campaigns/${id}/assets`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "TEXT",
        label: "Novo texto",
        value: defaultText,
        content: [span],
      })
    })
    if (res.ok) {
      await load()
      regenerateKVThumb(id).catch(() => {})
    } else {
      alert("Falha ao criar asset de texto")
    }
  }

  async function addImageAsset(file: File) {
    setShowAddMenu(false)
    const fd = new FormData()
    fd.append("image", file)
    fd.append("label", file.name.replace(/\.[^.]+$/, ""))
    const res = await fetch(`/api/campaigns/${id}/assets`, { method: "POST", body: fd })
    if (res.ok) {
      await load()
      regenerateKVThumb(id).catch(() => {})
    } else {
      alert("Falha ao criar asset de imagem")
    }
  }

  async function deleteAsset(assetId: string, label: string) {
    if (!confirm(`Apagar "${label}"? Será removido também das peças e da matriz.`)) return
    const res = await fetch(`/api/campaigns/${id}/assets/${assetId}`, { method: "DELETE" })
    if (res.ok) {
      await load()
      regenerateKVThumb(id).catch(() => {})
      regeneratePieceThumbsForAsset(id, assetId).catch(() => {})
    } else {
      alert("Falha ao apagar")
    }
  }

  async function load() {
    const res = await fetch(`/api/campaigns/${id}`)
    if (res.ok) setCampaign(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  useEffect(() => {
    if (!showAddMenu) return
    function close() { setShowAddMenu(false) }
    setTimeout(() => document.addEventListener("click", close), 0)
    return () => document.removeEventListener("click", close)
  }, [showAddMenu])

  function updateAssetText(assetId: string, newText: string) {
    if (!campaign) return
    setCampaign({
      ...campaign,
      assets: campaign.assets.map(a => {
        if (a.id !== assetId) return a
        const spans = parseContent(a.content)
        const newSpans = spans.length
          ? [{ ...spans[0], text: newText }, ...spans.slice(1)]
          : [{ text: newText, style: { color: "#111111", fontSize: 48, fontWeight: "normal", fontFamily: "Arial" } }]
        return { ...a, content: newSpans, value: newText }
      })
    })

    clearTimeout(saveTimers.current[assetId])
    setSavingMap(m => ({ ...m, [assetId]: true }))
    saveTimers.current[assetId] = setTimeout(async () => {
      const asset = campaign.assets.find(a => a.id === assetId)
      const spans = parseContent(asset?.content)
      const newSpans = spans.length
        ? [{ ...spans[0], text: newText }, ...spans.slice(1)]
        : [{ text: newText, style: { color: "#111111", fontSize: 48, fontWeight: "normal", fontFamily: "Arial" } }]
      await fetch(`/api/campaigns/${id}/assets/${assetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newSpans, value: newText })
      })
      setSavingMap(m => ({ ...m, [assetId]: false }))
      // Regerar thumbs das peças afetadas em segundo plano
      regeneratePieceThumbsForAsset(id, assetId).catch(e => console.warn("regen thumbs:", e))
      regenerateKVThumb(id).catch(e => console.warn("regen KV thumb:", e))
    }, 600)
  }

  async function uploadAssetImage(assetId: string, file: File) {
    setSavingMap(m => ({ ...m, [assetId]: true }))
    const fd = new FormData()
    fd.append("image", file)
    const res = await fetch(`/api/campaigns/${id}/assets/${assetId}/image`, { method: "POST", body: fd })
    if (res.ok) {
      const data = await res.json()
      setCampaign(c => c ? {
        ...c,
        assets: c.assets.map(a => a.id === assetId ? { ...a, imageUrl: data.imageUrl } : a)
      } : c)
      // Regerar thumbs das peças afetadas em segundo plano
      regeneratePieceThumbsForAsset(id, assetId).catch(e => console.warn("regen thumbs:", e))
      regenerateKVThumb(id).catch(e => console.warn("regen KV thumb:", e))
    }
    setSavingMap(m => ({ ...m, [assetId]: false }))
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "80vh", color: "#888" }}>Campanha nao encontrada.</div>
    </div>
  )

  const sortedAssets = [...campaign.assets].sort((a, b) => a.order - b.order)

  return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ cursor: "pointer", color: "#888" }} onClick={() => router.push(`/clients/${campaign.client.id}`)}>
                {campaign.client.name}
              </span>
              <span>/</span>
              <span style={{ cursor: "pointer", color: "#888" }} onClick={() => router.push(`/campaigns/${id}`)}>
                {campaign.name}
              </span>
              <span>/</span>
              <span>Assets</span>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Assets da campanha</h1>
            {campaign.psdName && (
              <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>
                PSD: <strong>{campaign.psdName}</strong> · {campaign.assets.length} assets
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", position: "relative" }}>
            <button
              onClick={() => setShowAddMenu(s => !s)}
              style={{ padding: "8px 14px", background: "#fff", border: "1px solid #E0E0E0", borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: "pointer", color: "#111" }}
            >
              + Adicionar asset
            </button>
            {showAddMenu && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, background: "#fff", border: "1px solid #E0E0E0", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 20, minWidth: 160 }}>
                <button onClick={addTextAsset} style={{ display: "block", width: "100%", padding: "10px 14px", border: "none", background: "transparent", textAlign: "left", fontSize: 13, cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#f5f5f5")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  📝 Texto
                </button>
                <button onClick={() => { setShowAddMenu(false); newImageInputRef.current?.click() }} style={{ display: "block", width: "100%", padding: "10px 14px", border: "none", background: "transparent", textAlign: "left", fontSize: 13, cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#f5f5f5")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  🖼 Imagem
                </button>
              </div>
            )}
            <input ref={newImageInputRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) addImageAsset(f); e.target.value = "" }} />
            <PsdImporter campaignId={id} onImported={load} />
            {campaign.assets.length > 0 && (
              <button
                onClick={() => router.push(`/editor?campaignId=${id}`)}
                style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "10px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
              >
                Editar Matriz (KV)
              </button>
            )}
          </div>
        </div>

        {campaign.assets.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#888" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "#444" }}>Nenhum asset ainda</div>
            <div style={{ fontSize: 14 }}>Importe um PSD para extrair os layers automaticamente</div>
          </div>
        ) : (
          <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", padding: 24 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {sortedAssets.map(asset => (
                <div key={asset.id} style={{ display: "grid", gridTemplateColumns: "180px 1fr 80px", gap: 12, alignItems: "center", paddingBottom: 14, borderBottom: "1px solid #F0F0F0" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                      {asset.type === "TEXT" ? "Texto" : "Imagem"}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {asset.label}
                    </div>
                  </div>

                  <div>
                    {asset.type === "TEXT" ? (
                      <textarea
                        defaultValue={getText(asset)}
                        onChange={e => updateAssetText(asset.id, e.target.value)}
                        rows={Math.min(4, Math.max(1, getText(asset).split("\n").length))}
                        style={{
                          width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #E0E0E0",
                          fontSize: 13, color: "#111", fontFamily: "inherit", resize: "vertical", outline: "none"
                        }}
                      />
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {asset.imageUrl ? (
                          <img src={asset.imageUrl} alt={asset.label}
                            style={{ width: 80, height: 60, objectFit: "cover", borderRadius: 4, border: "1px solid #E0E0E0" }} />
                        ) : (
                          <div style={{ width: 80, height: 60, background: "#F0F0F0", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", color: "#ccc", fontSize: 18 }}>🖼</div>
                        )}
                        <label style={{ cursor: "pointer", fontSize: 12, color: "#666", border: "1px solid #E0E0E0", borderRadius: 4, padding: "6px 10px", background: "#F8F9FA" }}>
                          Trocar imagem
                          <input type="file" accept="image/*" style={{ display: "none" }}
                            onChange={e => { const f = e.target.files?.[0]; if (f) uploadAssetImage(asset.id, f); e.target.value = "" }} />
                        </label>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <div style={{ fontSize: 10, color: savingMap[asset.id] ? "#F5C400" : "#bbb" }}>
                      {savingMap[asset.id] ? "Salvando..." : "Salvo"}
                    </div>
                    <button
                      onClick={() => deleteAsset(asset.id, asset.label)}
                      style={{ padding: "4px 10px", fontSize: 10, fontWeight: 600, background: "#f0f0f0", color: "#dc2626", border: "none", borderRadius: 4, cursor: "pointer" }}
                    >
                      Apagar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
