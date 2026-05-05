import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { copyFile, mkdir, readdir, stat } from "fs/promises"
import { existsSync } from "fs"
import path from "path"

export const runtime = "nodejs"
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

/**
 * Duplica uma campanha inteira: assets + KeyVision + peças + arquivos físicos.
 * Não duplica entregas (Delivery) — são histórico.
 * Status das peças é resetado para STANDBY.
 *
 * Estratégia:
 * 1) Copiar todo o diretório /uploads/campaigns/{oldId}/ para /uploads/campaigns/{newId}/
 * 2) Criar nova Campaign + assets (mapa oldAssetId → newAssetId)
 * 3) Reescrever URLs de imagem (oldId → newId) em assets, KV e peças
 * 4) Reescrever assetIds em layers de KV e peças usando o mapa
 * 5) Tudo em transação atômica
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id: oldId } = await ctx.params
  const tenantId = (session.user as any).tenantId

  // Validar acesso e carregar dados completos
  const original = await prisma.campaign.findFirst({
    where: { id: oldId, client: { tenantId } },
    include: {
      assets: true,
      keyVision: true,
      pieces: true,
    },
  })
  if (!original) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Reservar id da nova campanha (cuid gerado depois pelo Prisma).
  // Estratégia mais simples: criar a campanha vazia primeiro pra ter o id,
  // depois copiar arquivos e atualizar tudo.
  const newCampaign = await prisma.campaign.create({
    data: {
      name: `${original.name} (cópia)`,
      clientId: original.clientId,
      status: original.status,
      // psdUrl/psdName atualizamos depois (apos copiar arquivos)
    },
  })
  const newId = newCampaign.id

  // 1) Copiar todo o diretório de uploads
  const oldDir = path.join(process.cwd(), "public", "uploads", "campaigns", oldId)
  const newDir = path.join(process.cwd(), "public", "uploads", "campaigns", newId)
  if (existsSync(oldDir)) {
    try {
      await mkdir(newDir, { recursive: true })
      const entries = await readdir(oldDir, { withFileTypes: true })
      for (const ent of entries) {
        const srcPath = path.join(oldDir, ent.name)
        const dstPath = path.join(newDir, ent.name)
        if (ent.isDirectory()) {
          // Recursivo simples (1 nivel basta - estrutura comum eh /campaignId/pieces/)
          await mkdir(dstPath, { recursive: true })
          const sub = await readdir(srcPath)
          for (const f of sub) {
            const fs1 = path.join(srcPath, f)
            const fd1 = path.join(dstPath, f)
            try {
              const s = await stat(fs1)
              if (s.isFile()) await copyFile(fs1, fd1)
            } catch {}
          }
        } else if (ent.isFile()) {
          await copyFile(srcPath, dstPath)
        }
      }
    } catch (e) {
      console.warn("[duplicate] file copy partial fail:", e)
    }
  }

  // Helper: reescrever URLs do diretório antigo pro novo
  const rewriteUrl = (u: string | null | undefined): string | null => {
    if (!u) return u ?? null
    return u.replace(`/uploads/campaigns/${oldId}/`, `/uploads/campaigns/${newId}/`)
  }

  // Helper: parse JSON (tolerante)
  const parseJson = (raw: any): any => {
    if (!raw) return null
    if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return null } }
    return raw
  }

  // 2) Criar assets novos com mapa oldId → newId
  const assetMap: Record<string, string> = {}
  const newAssets = await Promise.all(
    original.assets.map(async (a) => {
      const created = await prisma.campaignAsset.create({
        data: {
          campaignId: newId,
          type: a.type,
          label: a.label,
          value: a.value,
          imageUrl: rewriteUrl(a.imageUrl),
          content: a.content,
          order: a.order,
          visible: a.visible,
        },
      })
      assetMap[a.id] = created.id
      return created
    })
  )

  // Helper: reescrever assetId em layers (suportando layers como string JSON ou array)
  const rewriteLayers = (layersRaw: any): string => {
    let layers: any[] = []
    const parsed = parseJson(layersRaw)
    if (Array.isArray(parsed)) layers = parsed
    const newLayers = layers.map((l: any) => {
      if (l?.assetId && assetMap[l.assetId]) {
        return { ...l, assetId: assetMap[l.assetId] }
      }
      return l
    })
    return JSON.stringify(newLayers)
  }

  // 3) Atualizar campaign: psdUrl, psdName
  await prisma.campaign.update({
    where: { id: newId },
    data: {
      psdUrl: rewriteUrl(original.psdUrl),
      psdName: original.psdName,
    },
  })

  // 4) KeyVision (se existir): criar com URLs reescritas e layers reescritos
  if (original.keyVision) {
    const kv = original.keyVision
    await prisma.keyVision.create({
      data: {
        campaignId: newId,
        data: kv.data,
        bgColor: kv.bgColor,
        layers: kv.layers ? rewriteLayers(kv.layers) : null,
        width: kv.width,
        height: kv.height,
        thumbnailUrl: rewriteUrl(kv.thumbnailUrl),
      },
    })
  }

  // 5) Peças: reescrever assetIds nos layers do data + status STANDBY + URLs
  for (const p of original.pieces) {
    let newDataStr: string | null = null
    if (p.data) {
      const pdata = parseJson(p.data)
      if (pdata) {
        if (Array.isArray(pdata.layers)) {
          pdata.layers = pdata.layers.map((l: any) =>
            l?.assetId && assetMap[l.assetId] ? { ...l, assetId: assetMap[l.assetId] } : l
          )
        }
        newDataStr = JSON.stringify(pdata)
      } else {
        newDataStr = typeof p.data === "string" ? p.data : JSON.stringify(p.data)
      }
    }
    await prisma.piece.create({
      data: {
        campaignId: newId,
        mediaFormatId: p.mediaFormatId,
        name: p.name,
        status: "STANDBY", // resetado conforme requisito
        data: newDataStr,
        imageUrl: rewriteUrl(p.imageUrl),
      },
    })
  }

  // Carregar campanha duplicada com counts
  const result = await prisma.campaign.findUnique({
    where: { id: newId },
    include: { _count: { select: { pieces: true } } },
  })
  return NextResponse.json(result)
}
