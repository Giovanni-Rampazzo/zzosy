"use client"
import { useState } from "react"
import { Button } from "@/components/ui/Button"
import { useModalEscape } from "@/lib/useModalEscape"

interface Props {
  defaultName: string
  totalAssets: number
  filteredAssets: number
  /** Se filtered < total, oferece opcao "exportar TODOS" vs "apenas visiveis" */
  onExport: (name: string, scope: "filtered" | "all") => Promise<void>
  onClose: () => void
}

/**
 * Modal pra export do cartridge (.zzosy). Substitui prompt() native.
 * U4 fix: oferece escolha entre filtered vs all (antes exportava silently
 * o filtered, perdendo TEXT/SO se filtro tipo=IMAGE ativo).
 */
export function ExportCartridgeModal({ defaultName, totalAssets, filteredAssets, onExport, onClose }: Props) {
  const [name, setName] = useState(defaultName)
  const [scope, setScope] = useState<"filtered" | "all">(filteredAssets === totalAssets ? "all" : "filtered")
  const [busy, setBusy] = useState(false)
  useModalEscape(!busy, onClose)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await onExport(name.trim(), scope)
    } finally {
      setBusy(false)
    }
  }

  const hasFilter = filteredAssets !== totalAssets

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div style={{ background: "white", borderRadius: 12, width: 480, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #E0E0E0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Exportar cartridge</div>
          <button onClick={onClose} disabled={busy} style={{ background: "transparent", border: 0, fontSize: 20, color: "#888", cursor: busy ? "wait" : "pointer" }}>✕</button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={labelStyle}>Nome do cartucho<span style={{ color: "#dc2626" }}> *</span></div>
            <input type="text" value={name} autoFocus
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submit() }}
              style={inpStyle}
            />
          </div>
          {hasFilter && (
            <div>
              <div style={labelStyle}>Escopo</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", padding: 10, border: `1px solid ${scope === "filtered" ? "#F5C400" : "#E0E0E0"}`, borderRadius: 6, cursor: "pointer", background: scope === "filtered" ? "rgba(245,196,0,0.06)" : "transparent" }}>
                  <input type="radio" checked={scope === "filtered"} onChange={() => setScope("filtered")} />
                  <div style={{ fontSize: 13 }}>Apenas visíveis pelo filtro <strong>({filteredAssets} de {totalAssets})</strong></div>
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center", padding: 10, border: `1px solid ${scope === "all" ? "#F5C400" : "#E0E0E0"}`, borderRadius: 6, cursor: "pointer", background: scope === "all" ? "rgba(245,196,0,0.06)" : "transparent" }}>
                  <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />
                  <div style={{ fontSize: 13 }}>Todos do library <strong>({totalAssets})</strong></div>
                </label>
              </div>
            </div>
          )}
          {!hasFilter && (
            <div style={{ fontSize: 12, color: "#666" }}>
              {totalAssets} asset(s) serão incluídos no cartucho.
            </div>
          )}
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid #E0E0E0", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!name.trim()}>
            {busy ? "Exportando..." : "Exportar"}
          </Button>
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#888", marginBottom: 6,
}
const inpStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 13, outline: "none", boxSizing: "border-box",
}
