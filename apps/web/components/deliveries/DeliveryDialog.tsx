"use client"
import { useEffect, useState } from "react"
import { buildDeliveryZip, type ExportFormat } from "@/lib/exportPiece"

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
  onClose: () => void
  onCreated?: () => void
}

const FORMATS: { v: ExportFormat; label: string }[] = [
  { v: "PNG", label: "PNG" },
  { v: "JPG", label: "JPG" },
  { v: "PSD", label: "PSD" },
  { v: "PDF", label: "PDF" },
]

export function DeliveryDialog({ campaignId, campaignName, onClose, onCreated }: Props) {
  const [allPieces, setAllPieces] = useState<PieceLite[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [formats, setFormats] = useState<Set<ExportFormat>>(new Set(["PNG"]))
  const [hideDelivered, setHideDelivered] = useState(true)
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

      // 1) Gerar ZIP no browser
      const zipBlob = await buildDeliveryZip(piecesToExport, Array.from(formats), campaignName, setProgress)

      // 2) Download local pro user
      const downloadName = `Entrega-${new Date().toISOString().slice(0,10)}.zip`
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement("a"); a.href = url; a.download = downloadName
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)

      // 3) Salvar copia no servidor + criar Delivery + marcar pecas como ENTREGUE
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
          {/* Toggle: ocultar entregues */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13, color: "#555" }}>
            <input type="checkbox" checked={hideDelivered} onChange={e => setHideDelivered(e.target.checked)} />
            Ocultar peças já entregues
          </label>

          {/* Lista de peças */}
          {loading ? <div style={{ color: "#888" }}>Carregando peças...</div> : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                <strong>{visible.length} peça(s)</strong>
                <button onClick={toggleAll} style={{ border: "none", background: "transparent", color: "#2563eb", cursor: "pointer", fontSize: 12 }}>
                  {selected.size === visible.length && visible.length > 0 ? "Desmarcar tudo" : "Selecionar tudo"}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 24 }}>
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

          {/* Formatos */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Formatos a exportar</div>
            <div style={{ display: "flex", gap: 8 }}>
              {FORMATS.map(f => {
                const isSel = formats.has(f.v)
                return (
                  <button key={f.v} onClick={() => toggleFormat(f.v)}
                    style={{
                      padding: "6px 14px", border: isSel ? "2px solid #F5C400" : "1px solid #ddd",
                      borderRadius: 6, background: isSel ? "#fffbeb" : "#fff",
                      cursor: "pointer", fontSize: 12, fontWeight: 600,
                    }}>
                    {f.label}
                  </button>
                )
              })}
            </div>
          </div>

          {progress && <div style={{ fontSize: 12, color: "#888", marginTop: 8 }}>{progress}</div>}
        </div>

        <div style={{ padding: 20, borderTop: "1px solid #eee", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={working}
            style={{ padding: "8px 16px", border: "1px solid #ddd", borderRadius: 6, background: "#fff", cursor: working ? "default" : "pointer", fontSize: 13 }}>
            Cancelar
          </button>
          <button onClick={handleExport} disabled={working || selected.size === 0}
            style={{ padding: "8px 20px", border: "none", borderRadius: 6, background: "#F5C400", color: "#111", cursor: (working || selected.size === 0) ? "default" : "pointer", fontSize: 13, fontWeight: 700, opacity: (working || selected.size === 0) ? 0.5 : 1 }}>
            {working ? "Exportando..." : `Exportar (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}
