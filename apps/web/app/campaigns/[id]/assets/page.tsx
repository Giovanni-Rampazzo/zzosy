"use client"
import { useEffect, useState, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { regeneratePieceThumbsForAsset, regenerateKVThumb } from "@/lib/regenerateThumbs"
import TopNav from "@/components/TopNav"
import { PsdImporter } from "@/components/campaign/PsdImporter"
import { EditableText } from "@/components/EditableText"
import { Button } from "@/components/ui/Button"
import { CampaignSubnav } from "@/components/campaign/CampaignSubnav"
import { loadGoogleFont, loadCustomFontFamily } from "@/lib/google-fonts"

interface CustomFontFile { url: string; weight: number; style: "normal" | "italic"; fileName: string }
interface BrandColor { hex: string; name?: string; role?: string }

interface Asset {
  id: string
  type: string
  label: string
  value: string | null
  imageUrl: string | null
  content: any
  order: number
}
interface Campaign {
  id: string
  name: string
  client: {
    id: string
    name: string
    brandFont?: string | null
    brandColors?: BrandColor[] | null
    customFontFiles?: CustomFontFile[] | null
  }
  psdUrl?: string | null
  psdName?: string | null
  assets: Asset[]
}

function parseContent(raw: any): any[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

function getText(asset: Asset): string {
  const spans = parseContent(asset.content)
  if (spans.length) return spans.map((s: any) => s.text).join("")
  return asset.value ?? ""
}

export default function CampaignAssetsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({})
  const newImageInputRef = useRef<HTMLInputElement>(null)
  const saveTimers = useRef<Record<string, any>>({})

  async function addTextAsset() {
    const defaultText = "Novo texto"
    const usedFont = (campaign?.client?.brandFont || "Arial")
    try {
      fetch("/api/debug/client-log", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: "assets-ADD-TEXT", data: {
          campaignLoaded: !!campaign,
          hasClient: !!campaign?.client,
          brandFontRaw: campaign?.client?.brandFont ?? null,
          usedFont,
        }})
      }).catch(() => {})
    } catch {}
    const span = { text: defaultText, style: { color: "#111111", fontSize: 80, fontWeight: "normal", fontFamily: usedFont } }
    const res = await fetch(`/api/campaigns/${id}/assets`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "TEXT",
        label: "Novo texto",
        value: defaultText,
        content: [span],
      })
    })
    if (res.ok) {
      await load()
      regenerateKVThumb(id).catch(() => {})
    } else {
      alert("Falha ao criar asset de texto")
    }
  }

  async function addImageAsset(file: File) {
    const fd = new FormData()
    fd.append("image", file)
    fd.append("label", file.name.replace(/\.[^.]+$/, ""))
    const res = await fetch(`/api/campaigns/${id}/assets`, { method: "POST", body: fd })
    if (res.ok) {
      await load()
      regenerateKVThumb(id).catch(() => {})
    } else {
      alert("Falha ao criar asset de imagem")
    }
  }

  async function deleteAsset(assetId: string, label: string, skipConfirm = false) {
    if (!skipConfirm && !confirm(`Apagar "${label}"? Será removido também das peças e da matriz.`)) return
    const res = await fetch(`/api/campaigns/${id}/assets/${assetId}`, { method: "DELETE" })
    if (res.ok) {
      await load()
      regenerateKVThumb(id).catch(() => {})
      regeneratePieceThumbsForAsset(id, assetId).catch(() => {})
    } else {
      alert("Falha ao apagar")
    }
  }

  async function load() {
    const res = await fetch(`/api/campaigns/${id}`)
    if (res.ok) {
      const c: Campaign = await res.json()
      // Log diagnostico — o que a API retornou pro client
      try {
        fetch("/api/debug/client-log", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag: "assets-LOAD", data: {
            hasClient: !!c.client,
            clientId: c.client?.id,
            brandFont: c.client?.brandFont ?? null,
            brandFontType: typeof c.client?.brandFont,
            customFontFilesCount: Array.isArray(c.client?.customFontFiles) ? c.client.customFontFiles.length : -1,
            brandColorsCount: Array.isArray(c.client?.brandColors) ? c.client.brandColors.length : -1,
          }})
        }).catch(() => {})
      } catch {}
      setCampaign(c)
      const files = c.client?.customFontFiles
      if (c.client?.brandFont) {
        if (Array.isArray(files) && files.length > 0) loadCustomFontFamily(c.client.brandFont, files)
        else loadGoogleFont(c.client.brandFont)
      }
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  async function updateAssetLabel(assetId: string, newLabel: string) {
    if (!campaign) return
    const trimmed = newLabel.trim()
    if (!trimmed) return
    setCampaign({ ...campaign, assets: campaign.assets.map(a => a.id === assetId ? { ...a, label: trimmed } : a) })
    setSavingMap(m => ({ ...m, [assetId]: true }))
    const res = await fetch(`/api/campaigns/${id}/assets/${assetId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: trimmed })
    })
    setSavingMap(m => ({ ...m, [assetId]: false }))
    if (!res.ok) throw new Error("Falha ao salvar nome")
  }

  function updateAssetText(assetId: string, newText: string) {
    if (!campaign) return
    // Photoshop-style: nome da layer = conteudo do texto (truncado/normalizado).
    // Sincroniza sempre que o texto muda.
    const newLabel = (() => {
      const t = newText.trim().replace(/\s+/g, " ")
      if (!t) return "Novo texto"
      return t.length > 64 ? t.substring(0, 64) + "…" : t
    })()
    setCampaign({
      ...campaign,
      assets: campaign.assets.map(a => {
        if (a.id !== assetId) return a
        const spans = parseContent(a.content)
        const newSpans = spans.length
          ? [{ ...spans[0], text: newText }, ...spans.slice(1)]
          : [{ text: newText, style: { color: "#111111", fontSize: 48, fontWeight: "normal", fontFamily: (campaign?.client?.brandFont || "Arial") } }]
        return { ...a, content: newSpans, value: newText, label: newLabel }
      })
    })

    clearTimeout(saveTimers.current[assetId])
    setSavingMap(m => ({ ...m, [assetId]: true }))
    saveTimers.current[assetId] = setTimeout(async () => {
      const asset = campaign.assets.find(a => a.id === assetId)
      const spans = parseContent(asset?.content)
      const newSpans = spans.length
        ? [{ ...spans[0], text: newText }, ...spans.slice(1)]
        : [{ text: newText, style: { color: "#111111", fontSize: 48, fontWeight: "normal", fontFamily: (campaign?.client?.brandFont || "Arial") } }]
      await fetch(`/api/campaigns/${id}/assets/${assetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newSpans, value: newText, label: newLabel })
      })
      setSavingMap(m => ({ ...m, [assetId]: false }))
      // Regerar thumbs das peças afetadas em segundo plano
      regeneratePieceThumbsForAsset(id, assetId).catch(e => console.warn("regen thumbs:", e))
      regenerateKVThumb(id).catch(e => console.warn("regen KV thumb:", e))
    }, 600)
  }

  async function uploadAssetImage(assetId: string, file: File) {
    setSavingMap(m => ({ ...m, [assetId]: true }))
    const fd = new FormData()
    fd.append("image", file)
    const res = await fetch(`/api/campaigns/${id}/assets/${assetId}/image`, { method: "POST", body: fd })
    if (res.ok) {
      const data = await res.json()
      setCampaign(c => c ? {
        ...c,
        assets: c.assets.map(a => a.id === assetId ? { ...a, imageUrl: data.imageUrl } : a)
      } : c)
      // Regerar thumbs das peças afetadas em segundo plano
      regeneratePieceThumbsForAsset(id, assetId).catch(e => console.warn("regen thumbs:", e))
      regenerateKVThumb(id).catch(e => console.warn("regen KV thumb:", e))
    }
    setSavingMap(m => ({ ...m, [assetId]: false }))
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "80vh", color: "#888" }}>Carregando...</div>
    </div>
  )

  if (!campaign) return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "80vh", color: "#888" }}>Campanha nao encontrada.</div>
    </div>
  )

  const sortedAssets = [...campaign.assets].sort((a, b) => a.order - b.order)

  return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
            <span style={{ cursor: "pointer" }} onClick={() => router.push(`/clients/${campaign.client.id}`)}>
              {campaign.client.name}
            </span>
            {" / "}
            <span style={{ cursor: "pointer" }} onClick={() => router.push(`/campaigns/${id}`)}>
              {campaign.name}
            </span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
            Assets
            <span style={{ fontSize: 13, fontWeight: 500, color: "#888", marginLeft: 8 }}>
              {campaign.assets.length}
            </span>
          </h1>
        </div>

        {/* Sub-nav contextual da campanha. Linha 1: ← Cliente + Peças (amarelo).
            Linha 2 (actions): + Texto + Imagem + Importar PSD + Editar Matriz. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", position: "relative", marginBottom: 4 }}>
          <CampaignSubnav
            campaignId={id}
            clientId={campaign.client?.id}
            activeTab="assets"
            actions={
              <>
                <Button variant="secondary" size="md" onClick={addTextAsset}>+ Texto</Button>
                <Button variant="secondary" size="md" onClick={() => newImageInputRef.current?.click()}>+ Imagem</Button>
                <PsdImporter campaignId={id} onImported={load} />
                {campaign.assets.length > 0 && (
                  <Button variant="primary" size="md" onClick={() => router.push(`/editor?campaignId=${id}`)}>Editar Matriz (KV)</Button>
                )}
              </>
            }
          />
          <input ref={newImageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" style={{ position: "absolute", left: "-9999px", width: 0, height: 0, opacity: 0 }} tabIndex={-1}
            onChange={e => { const f = e.target.files?.[0]; if (f) addImageAsset(f); e.target.value = "" }} />
        </div>

        {campaign.assets.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#888" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "#444" }}>Nenhum asset ainda</div>
            <div style={{ fontSize: 14 }}>Importe um PSD para extrair os layers automaticamente</div>
          </div>
        ) : (
          (() => {
            // Agrupa por tipo: textos primeiro, imagens depois (mantendo order interno)
            const texts = sortedAssets.filter(a => a.type === "TEXT")
            const images = sortedAssets.filter(a => a.type !== "TEXT")
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {texts.length > 0 && (
                  <AssetSection
                    title="Textos"
                    count={texts.length}
                    assets={texts}
                    savingMap={savingMap}
                    onTextChange={updateAssetText}
                    onLabelChange={updateAssetLabel}
                    onImageUpload={uploadAssetImage}
                    onDelete={deleteAsset}
                  />
                )}
                {images.length > 0 && (
                  <AssetSection
                    title="Imagens"
                    count={images.length}
                    assets={images}
                    savingMap={savingMap}
                    onTextChange={updateAssetText}
                    onLabelChange={updateAssetLabel}
                    onImageUpload={uploadAssetImage}
                    onDelete={deleteAsset}
                  />
                )}
              </div>
            )
          })()
        )}
      </div>
    </div>
  )
}

/* ============== Section component ============== */
interface SectionProps {
  title: string
  count: number
  assets: Asset[]
  savingMap: Record<string, boolean>
  onTextChange: (assetId: string, newText: string) => void
  onLabelChange: (assetId: string, newLabel: string) => Promise<void>
  onImageUpload: (assetId: string, file: File) => Promise<void>
  onDelete: (assetId: string, label: string, skipConfirm?: boolean) => Promise<void>
}

function AssetSection({ title, count, assets, savingMap, onTextChange, onLabelChange, onImageUpload, onDelete }: SectionProps) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10, paddingLeft: 4 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0, color: "#111", textTransform: "uppercase", letterSpacing: 0.6 }}>{title}</h2>
        <span style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>({count})</span>
      </div>
      <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", overflow: "hidden" }}>
        {assets.map((asset, i) => (
          <AssetRow
            key={asset.id}
            asset={asset}
            isLast={i === assets.length - 1}
            saving={!!savingMap[asset.id]}
            onTextChange={onTextChange}
            onLabelChange={onLabelChange}
            onImageUpload={onImageUpload}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  )
}

/* ============== Row component (preview-left layout) ============== */
interface RowProps {
  asset: Asset
  isLast: boolean
  saving: boolean
  onTextChange: (assetId: string, newText: string) => void
  onLabelChange: (assetId: string, newLabel: string) => Promise<void>
  onImageUpload: (assetId: string, file: File) => Promise<void>
  onDelete: (assetId: string, label: string, skipConfirm?: boolean) => Promise<void>
}

function AssetRow({ asset, isLast, saving, onTextChange, onLabelChange, onImageUpload, onDelete }: RowProps) {
  const isText = asset.type === "TEXT"
  const text = isText ? getText(asset) : ""
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "180px 1fr auto",
      gap: 16,
      alignItems: "stretch",
      padding: 16,
      borderBottom: isLast ? "none" : "1px solid #F0F0F0",
    }}>
      {/* Preview a esquerda */}
      <div style={{
        width: 180, height: 120,
        background: "#F8F9FA",
        borderRadius: 6,
        border: "1px solid #E5E5E5",
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
      }}>
        {isText ? (
          <div style={{
            padding: "8px 10px",
            fontSize: 13,
            color: "#333",
            textAlign: "center",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 4,
            WebkitBoxOrient: "vertical" as any,
            lineHeight: 1.3,
            wordBreak: "break-word",
          }}>
            {text || <span style={{ color: "#bbb" }}>(vazio)</span>}
          </div>
        ) : asset.imageUrl ? (
          <img src={asset.imageUrl} alt={asset.label}
            style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : (
          <div style={{ color: "#ccc", fontSize: 28 }}>🖼</div>
        )}
      </div>

      {/* Conteudo */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        {saving && (
          <span style={{ fontSize: 11, color: "#F5C400", fontWeight: 500 }}>
            Salvando…
          </span>
        )}
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>
          <EditableText value={asset.label} variant="inline" onSave={(v) => onLabelChange(asset.id, v)} />
        </div>
        {isText ? (
          <textarea
            defaultValue={text}
            onChange={e => onTextChange(asset.id, e.target.value)}
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #E0E0E0",
              fontSize: 13, color: "#111", fontFamily: "inherit", resize: "vertical", outline: "none",
              minHeight: 64, maxHeight: 200,
            }}
          />
        ) : (
          <div>
            <label style={{ cursor: "pointer", fontSize: 12, color: "#666", border: "1px solid #E0E0E0", borderRadius: 4, padding: "6px 12px", background: "#F8F9FA", display: "inline-block" }}>
              Trocar imagem
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" style={{ position: "absolute", left: "-9999px", width: 0, height: 0, opacity: 0 }} tabIndex={-1}
                onChange={e => { const f = e.target.files?.[0]; if (f) onImageUpload(asset.id, f); e.target.value = "" }} />
            </label>
          </div>
        )}
      </div>

      {/* Acoes */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
        <Button variant="secondary" size="sm" onClick={async () => {
          const { exportAsset } = await import("@/lib/exportAsset")
          try { await exportAsset(asset as any, "original") } catch (e: any) { alert("Falha no export: " + (e?.message || e)) }
        }} title="Baixar arquivo original do asset">Original</Button>
        <Button variant="secondary" size="sm" onClick={async () => {
          const { exportAsset } = await import("@/lib/exportAsset")
          try { await exportAsset(asset as any, "psd") } catch (e: any) { alert("Falha no export: " + (e?.message || e)) }
        }} title="Baixar PSD com 1 layer (texto editavel ou imagem)">PSD</Button>
        <Button variant="danger" size="sm" onClick={(e) => onDelete(asset.id, asset.label, e.altKey)} title="Option/Alt+click pra apagar sem confirmação">Apagar</Button>
      </div>
    </div>
  )
}
