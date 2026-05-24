"use client"
import { useState } from "react"

/**
 * Componente reusavel pra exportar 1 asset em "Original" ou "PSD".
 * Usado no painel Propriedades do editor (na sec\u00e3o do asset selecionado)
 * e potencialmente em outros lugares que precisem desse atalho.
 *
 * Recebe o asset inteiro (com campos opcionais smartObject, content, imageUrl).
 * Em loading: bot\u00f5es desabilitados. Em erro: alert simples.
 */
export function ExportAssetButtons({ asset }: { asset?: any }) {
  const [busy, setBusy] = useState<"original" | "psd" | null>(null)
  if (!asset) return null

  async function handle(format: "original" | "psd") {
    if (busy) return
    setBusy(format)
    try {
      const { exportAsset } = await import("@/lib/exportAsset")
      await exportAsset(asset, format)
    } catch (e: any) {
      alert("Export failed: " + (e?.message ?? e))
    } finally {
      setBusy(null)
    }
  }

  const btnStyle: React.CSSProperties = {
    flex: 1,
    background: "#222",
    border: "1px solid #2a2a2a",
    borderRadius: 4,
    padding: "7px 8px",
    fontSize: 11,
    fontWeight: 600,
    color: "#aaa",
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.6 : 1,
  }

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
        Export asset
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <button
          type="button"
          onClick={() => handle("original")}
          disabled={!!busy}
          title="Download original file (PNG/JPG/SVG or TXT)"
          style={btnStyle}
        >
          {busy === "original" ? "Downloading…" : "Original"}
        </button>
        <button
          type="button"
          onClick={() => handle("psd")}
          disabled={!!busy}
          title="Download PSD with 1 layer (editable text or image)"
          style={btnStyle}
        >
          {busy === "psd" ? "Generating…" : "PSD"}
        </button>
      </div>
    </div>
  )
}
