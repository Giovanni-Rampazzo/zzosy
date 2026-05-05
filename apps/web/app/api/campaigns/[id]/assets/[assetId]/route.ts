import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { migrateStyles } from "@/lib/migrateStyles"

type Ctx = { params: Promise<{ id: string; assetId: string }> }

function parseContent(raw: any): any[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

function spansToText(spans: any[]): string {
  return Array.isArray(spans) ? spans.map(s => s?.text ?? "").join("") : ""
}

export async function PUT(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id: campaignId, assetId } = await ctx.params
  const body = await req.json()

  // Pegar asset atual ANTES de atualizar (para diff de texto)
  const oldAsset = await prisma.campaignAsset.findUnique({ where: { id: assetId } })
  const oldText = spansToText(parseContent(oldAsset?.content))

  const data: any = {}
  for (const k of ["imageUrl", "label", "order", "visible", "value"]) {
    if (k in body) data[k] = body[k]
  }
  if ("content" in body) {
    const c = body.content
    data.content = typeof c === "string" ? c : JSON.stringify(c)
  }

  const asset = await prisma.campaignAsset.update({ where: { id: assetId }, data })
  const newText = spansToText(parseContent(asset.content))

  // Se texto mudou e for asset de TEXT, propagar migração de styles
  // para todos os layers (matriz e peças) que usam esse assetId.
  if (asset.type === "TEXT" && oldText !== newText) {
    try {
      // 1) MATRIZ (keyVision.layers)
      const kv = await prisma.keyVision.findUnique({ where: { campaignId } })
      if (kv && Array.isArray(kv.layers)) {
        const layers: any[] = (kv.layers as any[]).map((l: any) => {
          if (l?.assetId === assetId && l.overrides?.styles) {
            const migrated = migrateStyles(oldText, newText, l.overrides.styles)
            return { ...l, overrides: { ...l.overrides, styles: migrated } }
          }
          return l
        })
        await prisma.keyVision.update({ where: { campaignId }, data: { layers } })
      }

      // 2) PEÇAS (piece.data.layers)
      const pieces = await prisma.piece.findMany({ where: { campaignId } })
      for (const p of pieces) {
        let pdata: any = null
        try { pdata = typeof p.data === "string" ? JSON.parse(p.data as string) : p.data } catch {}
        if (!pdata || !Array.isArray(pdata.layers)) continue
        let touched = false
        const newLayers = pdata.layers.map((l: any) => {
          if (l?.assetId === assetId && l.overrides?.styles) {
            const migrated = migrateStyles(oldText, newText, l.overrides.styles)
            touched = true
            return { ...l, overrides: { ...l.overrides, styles: migrated } }
          }
          return l
        })
        if (touched) {
          const newData = { ...pdata, layers: newLayers }
          await prisma.piece.update({
            where: { id: p.id },
            data: { data: JSON.stringify(newData) }
          })
        }
      }
    } catch (e) {
      console.warn("[migrate-styles] propagation failed:", e)
    }
  }

  return NextResponse.json({
    ...asset,
    content: parseContent(asset.content)
  })
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { assetId } = await ctx.params
  const body = await req.json()
  const asset = await prisma.campaignAsset.update({ where: { id: assetId }, data: body })
  return NextResponse.json(asset)
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { assetId } = await ctx.params
  await prisma.campaignAsset.delete({ where: { id: assetId } })
  return NextResponse.json({ ok: true })
}
