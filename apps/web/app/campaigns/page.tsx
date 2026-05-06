"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PageShell } from "@/components/layout/PageShell"
import { PIECE_STATUS_LIST, statusMeta } from "@/lib/pieceStatus"

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
  const [view, setView] = useState<"grid" | "list">("grid")
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [q, setQ] = useState("")

  useEffect(() => {
    fetch("/api/campaigns").then(r => r.json()).then(d => {
      setCampaigns(Array.isArray(d) ? d : [])
      setLoading(false)
      // DEBUG: lista os status unicos que vieram do banco
      if (Array.isArray(d)) {
        const uniqueStatuses = [...new Set(d.map((c: any) => c.status))]
        console.log("[CAMPAIGNS-STATUS] Status no banco:", uniqueStatuses, "Total:", d.length)
      }
    })
  }, [])

  const filtered = campaigns.filter(c => {
    if (statusFilter !== "ALL" && c.status !== statusFilter) return false
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      if (!c.name.toLowerCase().includes(needle) && !c.client.name.toLowerCase().includes(needle)) return false
    }
    return true
  })

  const counts: Record<string, number> = { ALL: campaigns.length }
  for (const s of PIECE_STATUS_LIST) counts[s] = campaigns.filter(c => c.status === s).length

  return (
    <PageShell>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Campanhas <span className="text-[#888888] font-normal text-lg">({campaigns.length})</span></h1>
            <p className="text-sm text-[#888888] mt-1">Gerencie suas campanhas em um só lugar</p>
          </div>
          <div className="flex items-center gap-3">
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
          </div>
        </div>

        {/* Filtro por status */}
        <div className="flex flex-wrap gap-2 mb-5">
          <button
            onClick={() => setStatusFilter("ALL")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${statusFilter === "ALL" ? "bg-[#111] text-white border-[#111]" : "bg-white text-[#888] border-[#E0E0E0] hover:border-[#888]"}`}
          >
            Todas <span className="opacity-70">({counts.ALL})</span>
          </button>
          {PIECE_STATUS_LIST.map(s => {
            const meta = statusMeta(s)
            const active = statusFilter === s
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={active ? { background: meta.bg, color: meta.color, borderColor: meta.color } : {}}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${active ? "" : "bg-white text-[#888] border-[#E0E0E0] hover:border-[#888]"}`}
              >
                {meta.label} <span className="opacity-70">({counts[s]})</span>
              </button>
            )
          })}
        </div>

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
                      <span style={{ background: meta.bg, color: meta.color }} className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap">{meta.label}</span>
                    </div>
                    <div className="text-xs text-[#888] mb-3">{c.client.name}</div>
                    <div className="flex justify-between text-xs text-[#888] pt-2 border-t border-[#f0f0f0]">
                      <span>{c._count.pieces} peças · {c._count.assets} assets</span>
                      <span>{new Date(c.updatedAt).toLocaleDateString("pt-BR")}</span>
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#666]">Nome</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#666]">Cliente</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#666]">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#666]">Peças</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#666]">Assets</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#666]">Atualizada</th>
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
                      <td className="px-4 py-3 font-semibold text-sm">{c.name}</td>
                      <td className="px-4 py-3 text-sm text-[#666]">{c.client.name}</td>
                      <td className="px-4 py-3">
                        <span style={{ background: meta.bg, color: meta.color }} className="text-[10px] font-semibold px-2 py-0.5 rounded-full">{meta.label}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[#666]">{c._count.pieces}</td>
                      <td className="px-4 py-3 text-sm text-[#666]">{c._count.assets}</td>
                      <td className="px-4 py-3 text-sm text-[#666]">{new Date(c.updatedAt).toLocaleDateString("pt-BR")}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  )
}
