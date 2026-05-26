"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PageShell } from "@/components/layout/PageShell"
import { statusMeta } from "@/lib/pieceStatus"
import { StatusBadge } from "@/components/pieces/StatusBadge"
import { RowThumb } from "@/components/ui/RowThumb"
import { Button } from "@/components/ui/Button"
import { PageHeader } from "@/components/ui/PageHeader"

interface Campaign {
  id: string
  name: string
  status: string
  psdName?: string | null
  createdAt: string
  updatedAt: string
  client: { id: string; name: string }
  _count: { pieces: number; assets: number }
  keyVision?: { thumbnailUrl?: string | null; width?: number; height?: number; bgColor?: string } | null
}

export default function CampaignsPage() {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<"grid" | "list">("list")
  const [q, setQ] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  // Modal "+ Nova Campanha" (analogo ao "+ Nova Empresa" da dashboard).
  const [showNew, setShowNew] = useState(false)
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [newForm, setNewForm] = useState<{ name: string; clientId: string; code: string }>({ name: "", clientId: "", code: "" })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function openNewModal() {
    setShowNew(true)
    setCreateError(null)
    // Lazy load clientes — so abre modal quando user clica.
    if (clients.length === 0) {
      try {
        const r = await fetch("/api/clients", { cache: "no-store" })
        const d = await r.json()
        const list = Array.isArray(d) ? d : []
        setClients(list)
        if (list.length > 0 && !newForm.clientId) {
          setNewForm(f => ({ ...f, clientId: list[0].id }))
        }
      } catch (e) {
        setCreateError("Falha ao carregar empresas")
      }
    }
  }

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault()
    if (!newForm.name.trim() || !newForm.clientId) return
    setCreating(true)
    setCreateError(null)
    try {
      const r = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newForm.name.trim(),
          clientId: newForm.clientId,
          code: newForm.code.trim() || undefined,
        }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d?.error ?? "Falha ao criar campanha")
      }
      const created = await r.json()
      setShowNew(false)
      setNewForm({ name: "", clientId: "", code: "" })
      // Navega direto pra pagina da campanha criada — mesmo padrao de
      // "+ Nova Empresa" que sai do dashboard pra page da empresa.
      router.push(`/campaigns/${created.id}`)
    } catch (err: any) {
      setCreateError(err?.message ?? "Erro ao criar")
    } finally {
      setCreating(false)
    }
  }

  async function deleteCampaign(id: string, skipConfirm = false) {
    if (!skipConfirm && confirmDelete !== id) { setConfirmDelete(id); return }
    setDeletingId(id)
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      setCampaigns(prev => prev.filter(c => c.id !== id))
      setConfirmDelete(null)
    } catch {
      alert("Falha ao apagar campanha")
    } finally {
      setDeletingId(null)
    }
  }

  async function duplicateCampaign(id: string) {
    setDuplicatingId(id)
    try {
      const res = await fetch(`/api/campaigns/${id}/duplicate`, { method: "POST" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert("Falha ao duplicar: " + (err.detail ?? err.error ?? "?"))
        return
      }
      // Recarrega lista pra mostrar a duplicada
      const r = await fetch("/api/campaigns", { cache: "no-store" })
      const d = await r.json()
      setCampaigns(Array.isArray(d) ? d : [])
    } finally {
      setDuplicatingId(null)
    }
  }

  async function renameCampaign(id: string, currentName: string) {
    const next = prompt("Novo nome da campanha:", currentName)?.trim()
    if (!next || next === currentName) return
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next }),
    })
    if (!res.ok) { alert("Falha ao renomear"); return }
    setCampaigns(prev => prev.map(c => c.id === id ? { ...c, name: next } : c))
  }

  useEffect(() => {
    fetch("/api/campaigns", { cache: "no-store" }).then(r => r.json()).then(d => {
      setCampaigns(Array.isArray(d) ? d : [])
      setLoading(false)
    })
  }, [])

  const filtered = campaigns.filter(c => {
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      if (!c.name.toLowerCase().includes(needle) && !c.client.name.toLowerCase().includes(needle)) return false
    }
    return true
  })

  return (
    <PageShell>
      <div className="p-8">
        <PageHeader
          title=""
          count={campaigns.length}
          actions={
            <>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Buscar campanha ou cliente..."
                className="px-3 py-1.5 text-xs border border-[#E0E0E0] rounded-md w-64 outline-none focus:border-[#888]"
              />
              <div className="flex border border-[#E0E0E0] rounded-md overflow-hidden">
                <button onClick={() => setView("grid")} className={`px-3 py-1.5 text-xs font-medium cursor-pointer border-0 ${view === "grid" ? "bg-[#111111] text-white" : "bg-white text-[#888888]"}`}>Grid</button>
                <button onClick={() => setView("list")} className={`px-3 py-1.5 text-xs font-medium cursor-pointer border-0 ${view === "list" ? "bg-[#111111] text-white" : "bg-white text-[#888888]"}`}>Lista</button>
              </div>
              <Button onClick={openNewModal}>+ Nova Campanha</Button>
            </>
          }
        />

        {loading ? (
          <div className="text-center py-16 text-[#888888]">Carregando...</div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-16 text-[#888888]">Nenhuma campanha. Comece criando uma a partir de um cliente.</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-[#888888]">Nenhuma campanha encontrada com esse filtro</div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-3 gap-4">
            {filtered.map(c => {
              const meta = statusMeta(c.status)
              return (
                <div
                  key={c.id}
                  onClick={() => router.push(`/campaigns/${c.id}`)}
                  className="bg-white rounded-lg border border-[#E0E0E0] hover:border-[#F5C400] cursor-pointer transition-all"
                >
                  <div className="bg-[#F5F5F0] h-40 flex items-center justify-center rounded-t-lg overflow-hidden">
                    {c.keyVision?.thumbnailUrl ? (
                      <img src={c.keyVision.thumbnailUrl} alt={c.name} className="w-full h-full object-contain" />
                    ) : (
                      <div className="text-xs text-[#aaa]">Sem matriz</div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="font-semibold text-sm leading-tight">{c.name}</div>
                      <StatusBadge
                        pieceId={c.id}
                        entityType="campaign"
                        status={c.status ?? "STANDBY"}
                        size="sm"
                        onChange={(s) => setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, status: s } : x))}
                      />
                    </div>
                    <div className="text-xs text-[#888] mb-3">{c.client.name}</div>
                    <div className="flex justify-between text-xs text-[#888] pt-2 border-t border-[#f0f0f0]">
                      <span>{c._count.pieces} peças · {c._count.assets} assets</span>
                      <span>{new Date(c.updatedAt).toLocaleDateString("pt-BR")}</span>
                    </div>
                    <div className="flex justify-end mt-2" onClick={e => e.stopPropagation()}>
                      {confirmDelete === c.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-[#666]">Confirmar?</span>
                          <Button variant="danger" size="sm" loading={deletingId === c.id} onClick={() => deleteCampaign(c.id, true)}>Sim</Button>
                          <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>Não</Button>
                        </div>
                      ) : (
                        <Button variant="danger" size="sm" title="Option/Alt+click pra apagar sem confirmação" onClick={(e) => deleteCampaign(c.id, e.altKey)}>Apagar</Button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#E0E0E0] overflow-hidden">
            <table className="w-full border-collapse">
              <thead className="bg-[#fafafa] border-b border-[#E0E0E0]">
                <tr>
                  <th className="px-2 py-1.5 text-left" style={{ width: 72 }}></th>
                  <th className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#888]">Nome</th>
                  <th className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#888]">Cliente</th>
                  <th className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#888]">Status</th>
                  <th className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#888]">Peças</th>
                  <th className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#888]">Assets</th>
                  <th className="px-3 py-1.5 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const meta = statusMeta(c.status)
                  return (
                    <tr
                      key={c.id}
                      onClick={() => router.push(`/campaigns/${c.id}`)}
                      className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa] cursor-pointer"
                    >
                      <td className="px-2 py-1.5"><RowThumb src={c.keyVision?.thumbnailUrl} alt={c.name} fallbackText={c.name} /></td>
                      <td className="px-3 py-1.5 font-semibold text-[13px]">{c.name}</td>
                      <td className="px-3 py-1.5 text-[12px] text-[#666]">{c.client.name}</td>
                      <td className="px-3 py-1.5">
                        <StatusBadge
                          pieceId={c.id}
                          entityType="campaign"
                          status={c.status ?? "STANDBY"}
                          size="sm"
                          onChange={(s) => setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, status: s } : x))}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-[12px] text-[#666]">{c._count.pieces}</td>
                      <td className="px-3 py-1.5 text-[12px] text-[#666]">{c._count.assets}</td>
                      <td className="px-3 py-1.5 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-2 justify-end">
                          {confirmDelete === c.id ? (
                            <>
                              <span className="text-[11px] text-[#666] self-center">Confirmar?</span>
                              <Button variant="danger" size="sm" loading={deletingId === c.id} onClick={() => deleteCampaign(c.id, true)}>Sim</Button>
                              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>Não</Button>
                            </>
                          ) : (
                            <>
                              <Button variant="danger" size="sm" title="Option/Alt+click pra apagar sem confirmação" onClick={(e) => deleteCampaign(c.id, e.altKey)}>Apagar</Button>
                              <Button variant="info" size="sm" loading={duplicatingId === c.id} onClick={() => duplicateCampaign(c.id)}>
                                {duplicatingId === c.id ? "Duplicando..." : "Duplicar"}
                              </Button>
                              <Button variant="secondary" size="sm" onClick={() => renameCampaign(c.id, c.name)}>Editar</Button>
                              <Button variant="view" size="sm" onClick={() => router.push(`/campaigns/${c.id}`)}>Entrar</Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal "+ Nova Campanha" — analogo ao "+ Nova Empresa" do dashboard.
          Select de Empresa + Nome + Codigo opcional. POST + redirect pra
          /campaigns/{id}. */}
      {showNew && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "white", borderRadius: 12, width: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "16px 24px", borderBottom: "1px solid #E0E0E0" }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Nova Campanha</div>
            </div>
            <form onSubmit={createCampaign} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.5px", color: "#888", display: "block", marginBottom: 5 }}>Empresa *</label>
                {clients.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#888", padding: "8px 0" }}>Carregando empresas…</div>
                ) : (
                  <select
                    value={newForm.clientId}
                    onChange={e => setNewForm(f => ({ ...f, clientId: e.target.value }))}
                    required
                    style={{ width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" as const, background: "white" }}
                  >
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.5px", color: "#888", display: "block", marginBottom: 5 }}>Nome *</label>
                <input
                  type="text"
                  value={newForm.name}
                  onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Nome da campanha"
                  required
                  autoFocus
                  style={{ width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" as const }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.5px", color: "#888", display: "block", marginBottom: 5 }}>Código (opcional)</label>
                <input
                  type="text"
                  value={newForm.code}
                  onChange={e => setNewForm(f => ({ ...f, code: e.target.value }))}
                  placeholder="Ex: BB-2026-001"
                  style={{ width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" as const }}
                />
              </div>
              {createError && <p style={{ color: "#dc2626", fontSize: 12, margin: 0 }}>{createError}</p>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
                <Button type="button" variant="secondary" onClick={() => setShowNew(false)}>Cancelar</Button>
                <Button type="submit" loading={creating} disabled={!newForm.name.trim() || !newForm.clientId || creating}>
                  {creating ? "Criando…" : "Criar campanha"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageShell>
  )
}
