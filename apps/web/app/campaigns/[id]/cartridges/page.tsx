"use client"
import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { Button } from "@/components/ui/Button"
import { CampaignSubnav } from "@/components/campaign/CampaignSubnav"
import { ApplyCartridgeButton } from "@/components/campaign/ApplyCartridgeButton"

interface LibAsset {
  id: string
  name: string
  slotKey: string | null
  type: "TEXT" | "IMAGE" | "SHAPE" | "SMART_OBJECT" | string
  tags: string[]
  thumbnailUrl: string | null
  imageUrl: string | null
  version: number
  updatedAt: string
  instanceCount?: number
}

interface Campaign {
  id: string
  name: string
  client?: { id: string; name: string } | null
  assets: any[]
  _count?: { pieces?: number }
}

type TypeFilter = "ALL" | "TEXT" | "IMAGE" | "SHAPE" | "SMART_OBJECT"

const TYPE_LABEL: Record<string, string> = {
  TEXT: "Texto",
  IMAGE: "Imagem",
  SHAPE: "Forma",
  SMART_OBJECT: "Smart Obj",
}

export default function CartridgesBrowsePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [assets, setAssets] = useState<LibAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<TypeFilter>("ALL")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<Set<string>>(new Set())
  const [bulkAdding, setBulkAdding] = useState(false)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      const campRes = await fetch(`/api/campaigns/${id}`).then(r => r.ok ? r.json() : null)
      if (!alive) return
      setCampaign(campRes)
      if (campRes?.client?.id) {
        const libRes = await fetch(`/api/clients/${campRes.client.id}/library/assets`).then(r => r.ok ? r.json() : [])
        if (!alive) return
        setAssets(Array.isArray(libRes) ? libRes : [])
      }
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [id])

  const filtered = useMemo(() => {
    return assets.filter(a => {
      if (filter !== "ALL" && a.type !== filter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const hay = `${a.name} ${a.slotKey ?? ""} ${(a.tags ?? []).join(" ")}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [assets, filter, search])

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: assets.length, TEXT: 0, IMAGE: 0, SHAPE: 0, SMART_OBJECT: 0 }
    for (const a of assets) {
      if (c[a.type] !== undefined) c[a.type]++
    }
    return c
  }, [assets])

  function toggleSelect(assetId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  function selectAllVisible() {
    setSelected(prev => {
      const next = new Set(prev)
      filtered.forEach(a => next.add(a.id))
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  async function addOne(libraryAssetId: string) {
    setAdding(prev => new Set(prev).add(libraryAssetId))
    try {
      const res = await fetch(`/api/campaigns/${id}/assets/from-library`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ libraryAssetId }),
      })
      if (!res.ok) alert("Falha ao adicionar asset")
    } finally {
      setAdding(prev => {
        const next = new Set(prev)
        next.delete(libraryAssetId)
        return next
      })
    }
  }

  async function addSelected() {
    if (selected.size === 0) return
    setBulkAdding(true)
    const ids = Array.from(selected)
    // Serial pra evitar race no `order` calc do endpoint. N=50 leva ~5s — UX dispensa progress bar.
    let ok = 0
    let fail = 0
    for (const lid of ids) {
      try {
        const res = await fetch(`/api/campaigns/${id}/assets/from-library`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ libraryAssetId: lid }),
        })
        if (res.ok) ok++
        else fail++
      } catch { fail++ }
    }
    setBulkAdding(false)
    setSelected(new Set())
    alert(`${ok} adicionado(s)${fail > 0 ? ` · ${fail} falharam` : ""}`)
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "var(--zz-bg-page, #F5F5F0)" }}>
      <TopNav />
      <div style={{ padding: 32, color: "#888" }}>Carregando...</div>
    </div>
  )

  if (!campaign) return (
    <div style={{ minHeight: "100vh", background: "var(--zz-bg-page, #F5F5F0)" }}>
      <TopNav />
      <div style={{ padding: 32, color: "#888" }}>Campanha não encontrada.</div>
    </div>
  )

  return (
    <div style={{ minHeight: "100vh", background: "var(--zz-bg-page)" }}>
      <TopNav />
      <div style={{
        maxWidth: "var(--zz-page-max-w)",
        margin: "0 auto",
        padding: "var(--zz-page-pad-y) var(--zz-page-pad-x) var(--zz-page-pad-bottom)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 16, flexWrap: "wrap" }}>
          <CampaignSubnav
            campaignId={id}
            clientId={campaign.client?.id}
            clientName={campaign.client?.name}
            activeTab={null}
            hasAssets={campaign.assets.length > 0}
            hasPieces={((campaign as any)?._count?.pieces ?? 0) > 0}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ApplyCartridgeButton campaignId={id} clientId={campaign.client?.id} onApplied={() => router.refresh()} />
          </div>
        </div>

        <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", overflow: "hidden" }}>
          {/* Toolbar: filtros sutis + busca + bulk action */}
          <div style={{
            padding: "10px 14px",
            borderBottom: "1px solid #F0F0F0",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}>
            <FilterChip active={filter === "ALL"} onClick={() => setFilter("ALL")} label="Tudo" count={counts.ALL} />
            <FilterChip active={filter === "IMAGE"} onClick={() => setFilter("IMAGE")} label="Imagem" count={counts.IMAGE} />
            <FilterChip active={filter === "TEXT"} onClick={() => setFilter("TEXT")} label="Texto" count={counts.TEXT} />
            <FilterChip active={filter === "SHAPE"} onClick={() => setFilter("SHAPE")} label="Forma" count={counts.SHAPE} />
            <FilterChip active={filter === "SMART_OBJECT"} onClick={() => setFilter("SMART_OBJECT")} label="SO" count={counts.SMART_OBJECT} />
            <div style={{ flex: 1 }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar nome, slot, tag..."
              style={{
                padding: "5px 10px",
                border: "1px solid #E0E0E0",
                borderRadius: 4,
                fontSize: 12,
                outline: "none",
                width: 200,
                background: "#FAFAFA",
              }}
            />
            {selected.size > 0 && (
              <>
                <span style={{ fontSize: 11, color: "#888" }}>{selected.size} selecionado(s)</span>
                <Button variant="primary" size="sm" loading={bulkAdding} onClick={addSelected}>
                  + Add {selected.size}
                </Button>
                <Button variant="secondary" size="sm" onClick={clearSelection}>Limpar</Button>
              </>
            )}
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: "#888", fontSize: 13 }}>
              {assets.length === 0
                ? "Library do cliente vazia. Salve assets de outras campanhas via '↑ Tudo p/ Library' ou importe um cartucho .zzosy."
                : "Nenhum asset bate com os filtros."}
            </div>
          ) : (
            <div>
              {/* Header row */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "32px 40px 1fr 80px 80px 90px",
                gap: 8,
                padding: "6px 14px",
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                color: "#aaa",
                letterSpacing: 0.5,
                borderBottom: "1px solid #F0F0F0",
                background: "#FAFAFA",
              }}>
                <div>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every(a => selected.has(a.id))}
                    onChange={() => {
                      if (filtered.every(a => selected.has(a.id))) clearSelection()
                      else selectAllVisible()
                    }}
                    style={{ cursor: "pointer" }}
                  />
                </div>
                <div></div>
                <div>Nome</div>
                <div>Tipo</div>
                <div>Slot</div>
                <div style={{ textAlign: "right" }}>Ação</div>
              </div>
              {/* Rows */}
              {filtered.map((a, idx) => (
                <div key={a.id} style={{
                  display: "grid",
                  gridTemplateColumns: "32px 40px 1fr 80px 80px 90px",
                  gap: 8,
                  padding: "6px 14px",
                  alignItems: "center",
                  fontSize: 13,
                  borderBottom: idx === filtered.length - 1 ? "none" : "1px solid #F5F5F5",
                  background: selected.has(a.id) ? "#FFFBE6" : "white",
                  transition: "background 0.1s",
                }}>
                  <div>
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      style={{ cursor: "pointer" }}
                    />
                  </div>
                  <div>
                    {a.thumbnailUrl || a.imageUrl ? (
                      <img src={a.thumbnailUrl ?? a.imageUrl ?? ""} alt={a.name}
                        style={{ width: 32, height: 32, objectFit: "contain", borderRadius: 3, background: "#FAFAFA", border: "1px solid #EEE" }} />
                    ) : (
                      <div style={{
                        width: 32, height: 32, borderRadius: 3, background: "#FAFAFA",
                        border: "1px solid #EEE",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, color: "#bbb",
                      }}>
                        {a.type === "TEXT" ? "T" : a.type === "SHAPE" ? "◢" : a.type === "SMART_OBJECT" ? "SO" : "?"}
                      </div>
                    )}
                  </div>
                  <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#222" }}>
                    {a.name}
                    {a.tags && a.tags.length > 0 && (
                      <span style={{ fontSize: 10, color: "#999", marginLeft: 8 }}>
                        {a.tags.slice(0, 3).join(" · ")}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 0.3 }}>
                    {TYPE_LABEL[a.type] ?? a.type}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.slotKey ?? "—"}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => addOne(a.id)}
                      loading={adding.has(a.id)}
                    >
                      {adding.has(a.id) ? "..." : "+ Add"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, fontSize: 11, color: "#888", lineHeight: 1.5 }}>
          Assets adicionados ficam vinculados à library do cliente (badge LIBRARY).
          Edições no library propagam pra todas as campanhas que usam — exceto se você fizer Detach.
        </div>
      </div>
    </div>
  )
}

function FilterChip({ active, onClick, label, count }: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 10px",
        fontSize: 11,
        fontWeight: active ? 700 : 500,
        background: active ? "#111" : "transparent",
        color: active ? "white" : "#666",
        border: active ? "1px solid #111" : "1px solid #E0E0E0",
        borderRadius: 12,
        cursor: "pointer",
        transition: "all 0.1s",
      }}
    >
      {label} <span style={{ color: active ? "#999" : "#bbb", marginLeft: 4 }}>{count}</span>
    </button>
  )
}
