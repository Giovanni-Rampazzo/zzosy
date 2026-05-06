"use client"
import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Suspense } from "react"
import { PageShell } from "@/components/layout/PageShell"
import { Button } from "@/components/ui/Button"
import { ExportDialog } from "@/components/pieces/ExportDialog"
import { EditableText } from "@/components/EditableText"
import { statusMeta } from "@/lib/pieceStatus"

interface Piece {
  id: string
  name: string
  format: string
  width: number
  height: number
  dpi: number
  status: string
  createdAt: string
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

  async function deleteSelected() {
    await Promise.all(selected.map(id => fetch(`/api/pieces/${id}`, { method: "DELETE" })))
    setPieces(prev => prev.filter(p => !selected.includes(p.id)))
    setSelected([])
  }

  return (
    <PageShell>
      <div className="p-8">
        {campaignId && (
          <button
            onClick={() => router.push(`/campaigns/${campaignId}`)}
            className="text-xs text-[#888888] hover:text-[#111] mb-3 bg-transparent border-0 cursor-pointer p-0"
          >
            ← Voltar para a campanha
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
                <Button variant="danger" size="sm" onClick={deleteSelected}>🗑 Apagar ({selected.length})</Button>
                <Button size="sm" onClick={() => setExportOpen(true)}>↗ Exportar ({selected.length})</Button>
              </>
            )}
            <div className="flex border border-[#E0E0E0] rounded-md overflow-hidden">
              <button onClick={() => setView("grid")} className={`px-3 py-1.5 text-xs font-medium cursor-pointer border-0 ${view === "grid" ? "bg-[#111111] text-white" : "bg-white text-[#888888]"}`}>Grid</button>
              <button onClick={() => setView("list")} className={`px-3 py-1.5 text-xs font-medium cursor-pointer border-0 ${view === "list" ? "bg-[#111111] text-white" : "bg-white text-[#888888]"}`}>Lista</button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-[#888888]">Carregando...</div>
        ) : pieces.length === 0 ? (
          <div className="text-center py-16 text-[#888888]">Nenhuma peça encontrada</div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-4 gap-4">
            {pieces.map((p) => (
              <div
                key={p.id}
                className={`bg-white rounded-lg border transition-all overflow-hidden ${isSelected(p.id) ? "border-[#F5C400] shadow-md" : "border-[#E0E0E0] hover:border-[#F5C400]"}`}
              >
                <div
                  className="bg-[#F5F5F0] h-32 flex flex-col items-center justify-center relative overflow-hidden cursor-pointer group"
                  onClick={() => router.push(`/editor?campaignId=${p.campaignId}&pieceId=${p.id}`)}
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="w-full h-full object-contain" />
                  ) : (
                    <>
                      <div className="text-xs font-semibold text-[#888888] mb-1">{p.format}</div>
                      <div className="text-xs text-[#aaaaaa]">{p.width}×{p.height}</div>
                    </>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none" />
                  <div
                    onClick={(e) => { e.stopPropagation(); toggleSelect(p.id) }}
                    className={`absolute top-2 left-2 w-4 h-4 border-2 rounded flex items-center justify-center cursor-pointer ${isSelected(p.id) ? "border-[#F5C400] bg-[#F5C400]" : "border-[#E0E0E0] bg-white"}`}
                  >
                    {isSelected(p.id) && <div className="w-2 h-2 bg-white rounded-sm" />}
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
                    <span style={{ background: statusMeta(p.status).bg, color: statusMeta(p.status).color }} className="text-xs px-2 py-0.5 rounded-full font-medium">
                      {statusMeta(p.status).label}
                    </span>
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
                  {["", "Nome", "Formato", "Dimensões", "DPI", "Status", ""].map((h, i) => (
                    <th key={i} className="text-left text-xs font-semibold text-[#888888] uppercase tracking-wide px-4 py-3 border-b border-[#E0E0E0]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pieces.map((p) => (
                  <tr key={p.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                    <td className="px-4 py-3 w-8">
                      <div onClick={() => toggleSelect(p.id)} className={`w-4 h-4 border-2 rounded cursor-pointer flex items-center justify-center ${isSelected(p.id) ? "border-[#F5C400] bg-[#F5C400]" : "border-[#E0E0E0]"}`}>
                        {isSelected(p.id) && <div className="w-2 h-2 bg-white rounded-sm" />}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-sm" onClick={e => e.stopPropagation()}><EditableText value={p.name} variant="inline" onSave={async (newName) => {
                      const res = await fetch(`/api/pieces/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) })
                      if (!res.ok) throw new Error()
                      setPieces(prev => prev.map(x => x.id === p.id ? { ...x, name: newName } : x))
                    }} /></td>
                    <td className="px-4 py-3 text-sm text-[#888888]">{p.format}</td>
                    <td className="px-4 py-3 text-sm text-[#888888]">{p.width}×{p.height}</td>
                    <td className="px-4 py-3 text-sm text-[#888888]">{p.dpi}</td>
                    <td className="px-4 py-3"><span style={{ background: statusMeta(p.status).bg, color: statusMeta(p.status).color }} className="text-xs px-2 py-0.5 rounded-full font-medium">{statusMeta(p.status).label}</span></td>
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
