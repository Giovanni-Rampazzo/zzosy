/**
 * importer — entry point do pipeline novo de PSD.
 *
 * Coordena: file → reader → toCampaign → upload + POST API.
 *
 * Esse modulo SUBSTITUI a logica core do componente PsdImporter.tsx (legacy).
 * Coexiste com o legacy enquanto a Fase 2+ amadurece. Wire-up via feature
 * flag (URL ?useNewPsdPipeline=1 ou env var).
 */
import { readPsdDocument, resolveClippingChains, type ReadWarning } from "./reader"
import { buildCampaignFromPsd, type CampaignBuild, type BuildWarning } from "./toCampaign"
import { detectWrapperSmartObjects } from "./postProcess"
import { resolveAllClippingChains } from "./clipping"
import { propagateFolderMasks } from "./folderMasks"

export interface ImportResult {
  ok: boolean
  /** Mensagem pra UI quando ok=false. */
  error?: string
  /** Stats pos-import pra log + telemetria. */
  stats?: {
    assets: number
    layers: number
    imageBlobs: number
    durationMs: number
  }
  /** Warnings agregados (reader + builder). */
  warnings: Array<ReadWarning | BuildWarning>
  /** Fontes referenciadas — UI usa pra missing-fonts modal. */
  requiredFonts: string[]
}

export interface ImportOptions {
  /** Hook de progresso pra UI exibir percentual ou texto. */
  onProgress?: (msg: string) => void
  /** Hook chamado pra cada warning conforme acontece. */
  onWarning?: (w: ReadWarning | BuildWarning) => void
  /** PSD muito grande? skipMaster pula upload do .psd original (faz upload
   *  separado depois via chunked endpoint). Threshold default: 50MB. */
  skipMasterIfLarger?: number
}

const DEFAULT_SKIP_MASTER = 50 * 1024 * 1024 // 50MB

/**
 * Importa um arquivo PSD pra uma campanha ZZOSY usando o pipeline NOVO.
 *
 * Diferenca do importer legacy:
 *  - Effects sao DADOS no asset (nao baked em pixels)
 *  - Smart Objects vem com `pixelsIncludeEffects: true` (editor nao adiciona
 *    Fabric.Shadow extra — evita doubling)
 *  - Mask como dado discriminado
 *  - Clipping chain resolvida explicitamente
 *  - Warnings explicitos pra features fora de escopo
 *
 * @returns ImportResult com ok=true/false + warnings + stats
 */
export async function importPsdToCampaign(
  file: File,
  campaignId: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const t0 = performance.now()
  const warnings: Array<ReadWarning | BuildWarning> = []
  const skipMasterThreshold = options.skipMasterIfLarger ?? DEFAULT_SKIP_MASTER

  options.onProgress?.("Lendo PSD…")
  let bytes: ArrayBuffer
  try {
    bytes = await file.arrayBuffer()
  } catch (e: any) {
    return { ok: false, error: `Falha ao ler bytes do PSD: ${e?.message ?? e}`, warnings, requiredFonts: [] }
  }

  options.onProgress?.("Decodificando layers…")
  let document
  try {
    const result = readPsdDocument(bytes, {
      includeImageData: true,
      includeComposite: true,
      onWarning: (w) => {
        warnings.push(w)
        options.onWarning?.(w)
      },
    })
    document = result.document
  } catch (e: any) {
    return { ok: false, error: `Falha ao decodificar PSD: ${e?.message ?? e}`, warnings, requiredFonts: [] }
  }

  resolveClippingChains(document)

  // Fase 2: detecta Smart Objects "wrapper" (PA do Sicredi, mockups de
  // designer, preview embedded com layers acima duplicando). Marca isWrapper
  // em cada SO afetado. toCampaign omite ou avisa.
  const wrapperResult = detectWrapperSmartObjects(document)
  if (wrapperResult.detected.length > 0) {
    console.log("[psd-new] Smart Object wrappers detectados:", wrapperResult.detected)
  }

  // Fase 3: clipping chains resolved no build time. Substitui mask.kind=
  // "clipping" pela silhueta raster extraida do clipBase. Sem isso, editor
  // caia em rect bbox fallback → foto recortada em quadrado em vez da
  // shield curve. Agora cada layer com clipping tem mask.kind="raster" com
  // a silhueta Adobe-fiel ja resolved.
  options.onProgress?.("Resolvendo clipping chains…")
  const clipStats = await resolveAllClippingChains(document)
  if (clipStats.pending > 0) {
    console.warn(`[psd-new] ${clipStats.pending} clipping chains nao resolvidas (base sem canvas?). Camadas afetadas vao renderizar SEM mask.`)
  }
  if (clipStats.resolved > 0) {
    console.log(`[psd-new] ${clipStats.resolved} clipping chains resolvidas → raster masks`)
  }

  // Fase 3: propaga folder masks (mask de pasta intersectada com mask propria
  // de cada child). Adobe: composite do folder eh APENAS onde folder.mask
  // eh opaca, e cada child dentro vale a intersecao com sua mask propria.
  options.onProgress?.("Propagando folder masks…")
  const folderMaskStats = await propagateFolderMasks(document)
  if (folderMaskStats.propagated > 0) {
    console.log(`[psd-new] ${folderMaskStats.propagated} folder masks propagadas pros children`)
  }

  options.onProgress?.("Mapeando assets…")
  let build: CampaignBuild
  try {
    build = buildCampaignFromPsd(document)
    for (const w of build.warnings) {
      warnings.push(w)
      options.onWarning?.(w)
    }
  } catch (e: any) {
    return { ok: false, error: `Falha ao mapear assets: ${e?.message ?? e}`, warnings, requiredFonts: [] }
  }

  if (build.assets.length === 0) {
    return {
      ok: false,
      error: "Nenhum asset extraido. PSD pode ter so adjustments ou layers vazias.",
      warnings,
      requiredFonts: build.requiredFonts,
    }
  }

  options.onProgress?.(`Enviando ${build.assets.length} assets ao servidor…`)

  // Monta FormData esperado pelo endpoint POST /api/campaigns/[id]/import-psd
  const fd = new FormData()
  // Mapeia assets pro shape que o endpoint aceita. tempId vira posicao no
  // array; imageIndex aponta pra position do blob em images[].
  const apiAssets = build.assets.map((a, idx) => ({
    label: a.label,
    type: a.type,
    content: a.content,
    imageIndex: a.imageIndex,
    posX: 0, // sera derivado de kvLayer correspondente (mesmo idx)
    posY: 0,
    width: 0,
    height: 0,
    zIndex: idx,
    lastOverride: a.lastOverride,
    mask: a.mask,
    hidden: a.hidden,
    locked: a.locked,
    opacity: build.kvLayers[idx]?.opacity ?? 1,
    blendMode: build.kvLayers[idx]?.blendMode ?? "source-over",
    effects: a.effects,
    groupPath: build.kvLayers[idx]?.groupPath ?? [],
    // Novo flag — editor le pra decidir se aplica Fabric.Shadow ou nao.
    pixelsIncludeEffects: a.pixelsIncludeEffects,
  }))
  // Sincroniza posicoes a partir dos kvLayers (mesmo idx → mesmo asset).
  for (let i = 0; i < apiAssets.length && i < build.kvLayers.length; i++) {
    const kvl = build.kvLayers[i]
    apiAssets[i].posX = kvl.posX
    apiAssets[i].posY = kvl.posY
    apiAssets[i].width = kvl.width
    apiAssets[i].height = kvl.height
  }

  fd.append("assets", JSON.stringify(apiAssets))
  fd.append("canvasWidth", String(build.width))
  fd.append("canvasHeight", String(build.height))
  fd.append("bgColor", build.bgColor)
  fd.append("fontsRequired", JSON.stringify(build.requiredFonts))

  // Upload imagens com indices estaveis (idx i no array = imageIndex i no asset).
  for (let i = 0; i < build.imageBlobs.length; i++) {
    const blob = build.imageBlobs[i]
    fd.append("images", blob, `image-${i}.png`)
  }

  // PSD master: so manda se nao for muito grande (evita stall do edge / 413).
  if (file.size > skipMasterThreshold) {
    fd.append("skipMaster", "1")
    fd.append("psdName", file.name)
  } else {
    fd.append("psd", file, file.name)
  }

  let res: Response
  try {
    res = await fetch(`/api/campaigns/${campaignId}/import-psd`, {
      method: "POST",
      body: fd,
    })
  } catch (e: any) {
    return { ok: false, error: `Falha no fetch: ${e?.message ?? e}`, warnings, requiredFonts: build.requiredFonts }
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    return {
      ok: false,
      error: `HTTP ${res.status}: ${txt}`,
      warnings,
      requiredFonts: build.requiredFonts,
    }
  }

  // Thumb preview da matriz pro card da campanha. Sem isso, depois do import
  // o user volta na pagina da campanha e ve placeholder vazio ate abrir/salvar
  // no editor (que gera o thumb via Fabric). Usamos o composite raster que ag-psd
  // ja entregou — eh exatamente o que o Photoshop tinha salvo como preview.
  // NOTA: no escopo desse modulo, `document` eh o PsdDocument local (linha 76).
  // Checa o DOM via globalThis pra nao colidir.
  if (typeof (globalThis as any).document !== "undefined" && document.composite?.data) {
    try {
      await uploadCompositeAsThumb(campaignId, document.composite)
    } catch (e) {
      console.warn("[psd-new] thumb upload falhou (nao fatal):", e)
    }
  }

  const durationMs = Math.round(performance.now() - t0)
  options.onProgress?.(`Import concluido em ${durationMs}ms`)
  return {
    ok: true,
    stats: {
      assets: build.assets.length,
      layers: build.kvLayers.length,
      imageBlobs: build.imageBlobs.length,
      durationMs,
    },
    warnings,
    requiredFonts: build.requiredFonts,
  }
}

/**
 * Sobe o composite raster do PSD como thumb da matriz (Key Vision preview
 * no card da campanha). Browser-only. Mesma logica do legacy
 * PsdImporter:2150-2174, agora isolada num helper reusavel.
 */
async function uploadCompositeAsThumb(
  campaignId: string,
  composite: import("./types").PsdImageData,
): Promise<void> {
  const doc = (globalThis as any).document
  if (!doc) return
  // composite.data eh dataUrl. Decode em HTMLImageElement → canvas.
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    if (composite.format !== "dataUrl" || typeof composite.data !== "string") {
      resolve(null); return
    }
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => resolve(null)
    el.src = composite.data as string
  })
  if (!img) return

  // Redimensiona pra TARGET maior lado = 480 (mesma config do editor / legacy).
  const TARGET = 480
  const sw = img.naturalWidth || composite.width
  const sh = img.naturalHeight || composite.height
  if (!sw || !sh) return
  const scale = Math.min(TARGET / sw, TARGET / sh, 1)
  const tw = Math.max(1, Math.round(sw * scale))
  const th = Math.max(1, Math.round(sh * scale))
  const c = doc.createElement("canvas")
  c.width = tw; c.height = th
  const ctx = c.getContext("2d")
  if (!ctx) return
  // NAO pinta fundo branco — preserva alpha do composite (mesma decisao do legacy).
  ctx.drawImage(img, 0, 0, tw, th)
  const blob = await new Promise<Blob | null>((resolve) =>
    c.toBlob((b: Blob | null) => resolve(b), "image/png"))
  if (!blob) return
  const fd = new FormData()
  fd.append("thumbnail", blob, "kv-thumb.png")
  await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: fd })
}
