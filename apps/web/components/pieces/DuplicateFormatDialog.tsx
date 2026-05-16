"use client"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/Button"

interface MF { id: string; vehicle: string; media: string; format: string; width: number; height: number; category?: string }

interface Props {
  count: number
  originalFormat: string | null
  onCancel: () => void
  onConfirm: (mediaFormatId: string | null) => void
}

/**
 * Dialog pra escolher o formato (MediaFormat) ao duplicar peça(s).
 * Default: "manter o mesmo formato do original" — Confirm sem trocar = clone exato.
 * Trocar formato: atualiza width/height/dpi na nova peça; layers ficam onde estavam
 * (usuário reposiciona depois no editor).
 *
 * Componente compartilhado entre /campaigns/[id]/page.tsx e /pieces/page.tsx.
 */
export function DuplicateFormatDialog({ count, originalFormat, onCancel, onConfirm }: Props) {
  const [formats, setFormats] = useState<MF[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/medias").then(r => r.json()).then(d => { setFormats(Array.isArray(d) ? d : []); setLoading(false) })
  }, [])

  const groups = formats.reduce<Record<string, MF[]>>((acc, f) => {
    const cat = f.category || "Sem categoria"
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(f)
    return acc
  }, {})
  const sortedCats = Object.keys(groups).sort((a, b) => a.localeCompare(b, "pt-BR"))

  return (
    <div onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "white", borderRadius: 10, padding: 24, width: "min(640px, 92vw)", maxHeight: "85vh", overflow: "auto" }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Duplicar {count > 1 ? `${count} peças` : "peça"}</h3>
        <p style={{ marginTop: 6, marginBottom: 18, fontSize: 13, color: "#666" }}>
          Escolha o formato da nova {count > 1 ? "cópias" : "cópia"}. {originalFormat ? <>Formato atual: <strong>{originalFormat}</strong></> : null}
        </p>

        {loading ? (
          <div style={{ padding: 20, color: "#888" }}>Carregando formatos…</div>
        ) : (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: `2px solid ${selectedId === null ? "#F5C400" : "#E0E0E0"}`, borderRadius: 6, cursor: "pointer", marginBottom: 14, background: selectedId === null ? "rgba(245,196,0,0.06)" : "white" }}>
              <input type="radio" checked={selectedId === null} onChange={() => setSelectedId(null)} style={{ margin: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Manter formato original</div>
                <div style={{ fontSize: 11, color: "#888" }}>Cópia exata (mesmo formato/dimensões)</div>
              </div>
            </label>

            {sortedCats.map(cat => (
              <div key={cat} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>{cat}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {groups[cat].map(f => (
                    <label key={f.id}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: `2px solid ${selectedId === f.id ? "#F5C400" : "#E0E0E0"}`, borderRadius: 5, cursor: "pointer", background: selectedId === f.id ? "rgba(245,196,0,0.06)" : "white", fontSize: 12 }}>
                      <input type="radio" checked={selectedId === f.id} onChange={() => setSelectedId(f.id)} style={{ margin: 0, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.vehicle} · {f.media}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>{f.format} — {f.width}×{f.height}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
          <Button variant="primary" onClick={() => onConfirm(selectedId)} disabled={loading}>
            Duplicar
          </Button>
        </div>
      </div>
    </div>
  )
}
