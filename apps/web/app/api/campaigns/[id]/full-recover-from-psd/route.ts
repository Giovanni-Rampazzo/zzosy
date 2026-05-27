// POST/GET /api/campaigns/[id]/full-recover-from-psd
//
// Recovery server-side: re-processa o PSD original (campaign.psdUrl) pra
// recriar TODOS os assets perdidos + reconstruir KV. Logic INLINE em
// executeFullRecover — GET handler chama direto (sem self-fetch que estava
// falhando 'fetch failed' em runtime Next).
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getStorage } from "@/lib/storage"
import { randomUUID } from "crypto"
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

interface RecoverResult {
  ok: true
  campaignId: string
  assetsCreated: number
  kvLayersCreated: number
  imageBlobsUploaded: number
  smartObjectsCreated: number
  message: string
}

async function executeFullRecover(id: string, tenantId: string | null): Promise<RecoverResult | { error: string; status: number }> {
  const campaign = await prisma.campaign.findFirst({
    where: { id, ...(tenantId ? { client: { tenantId } } : {}) },
  })
  if (!campaign) return { error: "Campaign not found", status: 404 }
  if (!campaign.psdUrl) return { error: "Campanha sem psdUrl — nada pra restaurar.", status: 400 }

  const storage = getStorage()
  const psdKey = storage.keyFromUrl(campaign.psdUrl)
  if (!psdKey) return { error: "psdUrl invalida — nao consegui derivar key do storage.", status: 500 }
  const psdBytes = await storage.get(psdKey)
  if (!psdBytes) return { error: "PSD nao encontrado no storage.", status: 404 }

  ensureCanvasInit()
  const ab = psdBytes.buffer.slice(psdBytes.byteOffset, psdBytes.byteOffset + psdBytes.byteLength) as ArrayBuffer
  const { readPsdDocument } = await import("@/lib/psd/reader")
  const { buildCampaignFromPsd } = await import("@/lib/psd/toCampaign")
  const { document: doc } = readPsdDocument(ab, { includeImageData: true, includeComposite: true })
  const build = buildCampaignFromPsd(doc)

  const imageUrls: string[] = []
  for (let i = 0; i < build.imageBlobs.length; i++) {
    const blob = build.imageBlobs[i]
    const buf = Buffer.from(await blob.arrayBuffer())
    const key = `campaigns/${id}/layer-recovery-${randomUUID()}.png`
    const put = await storage.put(key, buf, "image/png")
    imageUrls.push(put.url)
  }
  const smartObjectIds: (string | null)[] = []
  await prisma.smartObjectFile.deleteMany({ where: { campaignId: id } })
  for (let i = 0; i < build.linkedBlobs.length; i++) {
    const blob = build.linkedBlobs[i]
    const meta = build.linkedMeta[i]
    if (!meta) { smartObjectIds.push(null); continue }
    try {
      const buf = Buffer.from(await blob.arrayBuffer())
      const ext =
        meta.mime === "image/svg+xml" ? "svg" :
        meta.mime === "application/pdf" ? "pdf" :
        meta.mime === "image/vnd.adobe.photoshop" ? "psd" :
        meta.mime === "image/png" ? "png" :
        meta.mime === "image/jpeg" ? "jpg" : "bin"
      const soKey = `campaigns/${id}/smart/${meta.guid}.${ext}`
      const soPut = await storage.put(soKey, buf, meta.mime)
      const so = await prisma.smartObjectFile.create({
        data: {
          campaignId: id, guid: meta.guid, filePath: soPut.url, mime: meta.mime,
          originalName: meta.originalName, sizeBytes: meta.sizeBytes,
          width: meta.width ?? null, height: meta.height ?? null,
        },
      })
      smartObjectIds.push(so.id)
    } catch (e) {
      console.warn("[full-recover] smart object falhou:", e)
      smartObjectIds.push(null)
    }
  }

  await prisma.campaignAsset.deleteMany({ where: { campaignId: id } })
  const tempIdToNewId = new Map<string, string>()
  for (let i = 0; i < build.assets.length; i++) {
    const a = build.assets[i]
    const imageUrl = a.type === "IMAGE" && typeof a.imageIndex === "number" ? imageUrls[a.imageIndex] ?? null : null
    const smartObjectId = a.type === "IMAGE" && typeof a.linkedIndex === "number" ? smartObjectIds[a.linkedIndex] ?? null : null
    let contentToStore: any = a.content
    if (a.type === "SHAPE" && a.shape) contentToStore = a.shape
    const record = await prisma.campaignAsset.create({
      data: {
        campaignId: id, label: a.label, type: a.type,
        content: contentToStore ? JSON.stringify(contentToStore) : null,
        imageUrl, smartObjectId, order: i,
        posX: 0, posY: 0, width: 400,
        visible: true, scaleX: 1, scaleY: 1, rotation: 0,
        lastOverride: (a.lastOverride ?? undefined) as any,
      },
    })
    tempIdToNewId.set(a.tempId, record.id)
  }

  const kvLayers = build.kvLayers
    .map(l => {
      const newId = tempIdToNewId.get(l.assetId)
      if (!newId) return null
      return { ...l, assetId: newId }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  const kvData = {
    version: 2,
    width: build.width,
    height: build.height,
    bgColor: build.bgColor,
    layers: kvLayers,
  }
  await prisma.keyVision.upsert({
    where: { campaignId: id },
    create: { campaignId: id, data: JSON.stringify(kvData) },
    update: { data: JSON.stringify(kvData), thumbnailUrl: null },
  })

  return {
    ok: true,
    campaignId: id,
    assetsCreated: build.assets.length,
    kvLayersCreated: kvLayers.length,
    imageBlobsUploaded: build.imageBlobs.length,
    smartObjectsCreated: smartObjectIds.filter(Boolean).length,
    message: "Matriz restaurada! Agora gera peças manualmente via + Gerar peça.",
  }
}

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any)?.tenantId
    const { id } = await ctx.params
    const result = await executeFullRecover(id, tenantId ?? null)
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result)
  } catch (e: any) {
    console.error("[full-recover POST]", e)
    return NextResponse.json({
      error: e?.message ?? "Erro",
      stack: e?.stack?.split("\n").slice(0, 6).join("\n"),
    }, { status: 500 })
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(req.url)}`, req.url))
  }
  const { searchParams } = new URL(req.url)
  if (searchParams.get("confirm") !== "1") {
    return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Confirmar recovery completa</title></head><body style="font-family:system-ui;padding:32px;max-width:640px;margin:0 auto">
<h2>⚠️ Recovery COMPLETA da matriz</h2>
<p>Esta ação vai:</p>
<ul>
  <li>Re-processar o PSD original da campanha (já no storage)</li>
  <li>Apagar assets atuais (que estão órfãos)</li>
  <li>Recriar todos os assets + matriz (KV)</li>
  <li>Peças <strong>não</strong> são re-vinculadas — você re-gera depois via "+ Gerar peça"</li>
</ul>
<p><a href="?confirm=1" style="display:inline-block;background:#F5C400;color:#111;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">✓ Executar Recovery</a></p>
<p><a href="/campaigns/${id}">← Voltar sem fazer nada</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }

  // Chama executeFullRecover DIRETO — sem self-fetch que estava falhando.
  const tenantId = (session.user as any)?.tenantId
  try {
    const result = await executeFullRecover(id, tenantId ?? null)
    if ("error" in result) {
      return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px;max-width:800px;margin:0 auto">
<h2>❌ Erro na recovery</h2>
<p><strong>${result.error}</strong></p>
<p>HTTP ${result.status}</p>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { status: result.status, headers: { "Content-Type": "text/html; charset=utf-8" } })
    }
    return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recovery OK</title><meta http-equiv="refresh" content="3;url=/campaigns/${id}"></head><body style="font-family:system-ui;padding:32px;max-width:640px;margin:0 auto">
<h2>✅ Matriz recuperada!</h2>
<ul>
  <li><strong>${result.assetsCreated}</strong> assets recriados</li>
  <li><strong>${result.kvLayersCreated}</strong> layers da matriz</li>
  <li><strong>${result.imageBlobsUploaded}</strong> imagens upload</li>
  <li><strong>${result.smartObjectsCreated}</strong> smart objects</li>
</ul>
<p style="background:#FFF3CD;border:1px solid #FFE69C;padding:12px;border-radius:6px">
<strong>Próximo passo:</strong> ${result.message}
</p>
<p>Redirecionando pra campanha em 3 segundos…</p>
<p><a href="/campaigns/${id}">→ Ir agora</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  } catch (e: any) {
    console.error("[full-recover GET]", e)
    const stack = e?.stack?.split("\n").slice(0, 8).join("\n") ?? "no stack"
    return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px;max-width:800px;margin:0 auto">
<h2>❌ Falha interna</h2>
<p><strong>${e?.name ?? "Error"}:</strong> ${e?.message ?? String(e)}</p>
<details open><summary>Stack trace</summary>
<pre style="background:#f4f4f4;padding:12px;font-size:11px;overflow:auto">${stack}</pre>
</details>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
}
