// POST /api/pieces/[id]/regenerate-from-matrix
//
// Regenera os LAYERS de uma peca a partir do estado atual da matriz (KeyVision)
// da mesma campanha. Util quando piece.data foi corrompido (e.g. salvo com
// layers=[] por bug) e o user quer recuperar sem deletar+recriar (que perderia
// metadata: name, segment, copy, status, mediaFormat).
//
// Mantem: piece.id, name, segment, copy, status, mediaFormatId, createdAt
// Substitui: piece.data.layers (com scale para o formato da peca)
// Preserva: bgLayers, bgColor, width, height, dpi do piece.data atual
//
// Logica de scale espelha GeneratePiecesModal: o menor lado da peca define
// o scale uniforme. TEXT consolida no fontSize (scaleX/Y=1). IMAGE/SHAPE
// mantem scaleX/Y multiplicado pelo scale.
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId

  const { id } = await ctx.params
  const piece = await prisma.piece.findFirst({
    where: { id, campaign: { client: { tenantId } } },
    include: { campaign: { include: { keyVision: true } } },
  })
  if (!piece) return apiErrors.notFound()
  const kv = piece.campaign?.keyVision
  if (!kv?.data) return NextResponse.json({ error: "Campanha sem matriz (KV)" }, { status: 400 })

  let kvData: any
  try {
    kvData = typeof kv.data === "string" ? JSON.parse(kv.data) : kv.data
  } catch {
    return NextResponse.json({ error: "KV.data malformado" }, { status: 500 })
  }
  let pData: any
  try {
    pData = piece.data ? (typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data) : {}
  } catch {
    pData = {}
  }

  const matrixLayers: any[] = Array.isArray(kvData?.layers) ? kvData.layers : []
  if (matrixLayers.length === 0) {
    return NextResponse.json({ error: "Matriz sem layers" }, { status: 400 })
  }

  const matrixW = kvData?.width ?? 1080
  const matrixH = kvData?.height ?? 1080
  const pieceW = pData?.width ?? matrixW
  const pieceH = pData?.height ?? matrixH

  // Scale uniforme baseado no menor lado — mesma logica do GeneratePiecesModal.
  const scale = Math.min(pieceW / matrixW, pieceH / matrixH)
  const scaledW = matrixW * scale
  const scaledH = matrixH * scale
  // Offset pra centrar matriz no canvas da peca (se aspect ratio difere).
  const offsetX = (pieceW - scaledW) / 2
  const offsetY = (pieceH - scaledH) / 2

  function scaleLayerMask(mask: any): any {
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

  const newLayers = matrixLayers.map((l: any, i: number) => {
    const base: any = {
      assetId: l.assetId,
      posX: Math.round((l.posX ?? 0) * scale + offsetX),
      posY: Math.round((l.posY ?? 0) * scale + offsetY),
      rotation: l.rotation ?? 0,
      zIndex: i,
    }
    if (l.mask) base.mask = scaleLayerMask(l.mask)
    if (l.hidden === true) base.hidden = true
    if (l.locked === true) base.locked = true
    if (typeof l.opacity === "number" && l.opacity < 1) base.opacity = l.opacity
    if (typeof l.blendMode === "string" && l.blendMode !== "source-over") base.blendMode = l.blendMode
    if (l.effects && typeof l.effects === "object") base.effects = l.effects
    if (Array.isArray(l.groupPath) && l.groupPath.length > 0) base.groupPath = l.groupPath

    const ov = l.overrides ?? {}
    // Detecta TEXT: presenca de fontSize ou text content sao bom sinal.
    const isTextLayer = typeof ov.fontSize === "number" || typeof ov.text === "string" ||
                         typeof ov.fontFamily === "string"

    if (isTextLayer) {
      const baseFontSize = typeof ov.fontSize === "number" ? ov.fontSize : 80
      const newOverrides: any = { ...ov }
      newOverrides.fontSize = baseFontSize * scale
      if (typeof ov.leadingPt === "number") newOverrides.leadingPt = ov.leadingPt * scale
      if (ov.styles && typeof ov.styles === "object") {
        const newStyles: any = {}
        for (const lk of Object.keys(ov.styles)) {
          newStyles[lk] = {}
          for (const ck of Object.keys(ov.styles[lk])) {
            const cs = { ...ov.styles[lk][ck] }
            if (typeof cs.fontSize === "number") cs.fontSize = cs.fontSize * scale
            newStyles[lk][ck] = cs
          }
        }
        newOverrides.styles = newStyles
      }
      return {
        ...base,
        scaleX: 1,
        scaleY: 1,
        width: Math.round((l.width ?? 400) * scale),
        height: Math.round((l.height ?? 100) * scale),
        overrides: newOverrides,
      }
    }

    // IMAGE / SHAPE / other: scale fica em scaleX/Y
    return {
      ...base,
      scaleX: (l.scaleX ?? 1) * scale,
      scaleY: (l.scaleY ?? 1) * scale,
      width: l.width ?? 400,
      height: l.height ?? 100,
      overrides: { ...ov },
    }
  })

  const newData: any = {
    ...pData,
    version: 2,
    width: pieceW,
    height: pieceH,
    bgColor: kvData?.bgColor ?? pData?.bgColor ?? "#ffffff",
    bgOpacity: kvData?.bgOpacity ?? pData?.bgOpacity ?? 1,
    bgLayers: kvData?.bgLayers ?? pData?.bgLayers ?? undefined,
    layers: newLayers,
  }
  // Limpa steps se peca vazia tinha steps vazios — proxima abertura no editor
  // detecta single-step e nao mostra a Step navigation.
  if (Array.isArray(newData.steps) && newData.steps.every((s: any) => !Array.isArray(s?.layers) || s.layers.length === 0)) {
    delete newData.steps
    delete newData.activeStepIndex
  }

  await prisma.piece.update({
    where: { id },
    data: { data: JSON.stringify(newData), imageUrl: null },  // imageUrl=null força regen do thumb
  })

  return NextResponse.json({
    ok: true,
    pieceId: id,
    layerCount: newLayers.length,
    message: `Peca regenerada com ${newLayers.length} layers da matriz`,
  })
}
