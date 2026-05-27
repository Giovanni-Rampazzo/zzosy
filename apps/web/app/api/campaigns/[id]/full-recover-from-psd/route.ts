// POST /api/campaigns/[id]/full-recover-from-psd
//
// Recovery server-side: re-processa o PSD original da campanha
// (campaign.psdUrl) pra recriar TODOS os assets perdidos + reconstruir KV.
// Idempotent — se assets ja batem com o PSD, vira no-op visual.
//
// User reportou 2026-05-27: 23 pieces vazias (verdes) porque assets foram
// hard-deleted. campaign.psdUrl ainda esta intacto. Esse endpoint re-roda
// import_psd 100% server-side via ag-psd + buildCampaignFromPsd.
//
// Trade-off: PIECES NAO sao re-vinculadas automaticamente — orphans
// continuam orfaos. User re-gera pieces manualmente via "+ Gerar peca"
// depois da matriz voltar. Recovery limitada a campanha + KV.
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

// Inicializa canvas adapter UMA vez por module load (cold-start).
// ag-psd precisa pra parse blob raster dos layers.
let canvasInitialized = false
function ensureCanvasInit() {
  if (canvasInitialized) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCanvas } = require("@napi-rs/canvas")
  initializeCanvas(createCanvas)
  canvasInitialized = true
}

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any)?.tenantId

    const { id } = await ctx.params
    const campaign = await prisma.campaign.findFirst({
      where: { id, ...(tenantId ? { client: { tenantId } } : {}) },
    })
    if (!campaign) return apiErrors.notFound()
    if (!campaign.psdUrl) {
      return NextResponse.json({ error: "Campanha sem psdUrl — nada pra restaurar." }, { status: 400 })
    }

    // Baixa PSD bytes do storage.
    const storage = getStorage()
    const psdKey = storage.keyFromUrl(campaign.psdUrl)
    if (!psdKey) {
      return NextResponse.json({ error: "psdUrl invalida — nao consegui derivar key do storage." }, { status: 500 })
    }
    const psdBytes = await storage.get(psdKey)
    if (!psdBytes) {
      return NextResponse.json({ error: "PSD nao encontrado no storage." }, { status: 404 })
    }

    // Parse PSD + build campaign model
    ensureCanvasInit()
    const ab = psdBytes.buffer.slice(psdBytes.byteOffset, psdBytes.byteOffset + psdBytes.byteLength) as ArrayBuffer
    const { readPsdDocument } = await import("@/lib/psd/reader")
    const { buildCampaignFromPsd } = await import("@/lib/psd/toCampaign")
    const { document } = readPsdDocument(ab, { includeImageData: true, includeComposite: true })
    const build = buildCampaignFromPsd(document)

    // Upload imageBlobs e linkedBlobs pro storage.
    const imageUrls: string[] = []
    for (let i = 0; i < build.imageBlobs.length; i++) {
      const blob = build.imageBlobs[i]
      const buf = Buffer.from(await blob.arrayBuffer())
      const key = `campaigns/${id}/layer-recovery-${randomUUID()}.png`
      const put = await storage.put(key, buf, "image/png")
      imageUrls.push(put.url)
    }
    // SmartObject linked files
    const smartObjectIds: (string | null)[] = []
    // Apaga SOs antigos
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
            campaignId: id,
            guid: meta.guid,
            filePath: soPut.url,
            mime: meta.mime,
            originalName: meta.originalName,
            sizeBytes: meta.sizeBytes,
            width: meta.width ?? null,
            height: meta.height ?? null,
          },
        })
        smartObjectIds.push(so.id)
      } catch (e) {
        console.warn("[full-recover] falha smart object:", e)
        smartObjectIds.push(null)
      }
    }

    // Apaga assets antigos
    await prisma.campaignAsset.deleteMany({ where: { campaignId: id } })

    // Cria novos assets baseado no build
    const tempIdToNewId = new Map<string, string>()
    for (let i = 0; i < build.assets.length; i++) {
      const a = build.assets[i]
      const imageUrl = a.type === "IMAGE" && typeof a.imageIndex === "number"
        ? imageUrls[a.imageIndex] ?? null : null
      const smartObjectId = a.type === "IMAGE" && typeof a.linkedIndex === "number"
        ? smartObjectIds[a.linkedIndex] ?? null : null
      let contentToStore: any = a.content
      if (a.type === "SHAPE" && a.shape) contentToStore = a.shape

      const record = await prisma.campaignAsset.create({
        data: {
          campaignId: id,
          label: a.label,
          type: a.type,
          content: contentToStore ? JSON.stringify(contentToStore) : null,
          imageUrl,
          smartObjectId,
          order: i,
          posX: 0, posY: 0, width: 400,
          visible: true, scaleX: 1, scaleY: 1, rotation: 0,
          lastOverride: (a.lastOverride ?? undefined) as any,
        },
      })
      tempIdToNewId.set(a.tempId, record.id)
    }

    // Constroi KV layers com novos assetIds.
    const kvLayers = build.kvLayers.map(l => {
      const newId = tempIdToNewId.get(l.assetId)
      if (!newId) return null
      return {
        ...l,
        assetId: newId,
      }
    }).filter(Boolean)

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

    return NextResponse.json({
      ok: true,
      campaignId: id,
      assetsCreated: build.assets.length,
      kvLayersCreated: kvLayers.length,
      imageBlobsUploaded: build.imageBlobs.length,
      smartObjectsCreated: smartObjectIds.filter(Boolean).length,
      message: "Matriz restaurada! Agora gera peças manualmente via + Gerar peça.",
    })
  } catch (e: any) {
    console.error("[full-recover-from-psd]", e)
    return NextResponse.json({
      error: e?.message ?? "Erro interno",
      stack: e?.stack?.split("\n").slice(0, 5).join("\n"),
    }, { status: 500 })
  }
}

// GET — HTML page que dispara o POST. Permite user clicar URL.
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

  // Dispara POST internamente via mesma session
  const cookie = req.headers.get("cookie") ?? ""
  const origin = new URL(req.url).origin
  try {
    const r = await fetch(`${origin}/api/campaigns/${id}/full-recover-from-psd`, {
      method: "POST",
      headers: { "Cookie": cookie },
      cache: "no-store",
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px;max-width:800px;margin:0 auto">
<h2>❌ Erro na recovery</h2>
<p><strong>${body?.error ?? "erro"}</strong></p>
<pre style="background:#f4f4f4;padding:12px;font-size:11px;overflow:auto">${body?.stack ?? ""}</pre>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { status: r.status, headers: { "Content-Type": "text/html; charset=utf-8" } })
    }
    return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recovery OK</title><meta http-equiv="refresh" content="3;url=/campaigns/${id}"></head><body style="font-family:system-ui;padding:32px;max-width:640px;margin:0 auto">
<h2>✅ Matriz recuperada!</h2>
<ul>
  <li><strong>${body.assetsCreated}</strong> assets recriados</li>
  <li><strong>${body.kvLayersCreated}</strong> layers da matriz</li>
  <li><strong>${body.imageBlobsUploaded}</strong> imagens upload</li>
  <li><strong>${body.smartObjectsCreated}</strong> smart objects</li>
</ul>
<p style="background:#FFF3CD;border:1px solid #FFE69C;padding:12px;border-radius:6px">
<strong>Próximo passo:</strong> ${body.message}
</p>
<p>Redirecionando pra campanha em 3 segundos…</p>
<p><a href="/campaigns/${id}">→ Ir agora</a></p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  } catch (e: any) {
    return new NextResponse(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:32px">
<h2>❌ Falha</h2><pre>${String(e?.message ?? e)}</pre>
<p><a href="/campaigns/${id}">← Voltar</a></p>
</body></html>`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
}
