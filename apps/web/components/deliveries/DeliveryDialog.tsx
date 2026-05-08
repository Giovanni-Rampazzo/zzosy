"use client"
import { useEffect, useState } from "react"
import { buildDeliveryZip, type ExportFormat } from "@/lib/exportPiece"
import { Button } from "@/components/ui/Button"
import { FilterPill } from "@/components/ui/FilterPill"

interface PieceLite {
  id: string
  name: string
  data: any
  width: number
  height: number
  status?: string
  media?: string
  imageUrl?: string | null
}

interface Props {
  campaignId: string
  campaignName?: string
  campaignCode?: string | null
  campaignSegment?: string | null
  onClose: () => void
  onCreated?: () => void
}

const FORMATS: { v: ExportFormat; label: string }[] = [
  { v: "PSD", label: "PSD" },
  { v: "PNG", label: "PNG" },
  { v: "JPG", label: "JPG" },
  { v: "PDF", label: "PDF" },
]

export function DeliveryDialog({ campaignId, campaignName, campaignCode, campaignSegment, onClose, onCreated }: Props) {
  const [allPieces, setAllPieces] = useState<PieceLite[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [formats, setFormats] = useState<Set<ExportFormat>>(new Set(["PSD"]))
  const [hideDelivered, setHideDelivered] = useState(false)
  const [includePresentation, setIncludePresentation] = useState(true)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState("")

  useEffect(() => {
    fetch(`/api/pieces?campaignId=${campaignId}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        setAllPieces(Array.isArray(d) ? d : [])
        setLoading(false)
      })
  }, [campaignId])

  const visible = hideDelivered
    ? allPieces.filter(p => p.status !== "ENTREGUE")
    : allPieces

  function toggle(id: string) {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id); else s.add(id)
    setSelected(s)
  }
  function toggleAll() {
    if (selected.size === visible.length) setSelected(new Set())
    else setSelected(new Set(visible.map(p => p.id)))
  }
  function toggleFormat(f: ExportFormat) {
    const s = new Set(formats)
    if (s.has(f)) s.delete(f); else s.add(f)
    setFormats(s)
  }

  async function handleExport() {
    if (selected.size === 0) { alert("Selecione pelo menos uma peça"); return }
    if (formats.size === 0) { alert("Selecione pelo menos um formato"); return }
    setWorking(true)
    try {
      const piecesToExport = allPieces
        .filter(p => selected.has(p.id))
        .map(p => ({ id: p.id, name: p.name, data: p.data, width: p.width, height: p.height, media: p.media }))

      // Se incluir apresentacao: gera o PPTX antes do ZIP pra empacotar em Deck/
      let extraFiles: Array<{ folder: string; name: string; blob: Blob }> | undefined
      if (includePresentation) {
        setProgress("Gerando apresentação...")
        const { buildCampaignPresentationBlob } = await import("@/lib/generatePresentation")
        const piecesForDeck = allPieces
          .filter(p => selected.has(p.id))
          .map(p => ({ id: p.id, name: p.name, imageUrl: p.imageUrl ?? null, width: p.width, height: p.height }))
        const { blob: pptxBlob, fileName: pptxName } = await buildCampaignPresentationBlob({
          name: campaignName ?? "Campanha",
          code: campaignCode ?? null,
          segment: campaignSegment ?? null,
          pieces: piecesForDeck,
        })
        extraFiles = [{ folder: "Deck", name: pptxName, blob: pptxBlob }]
      }

      // 1) Gerar ZIP no browser
      const zipBlob = await buildDeliveryZip(piecesToExport, Array.from(formats), campaignName, setProgress, extraFiles)

      // 2) Nome do ZIP usa codigo da campanha quando existir
      const codeForName = (campaignCode || "").trim()
      const safeCode = codeForName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "")
      const downloadName = safeCode
        ? `Entrega ${safeCode}.zip`
        : `Entrega-${new Date().toISOString().slice(0,10)}.zip`

      // 3) Download local pro user
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement("a"); a.href = url; a.download = downloadName
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)

      // 4) Salvar copia no servidor + criar Delivery + marcar pecas como ENTREGUE
      setProgress("Salvando entrega no servidor...")
      const fd = new FormData()
      fd.append("zip", zipBlob, downloadName)
      fd.append("campaignId", campaignId)
      fd.append("pieceIds", JSON.stringify(Array.from(selected)))
      fd.append("formats", JSON.stringify(Array.from(formats)))
      fd.append("name", downloadName)
      const res = await fetch("/api/deliveries", { method: "POST", body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert("Entrega salva localmente, mas falhou ao registrar no servidor: " + (err.detail ?? err.error ?? "?"))
      }

      onCreated?.()
      onClose()
    } catch (e: any) {
      alert("Falha na exportação: " + (e?.message ?? e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onMouseDown={(e) => { if (!working && e.target === e.currentTarget) onClose() }}>
      <div
        style={{ background: "#fff", borderRadius: 8, maxWidth: 720, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 20, borderBottom: "1px solid #eee" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Nova entrega</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>Selecione as peças e formatos para gerar o ZIP de entrega.</p>
        </div>

        <div style={{ padding: 20, flex: 1, overflowY: "auto" }}>
          {/* 1. Apresentação */}
          <div style={{ marginBottom: 16, padding: 12, background: "#fafafa", borderRadius: 6, border: "1px solid #eee" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              <input type="checkbox" checked={includePresentation} onChange={e => setIncludePresentation(e.target.checked)} />
              Incluir apresentação
            </label>
            <div style={{ fontSize: 11, color: "#888", marginTop: 4, marginLeft: 24 }}>
              Adiciona o .pptx da campanha numa pasta <strong>Deck/</strong> dentro do ZIP.
            </div>
          </div>

          {/* 2. Formatos */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Formatos a exportar</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {FORMATS.map(f => (
                <FilterPill key={f.v} active={formats.has(f.v)} onClick={() => toggleFormat(f.v)}>
                  {f.label}
                </FilterPill>
              ))}
            </div>
          </div>

          {/* 3. Toggle: ocultar entregues */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, color: "#555" }}>
            <input type="checkbox" checked={hideDelivered} onChange={e => setHideDelivered(e.target.checked)} />
            Ocultar peças já entregues
          </label>

          {/* 4. Lista de peças */}
          {loading ? <div style={{ color: "#888" }}>Carregando peças...</div> : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                <strong>{visible.length} peça(s)</strong>
                <button onClick={toggleAll} style={{ border: "none", background: "transparent", color: "#2563eb", cursor: "pointer", fontSize: 12 }}>
                  {selected.size === visible.length && visible.length > 0 ? "Desmarcar tudo" : "Selecionar tudo"}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 8 }}>
                {visible.map(p => {
                  const isSel = selected.has(p.id)
                  const isDelivered = p.status === "ENTREGUE"
                  return (
                    <div key={p.id} onClick={() => toggle(p.id)}
                      style={{
                        border: isSel ? "2px solid #F5C400" : "1px solid #eee",
                        borderRadius: 6, padding: 8, cursor: "pointer",
                        background: isSel ? "#fffbeb" : "#fff",
                        opacity: isDelivered ? 0.6 : 1,
                      }}>
                      <div style={{ aspectRatio: `${p.width || 1}/${p.height || 1}`, background: "#f5f5f5", marginBottom: 6, overflow: "hidden", borderRadius: 4 }}>
                        {p.imageUrl && <img src={p.imageUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: "#888" }}>{p.width}×{p.height}</div>
                      {isDelivered && <div style={{ fontSize: 10, color: "#4338ca", marginTop: 2 }}>✓ Entregue</div>}
                    </div>
                  )
                })}
                {visible.length === 0 && <div style={{ color: "#888", fontSize: 13, gridColumn: "1/-1" }}>Nenhuma peça disponível.</div>}
              </div>
            </>
          )}

          {progress && <div style={{ fontSize: 12, color: "#888", marginTop: 8 }}>{progress}</div>}
        </div>

        <div style={{ padding: 20, borderTop: "1px solid #eee", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="secondary" onClick={onClose} disabled={working}>Cancelar</Button>
          <Button onClick={handleExport} loading={working} disabled={selected.size === 0}>{working ? "Exportando..." : `Exportar (${selected.size})`}</Button>
        </div>
      </div>
    </div>
  )
}
