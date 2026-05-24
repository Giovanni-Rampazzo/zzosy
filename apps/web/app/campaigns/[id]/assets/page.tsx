"use client"
import { useEffect, useLayoutEffect, useState, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { regeneratePieceThumbsForAsset, regenerateKVThumb } from "@/lib/regenerateThumbs"
import TopNav from "@/components/TopNav"
import { PsdImporter, type PsdImporterHandle } from "@/components/campaign/PsdImporter"
import { EditableText } from "@/components/EditableText"
import { Button } from "@/components/ui/Button"
import { ClientLogoBadge } from "@/components/clients/ClientLogoBadge"
import { CampaignSubnav } from "@/components/campaign/CampaignSubnav"
import { loadGoogleFont, loadCustomFontFamily } from "@/lib/google-fonts"
import {
  BrandPresetKey, BrandPreset, BrandTypography,
  PRESET_LABELS, PRESET_ORDER, DEFAULT_TYPOGRAPHY, normalizeTypography,
} from "@/lib/brandTypography"
import { buildShapePath, type ShapeKind } from "@/lib/shapePaths"

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
  // newImageInputRef removido — file picker agora vive dentro de AddMenu.
  const psdImporterRef = useRef<PsdImporterHandle | null>(null)
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
  async function addShapeAsset(kind: ShapeKind) {
    const W = 400, H = 300
    let label = ""
    let cornerRadius: number | undefined = undefined
    if (kind === "rectangle") label = "Retangulo"
    else if (kind === "roundedRect") {
      label = "Retangulo Arredondado"
      cornerRadius = 20
    }
    else label = "Elipse"
    // buildShapePath: fonte unica de verdade pra gerar paths (lib/shapePaths.ts).
    const path = buildShapePath(kind, W, H, cornerRadius)
    // Fill default: primeira brand color do cliente, ou cinza neutro.
    const defaultFill = brandColors[0]?.hex ?? "#4d4d4f"
    // `kind` + `cornerRadius` metadata: permitem o Properties Panel mostrar
    // controle de raio + recomputar path quando user muda o raio.
    const shape: any = {
      kind,
      path,
      pathBbox: { left: 0, top: 0, right: W, bottom: H },
      fill: { kind: "solid", color: defaultFill },
      stroke: null,
      fillRule: "nonzero",
    }
    if (cornerRadius !== undefined) shape.cornerRadius = cornerRadius
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
   * (Edicao acontece no editor KV/peca — aqui so mostra preview.)
   */

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

        {/* Header limpo: breadcrumb compacto inline com contador. Titulo
            "Assets" removido — subnav abaixo ja destaca a tab ativa. */}
        <div style={{ fontSize: 13, color: "#666", marginBottom: 12, display:"flex", alignItems:"center", gap: 8 }}>
          <ClientLogoBadge
            client={{ id: campaign.client.id, name: campaign.client.name, brandLogoUrl: campaign.client.brandLogoUrl }}
            size={20}
            radius={3}
          />
          <span style={{ cursor: "pointer" }} onClick={() => router.push(`/clients/${campaign.client.id}`)}>
            {campaign.client.name}
          </span>
          <span style={{ color: "#bbb" }}>/</span>
          <span style={{ cursor: "pointer", color: "#111", fontWeight: 600 }} onClick={() => router.push(`/campaigns/${id}`)}>
            {campaign.name}
          </span>
          <span style={{ color: "#bbb" }}>·</span>
          <span style={{ color: "#888" }}>{campaign.assets.length} {campaign.assets.length === 1 ? "asset" : "assets"}</span>
        </div>

        {/* Sub-nav contextual da campanha (Campanha/Assets/KV/Pecas/Apresentacao)
            restaurada por pedido user 2026-05-23 ("aqui faltou o menu de
            navegacao"). + Adicionar fica alinhado a direita NA MESMA linha
            (padrao "+ X dentro da lista" via prop actions). */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative", marginBottom: 4 }}>
          <CampaignSubnav
            campaignId={id}
            clientId={campaign.client?.id}
            clientName={campaign.client?.name}
            activeTab="assets"
            hasAssets={campaign.assets.length > 0}
            hasPieces={((campaign as any)?._count?.pieces ?? 0) > 0}
            actions={
              <AddMenu
                onPickText={addTextAsset}
                onPickShape={addShapeAsset}
                onAddImage={addImageAsset}
                onPickPsd={(f) => psdImporterRef.current?.importFile(f)}
              />
            }
          />
          <div style={{ display: "none" }}>
            <PsdImporter ref={psdImporterRef} campaignId={id} onImported={load} />
          </div>
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
                    onDelete={deleteAsset}
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

function AssetRow({ asset, isLast, saving, onTextChange, onLabelChange, onImageUpload, onDelete }: RowProps) {
  const isText = asset.type === "TEXT"
  const isShape = asset.type === "SHAPE"
  const text = isText ? getText(asset) : ""
  // Edit local (uncontrolled visualmente — só salva ao clicar "Salvar").
  // Evita auto-save com debounce que disparava migrate em texto intermediário
  // (vazio) e destruía quebras de linha das peças geradas.
  const [localText, setLocalText] = useState(text)
  // Re-sincroniza localText quando o asset.content muda externamente (ex:
  // outro user editou, refresh, etc).
  useEffect(() => { setLocalText(text) }, [text])
  // Auto-resize do textarea apos cada mudanca de localText. useLayoutEffect
  // pra rodar APOS o React commitar o novo value mas ANTES do browser pintar
  // (sem flicker). Antes era ref callback inline que rodava ANTES do commit
  // do novo value, perdendo updates externos (setLocalText via useEffect).
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (!isText) return
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [localText, isText])
  const dirty = isText && localText !== text
  // TEXT: linha unica enxuta — input direto + Salvar + Apagar (sem label
  // do layer na frente, a pedido do user 2026-05-22).
  if (isText) {
    return (
      <div style={{
        display: "flex",
        // flex-start: botoes alinham com a PRIMEIRA linha do textarea quando
        // ele cresce. Center fazia eles "flutuarem" no meio vertical do
        // textarea expandido.
        alignItems: "flex-start",
        gap: 12,
        padding: "8px 16px",
        borderBottom: isLast ? "none" : "1px solid #F0F0F0",
      }}>
        {/* Textarea auto-crescente — resize via useLayoutEffect (acima),
            roda APOS commit do React. Enter vira newline natural; Cmd+Enter salva. */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={localText}
          onChange={e => setLocalText(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && dirty) {
              e.preventDefault()
              onTextChange(asset.id, localText)
            }
          }}
          placeholder="Conteúdo do texto"
          style={{
            flex: 1, minWidth: 0,
            padding: "6px 10px", borderRadius: 6,
            border: dirty ? "1px solid #F5C400" : "1px solid #E0E0E0",
            fontSize: 13, color: "#111", fontFamily: "inherit", outline: "none",
            resize: "none", overflow: "hidden", lineHeight: 1.5,
          }}
        />
        {/* So renderiza Salvar quando ha mudancas — antes ficava disabled
            com opacity-50, deixando o amarelo "clarinho" / fantasma na UI. */}
        {(dirty || saving) && (
          <Button variant="view" size="sm" disabled={saving}
            onClick={() => onTextChange(asset.id, localText)}
            title={saving ? "Salvando…" : "Salvar alterações (Cmd+Enter)"}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        )}
        <Button variant="danger" size="sm" onClick={(e) => onDelete(asset.id, asset.label, e.altKey)} title="Option/Alt+click pra apagar sem confirmação">Apagar</Button>
      </div>
    )
  }

  // IMAGE / SHAPE: layout grid com preview visual (que ajuda identificar).
  // Preview menor (120x80 era 180x120) + alignItems center pra alinhar linha
  // vertical com o texto/botoes (user pediu 2026-05-22).
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "120px 1fr auto",
      gap: 16,
      alignItems: "center",
      padding: 12,
      borderBottom: isLast ? "none" : "1px solid #F0F0F0",
    }}>
      {/* Preview a esquerda */}
      <div style={{
        width: 120, height: 80,
        background: "#F8F9FA",
        borderRadius: 6,
        border: "1px solid #E5E5E5",
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
      }}>
        {isShape ? (
          <ShapePreview asset={asset} />
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
        {isShape ? null : (
          <div>
            <label style={{ cursor: "pointer", fontSize: 12, color: "#666", border: "1px solid #E0E0E0", borderRadius: 4, padding: "6px 12px", background: "#F8F9FA", display: "inline-block" }}>
              Trocar imagem
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" style={{ position: "absolute", left: "-9999px", width: 0, height: 0, opacity: 0 }} tabIndex={-1}
                onChange={e => { const f = e.target.files?.[0]; if (f) onImageUpload(asset.id, f); e.target.value = "" }} />
            </label>
          </div>
        )}
      </div>

      {/* Acoes — so Apagar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
        <Button variant="danger" size="sm" onClick={(e) => onDelete(asset.id, asset.label, e.altKey)} title="Option/Alt+click pra apagar sem confirmação">Apagar</Button>
      </div>
    </div>
  )
}

/* AddShapeMenu removido (2026-05-22) — funcionalidade absorvida pelo AddMenu unificado acima. */

/**
 * Botao unico "+ Adicionar" que agrupa Texto + Imagem + Forma num menu so.
 * User pediu 2026-05-22: "isso tudo vira um botao so de Adicionar.. (+),
 * e quando clica nele aparecem essas opcoes". PSD continua botao separado
 * (acao diferente — substitui KV inteira).
 */
function AddMenu({
  onPickText,
  onPickShape,
  onAddImage,
  onPickPsd,
}: {
  onPickText: (preset: BrandPresetKey) => void
  onPickShape: (kind: "rectangle" | "roundedRect" | "ellipse") => void
  onAddImage: (file: File) => void
  onPickPsd: (file: File) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const psdRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])
  const sectionLabel: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.8px", color: "#999",
    padding: "10px 12px 4px",
  }
  const itemS: React.CSSProperties = {
    display: "block", width: "100%", textAlign: "left",
    padding: "8px 12px", background: "transparent",
    border: "none", borderRadius: 6, cursor: "pointer",
    fontSize: 13, fontFamily: "inherit", color: "#111",
  }
  const onHoverIn = (e: React.MouseEvent<HTMLButtonElement>) => { (e.currentTarget as HTMLButtonElement).style.background = "#F5F5F5" }
  const onHoverOut = (e: React.MouseEvent<HTMLButtonElement>) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }
  const shapes: { kind: "rectangle" | "roundedRect" | "ellipse"; label: string }[] = [
    { kind: "rectangle", label: "Retangulo" },
    { kind: "roundedRect", label: "Retangulo arredondado" },
    { kind: "ellipse", label: "Elipse" },
  ]
  return (
    // CampaignSubnav ja aplica marginLeft:auto no container de actions, entao
    // o AddMenu naturalmente fica encostado a direita.
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <Button variant="view" size="md" onClick={() => setOpen(o => !o)} title="Adicionar Texto / Imagem / Forma / PSD">+ Adicionar ▾</Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        style={{ position: "absolute", left: "-9999px", width: 0, height: 0, opacity: 0 }}
        tabIndex={-1}
        onChange={e => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (f) onAddImage(f)
        }}
      />
      <input
        ref={psdRef}
        type="file"
        accept=".psd"
        style={{ position: "absolute", left: "-9999px", width: 0, height: 0, opacity: 0 }}
        tabIndex={-1}
        onChange={e => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (f) onPickPsd(f)
        }}
      />
      {open && (
        <div style={{
          // right: 0 ancora popup pela direita (menu nao sai pra fora da viewport
          // quando o botao esta no canto direito do subnav).
          position: "absolute", top: "calc(100% + 4px)", right: 0,
          background: "white", border: "1px solid #E0E0E0", borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
          minWidth: 240, zIndex: 50, padding: 4,
        }}>
          <div style={sectionLabel}>Texto</div>
          {PRESET_ORDER.map(key => (
            <button key={key} type="button" style={itemS}
              onMouseEnter={onHoverIn} onMouseLeave={onHoverOut}
              onClick={() => { onPickText(key); setOpen(false) }}>
              + {PRESET_LABELS[key]}
            </button>
          ))}
          <div style={{ borderTop: "1px solid #F0F0F0", margin: "6px 0" }} />
          <div style={sectionLabel}>Imagem</div>
          <button type="button" style={itemS}
            onMouseEnter={onHoverIn} onMouseLeave={onHoverOut}
            onClick={() => { setOpen(false); fileRef.current?.click() }}>
            + Imagem (PNG/JPG/SVG)
          </button>
          {/* PSD entra como subitem de Imagem (user pedido 2026-05-23) — PSD eh
              outro formato de arquivo de imagem, nao precisa de secao propria. */}
          <button type="button" style={itemS}
            onMouseEnter={onHoverIn} onMouseLeave={onHoverOut}
            onClick={() => { setOpen(false); psdRef.current?.click() }}
            title="Importar arquivo PSD (substitui Key Vision atual)">
            + Importar PSD
          </button>
          <div style={{ borderTop: "1px solid #F0F0F0", margin: "6px 0" }} />
          <div style={sectionLabel}>Forma</div>
          {shapes.map(s => (
            <button key={s.kind} type="button" style={itemS}
              onMouseEnter={onHoverIn} onMouseLeave={onHoverOut}
              onClick={() => { onPickShape(s.kind); setOpen(false) }}>
              + {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* AddTextMenu removido (2026-05-22) — funcionalidade absorvida pelo AddMenu unificado acima. */
