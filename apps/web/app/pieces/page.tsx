"use client"
import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Suspense } from "react"
import { PageShell } from "@/components/layout/PageShell"
import { Button } from "@/components/ui/Button"
import { FilterPill } from "@/components/ui/FilterPill"
import { ExportDialog } from "@/components/pieces/ExportDialog"
import { EditableText } from "@/components/EditableText"
import { StatusBadge } from "@/components/pieces/StatusBadge"
import { PIECE_STATUS_LIST, statusMeta } from "@/lib/pieceStatus"
import { sortPieces, toggleSort, SortCol, SortDir } from "@/lib/sortPieces"
import { RowThumb } from "@/components/ui/RowThumb"

interface Piece {
  id: string
  name: string
  format: string
  width: number
  height: number
  dpi: number
  status: string
  createdAt: string
  updatedAt?: string
  campaignId: string
  imageUrl?: string | null
  data?: any
}

function PiecesContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const campaignId = searchParams.get("campaignId")
  const [pieces, setPieces] = useState<Piece[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<"grid" | "list">("grid")
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [campaignName, setCampaignName] = useState<string | undefined>(undefined)

  useEffect(() => {
    const url = campaignId ? `/api/pieces?campaignId=${campaignId}` : "/api/pieces"
    fetch(url).then(r => r.json()).then(d => { setPieces(d); setLoading(false) })
    if (campaignId) {
      fetch(`/api/campaigns/${campaignId}`).then(r => r.json()).then((c: any) => {
        setCampaignName(c?.title ?? c?.name)
      }).catch(() => {})
    }
  }, [campaignId])

  function toggleSelect(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function isSelected(id: string) { return selected.includes(id) }

  async function deleteSelected(skipConfirm = false) {
    if (selected.length === 0) return
    if (!skipConfirm && !confirm(`Apagar ${selected.length} peça(s)? Esta ação não pode ser desfeita.`)) return
    await Promise.all(selected.map(id => fetch(`/api/pieces/${id}`, { method: "DELETE" })))
    setPieces(prev => prev.filter(p => !selected.includes(p.id)))
    setSelected([])
  }

  const filteredRaw = statusFilter === "ALL" ? pieces : pieces.filter(p => p.status === statusFilter)
  const filtered = sort ? sortPieces(filteredRaw, sort.col, sort.dir) : filteredRaw
  const counts: Record<string, number> = { ALL: pieces.length }
  for (const s of PIECE_STATUS_LIST) counts[s] = pieces.filter(p => p.status === s).length

  return (
    <PageShell>
      <div className="p-8">
        {campaignId && (
          <button
            onClick={() => router.push(`/campaigns/${campaignId}`)}
            className="text-xs text-[#888888] hover:text-[#111] mb-3 bg-transparent border-0 cursor-pointer p-0"
          >
            ← Campanha
          </button>
        )}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Peças <span className="text-[#888888] font-normal text-lg">({pieces.length})</span></h1>
            <p className="text-sm text-[#888888] mt-1">Gerencie e exporte as peças geradas</p>
          </div>
          <div className="flex items-center gap-3">
            {selected.length > 0 && (
              <>
                <Button variant="danger" size="sm" onClick={(e) => deleteSelected(e.altKey)} title="Option/Alt+click pra apagar sem confirmação">Apagar ({selected.length})</Button>
                <Button variant="primary" size="sm" onClick={() => setExportOpen(true)}>Exportar ({selected.length})</Button>
              </>
            )}
            <div className="flex gap-1.5">
              <FilterPill active={view === "grid"} onClick={() => setView("grid")} size="sm">Grid</FilterPill>
              <FilterPill active={view === "list"} onClick={() => setView("list")} size="sm">Lista</FilterPill>
            </div>
          </div>
        </div>

        {/* Filtro por status */}
        <div className="flex flex-wrap gap-2 mb-5">
          <FilterPill
            active={statusFilter === "ALL"}
            onClick={() => setStatusFilter("ALL")}
            accent="#111111"
            accentBg="#F5F5F5"
            accentText="#111111"
          >
            Todas <span style={{ opacity: 0.7, fontWeight: 400 }}>({counts.ALL})</span>
          </FilterPill>
          {PIECE_STATUS_LIST.map(s => {
            const meta = statusMeta(s)
            return (
              <FilterPill
                key={s}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
                accent={meta.color}
                accentBg={meta.bg}
                accentText={meta.color}
              >
                {meta.label} <span style={{ opacity: 0.7, fontWeight: 400 }}>({counts[s]})</span>
              </FilterPill>
            )
          })}
        </div>

        {loading ? (
          <div className="text-center py-16 text-[#888888]">Carregando...</div>
        ) : pieces.length === 0 ? (
          <div className="text-center py-16 text-[#888888]">Nenhuma peça encontrada</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-[#888888]">Nenhuma peça com esse status</div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-4 gap-4">
            {filtered.map((p) => (
              <div
                key={p.id}
                className={`bg-white rounded-lg border transition-all ${isSelected(p.id) ? "border-[#F5C400] shadow-md" : "border-[#E0E0E0] hover:border-[#F5C400]"}`}
              >
                <div
                  className="bg-[#F5F5F0] h-32 flex flex-col items-center justify-center relative overflow-hidden cursor-pointer group rounded-t-lg"
                  onClick={() => router.push(`/editor?campaignId=${p.campaignId}&pieceId=${p.id}`)}
                >
                  {p.imageUrl ? (
                    <img src={`${p.imageUrl}?t=${new Date(p.updatedAt ?? Date.now()).getTime()}`} alt={p.name} className="w-full h-full object-contain" />
                  ) : (
                    <>
                      <div className="text-xs font-semibold text-[#888888] mb-1">{p.format}</div>
                      <div className="text-xs text-[#aaaaaa]">{p.width}×{p.height}</div>
                    </>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none" />
                  <div
                    onClick={(e) => { e.stopPropagation(); toggleSelect(p.id) }}
                    className={`absolute top-2 left-2 w-5 h-5 rounded flex items-center justify-center cursor-pointer ${isSelected(p.id) ? "bg-[#F5C400]" : "bg-white border border-[#E0E0E0]"}`}
                  >
                    {isSelected(p.id) && <span className="text-white text-sm font-bold leading-none">✓</span>}
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-xs font-semibold"><EditableText value={p.name} variant="inline" onSave={async (newName) => {
                    const res = await fetch(`/api/pieces/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) })
                    if (!res.ok) throw new Error()
                    setPieces(prev => prev.map(x => x.id === p.id ? { ...x, name: newName } : x))
                  }} /></div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="text-xs text-[#888888]">{p.width}×{p.height} px</div>
                    <StatusBadge
                      pieceId={p.id}
                      status={p.status ?? "STANDBY"}
                      size="sm"
                      onChange={(s) => setPieces(prev => prev.map(x => x.id === p.id ? { ...x, status: s } : x))}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#E0E0E0] overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {(() => {
                    const SortHeader = ({ col, label }: { col: SortCol; label: string }) => {
                      const active = sort?.col === col
                      const arrow = !active ? "" : sort.dir === "asc" ? " ↑" : " ↓"
                      return (
                        <th onClick={() => setSort(toggleSort(sort, col))}
                          className={`text-left text-xs font-semibold uppercase tracking-wide px-4 py-3 border-b border-[#E0E0E0] cursor-pointer select-none ${active ? "text-[#111]" : "text-[#888888]"}`}>
                          {label}{arrow}
                        </th>
                      )
                    }
                    return (
                      <>
                        <th className="text-left text-xs font-semibold text-[#888888] uppercase tracking-wide px-4 py-3 border-b border-[#E0E0E0]"></th>
                        <th className="text-left text-xs font-semibold text-[#888888] uppercase tracking-wide px-2 py-3 border-b border-[#E0E0E0]"></th>
                        <SortHeader col="name" label="Nome" />
                        <SortHeader col="format" label="Formato" />
                        <SortHeader col="size" label="Dimensões" />
                        <th className="text-left text-xs font-semibold text-[#888888] uppercase tracking-wide px-4 py-3 border-b border-[#E0E0E0]">DPI</th>
                        <SortHeader col="status" label="Status" />
                        <th className="text-left text-xs font-semibold text-[#888888] uppercase tracking-wide px-4 py-3 border-b border-[#E0E0E0]"></th>
                      </>
                    )
                  })()}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                    <td className="px-4 py-3 w-8">
                      <div onClick={() => toggleSelect(p.id)} className={`w-5 h-5 rounded cursor-pointer flex items-center justify-center ${isSelected(p.id) ? "bg-[#F5C400]" : "bg-white border border-[#E0E0E0]"}`}>
                        {isSelected(p.id) && <span className="text-white text-sm font-bold leading-none">✓</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2 w-16 cursor-pointer" onClick={() => router.push(`/pieces/${p.id}`)}>
                      <RowThumb src={p.imageUrl ? `${p.imageUrl}?t=${new Date(p.updatedAt ?? Date.now()).getTime()}` : null} alt={p.name} fallbackText={p.format} />
                    </td>
                    <td className="px-4 py-3 font-semibold text-sm" onClick={e => e.stopPropagation()}><EditableText value={p.name} variant="inline" onSave={async (newName) => {
                      const res = await fetch(`/api/pieces/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) })
                      if (!res.ok) throw new Error()
                      setPieces(prev => prev.map(x => x.id === p.id ? { ...x, name: newName } : x))
                    }} /></td>
                    <td className="px-4 py-3 text-sm text-[#888888]">{p.format}</td>
                    <td className="px-4 py-3 text-sm text-[#888888]">{p.width}×{p.height}</td>
                    <td className="px-4 py-3 text-sm text-[#888888]">{p.dpi}</td>
                    <td className="px-4 py-3"><StatusBadge pieceId={p.id} status={p.status ?? "STANDBY"} size="sm" onChange={(s) => setPieces(prev => prev.map(x => x.id === p.id ? { ...x, status: s } : x))} /></td>
                    <td className="px-4 py-3 text-right"><Button variant="secondary" size="sm" onClick={() => router.push(`/pieces/${p.id}`)}>Ver</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {exportOpen && (
        <ExportDialog
          pieces={pieces.filter(p => selected.includes(p.id)).map(p => ({ id: p.id, name: p.name, data: p.data, width: p.width, height: p.height }))}
          campaignName={campaignName}
          onClose={() => setExportOpen(false)}
        />
      )}
    </PageShell>
  )
}

export default function PiecesPage() {
  return <Suspense><PiecesContent /></Suspense>
}
