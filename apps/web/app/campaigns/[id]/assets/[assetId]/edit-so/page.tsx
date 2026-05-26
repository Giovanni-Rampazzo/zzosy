// SO Editor — pagina dedicada pra editar texto de um Smart Object PSD.
// MVP v1: edita TEXTO de cada text layer (input por layer). Composite re-render
// + propagacao pras pecas/KV acontece via PUT (auto-broadcast pq asset.imageUrl
// muda e pecas leem fresh).
//
// Futuro (v2): canvas Fabric pra editar posicao/scale/fill/per-char styles.
"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { Button } from "@/components/ui/Button"

interface TextLayerDTO {
  path: number[]
  name: string
  text: string
  fontSize: number
  color: string
  bbox: { left: number; top: number; right: number; bottom: number }
}

interface SoData {
  width: number
  height: number
  compositeUrl: string | null
  textLayers: TextLayerDTO[]
}

function pathKey(path: number[]): string {
  return path.join(".")
}

export default function EditSoPage() {
  const params = useParams<{ id: string; assetId: string }>()
  const router = useRouter()
  const campaignId = params.id
  const assetId = params.assetId
  const [data, setData] = useState<SoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // edits[pathKey] = newText. Inicia vazio; populado ao usuario digitar.
  // Mantemos separado dos `data.textLayers` (original) pra mostrar "dirty"
  // indicador e evitar re-fetch.
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [cacheBust, setCacheBust] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/assets/${assetId}/so-data`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        const json: SoData = await res.json()
        if (!cancelled) {
          setData(json)
          setEdits({})
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Erro ao carregar")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [campaignId, assetId])

  const dirtyCount = Object.keys(edits).filter(k => {
    const orig = data?.textLayers.find(l => pathKey(l.path) === k)?.text ?? ""
    return edits[k] !== orig
  }).length

  // beforeunload: dispara prompt nativo do browser se user fecha aba/reload
  // com edits pendentes. Sem isso, edicao some sem aviso.
  useEffect(() => {
    if (dirtyCount === 0) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Required for legacy browsers; mensagem custom e ignorada hoje (Chrome
      // mostra texto padrao do browser).
      e.returnValue = ""
      return ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirtyCount])

  async function save() {
    if (!data || dirtyCount === 0) return
    setSaving(true)
    try {
      // Envia SO os pathKeys que mudaram (server-side faz no-op pros iguais
      // mesmo, mas economiza payload e processing).
      const textEdits: Record<string, string> = {}
      for (const [k, v] of Object.entries(edits)) {
        const orig = data.textLayers.find(l => pathKey(l.path) === k)?.text ?? ""
        if (v !== orig) textEdits[k] = v
      }
      const res = await fetch(`/api/campaigns/${campaignId}/assets/${assetId}/so-data`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ textEdits }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(`Falha ao salvar: ${body?.error ?? res.status}`)
        return
      }
      // Atualiza data local com novos textos + bump cache pra forcar imagem reload.
      setData(prev => prev ? {
        ...prev,
        compositeUrl: body.imageUrl ?? prev.compositeUrl,
        textLayers: prev.textLayers.map(l => {
          const k = pathKey(l.path)
          return textEdits[k] !== undefined ? { ...l, text: textEdits[k] } : l
        }),
      } : prev)
      setEdits({})
      setCacheBust(n => n + 1)
    } catch (e: any) {
      alert(`Erro: ${e?.message ?? e}`)
    } finally {
      setSaving(false)
    }
  }

  function exit() {
    // CLAUDE.md §2.1: sem prompt "salvar?" em navegacao interna. beforeunload
    // (handler abaixo) ja cobre o caso critico de close-tab/reload com dirty.
    // Voltar pra Assets eh navegacao SPA — segue padrao Adobe/Figma de ir
    // direto sem perguntar.
    router.push(`/campaigns/${campaignId}/assets`)
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ padding: 48, textAlign: "center", color: "#888" }}>Carregando PSD...</div>
    </div>
  )

  if (error || !data) return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: 32 }}>
        <div style={{ color: "#c00", marginBottom: 16 }}>{error ?? "Erro desconhecido"}</div>
        <Button variant="secondary" size="md" onClick={() => router.push(`/campaigns/${campaignId}/assets`)}>← Assets</Button>
      </div>
    </div>
  )

  const compositeSrc = data.compositeUrl
    ? (cacheBust > 0 ? `${data.compositeUrl}?v=${cacheBust}` : data.compositeUrl)
    : null

  return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 16 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#111", margin: 0 }}>
            Editar Smart Object
            <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 400, color: "#666" }}>
              {data.width} x {data.height} px · {data.textLayers.length} text{data.textLayers.length === 1 ? "" : "os"}
            </span>
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" size="md" onClick={exit}>← Assets</Button>
            <Button variant="primary" size="md" onClick={save} disabled={saving || dirtyCount === 0} loading={saving}>
              {saving ? "Salvando..." : dirtyCount > 0 ? `Salvar (${dirtyCount})` : "Salvar"}
            </Button>
          </div>
        </div>

        {/* Layout: composite preview esquerda + lista de inputs direita */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 420px", gap: 24 }}>

          {/* Preview do composite */}
          <div style={{
            background: "#3a3a3a",
            backgroundImage: "linear-gradient(45deg, #2e2e2e 25%, transparent 25%), linear-gradient(-45deg, #2e2e2e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2e2e2e 75%), linear-gradient(-45deg, transparent 75%, #2e2e2e 75%)",
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
            borderRadius: 8, padding: 24,
            display: "flex", alignItems: "center", justifyContent: "center",
            minHeight: 400,
          }}>
            {compositeSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={compositeSrc} alt="Preview"
                style={{ maxWidth: "100%", maxHeight: 600, objectFit: "contain", borderRadius: 4 }} />
            ) : (
              <div style={{ color: "#aaa" }}>Sem preview disponivel</div>
            )}
          </div>

          {/* Lista de text layers editaveis */}
          <div style={{ background: "white", border: "1px solid #E0E0E0", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #F0F0F0", background: "#FAFAFA", fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Textos do PSD
            </div>
            {data.textLayers.length === 0 ? (
              <div style={{ padding: 24, color: "#888", fontSize: 13 }}>
                Este Smart Object nao tem layers de texto editaveis.
              </div>
            ) : (
              data.textLayers.map(l => {
                const k = pathKey(l.path)
                const cur = edits[k] !== undefined ? edits[k] : l.text
                const dirty = cur !== l.text
                return (
                  <div key={k} style={{ padding: "12px 16px", borderBottom: "1px solid #F5F5F5" }}>
                    <div style={{ fontSize: 11, color: "#888", marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{l.name}</span>
                      <span>· {Math.round(l.fontSize)}pt</span>
                      <span style={{ width: 12, height: 12, background: l.color, borderRadius: 2, border: "1px solid #ccc" }} />
                    </div>
                    <textarea
                      value={cur}
                      onChange={e => setEdits(prev => ({ ...prev, [k]: e.target.value }))}
                      rows={Math.min(6, Math.max(1, cur.split("\n").length))}
                      style={{
                        width: "100%", padding: "8px 10px", borderRadius: 6,
                        border: dirty ? "1px solid #F5C400" : "1px solid #E0E0E0",
                        fontSize: 13, color: "#111", fontFamily: "inherit", outline: "none",
                        resize: "vertical",
                      }}
                    />
                  </div>
                )
              })
            )}
          </div>
        </div>

        {data.textLayers.length === 0 && (
          <div style={{ marginTop: 16, padding: 16, background: "#FFF3CD", border: "1px solid #FFE69C", borderRadius: 6, color: "#664D03", fontSize: 13 }}>
            Sem textos editaveis. Para edicao visual completa (mover layers, mudar imagens), abra o PSD direto no Photoshop e re-importe.
          </div>
        )}
      </div>
    </div>
  )
}
