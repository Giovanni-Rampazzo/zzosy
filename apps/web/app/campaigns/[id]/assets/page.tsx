"use client"
import { useEffect, useState, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { regeneratePieceThumbsForAsset, regenerateKVThumb } from "@/lib/regenerateThumbs"
import TopNav from "@/components/TopNav"
import { PsdImporter } from "@/components/campaign/PsdImporter"
import { EditableText } from "@/components/EditableText"
import { Button } from "@/components/ui/Button"
import { ClientLogoBadge } from "@/components/clients/ClientLogoBadge"
import { CampaignSubnav } from "@/components/campaign/CampaignSubnav"
import { loadGoogleFont, loadCustomFontFamily } from "@/lib/google-fonts"
import {
  BrandPresetKey, BrandPreset, BrandTypography,
  PRESET_LABELS, PRESET_ORDER, DEFAULT_TYPOGRAPHY, normalizeTypography,
} from "@/lib/brandTypography"

interface CustomFontFile { url: string; weight: number; style: "normal" | "italic"; fileName: string }
interface BrandColor { hex: string; name?: string | null; role?: string }

function getPreset(client: any, key: BrandPresetKey): BrandPreset {
  return normalizeTypography(client?.brandTypography ?? {})[key]
}

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
    brandLogoUrl?: string | null
    brandFont?: string | null
    brandColors?: BrandColor[] | null
    brandTypography?: BrandTypography | null
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
  // Cores da marca (Client.brandColors). Carregadas quando a campanha resolve
  // o clientId. Refetch automatico no evento 'zzosy:client-brand-updated' pra
  // refletir mudancas feitas em /clients/[id]/edit sem reload.
  const [brandColors, setBrandColors] = useState<BrandColor[]>([])
  const newImageInputRef = useRef<HTMLInputElement>(null)
  const saveTimers = useRef<Record<string, any>>({})

  async function addTextAsset(preset: BrandPresetKey = "body") {
    const defaultText = PRESET_LABELS[preset]
    const presetData = getPreset(campaign?.client, preset)
    const { fontWeight, fontSize, leadingPt, charSpacing } = presetData
    // Fonte do preset > fonte da marca > Arial. Permite Titulo numa fonte e
    // Body em outra (Adobe-style paragraph styles).
    const usedFont = presetData.fontFamily ?? campaign?.client?.brandFont ?? "Arial"
    const span = {
      text: defaultText,
      // fontWeight como NUMERO (consistente com PSD imports que tambem agora
      // gravam numero via extractFontWeight). Fabric aceita ambos, mas mistura
      // string/number complica comparacoes em outros pontos do sistema.
      style: { color: "#111111", fontSize, fontWeight, fontFamily: usedFont },
    }
    // lastOverride: snapshot tipografico pra propagacao server-side.
    // brandPresetSnapshot guarda os valores EXATOS do preset (sem resolver
    // fallback pra brandFont). Se preset.fontFamily eh undefined, snapshot
    // tambem fica undefined — assim a propagacao consegue detectar "ainda
    // original" comparando os valores do preset diretamente. Se snapshot
    // tivesse fontFamily=usedFont (resolvido), nunca bateria com preset
    // que tem fontFamily=undefined → propagacao parava de funcionar.
    const lastOverride: any = {
      fontFamily: usedFont,
      fontSize,
      fontWeight,
      fill: "#111111",
      leadingPt,
      charSpacing,
      brandPresetKey: preset,
      brandPresetSnapshot: {
        fontWeight, fontSize, leadingPt, charSpacing,
        // Preserva o `undefined` quando o preset nao tem fontFamily explicito.
        ...(presetData.fontFamily ? { fontFamily: presetData.fontFamily } : {}),
      },
    }
    const res = await fetch(`/api/campaigns/${id}/assets`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "TEXT",
        label: defaultText,
        value: defaultText,
        content: [span],
        lastOverride,
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

  /**
   * Cria um SHAPE asset com path vetorial pre-definido. Suporta:
   *   rectangle      → retangulo sharp 400×300
   *   roundedRect    → retangulo cantos arredondados r=20
   *   ellipse        → elipse 400×300 (4 arcos Bezier)
   *
   * Path em coords absolutas comecando em (0,0). Fabric.Path normaliza
   * internamente e usa left/top do layer pra posicionar.
   * Fill default = primeira brand color (ou cinza neutro). Sem stroke.
   * Editor expoe controles fill/stroke/strokeWidth no painel direito.
   */
  async function addShapeAsset(kind: "rectangle" | "roundedRect" | "ellipse") {
    const W = 400, H = 300
    const K = 0.5522847498
    let path = ""
    let label = ""
    if (kind === "rectangle") {
      label = "Retangulo"
      path = `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z`
    } else if (kind === "roundedRect") {
      label = "Retangulo Arredondado"
      const r = 20
      path = [
        `M ${r} 0`,
        `L ${W - r} 0`,
        `C ${W - r + r * K} 0, ${W} ${r - r * K}, ${W} ${r}`,
        `L ${W} ${H - r}`,
        `C ${W} ${H - r + r * K}, ${W - r + r * K} ${H}, ${W - r} ${H}`,
        `L ${r} ${H}`,
        `C ${r - r * K} ${H}, 0 ${H - r + r * K}, 0 ${H - r}`,
        `L 0 ${r}`,
        `C 0 ${r - r * K}, ${r - r * K} 0, ${r} 0`,
        "Z",
      ].join(" ")
    } else {
      label = "Elipse"
      const cx = W / 2, cy = H / 2, rx = W / 2, ry = H / 2
      const dx = rx * K, dy = ry * K
      path = [
        `M ${cx} 0`,
        `C ${cx + dx} 0, ${W} ${cy - dy}, ${W} ${cy}`,
        `C ${W} ${cy + dy}, ${cx + dx} ${H}, ${cx} ${H}`,
        `C ${cx - dx} ${H}, 0 ${cy + dy}, 0 ${cy}`,
        `C 0 ${cy - dy}, ${cx - dx} 0, ${cx} 0`,
        "Z",
      ].join(" ")
    }
    // Fill default: primeira brand color do cliente, ou cinza neutro.
    const defaultFill = brandColors[0]?.hex ?? "#4d4d4f"
    const shape = {
      path,
      pathBbox: { left: 0, top: 0, right: W, bottom: H },
      fill: { kind: "solid", color: defaultFill },
      stroke: null,
      fillRule: "nonzero",
    }
    const res = await fetch(`/api/campaigns/${id}/assets`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "SHAPE",
        label,
        // SHAPE: o endpoint armazena `shape` como content JSON
        // (lib/exportPiece + KeyVisionEditor leem de asset.content).
        content: shape,
      }),
    })
    if (res.ok) {
      await load()
      regenerateKVThumb(id).catch(() => {})
    } else {
      alert("Falha ao criar asset de forma")
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

  // Carrega brandColors do cliente quando a campanha resolve. Refetch no
  // evento 'zzosy:client-brand-updated' (disparado pelo /clients/[id]/edit ao
  // salvar) pra atualizar swatches sem reload manual.
  useEffect(() => {
    const clientId = campaign?.client?.id
    if (!clientId) { setBrandColors([]); return }
    let cancelled = false
    function fetchBrand() {
      fetch(`/api/clients/${clientId}`, { cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .then(c => {
          if (cancelled || !c) return
          const arr: any[] = Array.isArray(c?.brandColors) ? c.brandColors : []
          const cleaned: BrandColor[] = arr
            .filter(x => typeof x?.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(x.hex))
            .map(x => ({ hex: x.hex, name: x.name ?? null, role: x.role }))
          setBrandColors(cleaned)
        })
        .catch(() => { if (!cancelled) setBrandColors([]) })
    }
    fetchBrand()
    function onUpdate(e: any) {
      const detailId = e?.detail?.clientId
      if (!detailId || detailId === clientId) fetchBrand()
    }
    window.addEventListener("zzosy:client-brand-updated", onUpdate)
    return () => { cancelled = true; window.removeEventListener("zzosy:client-brand-updated", onUpdate) }
  }, [campaign?.client?.id])

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
    // Re-monta spans preservando styles per-char por DIFF de prefix/suffix:
    //  - Common prefix entre prevText e newText: mantém styles originais
    //  - Common suffix: mantém styles originais
    //  - Meio (diferente): usa style default (do primeiro span)
    //  - Agrupa chars consecutivos com mesmo style em spans
    // Sem isso, cada edição colapsava tudo em 1 span único com 1 cor.
    function rebuildSpans(prev: any[]): any[] {
      const defaultStyle = prev?.[0]?.style ?? { color: "#111111", fontSize: 48, fontWeight: "normal", fontFamily: "Arial" }
      const prevText = (prev ?? []).map((s: any) => s?.text ?? "").join("")
      if (prevText === newText) return prev ?? [{ text: newText, style: defaultStyle }]
      // Style char-by-char do prev (expansão dos spans)
      const prevStyles: any[] = []
      for (const span of (prev ?? [])) {
        const t = span?.text ?? ""
        const st = span?.style ?? defaultStyle
        for (let i = 0; i < t.length; i++) prevStyles.push(st)
      }
      // Common prefix
      let prefixLen = 0
      const minLen = Math.min(prevText.length, newText.length)
      while (prefixLen < minLen && prevText[prefixLen] === newText[prefixLen]) prefixLen++
      // Common suffix (sem invadir o prefix em qualquer lado)
      let suffixLen = 0
      while (
        suffixLen < (prevText.length - prefixLen) &&
        suffixLen < (newText.length - prefixLen) &&
        prevText[prevText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
      ) suffixLen++
      // Style char-by-char pro newText
      const newStyles: any[] = []
      for (let i = 0; i < newText.length; i++) {
        if (i < prefixLen) newStyles.push(prevStyles[i] ?? defaultStyle)
        else if (i >= newText.length - suffixLen) {
          const prevIdx = prevText.length - (newText.length - i)
          newStyles.push(prevStyles[prevIdx] ?? defaultStyle)
        } else newStyles.push(defaultStyle)
      }
      // Agrupa chars consecutivos com mesmo style em spans
      const result: any[] = []
      let buf = ""
      let bufStyle: any = null
      const sameStyle = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)
      for (let i = 0; i < newText.length; i++) {
        const cs = newStyles[i]
        if (bufStyle === null) { buf = newText[i]; bufStyle = cs; continue }
        if (sameStyle(bufStyle, cs)) buf += newText[i]
        else { result.push({ text: buf, style: bufStyle }); buf = newText[i]; bufStyle = cs }
      }
      if (buf) result.push({ text: buf, style: bufStyle ?? defaultStyle })
      return result.length > 0 ? result : [{ text: newText, style: defaultStyle }]
    }
    // Salva IMEDIATO ao clicar "Salvar" (sem debounce). Antes era debounce
    // 600ms — mas dispara em texto intermediário ("" durante apagar+digitar)
    // e destrói overrides.text das peças. Agora user controla via botão.
    const currentAsset = campaign.assets.find(a => a.id === assetId)
    const newSpans = rebuildSpans(parseContent(currentAsset?.content))
    setCampaign({
      ...campaign,
      assets: campaign.assets.map(a => a.id === assetId ? { ...a, content: newSpans, value: newText, label: newLabel } : a)
    })
    setSavingMap(m => ({ ...m, [assetId]: true }))
    ;(async () => {
      try {
        await fetch(`/api/campaigns/${id}/assets/${assetId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newSpans, value: newText, label: newLabel })
        })
      } finally {
        setSavingMap(m => ({ ...m, [assetId]: false }))
      }
      // Regerar thumbs das peças afetadas em segundo plano
      regeneratePieceThumbsForAsset(id, assetId).catch(e => console.warn("regen thumbs:", e))
      regenerateKVThumb(id).catch(e => console.warn("regen KV thumb:", e))
    })()
  }

  /**
   * Atualiza content do SHAPE asset (fill/stroke/strokeWidth). PATCH no
   * endpoint /assets/[assetId]. Estado local atualizado otimisticamente pra
   * preview ja refletir antes da resposta. Regen thumbs em background.
   */
  async function updateAssetShape(assetId: string, newShape: any) {
    setSavingMap(m => ({ ...m, [assetId]: true }))
    // Optimistic update — UI ja mostra novo content antes do PATCH voltar.
    setCampaign(c => c ? {
      ...c,
      assets: c.assets.map(a => a.id === assetId
        ? { ...a, content: JSON.stringify(newShape) } as any
        : a)
    } : c)
    const res = await fetch(`/api/campaigns/${id}/assets/${assetId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: JSON.stringify(newShape) }),
    })
    if (res.ok) {
      regeneratePieceThumbsForAsset(id, assetId).catch(e => console.warn("regen thumbs:", e))
      regenerateKVThumb(id).catch(e => console.warn("regen KV thumb:", e))
    }
    setSavingMap(m => ({ ...m, [assetId]: false }))
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
          <div style={{ fontSize: 12, color: "#888", marginBottom: 4, display:"flex", alignItems:"center", gap: 8 }}>
            <ClientLogoBadge
              client={{ id: campaign.client.id, name: campaign.client.name, brandLogoUrl: campaign.client.brandLogoUrl }}
              size={24}
              radius={4}
            />
            <span style={{ cursor: "pointer" }} onClick={() => router.push(`/clients/${campaign.client.id}`)}>
              {campaign.client.name}
            </span>
            <span>/</span>
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

        {/* Sub-nav contextual da campanha. Navegacao no topo (Cliente, Campanha,
            Assets, KV, Peças, Apresentação). Linha 2 (actions) tem APENAS
            acoes que MODIFICAM dados: + Texto / + Imagem / Importar PSD.
            Removido "Editar Matriz" — duplicado com botao "KV" da navegacao. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", position: "relative", marginBottom: 4 }}>
          <CampaignSubnav
            campaignId={id}
            clientId={campaign.client?.id}
            clientName={campaign.client?.name}
            activeTab="assets"
            hasAssets={campaign.assets.length > 0}
            hasPieces={((campaign as any)?._count?.pieces ?? 0) > 0}
            actions={
              <>
                <AddTextMenu onPick={addTextAsset} />
                <Button variant="secondary" size="md" onClick={() => newImageInputRef.current?.click()}>+ Imagem</Button>
                <AddShapeMenu onPick={addShapeAsset} />
                <PsdImporter campaignId={id} onImported={load} />
              </>
            }
          />
          <input ref={newImageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" style={{ position: "absolute", left: "-9999px", width: 0, height: 0, opacity: 0 }} tabIndex={-1}
            onChange={e => { const f = e.target.files?.[0]; if (f) addImageAsset(f); e.target.value = "" }} />
        </div>

        {/* Cores da Marca — sempre visível quando o cliente tem alguma cor
            cadastrada. Read-only aqui; pra editar, link pra /clients/[id]/edit. */}
        {brandColors.length > 0 && (
          <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", padding: "16px 20px", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0, color: "#111", textTransform: "uppercase", letterSpacing: 0.6 }}>Cores da Marca</h2>
                <span style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>({brandColors.length})</span>
              </div>
              <button onClick={() => router.push(`/clients/${campaign.client.id}/edit`)}
                style={{ background: "transparent", border: "1px solid #E0E0E0", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", color: "#666", fontFamily: "inherit", textTransform: "uppercase", letterSpacing: 0.4 }}
                title="Editar cores da marca em /clients/[id]/edit">
                Editar
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {brandColors.map((bc, i) => (
                <div key={`${bc.hex}-${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 64 }}>
                  <div title={bc.name ? `${bc.name} (${bc.hex})` : bc.hex}
                    style={{ width: 48, height: 48, borderRadius: 8, background: bc.hex, border: "1px solid #E0E0E0", cursor: "default" }} />
                  <div style={{ fontSize: 11, color: "#444", fontWeight: 600, fontFamily: "monospace", textTransform: "uppercase" }}>{bc.hex}</div>
                  {bc.name && <div style={{ fontSize: 10, color: "#888", textAlign: "center", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bc.name}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

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
            const shapes = sortedAssets.filter(a => a.type === "SHAPE")
            // IMAGENS = tudo que sobra (IMAGE + tipos desconhecidos pra compat).
            const images = sortedAssets.filter(a => a.type !== "TEXT" && a.type !== "SHAPE")
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
                    onShapeChange={updateAssetShape}
                    onDelete={deleteAsset}
                    brandColors={brandColors}
                  />
                )}
                {shapes.length > 0 && (
                  <AssetSection
                    title="Formas"
                    count={shapes.length}
                    assets={shapes}
                    savingMap={savingMap}
                    onTextChange={updateAssetText}
                    onLabelChange={updateAssetLabel}
                    onImageUpload={uploadAssetImage}
                    onShapeChange={updateAssetShape}
                    onDelete={deleteAsset}
                    brandColors={brandColors}
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
                    onShapeChange={updateAssetShape}
                    onDelete={deleteAsset}
                    brandColors={brandColors}
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
  onShapeChange?: (assetId: string, newShape: any) => Promise<void>
  onDelete: (assetId: string, label: string, skipConfirm?: boolean) => Promise<void>
  brandColors?: BrandColor[]
}

function AssetSection({ title, count, assets, savingMap, onTextChange, onLabelChange, onImageUpload, onShapeChange, onDelete, brandColors }: SectionProps) {
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
            onShapeChange={onShapeChange}
            onDelete={onDelete}
            brandColors={brandColors}
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
  onShapeChange?: (assetId: string, newShape: any) => Promise<void>
  onDelete: (assetId: string, label: string, skipConfirm?: boolean) => Promise<void>
  brandColors?: BrandColor[]
}

/**
 * Renderiza preview SVG inline pra SHAPE asset. Lê do `shape` prop quando
 * fornecido (preview real-time durante edicao) ou parsea de asset.content.
 */
function ShapePreview({ asset, shape: shapeOverride }: { asset?: any; shape?: any }) {
  let shape: any = shapeOverride
  if (!shape && asset) {
    try {
      shape = typeof asset.content === "string" ? JSON.parse(asset.content) : asset.content
    } catch {}
  }
  if (!shape?.path) return <div style={{ color: "#ccc", fontSize: 11 }}>Forma invalida</div>
  const bb = shape.pathBbox ?? { left: 0, top: 0, right: 400, bottom: 300 }
  const w = Math.max(1, bb.right - bb.left)
  const h = Math.max(1, bb.bottom - bb.top)
  const fill = shape.fill?.kind === "solid" ? shape.fill.color : "transparent"
  const stroke = shape.stroke?.color
  const strokeW = shape.stroke?.width ?? 0
  return (
    <svg
      viewBox={`${bb.left} ${bb.top} ${w} ${h}`}
      width="100%" height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", padding: 8 }}
    >
      <path d={shape.path}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeW}
        fillRule={shape.fillRule === "evenodd" ? "evenodd" : "nonzero"}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/**
 * Editor inline pra SHAPE assets — fill (color picker + hex + brand swatches),
 * stroke color + width. Preview re-renderiza em tempo real conforme user
 * digita/clica. PATCH dispara debounced (300ms) pra nao sobrecarregar o banco.
 */
function ShapeInlineEditor({
  asset,
  brandColors,
  onPreviewChange,
  onCommit,
}: {
  asset: any
  brandColors: BrandColor[]
  onPreviewChange: (shape: any) => void
  onCommit: (shape: any) => Promise<void>
}) {
  const parsed = (() => {
    try { return typeof asset.content === "string" ? JSON.parse(asset.content) : asset.content } catch { return null }
  })()
  const [fill, setFill] = useState(parsed?.fill?.kind === "solid" ? parsed.fill.color : "#000000")
  const [stroke, setStroke] = useState(parsed?.stroke?.color ?? "")
  const [strokeW, setStrokeW] = useState(parsed?.stroke?.width ?? 0)
  const saveTimer = useRef<any>(null)

  // Constroi shape atualizado pra preview + commit. Mantem path/pathBbox/fillRule
  // originais — so muda fill/stroke (props editaveis).
  function buildShape(f: string, s: string, sw: number) {
    return {
      ...parsed,
      fill: { kind: "solid", color: f },
      stroke: s && sw > 0 ? {
        color: s, width: sw,
        position: parsed?.stroke?.position ?? "outside",
        cap: parsed?.stroke?.cap ?? "butt",
        join: parsed?.stroke?.join ?? "miter",
      } : null,
    }
  }

  function update(f: string, s: string, sw: number) {
    setFill(f); setStroke(s); setStrokeW(sw)
    const newShape = buildShape(f, s, sw)
    onPreviewChange(newShape)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    // Debounce 300ms — typing rapido nao spamma o banco. Commit acontece
    // quando usuario para de mexer.
    saveTimer.current = setTimeout(() => { onCommit(newShape).catch(() => {}) }, 300)
  }

  const sec = { fontSize: 10, fontWeight: 700 as const, textTransform: "uppercase" as const, letterSpacing: "0.6px", color: "#888", marginBottom: 4 }
  const inp = { width: "100%", fontSize: 12, padding: "5px 8px", borderRadius: 4, border: "1px solid #E0E0E0", outline: "none", fontFamily: "inherit" } as React.CSSProperties

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0" }}>
      {/* Fill */}
      <div>
        <div style={sec}>Preenchimento</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(fill) ? fill : "#000000"}
            onChange={e => update(e.target.value, stroke, strokeW)}
            style={{ width: 36, height: 32, border: "1px solid #E0E0E0", borderRadius: 4, cursor: "pointer", padding: 0 }} />
          <input type="text" value={fill}
            onChange={e => { const v = e.target.value; if (/^#[0-9a-fA-F]{6}$/.test(v)) update(v, stroke, strokeW); setFill(v) }}
            placeholder="#RRGGBB"
            style={{ ...inp, fontFamily: "monospace", fontSize: 13, textTransform: "uppercase", flex: 1 }} />
        </div>
        {brandColors.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
            {brandColors.map((bc, i) => (
              <div key={`f-${i}`} onClick={() => update(bc.hex, stroke, strokeW)}
                title={bc.name ?? bc.hex}
                style={{ width: 22, height: 22, borderRadius: 4, background: bc.hex, cursor: "pointer",
                  border: fill.toLowerCase() === bc.hex.toLowerCase() ? "2px solid #F5C400" : "1px solid #E0E0E0" }} />
            ))}
          </div>
        )}
      </div>
      {/* Stroke */}
      <div>
        <div style={sec}>Stroke</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(stroke) ? stroke : "#000000"}
            onChange={e => update(fill, e.target.value, strokeW === 0 ? 1 : strokeW)}
            style={{ width: 36, height: 32, border: "1px solid #E0E0E0", borderRadius: 4, cursor: "pointer", padding: 0 }} />
          <input type="text" value={stroke}
            onChange={e => { const v = e.target.value; if (/^#[0-9a-fA-F]{6}$/.test(v) || v === "") update(fill, v, strokeW); setStroke(v) }}
            placeholder="(sem stroke)"
            style={{ ...inp, fontFamily: "monospace", fontSize: 13, textTransform: "uppercase", flex: 1 }} />
          <button type="button" onClick={() => update(fill, "", 0)} title="Sem stroke"
            style={{ ...inp, width: 32, cursor: "pointer", padding: 0, textAlign: "center" }}>∅</button>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="range" min={0} max={50} step={1} value={strokeW}
            onChange={e => update(fill, stroke, Number(e.target.value))}
            style={{ flex: 1 }} />
          <input type="number" min={0} max={500} step={1} value={strokeW}
            onChange={e => update(fill, stroke, Number(e.target.value) || 0)}
            style={{ ...inp, width: 70, textAlign: "right" }} />
          <span style={{ fontSize: 10, color: "#666" }}>px</span>
        </div>
      </div>
    </div>
  )
}

function AssetRow({ asset, isLast, saving, onTextChange, onLabelChange, onImageUpload, onShapeChange, onDelete, brandColors = [] }: RowProps) {
  const isText = asset.type === "TEXT"
  const isShape = asset.type === "SHAPE"
  // Preview override: durante edicao do SHAPE, mostra o shape do editor em
  // tempo real (em vez do que esta salvo). Reset apos commit/load.
  const [previewShape, setPreviewShape] = useState<any | null>(null)
  useEffect(() => { setPreviewShape(null) }, [asset.content])
  const text = isText ? getText(asset) : ""
  // Edit local (uncontrolled visualmente — só salva ao clicar "Salvar").
  // Evita auto-save com debounce que disparava migrate em texto intermediário
  // (vazio) e destruía quebras de linha das peças geradas.
  const [localText, setLocalText] = useState(text)
  // Re-sincroniza localText quando o asset.content muda externamente (ex:
  // outro user editou, refresh, etc).
  useEffect(() => { setLocalText(text) }, [text])
  const dirty = isText && localText !== text
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
        ) : isShape ? (
          <ShapePreview asset={asset} shape={previewShape ?? undefined} />
        ) : asset.imageUrl ? (
          <img src={asset.imageUrl} alt={asset.label}
            style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : (
          <div style={{ color: "#ccc", fontSize: 11 }}>Sem imagem</div>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <textarea
              value={localText}
              onChange={e => setLocalText(e.target.value)}
              onKeyDown={e => {
                // Cmd/Ctrl+Enter = atalho pra salvar
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && dirty) {
                  e.preventDefault()
                  onTextChange(asset.id, localText)
                }
              }}
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 6,
                border: dirty ? "1px solid #F5C400" : "1px solid #E0E0E0",
                fontSize: 13, color: "#111", fontFamily: "inherit", resize: "vertical", outline: "none",
                minHeight: 64, maxHeight: 200,
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10, color: dirty ? "#F5C400" : "#aaa" }}>
                {dirty ? "Alterações não salvas (Cmd+Enter pra salvar)" : "Salvo"}
              </span>
              <Button variant="primary" size="sm" disabled={!dirty}
                onClick={() => onTextChange(asset.id, localText)}>
                Salvar
              </Button>
            </div>
          </div>
        ) : isShape ? (
          <ShapeInlineEditor asset={asset} brandColors={brandColors}
            onPreviewChange={(s) => setPreviewShape(s)}
            onCommit={async (s) => {
              if (onShapeChange) await onShapeChange(asset.id, s)
              // Reset previewShape — proximo render usa o asset.content fresco do banco.
              setPreviewShape(null)
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

/**
 * Dropdown menu pra criar texto com 1 dos 4 presets tipograficos.
 * Click no botao abre menu com Titulo / Subtitulo / Corpo / Legenda.
 */
/**
 * Dropdown analogo a + Texto, mas pra SHAPE. Permite criar rectangle,
 * roundedRect ou ellipse direto pelo painel (sem precisar importar PSD).
 */
function AddShapeMenu({ onPick }: { onPick: (kind: "rectangle" | "roundedRect" | "ellipse") => void }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])
  const items: { kind: "rectangle" | "roundedRect" | "ellipse"; label: string }[] = [
    { kind: "rectangle", label: "Retangulo" },
    { kind: "roundedRect", label: "Retangulo arredondado" },
    { kind: "ellipse", label: "Elipse" },
  ]
  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <Button variant="secondary" size="md" onClick={() => setOpen(o => !o)}>+ Forma ▾</Button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0,
          background: "white", border: "1px solid #E0E0E0", borderRadius: 8,
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          minWidth: 220, zIndex: 50, padding: 4,
        }}>
          {items.map(it => (
            <button
              key={it.kind}
              type="button"
              onClick={() => { onPick(it.kind); setOpen(false) }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "8px 12px", background: "transparent",
                border: "none", borderRadius: 6, cursor: "pointer",
                fontSize: 13, fontFamily: "inherit", color: "#111",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#F5F5F5" }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
            >
              + {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AddTextMenu({ onPick }: { onPick: (preset: BrandPresetKey) => void }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])
  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <Button variant="secondary" size="md" onClick={() => setOpen(o => !o)}>+ Texto ▾</Button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0,
          background: "white", border: "1px solid #E0E0E0", borderRadius: 8,
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          minWidth: 200, zIndex: 50,
          padding: 4,
        }}>
          {PRESET_ORDER.map(key => (
            <button
              key={key}
              type="button"
              onClick={() => { onPick(key); setOpen(false) }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "8px 12px", background: "transparent",
                border: "none", borderRadius: 6, cursor: "pointer",
                fontSize: 13, fontFamily: "inherit", color: "#111",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#F5F5F5" }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
            >
              + {PRESET_LABELS[key]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
