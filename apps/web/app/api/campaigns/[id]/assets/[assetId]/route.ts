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
  // lastOverride: template visual aplicado na matriz. Atualizado quando user
  // edita styles na matriz (applyStyle, text:editing:exited) ou quando salva
  // override por outro caminho. Pecas NAO atualizam isso.
  if ("lastOverride" in body) {
    data.lastOverride = body.lastOverride === null ? null : body.lastOverride
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
  // Pecas a invalidar thumbnail (imageUrl = null) — todas que usam esse asset.
  // Sem isso, lista de pecas mostra thumb stale com texto antigo apos editar /assets.
  const pieceInvalidateThumb: Array<string> = []
  if (textChanged) {
    for (const p of pieces) {
      let pdata: any = null
      try { pdata = typeof p.data === "string" ? JSON.parse(p.data as string) : p.data } catch {}
      if (!pdata) continue
      let touched = false
      let usesAsset = false

      // SINGLE-STEP: layers no topo de pdata
      if (Array.isArray(pdata.layers)) {
        if (pdata.layers.some((l: any) => l?.assetId === assetId)) usesAsset = true
        const newLayers = pdata.layers.map((l: any) => {
          if (l?.assetId === assetId && l.overrides?.styles && Object.keys(l.overrides.styles).length > 0) {
            const migrated = migrateStyles(oldText, newText, l.overrides.styles)
            touched = true
            return { ...l, overrides: { ...l.overrides, styles: migrated } }
          }
          return l
        })
        pdata.layers = newLayers
      }

      // MULTI-STEP: pdata.steps[].layers — itera CADA step e invalida step.imageUrl
      // tambem. Sem isso, peca com 4 steps que usa esse asset continua com thumbs
      // velhos em todos os steps mesmo depois de mudar o texto no asset.
      if (Array.isArray(pdata.steps)) {
        pdata.steps = pdata.steps.map((step: any) => {
          if (!step || !Array.isArray(step.layers)) return step
          if (step.layers.some((l: any) => l?.assetId === assetId)) usesAsset = true
          const newStepLayers = step.layers.map((l: any) => {
            if (l?.assetId === assetId && l.overrides?.styles && Object.keys(l.overrides.styles).length > 0) {
              const migrated = migrateStyles(oldText, newText, l.overrides.styles)
              touched = true
              return { ...l, overrides: { ...l.overrides, styles: migrated } }
            }
            return l
          })
          // Se este step usa o asset, invalida imageUrl/thumbnailUrl do step.
          const stepUsesAsset = step.layers.some((l: any) => l?.assetId === assetId)
          return {
            ...step,
            layers: newStepLayers,
            ...(stepUsesAsset ? { imageUrl: null, thumbnailUrl: null } : {}),
          }
        })
        // Se algum step usa o asset, considera que data mudou (precisa salvar).
        if (pdata.steps.some((s: any) => Array.isArray(s?.layers) && s.layers.some((l: any) => l?.assetId === assetId))) {
          touched = true
        }
      }

      if (usesAsset) pieceInvalidateThumb.push(p.id)
      if (touched) {
        pieceUpdates.push({ id: p.id, data: JSON.stringify(pdata) })
      } else if (usesAsset) {
        // Mesmo sem styles per-char pra migrar, peca usa o asset — precisa
        // invalidar steps[].imageUrl pra forcar regen na proxima abertura.
        if (Array.isArray(pdata.steps)) {
          pdata.steps = pdata.steps.map((step: any) => {
            if (!step || !Array.isArray(step.layers)) return step
            const stepUsesAsset = step.layers.some((l: any) => l?.assetId === assetId)
            return stepUsesAsset ? { ...step, imageUrl: null, thumbnailUrl: null } : step
          })
          pieceUpdates.push({ id: p.id, data: JSON.stringify(pdata) })
        }
      }
    }
  }

  // Executar tudo numa única transação atômica
  const ops: any[] = [prisma.campaignAsset.update({ where: { id: assetId }, data })]
  if (kvUpdate) ops.push(prisma.keyVision.update({ where: { campaignId }, data: kvUpdate }))
  for (const u of pieceUpdates) {
    ops.push(prisma.piece.update({ where: { id: u.id }, data: { data: u.data } }))
  }
  // Invalida thumb (imageUrl = null) das pecas afetadas. So da update se ainda
  // nao foi atualizada por pieceUpdates (pra nao duplicar). Lista de pecas vai
  // mostrar placeholder ate user abrir a peca (que re-gera o thumb).
  const updatedIds = new Set(pieceUpdates.map(u => u.id))
  for (const pid of pieceInvalidateThumb) {
    if (updatedIds.has(pid)) {
      // Ja vai atualizar 'data' — adicionar imageUrl: null junto
      const existing = ops.find((op: any) => op?.args?.where?.id === pid)
      // Simplificacao: faz update separado pra clareza
      ops.push(prisma.piece.update({ where: { id: pid }, data: { imageUrl: null } }))
    } else {
      ops.push(prisma.piece.update({ where: { id: pid }, data: { imageUrl: null } }))
    }
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
  const { id: campaignId, assetId } = await ctx.params

  // Cascade delete: tira o asset E todas as layers (matriz + peças) que o referenciam.
  // Tudo numa transação atômica para evitar layers órfãs.
  const [kv, pieces] = await Promise.all([
    prisma.keyVision.findUnique({ where: { campaignId } }),
    prisma.piece.findMany({ where: { campaignId } }),
  ])

  let kvUpdate: any = null
  if (kv) {
    let kvLayersRaw: any = kv.layers
    let kvLayers: any[] = []
    if (typeof kvLayersRaw === "string") {
      try { kvLayers = JSON.parse(kvLayersRaw) } catch { kvLayers = [] }
    } else if (Array.isArray(kvLayersRaw)) kvLayers = kvLayersRaw
    const filteredKv = kvLayers.filter((l: any) => l?.assetId !== assetId)
    if (filteredKv.length !== kvLayers.length) {
      kvUpdate = { layers: JSON.stringify(filteredKv) }
    }
  }

  const pieceUpdates: Array<{ id: string; data: string }> = []
  for (const p of pieces) {
    let pdata: any = null
    try { pdata = typeof p.data === "string" ? JSON.parse(p.data as string) : p.data } catch {}
    if (!pdata || !Array.isArray(pdata.layers)) continue
    const filtered = pdata.layers.filter((l: any) => l?.assetId !== assetId)
    if (filtered.length !== pdata.layers.length) {
      pieceUpdates.push({ id: p.id, data: JSON.stringify({ ...pdata, layers: filtered }) })
    }
  }

  const ops: any[] = []
  if (kvUpdate) ops.push(prisma.keyVision.update({ where: { campaignId }, data: kvUpdate }))
  for (const u of pieceUpdates) ops.push(prisma.piece.update({ where: { id: u.id }, data: { data: u.data } }))
  ops.push(prisma.campaignAsset.delete({ where: { id: assetId } }))

  try {
    await prisma.$transaction(ops)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("[DELETE asset] cascade failed:", e?.message ?? e)
    return NextResponse.json({ error: "Failed to delete asset", detail: String(e?.message ?? e) }, { status: 500 })
  }
}
