// POST/GET /api/campaigns/[id]/repatch-masks
//
// Re-aplica masks do PSD original (campaign.psdUrl) em KV.layers + piece.data.layers
// SEM apagar/recriar assets. Conserta o bug do full-recover-from-psd anterior
// que perdia mask field (toCampaign retorna kvLayers sem mask).
//
// Match: pela ORDEM (zIndex) dos layers do PSD vs KV/piece.
//
// User reportou 2026-05-27: "mascaras se perdendo no editor e preview".
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getStorage } from "@/lib/storage"
import { apiErrors } from "@/lib/apiError"
import { initializeCanvas } from "ag-psd"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 120

let canvasInitialized = false
function ensureCanvasInit() {
  if (canvasInitialized) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCanvas } = require("@napi-rs/canvas")
  initializeCanvas(createCanvas)
  canvasInitialized = true
}

type Ctx = { params: Promise<{ id: string }> }

interface Result {
  ok: true
  kvLayersUpdated: number
  piecesUpdated: number
  masksReapplied: number
}

async function execute(id: string, tenantId: string | null): Promise<Result | { error: string; status: number }> {
  const campaign = await prisma.campaign.findFirst({
    where: { id, ...(tenantId ? { client: { tenantId } } : {}) },
    include: { keyVision: true, pieces: true },
  })
  if (!campaign) return { error: "Campaign not found", status: 404 }
  if (!campaign.psdUrl) return { error: "Sem psdUrl", status: 400 }
  if (!campaign.keyVision?.data) return { error: "Sem KV", status: 400 }

  const storage = getStorage()
  const psdKey = storage.keyFromUrl(campaign.psdUrl)
  if (!psdKey) return { error: "psdUrl invalida", status: 500 }
  const psdBytes = await storage.get(psdKey)
  if (!psdBytes) return { error: "PSD nao encontrado", status: 404 }

  ensureCanvasInit()
  const ab = psdBytes.buffer.slice(psdBytes.byteOffset, psdBytes.byteOffset + psdBytes.byteLength) as ArrayBuffer
  const { readPsdDocument } = await import("@/lib/psd/reader")
  const { buildCampaignFromPsd } = await import("@/lib/psd/toCampaign")
  const { document: doc } = readPsdDocument(ab, { includeImageData: true, includeComposite: true })
  const build = buildCampaignFromPsd(doc)

  // Build ordered list of masks/flags from PSD assets (in zIndex order).
  // build.assets[i] corresponde a build.kvLayers[i] na ordem que foi criado.
  // Mas kvLayers tem zIndex como ordem. Vamos garantir match por zIndex.
  const sortedKvLayers = [...build.kvLayers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

  // Pra cada zIndex (slot K), achar o asset original que produziu esse layer.
  // toCampaign produz pares (asset, layer) em ordem — assets[i] gerou layer com zIndex=i+1 (approx).
  // Match seguro: pela tempId reference do kvLayer.
  const assetByTempId = new Map<string, any>()
  for (const a of build.assets) assetByTempId.set(a.tempId, a)

  // KV layers (com NOVOS assetIds ja resolvidos). Vamos buscar mask por POSICAO
  // (zIndex) — assumimos que ordem da KV atual bate com ordem original do PSD.
  let kvData: any
  try { kvData = JSON.parse(campaign.keyVision.data) } catch {
    return { error: "KV.data malformed", status: 500 }
  }
  const currentKvLayers: any[] = Array.isArray(kvData.layers) ? kvData.layers : []
  const currentSorted = [...currentKvLayers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

  // Mask por slot K
  const masksByZIndex: Map<number, any> = new Map()
  for (let i = 0; i < sortedKvLayers.length; i++) {
    const layerFromBuild = sortedKvLayers[i]
    const asset = assetByTempId.get(layerFromBuild.assetId)
    if (!asset) continue
    const flags: any = {}
    if (asset.mask) flags.mask = asset.mask
    if (asset.hidden === true) flags.hidden = true
    if (asset.locked === true) flags.locked = true
    if (asset.effects && Object.keys(asset.effects).length > 0) flags.effects = asset.effects
    if (asset.pixelsIncludeEffects === true) flags.pixelsIncludeEffects = true
    if (typeof asset.nameSource === "string") flags.nameSource = asset.nameSource
    masksByZIndex.set(i, flags)
  }

  // Aplica em KV
  let masksReapplied = 0
  let kvLayersUpdated = 0
  for (let i = 0; i < currentSorted.length; i++) {
    const flags = masksByZIndex.get(i)
    if (!flags) continue
    const cur = currentSorted[i]
    for (const k of Object.keys(flags)) {
      if (cur[k] !== flags[k]) {
        cur[k] = flags[k]
        if (k === "mask") masksReapplied++
      }
    }
    kvLayersUpdated++
  }
  kvData.layers = currentKvLayers
  await prisma.keyVision.update({
    where: { campaignId: id },
    data: { data: JSON.stringify(kvData), thumbnailUrl: null },
  })

  // Aplica em pieces (mesmo padrão — match por zIndex)
  let piecesUpdated = 0
  for (const p of campaign.pieces) {
    if (!p.data) continue
    let pData: any
    try { pData = JSON.parse(p.data) } catch { continue }
    const layers: any[] = Array.isArray(pData.layers) ? pData.layers : []
    if (layers.length === 0) continue
    const sorted = [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    let modified = false
    for (let i = 0; i < sorted.length; i++) {
      const flags = masksByZIndex.get(i)
      if (!flags) continue
      const layer = sorted[i]
      for (const k of Object.keys(flags)) {
        if (layer[k] !== flags[k]) {
          layer[k] = flags[k]
          modified = true
          if (k === "mask") masksReapplied++
        }
      }
    }
    if (modified) {
      pData.layers = layers
      await prisma.piece.update({
        where: { id: p.id },
        data: { data: JSON.stringify(pData), imageUrl: null },
      })
      piecesUpdated++
    }
  }

  return { ok: true, kvLayersUpdated, piecesUpdated, masksReapplied }
}

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any)?.tenantId
    const { id } = await ctx.params
    const result = await execute(id, tenantId ?? null)
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  } catch (e: any) {
    console.error("[repatch-masks]", e)
    return NextResponse.json({ error: e?.message ?? "Erro", stack: e?.stack?.split("\n").slice(0, 6).join("\n") }, { status: 500 })
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(req.url)}`, req.url))
  const { searchParams } = new URL(req.url)
  if (searchParams.get("confirm") !== "1") {
    return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Repatch masks</title></head><body style="font-family:system-ui;padding:32px;max-width:640px;margin:0 auto">
<h2>🎭 Re-aplicar máscaras do PSD original</h2>
<p>Lê o PSD da campanha e re-aplica as <strong>máscaras (clipping/raster/vector)</strong> nas layers da matriz e das peças geradas. Match por zIndex.</p>
<p>NÃO recria assets nem perde dados — só adiciona o campo <code>mask</code> de volta nas layers.</p>
<p><a href="?confirm=1" style="display:inline-block;background:#F5C400;color:#111;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700">✓ Re-aplicar Máscaras</a></p>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
  const tenantId = (session.user as any)?.tenantId
  try {
    const result = await execute(id, tenantId ?? null)
    if ("error" in result) {
      return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px"><h2>❌ ${result.error}</h2><p><a href="/campaigns/${id}">← Voltar</a></p></body></html>`, { status: result.status, headers: { "Content-Type": "text/html; charset=utf-8" } })
    }
    return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>OK</title><meta http-equiv="refresh" content="3;url=/campaigns/${id}"></head><body style="font-family:system-ui;padding:32px;max-width:640px;margin:0 auto">
<h2>✅ Máscaras re-aplicadas!</h2>
<ul>
  <li><strong>${result.masksReapplied}</strong> máscaras reaplicadas</li>
  <li><strong>${result.kvLayersUpdated}</strong> layers da matriz atualizados</li>
  <li><strong>${result.piecesUpdated}</strong> peças atualizadas</li>
</ul>
<p>Redirecionando…</p>
<p><a href="/campaigns/${id}">→ Ir agora</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  } catch (e: any) {
    const stack = e?.stack?.split("\n").slice(0, 8).join("\n") ?? "no stack"
    return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px;max-width:800px;margin:0 auto">
<h2>❌ Falha</h2><p>${e?.message ?? String(e)}</p>
<pre style="background:#f4f4f4;padding:12px;font-size:11px">${stack}</pre>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
}
