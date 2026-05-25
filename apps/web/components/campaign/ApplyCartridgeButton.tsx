"use client"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/Button"

/**
 * Botão "Aplicar cartucho" + modal. Aceita upload de .zzosy OU aplica
 * todos os assets do library do cliente. Reusado em /campaigns/[id] header
 * e /campaigns/[id]/assets header.
 *
 * Match por slotKey (Figma-style). Sem slot match → cria novos assets.
 */
export function ApplyCartridgeButton({ campaignId, clientId, onApplied, size = "md" }: {
  campaignId: string
  clientId?: string | null
  onApplied: () => void
  size?: "sm" | "md" | "lg"
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [libraryAssets, setLibraryAssets] = useState<any[]>([])

  useEffect(() => {
    if (!open || !clientId) return
    fetch(`/api/clients/${clientId}/library/assets`)
      .then(r => r.ok ? r.json() : [])
      .then(setLibraryAssets)
  }, [open, clientId])

  async function applyUpload(file: File) {
    setBusy(true)
    const fd = new FormData()
    fd.append("cartridge", file)
    const res = await fetch(`/api/campaigns/${campaignId}/apply-cartridge`, {
      method: "POST",
      body: fd,
    })
    setBusy(false)
    if (res.ok) {
      const r = await res.json()
      alert(`Cartucho aplicado: ${r.updated.length} atualizado(s), ${r.created.length} criado(s), ${r.skipped.length} pulado(s)`)
      setOpen(false)
      onApplied()
    } else {
      alert("Falha ao aplicar cartucho")
    }
  }

  async function applyFromLibrary(assetIds: string[]) {
    setBusy(true)
    const res = await fetch(`/api/campaigns/${campaignId}/apply-cartridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ libraryAssetIds: assetIds }),
    })
    setBusy(false)
    if (res.ok) {
      const r = await res.json()
      alert(`Aplicado: ${r.updated.length} atualizado(s), ${r.created.length} criado(s)`)
      setOpen(false)
      onApplied()
    } else {
      alert("Falha ao aplicar")
    }
  }

  return (
    <>
      <Button variant="secondary" size={size} onClick={() => setOpen(true)}>Aplicar cartucho</Button>
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "white", borderRadius: 12, width: 560, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid #E0E0E0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Aplicar cartucho</div>
              <button onClick={() => setOpen(false)} style={{ background: "transparent", border: 0, fontSize: 20, color: "#888", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ padding: 24, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#888", letterSpacing: 0.5, marginBottom: 8 }}>Upload .zzosy</div>
                <label style={{ cursor: busy ? "wait" : "pointer", display: "inline-block" }}>
                  <input type="file" accept=".zzosy,.zip" disabled={busy}
                    onChange={e => { const f = e.target.files?.[0]; if (f) applyUpload(f); e.target.value = "" }}
                    style={{ display: "none" }} />
                  <span style={{ display: "inline-block", padding: "8px 16px", border: "2px solid #555", background: "white", color: "#111", fontWeight: 700, fontSize: 13, borderRadius: 6 }}>
                    {busy ? "Aplicando..." : "Escolher arquivo .zzosy"}
                  </span>
                </label>
              </div>
              {libraryAssets.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#888", letterSpacing: 0.5, marginBottom: 8 }}>OU usar TODO o library do cliente</div>
                  <Button variant="secondary" size="md" disabled={busy}
                    onClick={() => applyFromLibrary(libraryAssets.map(a => a.id))}>
                    Aplicar {libraryAssets.length} asset(s) do library
                  </Button>
                </div>
              )}
              <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5 }}>
                Match por <code>slotKey</code> (Figma-style). Assets do cartucho com slotKey igual a algum da campanha → atualizam content. Sem slot match → criam novos.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
