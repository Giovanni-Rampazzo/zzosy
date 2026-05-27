// POST /api/campaigns/[id]/regenerate-empty-pieces
//
// Endpoint expresso de recuperacao em massa: regenera TODAS as pieces da
// campanha que tem layers=[] (vazias/corrompidas), usando a matriz atual.
//
// Util quando user precisa restaurar muitas pieces de uma vez e nao quer
// clicar por uma. Idempotent — pieces ja com conteudo sao ignoradas.
//
// User pediu 2026-05-26: "preciso entregar trabalho para cliente, todos
// previews estao verdes". Endpoint atalho pra desbloquear entrega rapida.
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId

  const { id } = await ctx.params
  const campaign = await prisma.campaign.findFirst({
    where: { id, client: { tenantId } },
    include: { keyVision: true, pieces: true },
  })
  if (!campaign) return apiErrors.notFound()
  const kv = campaign.keyVision
  if (!kv?.data) return NextResponse.json({ error: "Campanha sem matriz" }, { status: 400 })

  let kvData: any
  try {
    kvData = typeof kv.data === "string" ? JSON.parse(kv.data) : kv.data
  } catch {
    return NextResponse.json({ error: "KV.data malformado" }, { status: 500 })
  }
  const matrixLayers: any[] = Array.isArray(kvData?.layers) ? kvData.layers : []
  if (matrixLayers.length === 0) {
    return NextResponse.json({ error: "Matriz sem layers" }, { status: 400 })
  }

  const matrixW = kvData?.width ?? 1080
  const matrixH = kvData?.height ?? 1080

  // Detecta empty + reusa logica de scale do /regenerate-from-matrix
  function isPieceEmpty(p: any): boolean {
    try {
      const d = p.data ? JSON.parse(p.data) : null
      if (!d) return true
      const layers = Array.isArray(d.layers) ? d.layers.length : 0
      const stepsHaveLayers = Array.isArray(d.steps) && d.steps.some((s: any) => Array.isArray(s?.layers) && s.layers.length > 0)
      return layers === 0 && !stepsHaveLayers
    } catch { return false }
  }

  function scaleLayerMask(mask: any, scale: number, offsetX: number, offsetY: number): any {
    if (!mask) return mask
    if (mask.type === "vector" && mask.vector) {
      return {
        ...mask,
        vector: {
          ...mask.vector,
          posX: (mask.vector.posX ?? 0) * scale + offsetX,
          posY: (mask.vector.posY ?? 0) * scale + offsetY,
          width: (mask.vector.width ?? 0) * scale,
          height: (mask.vector.height ?? 0) * scale,
        },
      }
    }
    if (mask.type === "raster" && mask.raster) {
      return {
        ...mask,
        raster: {
          ...mask.raster,
          posX: (mask.raster.posX ?? 0) * scale + offsetX,
          posY: (mask.raster.posY ?? 0) * scale + offsetY,
          width: (mask.raster.width ?? 0) * scale,
          height: (mask.raster.height ?? 0) * scale,
        },
      }
    }
    return mask
  }

  function buildLayersForPiece(pieceW: number, pieceH: number): any[] {
    const scale = Math.min(pieceW / matrixW, pieceH / matrixH)
    const scaledW = matrixW * scale, scaledH = matrixH * scale
    const offsetX = (pieceW - scaledW) / 2, offsetY = (pieceH - scaledH) / 2
    return matrixLayers.map((l: any, i: number) => {
      const base: any = {
        assetId: l.assetId,
        posX: Math.round((l.posX ?? 0) * scale + offsetX),
        posY: Math.round((l.posY ?? 0) * scale + offsetY),
        rotation: l.rotation ?? 0, zIndex: i,
      }
      if (l.mask) base.mask = scaleLayerMask(l.mask, scale, offsetX, offsetY)
      if (l.hidden === true) base.hidden = true
      if (l.locked === true) base.locked = true
      if (typeof l.opacity === "number" && l.opacity < 1) base.opacity = l.opacity
      if (typeof l.blendMode === "string" && l.blendMode !== "source-over") base.blendMode = l.blendMode
      if (l.effects) base.effects = l.effects
      if (Array.isArray(l.groupPath) && l.groupPath.length > 0) base.groupPath = l.groupPath
      const ov = l.overrides ?? {}
      const isText = typeof ov.fontSize === "number" || typeof ov.text === "string" || typeof ov.fontFamily === "string"
      if (isText) {
        const newOverrides: any = { ...ov }
        const baseFs = typeof ov.fontSize === "number" ? ov.fontSize : 80
        newOverrides.fontSize = baseFs * scale
        if (typeof ov.leadingPt === "number") newOverrides.leadingPt = ov.leadingPt * scale
        if (ov.styles && typeof ov.styles === "object") {
          const ns: any = {}
          for (const lk of Object.keys(ov.styles)) {
            ns[lk] = {}
            for (const ck of Object.keys(ov.styles[lk])) {
              const cs = { ...ov.styles[lk][ck] }
              if (typeof cs.fontSize === "number") cs.fontSize = cs.fontSize * scale
              ns[lk][ck] = cs
            }
          }
          newOverrides.styles = ns
        }
        return { ...base, scaleX: 1, scaleY: 1, width: Math.round((l.width ?? 400) * scale), height: Math.round((l.height ?? 100) * scale), overrides: newOverrides }
      }
      return { ...base, scaleX: (l.scaleX ?? 1) * scale, scaleY: (l.scaleY ?? 1) * scale, width: l.width ?? 400, height: l.height ?? 100, overrides: { ...ov } }
    })
  }

  const updates: Array<{ id: string; layerCount: number }> = []
  for (const p of campaign.pieces) {
    if (!isPieceEmpty(p)) continue
    let pData: any
    try { pData = p.data ? JSON.parse(p.data) : {} } catch { pData = {} }
    const pieceW = pData?.width ?? matrixW
    const pieceH = pData?.height ?? matrixH
    const newLayers = buildLayersForPiece(pieceW, pieceH)
    const newData = {
      ...pData,
      version: 2,
      width: pieceW,
      height: pieceH,
      bgColor: kvData?.bgColor ?? pData?.bgColor ?? "#ffffff",
      bgOpacity: kvData?.bgOpacity ?? pData?.bgOpacity ?? 1,
      bgLayers: kvData?.bgLayers ?? pData?.bgLayers ?? undefined,
      layers: newLayers,
    }
    if (Array.isArray(newData.steps) && newData.steps.every((s: any) => !Array.isArray(s?.layers) || s.layers.length === 0)) {
      delete newData.steps
      delete newData.activeStepIndex
    }
    await prisma.piece.update({
      where: { id: p.id },
      data: {
        data: JSON.stringify(newData),
        dataBackup: p.data ?? null,
        imageUrl: null,
      },
    })
    updates.push({ id: p.id, layerCount: newLayers.length })
  }

  return NextResponse.json({
    ok: true,
    regeneratedCount: updates.length,
    skippedCount: campaign.pieces.length - updates.length,
    updates,
    message: `${updates.length} peça(s) vazia(s) regenerada(s) da matriz`,
  })
}
