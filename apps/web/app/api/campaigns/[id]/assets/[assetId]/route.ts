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

// Migra overrides.text quando asset.content muda. Preserva a estrutura de
// quebras (\n) em termos de "tokens por linha": pega N tokens da nova asset
// text por linha, onde N e' a quantidade de tokens da linha original. Sobras
// vao pra ultima linha. Robust contra edicoes char-level (palavras mudam mas
// boundaries continuam fazendo sentido).
function migrateOverrideText(oldOverrideText: string, newAssetCleanText: string): string {
  if (!oldOverrideText.includes("\n")) return ""
  const oldLines = oldOverrideText.split("\n")
  const lineTokenCounts = oldLines.map(line =>
    line.trim().split(/\s+/).filter(t => t.length > 0).length
  )
  const newTokens = newAssetCleanText.trim().split(/\s+/).filter(t => t.length > 0)
  if (newTokens.length === 0) return ""
  const newLines: string[] = []
  let cursor = 0
  for (let i = 0; i < lineTokenCounts.length - 1; i++) {
    const take = lineTokenCounts[i]
    const lineTokens = newTokens.slice(cursor, cursor + take)
    cursor += take
    newLines.push(lineTokens.join(" "))
  }
  newLines.push(newTokens.slice(cursor).join(" "))
  // Remove linhas vazias do fim (quando newTokens.length < total esperado)
  while (newLines.length > 1 && newLines[newLines.length - 1] === "") newLines.pop()
  return newLines.join("\n")
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
  // Edge: newText vazio (user apagou tudo pra re-escrever). NÃO migrar
  // overrides.text/styles agora — preservar quebras de linha que o user
  // criou nas peças. Próximo save (quando ele digitar de novo) faz o
  // migrate com o NOVO texto não-vazio. Sem essa guarda, o save
  // intermediário "" zerava o override.text e o save seguinte não
  // achava \n pra migrar.
  const skipMigrate = newText.trim().length === 0

  // Pre-buscar matriz e peças (fora da transação para reduzir tempo de lock)
  const [kv, pieces] = await Promise.all([
    prisma.keyVision.findUnique({ where: { campaignId } }),
    prisma.piece.findMany({ where: { campaignId } }),
  ])

  // Calcular layers atualizados (sem tocar no banco ainda)
  let kvUpdate: any = null
  if (kv && textChanged && !skipMigrate) {
    let kvLayersRaw: any = kv.layers
    let kvLayers: any[] = []
    if (typeof kvLayersRaw === "string") {
      try { kvLayers = JSON.parse(kvLayersRaw) } catch { kvLayers = [] }
    } else if (Array.isArray(kvLayersRaw)) {
      kvLayers = kvLayersRaw
    }
    let kvTouched = false
    const newKvLayers = kvLayers.map((l: any) => {
      if (l?.assetId !== assetId) return l
      const newOverrides = { ...(l.overrides ?? {}) }
      let layerChanged = false
      if (l.overrides?.styles && Object.keys(l.overrides.styles).length > 0) {
        newOverrides.styles = migrateStyles(oldText, newText, l.overrides.styles)
        layerChanged = true
      }
      if (typeof l.overrides?.text === "string" && l.overrides.text.includes("\n")) {
        newOverrides.text = migrateOverrideText(l.overrides.text, newText)
        layerChanged = true
      }
      if (layerChanged) {
        kvTouched = true
        return { ...l, overrides: newOverrides }
      }
      return l
    })
    if (kvTouched) {
      kvUpdate = { layers: JSON.stringify(newKvLayers) }
    }
  }

  const pieceUpdates: Array<{ id: string; data: string }> = []
  if (textChanged && !skipMigrate) {
    for (const p of pieces) {
      let pdata: any = null
      try { pdata = typeof p.data === "string" ? JSON.parse(p.data as string) : p.data } catch {}
      if (!pdata || !Array.isArray(pdata.layers)) continue
      let touched = false
      const newLayers = pdata.layers.map((l: any) => {
        if (l?.assetId !== assetId) return l
        const newOverrides = { ...(l.overrides ?? {}) }
        let layerChanged = false
        if (l.overrides?.styles && Object.keys(l.overrides.styles).length > 0) {
          newOverrides.styles = migrateStyles(oldText, newText, l.overrides.styles)
          layerChanged = true
        }
        if (typeof l.overrides?.text === "string" && l.overrides.text.includes("\n")) {
          newOverrides.text = migrateOverrideText(l.overrides.text, newText)
          layerChanged = true
        }
        if (layerChanged) {
          touched = true
          return { ...l, overrides: newOverrides }
        }
        return l
      })
      if (touched) {
        const newData = { ...pdata, layers: newLayers }
        pieceUpdates.push({ id: p.id, data: JSON.stringify(newData) })
      }
    }
  }

  // Executar tudo numa única transação atômica.
  // NOTA: NAO invalidamos imageUrl das pecas (= null) — antes faziamos isso pra
  // forcar regeneracao, mas a presentation/preview mostrava "(Imagem nao
  // disponivel)" quando o user nao reabria a peca no editor. Preferivel manter
  // o thumb com texto stale ate o user abrir a peca (que regera).
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
