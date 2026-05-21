import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * POST /api/pieces/duplicate
 * body: { ids: string[]; mediaFormatId?: string }
 * Duplica peças. Para cada peça original cria uma nova com:
 *  - mesmo campaignId, data (snapshot do canvas), imageUrl, segment, copy
 *  - mediaFormatId: se passado no body, usa o novo formato (atualiza
 *    piece.data.width/height/dpi); senao mantem o do original
 *  - status sempre "STANDBY" (saimos do fluxo de aprovacao)
 *  - name = "<original> (cópia)" (ou "<original> (cópia N)" se ja existir)
 *  - createdAt novo
 *
 * Quando o formato muda, o thumbnail antigo nao bate com a nova dimensao
 * — descartamos (imageUrl=undefined) pra forçar re-geração no proximo render.
 * Layers ficam nas mesmas coords do original (usuario reposiciona no editor).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === "string") : []
  const newMediaFormatId: string | undefined = typeof body?.mediaFormatId === "string" && body.mediaFormatId ? body.mediaFormatId : undefined
  if (!ids.length) return NextResponse.json({ error: "ids vazio" }, { status: 400 })

  // Se body passou mediaFormatId, busca pra ter width/height/dpi.
  // Audit P1.6: valida que mediaFormat existe E pertence ao tenant (ou eh default).
  let newFormat: { id: string; width: number; height: number; dpi: number } | null = null
  if (newMediaFormatId) {
    const mf = await prisma.mediaFormat.findFirst({
      where: { id: newMediaFormatId, OR: [{ isDefault: true }, { tenantId }] },
    })
    if (!mf) return NextResponse.json({ error: "mediaFormatId nao encontrado" }, { status: 404 })
    newFormat = { id: mf.id, width: mf.width, height: mf.height, dpi: mf.dpi ?? 72 }
  }

  // Audit P1.6: filtra pieces que pertencem ao tenant. O comentario antigo
  // alegava "RLS garantida" mas o where era so id:{in:ids} — qualquer user
  // podia duplicar pecas de outros tenants.
  const originals = await prisma.piece.findMany({
    where: {
      id: { in: ids },
      campaign: { client: { tenantId } },
    },
    include: { campaign: { select: { id: true } } },
  })
  if (!originals.length) return NextResponse.json({ error: "Nenhuma peca encontrada" }, { status: 404 })

  const created = []
  for (const orig of originals) {
    const baseName = orig.name ?? "Peça"
    const baseStripped = baseName.replace(/\s*\(cópia(?:\s+\d+)?\)\s*$/, "")
    const existing = await prisma.piece.count({
      where: { campaignId: orig.campaignId, name: { startsWith: baseStripped } },
    })
    const suffix = existing === 0 ? " (cópia)" : ` (cópia ${existing})`
    const newName = baseStripped + suffix

    // Se trocou formato, atualiza data.width/height/dpi + ESCALA layers
    // proporcionalmente (sem isso, layers ficam fora do canvas novo).
    // piece.data eh LongText (string) no schema — sempre passar JSON.stringified.
    let newData: string | undefined = (typeof orig.data === "string" ? orig.data : undefined)
    let newImageUrl: string | undefined = orig.imageUrl ?? undefined
    if (newFormat && newFormat.id !== orig.mediaFormatId) {
      try {
        const parsed = typeof orig.data === "string" ? JSON.parse(orig.data) : (orig.data ?? {})
        const oldW = typeof parsed?.width === "number" && parsed.width > 0 ? parsed.width : null
        const oldH = typeof parsed?.height === "number" && parsed.height > 0 ? parsed.height : null
        const merged = { ...parsed, width: newFormat.width, height: newFormat.height, dpi: newFormat.dpi }
        if (oldW && oldH) {
          // Escala uniforme (preserva proporção, sem distorcer textos) +
          // centraliza pra usar área util do novo canvas.
          const ratio = Math.min(newFormat.width / oldW, newFormat.height / oldH)
          const offX = (newFormat.width - oldW * ratio) / 2
          const offY = (newFormat.height - oldH * ratio) / 2
          const scaleLayer = (l: any) => {
            if (!l || typeof l !== "object") return l
            const out = { ...l }
            if (typeof out.posX === "number") out.posX = Math.round(out.posX * ratio + offX)
            if (typeof out.posY === "number") out.posY = Math.round(out.posY * ratio + offY)
            if (typeof out.width === "number") out.width = Math.round(out.width * ratio)
            if (typeof out.height === "number") out.height = Math.round(out.height * ratio)
            if (typeof out.scaleX === "number") out.scaleX = out.scaleX * ratio
            if (typeof out.scaleY === "number") out.scaleY = out.scaleY * ratio
            // Override fontSize/leadingPt/styles tambem escalam (texto preserva
            // proporção visual contra o canvas)
            if (out.overrides && typeof out.overrides === "object") {
              const ov = { ...out.overrides }
              if (typeof ov.fontSize === "number") ov.fontSize = Math.round(ov.fontSize * ratio)
              if (typeof ov.width === "number") ov.width = Math.round(ov.width * ratio)
              if (typeof ov.height === "number") ov.height = Math.round(ov.height * ratio)
              if (typeof ov.leadingPt === "number") ov.leadingPt = ov.leadingPt * ratio
              if (ov.styles && typeof ov.styles === "object") {
                const newStyles: any = {}
                for (const lineKey of Object.keys(ov.styles)) {
                  newStyles[lineKey] = {}
                  for (const colKey of Object.keys(ov.styles[lineKey])) {
                    const cs = { ...ov.styles[lineKey][colKey] }
                    if (typeof cs.fontSize === "number") cs.fontSize = Math.round(cs.fontSize * ratio)
                    newStyles[lineKey][colKey] = cs
                  }
                }
                ov.styles = newStyles
              }
              out.overrides = ov
            }
            return out
          }
          if (Array.isArray(merged.layers)) merged.layers = merged.layers.map(scaleLayer)
          if (Array.isArray(merged.steps)) {
            merged.steps = merged.steps.map((s: any) => ({
              ...s,
              layers: Array.isArray(s?.layers) ? s.layers.map(scaleLayer) : s?.layers,
            }))
          }
        }
        newData = JSON.stringify(merged)
      } catch {
        newData = JSON.stringify({ width: newFormat.width, height: newFormat.height, dpi: newFormat.dpi })
      }
      newImageUrl = undefined
    }

    const newPiece = await prisma.piece.create({
      data: {
        campaignId: orig.campaignId,
        mediaFormatId: newFormat?.id ?? orig.mediaFormatId,
        name: newName,
        status: "STANDBY",
        data: newData,
        imageUrl: newImageUrl,
        segment: orig.segment ?? undefined,
        copy: orig.copy ?? undefined,
      },
    })
    created.push(newPiece)
  }

  return NextResponse.json({ ok: true, count: created.length, pieces: created })
}
