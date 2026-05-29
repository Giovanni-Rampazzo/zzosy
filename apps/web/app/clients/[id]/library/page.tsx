"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { Button } from "@/components/ui/Button"
import { FilterPill } from "@/components/ui/FilterPill"
import { ClientLogoBadge } from "@/components/clients/ClientLogoBadge"
import { useSetActiveClient } from "@/lib/activeClientContext"
import { ExportCartridgeModal } from "@/components/library/ExportCartridgeModal"
import { broadcastLibrary, subscribeLibrary } from "@/lib/libraryBroadcast"

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
  // smartObject vem do include na rota GET /assets — usado pra detectar
  // se SO eh vetorial (AI/PDF) e expor botao "Editar" no card.
  smartObject?: { mime: string } | null
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

  // U6: cross-tab realtime — outra tab editou library → refetch.
  useEffect(() => {
    const unsub = subscribeLibrary(id, () => { load() })
    return unsub
  }, [id])

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
      broadcastLibrary({ kind: "asset-deleted", clientId: id, assetId })
    } else {
      alert("Falha ao apagar")
    }
    setConfirmDelete(null)
  }

  async function duplicateAsset(assetId: string) {
    const res = await fetch(`/api/clients/${id}/library/assets/${assetId}/duplicate`, { method: "POST" })
    if (res.ok) {
      const clone = await res.json()
      setAssets(prev => [clone, ...prev])
    } else alert("Falha ao duplicar asset")
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
        broadcastLibrary({ kind: "cartridge-imported", clientId: id, meta: { count: data.created } })
      } else {
        const err = await res.json().catch(() => ({}))
        alert("Falha ao importar: " + (err.error ?? res.status))
      }
    } finally {
      setImportBusy(false)
    }
  }

  /**
   * Smart import: detecta tipo do arquivo e dispatch pro fluxo certo.
   *  - .zzosy/.zip → cartucho (importCartridge)
   *  - .psd → import-psd-as-so (SMART_OBJECT preservando bytes originais)
   *  - .ai/.pdf → import-ai (SMART_OBJECT, raster composite via pdf.js)
   *  - image/* → upload pro storage + cria ClientLibraryAsset type=IMAGE
   *  - text/plain ou .txt/.md → le como texto + cria type=TEXT
   * Outros tipos: erro amigavel.
   *
   * Adicionado 2026-05-29 (user pedido pra importar text/image direto sem
   * precisar passar por uma campanha). Estendido pra PSD/AI no mesmo dia.
   */
  async function importSmart(file: File) {
    const name = file.name
    const lower = name.toLowerCase()
    const isCartridge = lower.endsWith(".zzosy") || lower.endsWith(".zip")
    const isPsd = lower.endsWith(".psd")
    const isAi = lower.endsWith(".ai") || lower.endsWith(".pdf")
    const isImage = file.type.startsWith("image/")
    const isText = file.type.startsWith("text/") || lower.endsWith(".txt") || lower.endsWith(".md")
    if (isCartridge) {
      await importCartridge(file)
      return
    }
    setImportBusy(true)
    try {
      if (isPsd || isAi) {
        // PSD ou AI/PDF → SMART_OBJECT (preserva bytes originais + composite PNG).
        const endpoint = isPsd ? "import-psd-as-so" : "import-ai"
        const fieldName = isPsd ? "psd" : "ai"
        const fd = new FormData()
        fd.append(fieldName, file)
        const res = await fetch(`/api/clients/${id}/library/${endpoint}`, { method: "POST", body: fd })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          alert(`Falha ao importar ${isPsd ? "PSD" : isAi && lower.endsWith(".ai") ? "AI" : "PDF"}: ` + (err.error ?? res.status))
          return
        }
        const { asset } = await res.json()
        setAssets(prev => [asset, ...prev])
        broadcastLibrary({ kind: "asset-created" as any, clientId: id, assetId: asset.id })
        return
      }
      if (isImage) {
        // Upload pro storage primeiro (rota generica /api/upload).
        const fd = new FormData()
        fd.append("file", file)
        const upRes = await fetch("/api/upload", { method: "POST", body: fd })
        if (!upRes.ok) {
          const err = await upRes.json().catch(() => ({}))
          alert("Falha no upload: " + (err.error ?? upRes.status))
          return
        }
        const { url } = await upRes.json()
        // Cria asset apontando pra URL.
        const assetName = name.replace(/\.[^.]+$/, "")
        const createRes = await fetch(`/api/clients/${id}/library/assets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: assetName, type: "IMAGE", imageUrl: url }),
        })
        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({}))
          alert("Falha ao criar asset: " + (err.error ?? createRes.status))
          return
        }
        const created = await createRes.json()
        setAssets(prev => [created, ...prev])
        broadcastLibrary({ kind: "asset-created" as any, clientId: id, assetId: created.id })
        return
      }
      if (isText) {
        const text = await file.text()
        const assetName = name.replace(/\.[^.]+$/, "")
        // Content shape: array de spans (compatible com playground/overrides).
        const content = [{ text, style: {} }]
        const createRes = await fetch(`/api/clients/${id}/library/assets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: assetName, type: "TEXT", content }),
        })
        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({}))
          alert("Falha ao criar asset: " + (err.error ?? createRes.status))
          return
        }
        const created = await createRes.json()
        setAssets(prev => [created, ...prev])
        broadcastLibrary({ kind: "asset-created" as any, clientId: id, assetId: created.id })
        return
      }
      alert(`Tipo nao suportado: ${file.type || lower}. Use imagem, texto ou cartucho .zzosy.`)
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
        {/* Linha de navegacao (CLAUDE 1.2.1): SO Voltar + logo + titulo.
            Actions Export/Import cartridge migram pro toolbar interno do
            card de Assets — mesma regra das outras paginas. */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
          <Button variant="view" size="md" onClick={() => router.push(`/clients/${id}`)}>← Voltar</Button>
          {/* Logo aumentado (48→64) e label "SICREDI · Library" removida — logo
              ja identifica a marca, /library a pagina (CLAUDE 1.2, 2.6). */}
          {client && <ClientLogoBadge client={{ id, name: client.name, brandLogoUrl: client.brandLogoUrl }} size={64} radius={10} />}
        </div>

        {/* Card box com header de filtros + grid */}
        <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #E0E0E0", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>
              Assets ({filtered.length})
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Filtros via FilterPill (canonical ZZOSY). Antes era <button>
                  inline com case mixto ("Todos" vs "TEXT/IMAGE/SHAPE/SO") —
                  padronizado em UPPERCASE pra consistencia visual. */}
              {(["ALL", "TEXT", "IMAGE", "SHAPE", "SMART_OBJECT"] as const).map(t => (
                <FilterPill
                  key={t}
                  active={filterType === t}
                  onClick={() => setFilterType(t)}
                  size="sm"
                >
                  {t === "ALL" ? "TODOS" : t === "SMART_OBJECT" ? "SO" : t}
                </FilterPill>
              ))}
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar nome / tag / slot..."
                style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #E0E0E0", borderRadius: 6, outline: "none", width: 200 }}
              />
              {/* Toolbar de actions (CLAUDE 1.2.1 — nav e action nao dividem linha).
                  Padronizado via <Button size="sm"> em todas: Import (smart
                  dispatch por MIME), Export cartridge, Import cartridge. */}
              <div style={{ width: 1, height: 24, background: "#E0E0E0", margin: "0 4px" }} />
              <Button
                variant="primary"
                size="sm"
                onFileSelect={(f) => importSmart(f)}
                accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,.txt,.md,.zzosy,.zip,.psd,.ai,.pdf"
                loading={importBusy}
              >
                + Importar
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setExportOpen(true)} disabled={assets.length === 0}>
                Export cartridge
              </Button>
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(var(--zz-card-grid-min), 1fr))", gap: "var(--zz-card-grid-gap)" }}>
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
                    {/* Preview com fundo escuro + checker sutil pra que assets
                        brancos (logo branco, texto branco) fiquem visiveis.
                        Padrao Photoshop pra transparencia. */}
                    <div style={{
                      height: 140, borderRadius: "10px 10px 0 0",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      overflow: "hidden", padding: 8,
                      background: "#3a3a3a",
                      backgroundImage: "linear-gradient(45deg, #2e2e2e 25%, transparent 25%), linear-gradient(-45deg, #2e2e2e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2e2e2e 75%), linear-gradient(-45deg, transparent 75%, #2e2e2e 75%)",
                      backgroundSize: "12px 12px",
                      backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0px",
                    }}>
                      {a.thumbnailUrl ?? a.imageUrl ? (
                        <img src={a.thumbnailUrl ?? a.imageUrl ?? ""} alt={a.name} loading="lazy" decoding="async" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                      ) : a.type === "TEXT" ? (
                        <div style={{ fontSize: 14, color: "#eee", padding: 12, fontStyle: "italic", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }}>
                          {previewText(a.content)}
                        </div>
                      ) : (
                        <div style={{ color: "#999", fontSize: 11 }}>(sem preview)</div>
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
                      <div style={{ display: "flex", gap: "var(--zz-btn-compact-gap)", marginTop: 4, justifyContent: "center", flexWrap: "wrap" }}>
                        {/* Library tem APENAS 3 botoes: Editar foi removido porque
                            ia pro MESMO destino que Entrar (/clients/[id]/library/
                            [assetId]). CLAUDE 2.4: nao duplicar navegacao pra
                            mesmo destino. Demais paginas com Editar destino
                            diferente (campaigns, pieces) mantem os 4. */}
                        {confirmDelete === a.id ? (
                          <>
                            <Button variant="danger" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={() => deleteAsset(a.id)}>Sim</Button>
                            <Button variant="secondary" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={() => setConfirmDelete(null)}>Não</Button>
                          </>
                        ) : (
                          <>
                            <Button variant="danger" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={() => setConfirmDelete(a.id)}>Apagar</Button>
                            <Button variant="info" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={() => duplicateAsset(a.id)}>Duplicar</Button>
                            {/* "Editar vetor" so aparece em SMART_OBJECT importado de .ai/.pdf — abre sub-editor
                                Fabric com paths editaveis (CLAUDE 2.4: destinos diferentes mantem o botao). */}
                            {a.type === "SMART_OBJECT" && (a.smartObject?.mime === "application/postscript" || a.smartObject?.mime === "application/pdf") && (
                              <Button variant="secondary" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={() => router.push(`/clients/${id}/library/${a.id}/edit-vector`)} title="Editar paths e cores do vetor">Editar</Button>
                            )}
                            <Button variant="view" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={() => router.push(`/clients/${id}/library/${a.id}`)}>Entrar</Button>
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
