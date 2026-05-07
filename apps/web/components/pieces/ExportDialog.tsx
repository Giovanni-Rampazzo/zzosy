"use client"
import { useState } from "react"
import { exportPieces, ExportFormat } from "@/lib/exportPiece"
import { Button } from "@/components/ui/Button"

interface PieceLite {
  id: string
  name: string
  data: any
  width: number
  height: number
}

interface Props {
  pieces: PieceLite[]
  onClose: () => void
  campaignName?: string
}

const FORMATS: { value: ExportFormat; label: string; desc: string }[] = [
  { value: "PSD", label: "PSD", desc: "Photoshop editavel (textos como layers de texto)" },
  { value: "PNG", label: "PNG", desc: "Imagem PNG sem perdas, fundo transparente quando aplicavel" },
  { value: "JPG", label: "JPG", desc: "Imagem JPEG comprimida, ideal para web" },
  { value: "PDF", label: "PDF", desc: "PDF com pagina unica do tamanho exato da peca" },
]

export function ExportDialog({ pieces, onClose, campaignName }: Props) {
  const [selectedFormats, setSelectedFormats] = useState<ExportFormat[]>(["PNG"])
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState("")

  function toggleFormat(f: ExportFormat) {
    setSelectedFormats(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }

  async function doExport() {
    if (!selectedFormats.length) return
    setExporting(true)
    try {
      await exportPieces(pieces, selectedFormats, setProgress, campaignName)
    } catch (e) {
      console.error("Falha geral na exportacao", e)
    }
    setExporting(false)
    setProgress("")
    onClose()
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#1a1a1a", borderRadius: 12, width: 520, maxHeight: "85vh", display: "flex", flexDirection: "column", border: "1px solid #333" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", borderBottom: "1px solid #333" }}>
          <span style={{ fontWeight: 700, color: "white", fontSize: 16 }}>Exportar {pieces.length} peça{pieces.length > 1 ? "s" : ""}</span>
          <button onClick={onClose} disabled={exporting} style={{ background: "transparent", border: "none", color: "#888", fontSize: 20, cursor: exporting ? "not-allowed" : "pointer" }}>✕</button>
        </div>

        <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>
          <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700, marginBottom: 12 }}>Formatos</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {FORMATS.map(f => {
              const checked = selectedFormats.includes(f.value)
              return (
                <label key={f.value}
                  style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 12, border: `1px solid ${checked ? "#F5C400" : "#2a2a2a"}`, borderRadius: 8, cursor: "pointer", background: checked ? "rgba(245,196,0,0.06)" : "transparent" }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleFormat(f.value)} disabled={exporting} style={{ marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "white", fontWeight: 600, fontSize: 14 }}>{f.label}</div>
                    <div style={{ color: "#888", fontSize: 12, marginTop: 2 }}>{f.desc}</div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        <div style={{ padding: "14px 24px", borderTop: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#888", fontSize: 12 }}>{exporting ? progress : `${selectedFormats.length} formato(s)`}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={onClose} disabled={exporting}>Cancelar</Button>
            <Button onClick={doExport} loading={exporting} disabled={!selectedFormats.length}>{exporting ? "Exportando..." : "Exportar"}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
