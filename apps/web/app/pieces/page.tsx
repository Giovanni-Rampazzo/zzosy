"use client"
import { useEffect, useRef, useState } from "react"
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
import { CampaignSubnav } from "@/components/campaign/CampaignSubnav"
import { DuplicateFormatDialog } from "@/components/pieces/DuplicateFormatDialog"
import { PageHeader } from "@/components/ui/PageHeader"
import { PsdPieceImporter, type PsdPieceImporterHandle } from "@/components/campaign/PsdPieceImporter"

interface Piece {
  id: string
  name: string
  format: string
  width: number
  height: number
  dpi: number
  status: string
  mediaFormatCategory?: string
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
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL")
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [campaignName, setCampaignName] = useState<string | undefined>(undefined)
  const [campaignClientId, setCampaignClientId] = useState<string | undefined>(undefined)
  const [campaignClientName, setCampaignClientName] = useState<string | undefined>(undefined)
  const [campaignHasAssets, setCampaignHasAssets] = useState<boolean>(false)
  // Assets da campanha pra suportar drag-drop de PSDs (PsdPieceImporter precisa).
  const [campaignAssets, setCampaignAssets] = useState<Array<{ id: string; label: string | null; type: string; imageUrl?: string | null }>>([])
  // Ref + estado pra drag-drop de PSDs nessa pagina (mesmo padrao de /campaigns/[id]).
  const psdPieceImporterRef = useRef<PsdPieceImporterHandle>(null)
  const [piecesDragOver, setPiecesDragOver] = useState(false)
  const [psdImporting, setPsdImporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    const url = campaignId ? `/api/pieces?campaignId=${campaignId}` : "/api/pieces"
    // Carga inicial — com loading state
    fetch(url).then(r => r.json()).then(d => {
      if (cancelled) return
      setPieces(d); setLoading(false)
    })
    if (campaignId) {
      fetch(`/api/campaigns/${campaignId}`).then(r => r.json()).then((c: any) => {
        if (cancelled) return
        setCampaignName(c?.title ?? c?.name)
        setCampaignClientId(c?.client?.id ?? c?.clientId)
        setCampaignClientName(c?.client?.name)
        setCampaignHasAssets(Array.isArray(c?.assets) && c.assets.length > 0)
        setCampaignAssets(Array.isArray(c?.assets) ? c.assets : [])
      }).catch(() => {})
    }

    // === PREVIEW REAL-TIME ===
    // Refetch silencioso: pega mudancas externas (outra aba, outro user, scripts).
    // 5s eh balance entre frescor visual e load no server. Pula visualmente
    // piscar comparando updatedAt — atualiza apenas pieces que mudaram.
    async function silentRefetch() {
      if (cancelled || typeof document === "undefined" || document.hidden) return
      try {
        const r = await fetch(url, { cache: "no-store" })
        if (!r.ok) return
        const fresh: Piece[] = await r.json()
        if (cancelled) return
        setPieces(prev => {
          // Se quantidade mudou ou ids diferentes → substitui completo
          const prevIds = prev.map(p => p.id).join("|")
          const freshIds = fresh.map(p => p.id).join("|")
          if (prevIds !== freshIds) return fresh
          // Mesmo conjunto: faz merge preservando referencias quando updatedAt
          // nao mudou (evita re-render desnecessario do <img>).
          return prev.map(p => {
            const next = fresh.find(f => f.id === p.id)
            if (!next) return p
            const prevTs = new Date((p as any).updatedAt ?? 0).getTime()
            const nextTs = new Date((next as any).updatedAt ?? 0).getTime()
            return nextTs > prevTs ? next : p
          })
        })
      } catch {}
    }
    const pollTimer = setInterval(silentRefetch, 5000)

    // Listener BroadcastChannel: editor faz postMessage quando salva uma peca.
    // Refetch IMEDIATO quando notificado (sem esperar o polling). Cross-tab.
    let bc: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== "undefined") {
        bc = new BroadcastChannel("zzosy:pieces")
        bc.onmessage = (ev) => {
          const msg = ev.data
          if (!msg || msg.type !== "piece-updated") return
          // Se a peca atualizada eh dessa campanha (ou estamos vendo todas), refetch
          if (!campaignId || msg.campaignId === campaignId) silentRefetch()
        }
      }
    } catch {}

    // Tambem refetch quando a aba volta a ficar visivel (user trocou de aba e voltou)
    const onVisible = () => { if (!document.hidden) silentRefetch() }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      cancelled = true
      clearInterval(pollTimer)
      document.removeEventListener("visibilitychange", onVisible)
      try { bc?.close() } catch {}
    }
  }, [campaignId])

  // LAZY THUMB REGEN — peças sem imageUrl ganham preview em background.
  // regeneratePieceThumb broadcasta piece-updated → lista refetch.
  useEffect(() => {
    if (pieces.length === 0) return
    const missing = pieces.filter(p => !p.imageUrl).map(p => p.id)
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      const { regeneratePieceThumb } = await import("@/lib/regenerateThumbs")
      for (const pid of missing) {
        if (cancelled) break
        try { await regeneratePieceThumb(pid) }
        catch (e) { console.warn("[lazy-regen]", pid, e) }
      }
    })()
    return () => { cancelled = true }
  }, [pieces])

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

  async function deleteOne(id: string, skipConfirm = false) {
    if (!skipConfirm && !confirm("Apagar esta peça?")) return
    await fetch(`/api/pieces/${id}`, { method: "DELETE" })
    setPieces(prev => prev.filter(p => p.id !== id))
    setSelected(prev => prev.filter(x => x !== id))
  }

  // Dialog de duplicação: pergunta o formato (manter ou trocar).
  const [dupDialog, setDupDialog] = useState<{ ids: string[]; originalFormat?: string } | null>(null)

  function duplicateOne(id: string) {
    const p = pieces.find(x => x.id === id)
    setDupDialog({ ids: [id], originalFormat: p?.format })
  }

  async function confirmDuplicate(mediaFormatId: string | null) {
    if (!dupDialog) return
    try {
      const body: any = { ids: dupDialog.ids }
      if (mediaFormatId) body.mediaFormatId = mediaFormatId
      const r = await fetch(`/api/pieces/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        alert(`Erro ao duplicar: ${err?.error ?? r.statusText}`)
        return
      }
      setDupDialog(null)
      // Refetch lista pra mostrar a nova peça
      const url = campaignId ? `/api/pieces?campaignId=${campaignId}` : "/api/pieces"
      const fresh = await fetch(url).then(r => r.json())
      setPieces(fresh)
    } catch (e: any) {
      alert(`Erro ao duplicar: ${e?.message ?? e}`)
    }
  }

  // Aplica filtros (status + categoria) e ordenacao
  const afterStatus = statusFilter === "ALL" ? pieces : pieces.filter(p => p.status === statusFilter)
  const afterCategory = categoryFilter === "ALL" ? afterStatus : afterStatus.filter(p => (p.mediaFormatCategory ?? "Sem categoria") === categoryFilter)
  const filteredRaw = afterCategory
  const filtered = sort ? sortPieces(filteredRaw, sort.col, sort.dir) : filteredRaw
  const counts: Record<string, number> = { ALL: pieces.length }
  for (const s of PIECE_STATUS_LIST) counts[s] = pieces.filter(p => p.status === s).length

  // Lista de categorias unicas vindas do MediaFormat associado (pra filtro no topo).
  const allCategories = Array.from(new Set(pieces.map(p => p.mediaFormatCategory ?? "Sem categoria"))).sort()

  // Agrupa pecas filtradas por categoria (pra exibicao em sections com header).
  // Categoria vem do MediaFormat de cada peca. Editar a categoria de uma peca
  // significa editar o MediaFormat dela em /medias.
  const grouped: Record<string, Piece[]> = {}
  for (const p of filtered) {
    const cat = p.mediaFormatCategory ?? "Sem categoria"
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(p)
  }
  const groupedKeys = Object.keys(grouped).sort()

  // Refetch helper para o PsdPieceImporter chamar apos importar.
  async function reloadPieces() {
    if (!campaignId) return
    try {
      const r = await fetch(`/api/pieces?campaignId=${campaignId}`, { cache: "no-store" })
      if (r.ok) setPieces(await r.json())
    } catch {}
  }

  return (
    <PageShell>
      <div
        className="p-8"
        // Drag-drop de PSDs: cria uma peca nova por arquivo. Pattern espelhado
        // de /campaigns/[id]/page.tsx (so funciona quando ha campaignId + assets).
        onDragOver={e => {
          if (!campaignId || !campaignHasAssets) return
          const hasFile = Array.from(e.dataTransfer.types ?? []).includes("Files")
          if (!hasFile) return
          e.preventDefault()
          if (!piecesDragOver) setPiecesDragOver(true)
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setPiecesDragOver(false)
        }}
        onDrop={async e => {
          if (!campaignId) return
          e.preventDefault()
          setPiecesDragOver(false)
          if (!campaignHasAssets) { alert("Importe a matriz (PSD) primeiro — peças precisam de assets pra linkar"); return }
          const files = Array.from(e.dataTransfer.files).filter(f => /\.psd$/i.test(f.name))
          if (files.length === 0) { alert("Arraste 1 ou mais arquivos .psd"); return }
          try {
            setPsdImporting(true)
            await psdPieceImporterRef.current?.importFiles(files)
          } finally {
            setPsdImporting(false)
            reloadPieces()
          }
        }}
        style={{ position: "relative", minHeight: "calc(100vh - 64px)" }}
      >
        {/* Overlay visual durante drag-over de PSD */}
        {piecesDragOver && (
          <div style={{
            position: "fixed", inset: 64, zIndex: 1000,
            border: "3px dashed #F5C400", borderRadius: 12,
            background: "rgba(245,196,0,0.08)",
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}>
            <div style={{
              background: "#111", color: "#F5C400",
              padding: "16px 24px", borderRadius: 8,
              fontWeight: 700, fontSize: 16, letterSpacing: 0.5,
            }}>
              Solte o(s) PSD para importar como peça(s)
            </div>
          </div>
        )}
        {/* Overlay de progresso enquanto importa */}
        {psdImporting && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 1100,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ background: "#fff", color: "#111", padding: "20px 28px", borderRadius: 10, fontWeight: 600 }}>
              Importando PSD(s)…
            </div>
          </div>
        )}
        {/* PsdPieceImporter renderizado mas com UI propria escondida — o handle
            via ref é o que importamos via drag-drop. */}
        {campaignId && (
          <div style={{ position: "absolute", left: -9999, top: -9999, visibility: "hidden" }}>
            <PsdPieceImporter
              ref={psdPieceImporterRef}
              campaignId={campaignId}
              campaignAssets={campaignAssets}
              onImported={reloadPieces}
            />
          </div>
        )}
        {campaignId && (
          <CampaignSubnav
            campaignId={campaignId}
            clientId={campaignClientId}
            clientName={campaignClientName}
            activeTab="pieces"
            hasAssets={campaignHasAssets}
            hasPieces={pieces.length > 0}
          />
        )}
        <PageHeader
          title="Peças"
          count={pieces.length}
          subtitle="Gerencie e exporte as peças geradas"
          actions={
            <>
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
            </>
          }
        />
        {/* Filtro por status */}
        <div className="flex flex-wrap gap-2 mb-2">
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

        {/* Filtro por categoria — so aparece se ha mais de 1 categoria */}
        {allCategories.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs text-[#555] uppercase tracking-wider font-bold mr-1">Categoria:</span>
            <FilterPill
              active={categoryFilter === "ALL"}
              onClick={() => setCategoryFilter("ALL")}
              accent="#111111"
              accentBg="#F5F5F5"
              accentText="#111111"
            >
              Todas
            </FilterPill>
            {allCategories.map(c => (
              <FilterPill
                key={c}
                active={categoryFilter === c}
                onClick={() => setCategoryFilter(c)}
                accent="#111111"
                accentBg="#F5F5F5"
                accentText="#111111"
              >
                {c} <span style={{ opacity: 0.7, fontWeight: 400 }}>({pieces.filter(p => (p.mediaFormatCategory ?? "Sem categoria") === c).length})</span>
              </FilterPill>
            ))}
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-[#888888]">Carregando...</div>
        ) : pieces.length === 0 ? (
          <div className="text-center py-16 text-[#888888]">Nenhuma peça encontrada</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-[#888888]">Nenhuma peça com esse status</div>
        ) : view === "grid" ? (
          // Agrupado por categoria. Cada grupo tem header com o nome da categoria.
          <div className="space-y-6">
            {groupedKeys.map(cat => (
              <div key={cat}>
                <div className="text-xs font-bold uppercase tracking-wider text-[#555] mb-3 pb-2 border-b border-[#E0E0E0]">
                  {cat} <span className="text-[#aaa] font-normal">({grouped[cat].length})</span>
                </div>
                <div className="grid grid-cols-4 gap-4">
                  {grouped[cat].map((p) => (
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
                  <div className="flex items-center gap-1 mt-2 pt-2 border-t border-[#F0F0F0]">
                    <Button variant="info" size="sm" onClick={() => duplicateOne(p.id)} title="Duplicar peça">Duplicar</Button>
                    <Button variant="danger" size="sm" onClick={(e) => deleteOne(p.id, e.altKey)} title="Option/Alt+click pra apagar sem confirmação">Apagar</Button>
                  </div>
                </div>
              </div>
                  ))}
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
                          className={`text-left text-xs font-semibold uppercase tracking-wide px-4 py-2 border-b border-[#E0E0E0] cursor-pointer select-none ${active ? "text-[#111]" : "text-[#888888]"}`}>
                          {label}{arrow}
                        </th>
                      )
                    }
                    return (
                      <>
                        <th className="text-left text-xs font-semibold text-[#888888] uppercase tracking-wide px-4 py-2 border-b border-[#E0E0E0]"></th>
                        <th className="text-left text-xs font-semibold text-[#888888] uppercase tracking-wide px-2 py-2 border-b border-[#E0E0E0]"></th>
                        <SortHeader col="name" label="Nome" />
                        <SortHeader col="format" label="Formato" />
                        <SortHeader col="size" label="Dimensões" />
                        <th className="text-left text-xs font-semibold text-[#888888] uppercase tracking-wide px-4 py-2 border-b border-[#E0E0E0]">DPI</th>
                        <SortHeader col="status" label="Status" />
                        <th className="text-left text-xs font-semibold text-[#888888] uppercase tracking-wide px-4 py-2 border-b border-[#E0E0E0]"></th>
                      </>
                    )
                  })()}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                    <td className="px-4 py-1.5 w-8">
                      <div onClick={() => toggleSelect(p.id)} className={`w-5 h-5 rounded cursor-pointer flex items-center justify-center ${isSelected(p.id) ? "bg-[#F5C400]" : "bg-white border border-[#E0E0E0]"}`}>
                        {isSelected(p.id) && <span className="text-white text-sm font-bold leading-none">✓</span>}
                      </div>
                    </td>
                    <td className="px-2 py-1 w-12 cursor-pointer" onClick={() => router.push(`/pieces/${p.id}`)}>
                      <RowThumb src={p.imageUrl ? `${p.imageUrl}?t=${new Date(p.updatedAt ?? Date.now()).getTime()}` : null} alt={p.name} fallbackText={p.format} size={36} rounded={4} />
                    </td>
                    <td className="px-4 py-1.5 font-semibold text-sm" onClick={e => e.stopPropagation()}><EditableText value={p.name} variant="inline" onSave={async (newName) => {
                      const res = await fetch(`/api/pieces/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) })
                      if (!res.ok) throw new Error()
                      setPieces(prev => prev.map(x => x.id === p.id ? { ...x, name: newName } : x))
                    }} /></td>
                    <td className="px-4 py-1.5 text-sm text-[#888888]">{p.format}</td>
                    <td className="px-4 py-1.5 text-sm text-[#888888]">{p.width}×{p.height}</td>
                    <td className="px-4 py-1.5 text-sm text-[#888888]">{p.dpi}</td>
                    <td className="px-4 py-1.5"><StatusBadge pieceId={p.id} status={p.status ?? "STANDBY"} size="sm" onChange={(s) => setPieces(prev => prev.map(x => x.id === p.id ? { ...x, status: s } : x))} /></td>
                    <td className="px-4 py-1.5 text-right">
                      <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <Button variant="view" size="sm" onClick={() => router.push(`/pieces/${p.id}`)}>Ver</Button>
                        <Button variant="info" size="sm" onClick={() => duplicateOne(p.id)} title="Duplicar peça">Duplicar</Button>
                        <Button variant="danger" size="sm" onClick={(e) => deleteOne(p.id, e.altKey)} title="Option/Alt+click pra apagar sem confirmação">Apagar</Button>
                      </div>
                    </td>
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
      {dupDialog && (
        <DuplicateFormatDialog
          count={dupDialog.ids.length}
          originalFormat={dupDialog.originalFormat ?? null}
          onCancel={() => setDupDialog(null)}
          onConfirm={confirmDuplicate}
        />
      )}
    </PageShell>
  )
}

export default function PiecesPage() {
  return <Suspense><PiecesContent /></Suspense>
}
