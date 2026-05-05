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

  // Caso 1: NÃO mexeu em texto -> só atualiza o asset (rápido)
  if (!("content" in body) || oldAsset?.type !== "TEXT") {
    const asset = await prisma.campaignAsset.update({ where: { id: assetId }, data })
    return NextResponse.json({ ...asset, content: parseContent(asset.content) })
  }

  // Caso 2: É TEXT e content mudou -> transação atômica que migra TUDO
  // Importante: usar transaction garante que ou atualiza asset+matriz+todas peças,
  // ou nada é alterado (rollback em caso de falha em qualquer step).
  const newContent = data.content
  const newSpansParsed = parseContent(newContent)
  const newText = spansToText(newSpansParsed)
  const textChanged = oldText !== newText

  // Pre-buscar matriz e peças (fora da transação para reduzir tempo de lock)
  const [kv, pieces] = await Promise.all([
    prisma.keyVision.findUnique({ where: { campaignId } }),
    prisma.piece.findMany({ where: { campaignId } }),
  ])

  // Calcular layers atualizados (sem tocar no banco ainda)
  let kvUpdate: any = null
  if (kv && textChanged) {
    let kvLayersRaw: any = kv.layers
    let kvLayers: any[] = []
    if (typeof kvLayersRaw === "string") {
      try { kvLayers = JSON.parse(kvLayersRaw) } catch { kvLayers = [] }
    } else if (Array.isArray(kvLayersRaw)) {
      kvLayers = kvLayersRaw
    }
    let kvTouched = false
    const newKvLayers = kvLayers.map((l: any) => {
      if (l?.assetId === assetId && l.overrides?.styles && Object.keys(l.overrides.styles).length > 0) {
        const migrated = migrateStyles(oldText, newText, l.overrides.styles)
        kvTouched = true
        return { ...l, overrides: { ...l.overrides, styles: migrated } }
      }
      return l
    })
    if (kvTouched) {
      kvUpdate = { layers: JSON.stringify(newKvLayers) }
    }
  }

  const pieceUpdates: Array<{ id: string; data: string }> = []
  if (textChanged) {
    for (const p of pieces) {
      let pdata: any = null
      try { pdata = typeof p.data === "string" ? JSON.parse(p.data as string) : p.data } catch {}
      if (!pdata || !Array.isArray(pdata.layers)) continue
      let touched = false
      const newLayers = pdata.layers.map((l: any) => {
        if (l?.assetId === assetId && l.overrides?.styles && Object.keys(l.overrides.styles).length > 0) {
          const migrated = migrateStyles(oldText, newText, l.overrides.styles)
          touched = true
          return { ...l, overrides: { ...l.overrides, styles: migrated } }
        }
        return l
      })
      if (touched) {
        const newData = { ...pdata, layers: newLayers }
        pieceUpdates.push({ id: p.id, data: JSON.stringify(newData) })
      }
    }
  }

  // Executar tudo numa única transação atômica
  const ops: any[] = [prisma.campaignAsset.update({ where: { id: assetId }, data })]
  if (kvUpdate) ops.push(prisma.keyVision.update({ where: { campaignId }, data: kvUpdate }))
  for (const u of pieceUpdates) {
    ops.push(prisma.piece.update({ where: { id: u.id }, data: { data: u.data } }))
  }

  try {
    const results = await prisma.$transaction(ops)
    const asset = results[0]
    return NextResponse.json({ ...asset, content: parseContent((asset as any).content) })
  } catch (e: any) {
    console.error("[PUT asset] transaction failed, rolled back:", e?.message ?? e)
    return NextResponse.json({ error: "Failed to update asset and propagate styles", detail: String(e?.message ?? e) }, { status: 500 })
  }
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
