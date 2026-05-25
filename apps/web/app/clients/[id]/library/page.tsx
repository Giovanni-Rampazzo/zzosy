"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { Button } from "@/components/ui/Button"
import { ClientLogoBadge } from "@/components/clients/ClientLogoBadge"
import { useSetActiveClient } from "@/lib/activeClientContext"
import { ExportCartridgeModal } from "@/components/library/ExportCartridgeModal"

interface LibraryAsset {
  id: string
  name: string
  slotKey: string | null
  type: string
  content: any
  imageUrl: string | null
  thumbnailUrl: string | null
  tags: string[]
  notes: string | null
  version: number
  instanceCount: number
  updatedAt: string
}

interface ClientLite {
  id: string
  name: string
  brandLogoUrl: string | null
}

const TYPE_COLORS: Record<string, string> = {
  TEXT: "#3b82f6",
  IMAGE: "#10b981",
  SHAPE: "#a855f7",
  SMART_OBJECT: "#f59e0b",
}

export default function ClientLibraryPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [client, setClient] = useState<ClientLite | null>(null)
  useSetActiveClient(client ? { id, name: client.name, brandLogoUrl: client.brandLogoUrl } : null)
  const [assets, setAssets] = useState<LibraryAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<string>("ALL")
  const [search, setSearch] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  async function load() {
    setLoading(true)
    const [cRes, aRes] = await Promise.all([
      fetch(`/api/clients/${id}`),
      fetch(`/api/clients/${id}/library/assets`),
    ])
    if (cRes.ok) {
      const c = await cRes.json()
      setClient({ id: c.id, name: c.name, brandLogoUrl: c.brandLogoUrl })
    }
    if (aRes.ok) setAssets(await aRes.json())
    setLoading(false)
  }
  useEffect(() => { load() }, [id])

  const filtered = assets.filter(a => {
    if (filterType !== "ALL" && a.type !== filterType) return false
    if (search) {
      const q = search.toLowerCase()
      const hit = a.name.toLowerCase().includes(q) ||
                  (a.slotKey?.toLowerCase().includes(q) ?? false) ||
                  a.tags.some(t => t.toLowerCase().includes(q))
      if (!hit) return false
    }
    return true
  })

  async function deleteAsset(assetId: string) {
    const res = await fetch(`/api/clients/${id}/library/assets/${assetId}`, { method: "DELETE" })
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      if (data.detachedInstances > 0) {
        alert(`Asset apagado. ${data.detachedInstances} instância(s) em campanhas viraram independentes.`)
      }
      setAssets(prev => prev.filter(a => a.id !== assetId))
    } else {
      alert("Falha ao apagar")
    }
    setConfirmDelete(null)
  }

  async function importCartridge(file: File) {
    setImportBusy(true)
    try {
      const fd = new FormData()
      fd.append("cartridge", file)
      const res = await fetch(`/api/clients/${id}/library/cartridge`, { method: "PUT", body: fd })
      if (res.ok) {
        const data = await res.json()
        alert(`Cartucho importado: ${data.created} asset(s) adicionado(s) ao library.`)
        await load()
      } else {
        const err = await res.json().catch(() => ({}))
        alert("Falha ao importar: " + (err.error ?? res.status))
      }
    } finally {
      setImportBusy(false)
    }
  }

  async function doExportCartridge(name: string, scope: "filtered" | "all") {
    const ids = scope === "all" ? assets.map(a => a.id) : filtered.map(a => a.id)
    if (ids.length === 0) { alert("Nenhum asset pra exportar"); return }
    const res = await fetch(`/api/clients/${id}/library/cartridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, assetIds: ids }),
    })
    if (!res.ok) { alert("Falha ao gerar cartucho"); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${name}.zzosy`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setExportOpen(false)
  }

  if (loading) return <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}><TopNav /><div style={{ padding: 32, color: "#888" }}>Carregando...</div></div>

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopNav />
      <div style={{ flex: 1, overflowY: "auto", padding: 32, background: "var(--zz-bg-page, #F5F5F0)" }}>
        {/* Header igual padrao de outras paginas do cliente */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flex: 1, minWidth: 0 }}>
            <Button variant="view" size="md" onClick={() => router.push(`/clients/${id}`)}>← Voltar</Button>
            {client && <ClientLogoBadge client={{ id, name: client.name, brandLogoUrl: client.brandLogoUrl }} size={48} radius={8} />}
            <div style={{ fontSize: 22, fontWeight: 700, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
              {client?.name} · Library
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" size="md" onClick={() => setExportOpen(true)} disabled={assets.length === 0}>
              Export cartridge
            </Button>
            <label style={{ cursor: importBusy ? "wait" : "pointer" }}>
              <input
                type="file"
                accept=".zzosy,.zip"
                style={{ display: "none" }}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) importCartridge(f)
                  e.target.value = ""
                }}
                disabled={importBusy}
              />
              <span style={{
                display: "inline-block", padding: "8px 16px", border: "2px solid #555",
                background: "white", color: "#111", fontWeight: 700, fontSize: 13,
                borderRadius: 6, cursor: importBusy ? "wait" : "pointer", opacity: importBusy ? 0.5 : 1,
              }}>
                {importBusy ? "Importando..." : "Import cartridge"}
              </span>
            </label>
          </div>
        </div>

        {/* Card box com header de filtros + grid */}
        <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #E0E0E0", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>
              Assets ({filtered.length})
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {["ALL", "TEXT", "IMAGE", "SHAPE", "SMART_OBJECT"].map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  style={{
                    padding: "5px 10px", fontSize: 11, fontWeight: 600,
                    background: filterType === t ? "#F5C400" : "white",
                    color: filterType === t ? "#111" : "#555",
                    border: "2px solid #555", borderRadius: 6, cursor: "pointer",
                  }}
                >
                  {t === "ALL" ? "Todos" : t === "SMART_OBJECT" ? "SO" : t}
                </button>
              ))}
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar nome / tag / slot..."
                style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #E0E0E0", borderRadius: 6, outline: "none", width: 200 }}
              />
            </div>
          </div>

          <div style={{ padding: 16 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#888", fontSize: 13 }}>
                {assets.length === 0
                  ? "Nenhum asset no library ainda. Vá em uma campanha e clique \"Salvar no Library\" nos assets que quer preservar."
                  : "Nenhum asset com este filtro."}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
                {filtered.map(a => (
                  <div key={a.id} style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", display: "flex", flexDirection: "column", position: "relative" }}>
                    <div style={{ position: "absolute", top: 8, left: 8, zIndex: 2, background: TYPE_COLORS[a.type] ?? "#888", color: "white", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: 0.3 }}>
                      {a.type === "SMART_OBJECT" ? "SO" : a.type}
                    </div>
                    {a.instanceCount > 0 && (
                      <div style={{ position: "absolute", top: 8, right: 8, zIndex: 2, background: "rgba(0,0,0,0.7)", color: "white", fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4 }}>
                        {a.instanceCount} em uso
                      </div>
                    )}
                    <div style={{ height: 140, background: "#F5F5F0", borderRadius: "10px 10px 0 0", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 8 }}>
                      {a.thumbnailUrl ?? a.imageUrl ? (
                        <img src={a.thumbnailUrl ?? a.imageUrl ?? ""} alt={a.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                      ) : a.type === "TEXT" ? (
                        <div style={{ fontSize: 14, color: "#444", padding: 12, fontStyle: "italic", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }}>
                          {previewText(a.content)}
                        </div>
                      ) : (
                        <div style={{ color: "#aaa", fontSize: 11 }}>(sem preview)</div>
                      )}
                    </div>
                    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#222", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                      {a.slotKey && <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace" }}>slot: {a.slotKey}</div>}
                      {a.tags.length > 0 && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {a.tags.slice(0, 3).map(t => (
                            <span key={t} style={{ fontSize: 9, color: "#666", background: "#f0f0f0", padding: "2px 5px", borderRadius: 3 }}>{t}</span>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 6, marginTop: 4, justifyContent: "center" }}>
                        {confirmDelete === a.id ? (
                          <>
                            <Button variant="danger" size="sm" onClick={() => deleteAsset(a.id)}>Sim</Button>
                            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>Não</Button>
                          </>
                        ) : (
                          <>
                            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(a.id)}>Apagar</Button>
                            <Button variant="secondary" size="sm" onClick={() => router.push(`/clients/${id}/library/${a.id}`)}>Editar</Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {exportOpen && (
        <ExportCartridgeModal
          defaultName={`${client?.name ?? "library"}-cartridge`}
          totalAssets={assets.length}
          filteredAssets={filtered.length}
          onExport={doExportCartridge}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  )
}

function previewText(content: any): string {
  if (!Array.isArray(content)) return ""
  return content.map((s: any) => s?.text ?? "").join("")
}
