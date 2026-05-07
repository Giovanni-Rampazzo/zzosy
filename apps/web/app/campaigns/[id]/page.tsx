"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { StatusBadge } from "@/components/pieces/StatusBadge"
import { DeliveryDialog } from "@/components/deliveries/DeliveryDialog"
import { ExportDialog } from "@/components/pieces/ExportDialog"
import { EditableText } from "@/components/EditableText"
import { PIECE_STATUS_LIST, statusMeta } from "@/lib/pieceStatus"
import { sortPieces, toggleSort, SortCol, SortDir } from "@/lib/sortPieces"
import { RowThumb } from "@/components/ui/RowThumb"
import { Button } from "@/components/ui/Button"

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
  data?: any
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
  const [view, setView] = useState<"grid" | "list">("grid")
  const [selected, setSelectedRaw] = useState<string[]>([])
  // Wrapper de debug temporario pra rastrear quem zera selected
  const setSelected = (next: any) => {
    if (typeof next === "function") {
      setSelectedRaw(prev => {
        const result = next(prev)
        if (Array.isArray(result) && result.length === 0 && prev.length > 0) {
          console.log("[SEL-CLEAR] (function form)", { prev, stack: new Error().stack?.split("\n").slice(1, 5).join("\n") })
        }
        return result
      })
    } else {
      if (Array.isArray(next) && next.length === 0) {
        console.log("[SEL-CLEAR] (direct)", { stack: new Error().stack?.split("\n").slice(1, 5).join("\n") })
      }
      setSelectedRaw(next)
    }
  }
  const [exportOpen, setExportOpen] = useState(false)
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir } | null>(null)

  async function loadAll() {
    console.log("[LOAD-ALL] disparou em", new Date().toISOString().slice(11, 19), "id=", id)
    const url = `/api/campaigns/${id}`
    const cRes = await fetch(url, { cache: "no-store" })
    console.log("[LOAD-ALL] fetch status:", cRes.status, "url:", url)
    const c = await cRes.json()
    console.log("[LOAD-ALL] campaign response:", c)
    const p = await fetch(`/api/pieces?campaignId=${id}`, { cache: "no-store" }).then(r => r.json())
    // Guard: se API retornou erro ({error: "..."}), nao seta no state pra evitar crash
    if (c && !c.error && c.client) {
      setCampaign(c)
    } else {
      console.error("[LOAD-ALL] campaign response invalida ou sem client:", c)
      setCampaign(null)
    }
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

  async function deletePiece(pieceId: string, skipConfirm = false) {
    if (!skipConfirm && !confirm("Apagar esta peça? Esta ação não pode ser desfeita.")) return
    await fetch(`/api/pieces/${pieceId}`, { method: "DELETE" })
    setPieces(p => p.filter(x => x.id !== pieceId))
  }

  function toggleSelect(pieceId: string) {
    setSelected(s => s.includes(pieceId) ? s.filter(x => x !== pieceId) : [...s, pieceId])
  }
  function isSelected(pieceId: string) { return selected.includes(pieceId) }

  async function deleteSelected(skipConfirm = false) {
    if (selected.length === 0) return
    if (!skipConfirm && !confirm(`Apagar ${selected.length} peça(s)? Esta ação não pode ser desfeita.`)) return
    await Promise.all(selected.map(id => fetch(`/api/pieces/${id}`, { method: "DELETE" })))
    setPieces(prev => prev.filter(p => !selected.includes(p.id)))
    setSelected([])
  }

  async function bulkSetStatus(status: string) {
    if (selected.length === 0) return
    await Promise.all(selected.map(id =>
      fetch(`/api/pieces/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
    ))
    setPieces(prev => prev.map(p => selected.includes(p.id) ? { ...p, status } : p))
    setBulkStatusOpen(false)
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

        <button
          onClick={() => campaign.client?.id && router.push(`/clients/${campaign.client.id}`)}
          style={{ background: "transparent", border: "none", color: "#888", fontSize: 12, cursor: "pointer", padding: 0, marginBottom: 12 }}
        >
          ← Clientes
        </button>

        {/* Breadcrumb + título */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
            <span style={{ cursor: "pointer" }} onClick={() => campaign.client?.id && router.push(`/clients/${campaign.client.id}`)}>
              {campaign.client?.name ?? "—"}
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
              maxHeight: 220, display: "flex", alignItems: "center", justifyContent: "center",
              color: "#aaa", fontSize: 13,
            }}>
              {campaign.keyVision?.thumbnailUrl ? (
                <img src={`${campaign.keyVision.thumbnailUrl}?v=${loadTs}`} alt="KV preview"
                  style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 6, border: "1px solid #E0E0E0" }} />
              ) : (
                <div style={{
                  aspectRatio: `${kvW} / ${kvH}`, maxHeight: 220, width: "auto", maxWidth: "100%",
                  background: kvBg, borderRadius: 6, border: "1px solid #E0E0E0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span>{kvW} × {kvH}</span>
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Button variant="primary" size="lg" onClick={() => router.push(`/editor?campaignId=${id}`)}>Key Vision</Button>
            <Button variant="secondary" size="lg" onClick={() => router.push(`/campaigns/${id}/assets`)}>Assets</Button>
            <Button variant="dark" size="lg" onClick={() => setDeliveryOpen(true)} disabled={pieces.length === 0}>Package</Button>
          </div>
        </div>

        {/* Lista de peças */}
        {(() => {
          const filteredPieces = statusFilter === "ALL" ? pieces : pieces.filter(p => p.status === statusFilter)
          const visiblePieces = sort ? sortPieces(filteredPieces, sort.col, sort.dir) : filteredPieces
          const counts: Record<string, number> = { ALL: pieces.length }
          for (const s of PIECE_STATUS_LIST) counts[s] = pieces.filter(p => p.status === s).length
          // toggleSelectAll opera sobre visiblePieces (so seleciona o que ta visivel)
          const allVisibleSelected = visiblePieces.length > 0 && visiblePieces.every(p => selected.includes(p.id))
          const toggleSelectAll = () => {
            if (allVisibleSelected) setSelected(s => s.filter(id => !visiblePieces.some(p => p.id === id)))
            else setSelected(s => Array.from(new Set([...s, ...visiblePieces.map(p => p.id)])))
          }
          return (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>
              Peças geradas ({visiblePieces.length})
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {visiblePieces.length > 0 && (
                <>
                  {selected.length > 0 ? (
                    <>
                      <span style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>{selected.length} selecionada(s)</span>
                      <Button variant="secondary" size="sm" onClick={() => setBulkStatusOpen(o => !o)}>◐ Status ▾</Button>
                      <Button variant="dark" size="sm" onClick={() => setExportOpen(true)}>↗ Exportar ({selected.length})</Button>
                      <Button variant="danger" size="sm" onClick={(e) => deleteSelected(e.altKey)} title="Option/Alt+click pra apagar sem confirmação">🗑 Apagar ({selected.length})</Button>
                      <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Cancelar</Button>
                    </>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={toggleSelectAll}>Selecionar tudo</Button>
                  )}
                  <div style={{ display: "flex", border: "1px solid #E0E0E0", borderRadius: 6, overflow: "hidden" }}>
                    <button onClick={() => setView("grid")}
                      style={{ background: view === "grid" ? "#111" : "white", color: view === "grid" ? "white" : "#888", border: "none", padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      Grid
                    </button>
                    <button onClick={() => setView("list")}
                      style={{ background: view === "list" ? "#111" : "white", color: view === "list" ? "white" : "#888", border: "none", padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      Lista
                    </button>
                  </div>
                  <Button variant="link" size="sm" onClick={() => router.push(`/pieces?campaignId=${id}`)}>Ver todas →</Button>
                </>
              )}
            </div>
          </div>

          {/* Mini menu pro bulk status */}
          {bulkStatusOpen && (
            <div style={{ background: "white", border: "1px solid #E0E0E0", borderRadius: 8, padding: 8, marginBottom: 10, display: "flex", gap: 6, flexWrap: "wrap", boxShadow: "0 2px 6px rgba(0,0,0,0.05)" }}>
              <span style={{ fontSize: 11, color: "#888", padding: "5px 8px" }}>Marcar como:</span>
              {PIECE_STATUS_LIST.filter(s => s !== "ENTREGUE").map(s => {
                const meta = statusMeta(s)
                return (
                  <button key={s} onClick={() => bulkSetStatus(s)}
                    style={{ background: meta.bg, color: meta.color, border: "none", borderRadius: 5, padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                    {meta.label}
                  </button>
                )
              })}
            </div>
          )}

          {/* Abas de filtro por status */}
          {pieces.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              <button
                onClick={() => { setStatusFilter("ALL"); setSelected([]) }}
                style={{
                  padding: "6px 12px", fontSize: 11, fontWeight: 600, borderRadius: 6,
                  border: statusFilter === "ALL" ? "1px solid #111" : "1px solid #E0E0E0",
                  background: statusFilter === "ALL" ? "#111" : "white",
                  color: statusFilter === "ALL" ? "white" : "#888", cursor: "pointer",
                }}>
                Todas <span style={{ opacity: 0.7 }}>({counts.ALL})</span>
              </button>
              {PIECE_STATUS_LIST.map(s => {
                const meta = statusMeta(s)
                const active = statusFilter === s
                return (
                  <button
                    key={s}
                    onClick={() => { setStatusFilter(s); setSelected([]) }}
                    style={{
                      padding: "6px 12px", fontSize: 11, fontWeight: 600, borderRadius: 6,
                      border: active ? `1px solid ${meta.color}` : "1px solid #E0E0E0",
                      background: active ? meta.bg : "white",
                      color: active ? meta.color : "#888", cursor: "pointer",
                    }}>
                    {meta.label} <span style={{ opacity: 0.7 }}>({counts[s]})</span>
                  </button>
                )
              })}
            </div>
          )}

          {visiblePieces.length === 0 ? (
            <div style={{ background: "white", border: "1px dashed #E0E0E0", borderRadius: 10, padding: 40, textAlign: "center", color: "#888", fontSize: 13 }}>
              {pieces.length === 0
                ? `Nenhuma peça gerada ainda. Abra o editor e clique em "Gerar Peças".`
                : `Nenhuma peça com este status.`}
            </div>
          ) : view === "grid" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
              {visiblePieces.map(p => (
                <div key={p.id}
                  style={{
                    background: "white", borderRadius: 10,
                    border: isSelected(p.id) ? "2px solid #F5C400" : "1px solid #E0E0E0",
                    display: "flex", flexDirection: "column", position: "relative",
                  }}>
                  {/* Checkbox */}
                  <div onClick={(e) => { e.stopPropagation(); toggleSelect(p.id) }}
                    title={isSelected(p.id) ? "Desselecionar" : "Selecionar"}
                    style={{
                      position: "absolute", top: 8, left: 8, zIndex: 5,
                      width: 20, height: 20, borderRadius: 4, cursor: "pointer",
                      background: isSelected(p.id) ? "#F5C400" : "rgba(255,255,255,0.9)",
                      border: isSelected(p.id) ? "none" : "1px solid #E0E0E0",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                    {isSelected(p.id) && <span style={{ color: "white", fontSize: 14, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                  </div>
                  <div
                    onClick={() => router.push(`/editor?campaignId=${id}&pieceId=${p.id}`)}
                    title="Editar peça"
                    style={{ height: 130, background: "#F5F5F0", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: "pointer", borderRadius: "10px 10px 0 0" }}>
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
                      <Button variant="ghost" size="sm" onClick={(e) => deletePiece(p.id, e.altKey)} title="Option/Alt+click pra apagar sem confirmação">🗑</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ background: "#fafafa", borderBottom: "1px solid #E0E0E0" }}>
                  <tr>
                    <th style={{ padding: "10px 12px", textAlign: "left", width: 32 }}>
                      <div onClick={toggleSelectAll}
                        style={{
                          width: 18, height: 18, borderRadius: 3, cursor: "pointer",
                          background: allVisibleSelected ? "#F5C400" : "white",
                          border: allVisibleSelected ? "none" : "1px solid #E0E0E0",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                        {allVisibleSelected && <span style={{ color: "white", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                      </div>
                    </th>
                    {(() => {
                      const SortHeader = ({ col, label, align = "left" }: { col: SortCol; label: string; align?: "left" | "right" }) => {
                        const active = sort?.col === col
                        const arrow = !active ? "" : sort.dir === "asc" ? " ↑" : " ↓"
                        return (
                          <th style={{ padding: "10px 12px", textAlign: align, fontSize: 11, fontWeight: 600, color: active ? "#111" : "#666", cursor: "pointer", userSelect: "none" }}
                            onClick={() => setSort(toggleSort(sort, col))}>
                            {label}{arrow}
                          </th>
                        )
                      }
                      return (
                        <>
                          <th style={{ padding: "10px 8px", textAlign: "left", width: 72 }}></th>
                          <SortHeader col="name" label="Nome" />
                          <SortHeader col="format" label="Formato" />
                          <SortHeader col="size" label="Tamanho" />
                          <SortHeader col="status" label="Status" />
                          <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "#666" }}>Ações</th>
                        </>
                      )
                    })()}
                  </tr>
                </thead>
                <tbody>
                  {visiblePieces.map(p => (
                    <tr key={p.id}
                      style={{ borderBottom: "1px solid #f0f0f0", background: isSelected(p.id) ? "#fffaeb" : "transparent" }}>
                      <td style={{ padding: "10px 12px" }}>
                        <div onClick={() => toggleSelect(p.id)}
                          style={{
                            width: 18, height: 18, borderRadius: 3, cursor: "pointer",
                            background: isSelected(p.id) ? "#F5C400" : "white",
                            border: isSelected(p.id) ? "none" : "1px solid #E0E0E0",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                          {isSelected(p.id) && <span style={{ color: "white", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                        </div>
                      </td>
                      <td style={{ padding: "8px 8px", cursor: "pointer" }}
                        onClick={() => router.push(`/editor?campaignId=${id}&pieceId=${p.id}`)}>
                        <RowThumb src={p.imageUrl} alt={p.name} fallbackText={p.format} />
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                        onClick={() => router.push(`/editor?campaignId=${id}&pieceId=${p.id}`)}>
                        {p.name}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "#666" }}>{p.format}</td>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "#666" }}>{p.width} × {p.height}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <StatusBadge pieceId={p.id} status={p.status ?? "STANDBY"} size="sm" onChange={(s) => setPieces(prev => prev.map(x => x.id === p.id ? { ...x, status: s } : x))} />
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right" }}>
                        <Button variant="ghost" size="sm" onClick={(e) => deletePiece(p.id, e.altKey)} title="Option/Alt+click pra apagar sem confirmação">🗑</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
          )
        })()}
      </div>

      {deliveryOpen && (
        <DeliveryDialog
          campaignId={id}
          campaignName={campaign.name}
          onClose={() => setDeliveryOpen(false)}
          onCreated={() => loadAll()}
        />
      )}

      {exportOpen && selected.length > 0 && (
        <ExportDialog
          pieces={pieces.filter(p => selected.includes(p.id)).map(p => ({ id: p.id, name: p.name, data: p.data, width: p.width, height: p.height }))}
          campaignName={campaign.name}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  )
}
