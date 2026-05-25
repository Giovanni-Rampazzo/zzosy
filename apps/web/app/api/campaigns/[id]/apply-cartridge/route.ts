/**
 * GAM Apply Cartridge — recebe upload de .zzosy OU referencia de cartucho ja
 * importado (libraryAssetIds opcionais) e aplica na campanha.
 *
 * MATCH: por slotKey explicito (Figma-style). Cada asset do cartucho com
 * slotKey=X procura CampaignAsset.slotKey=X na campanha → atualiza content
 * + lastOverride + imageUrl + smartObjectId. Slots nao-matched:
 *   - se body.createMissing=true (default): cria novo CampaignAsset
 *   - senao: skip + warning
 *
 * Fallback manual: body.mapping = { [cartridgeSlotKey]: campaignAssetId } pra
 * ambiguidades resolvidas no front (modal manual mapping).
 *
 * Body opcoes:
 *   { uploadCartridge: true, file: multipart 'cartridge' }  — upload novo .zzosy
 *   { libraryAssetIds: string[] }                            — usar assets ja no library
 *   { mapping?: Record<slotKey, campaignAssetId> }           — override manual
 *   { createMissing?: boolean }                              — default true
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"
import { addLayersToKv, type KvLayerInput } from "@/lib/kvLayers"
import JSZip from "jszip"
import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { SIZE_LIMITS, isCartridgeMimeAllowed } from "@/lib/sizeGuards"
import { parseCartridgeManifest, CartridgeFormatError } from "@/lib/cartridgeFormat"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { id: campaignId } = await ctx.params

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, client: { tenantId } },
    include: { assets: true },
  })
  if (!campaign) return apiErrors.notFound()

  const clientId = campaign.clientId

  // Carrega lista de "cartridge assets" — pode vir de upload OU library.
  const ct = req.headers.get("content-type") ?? ""
  let cartridgeAssets: any[] = []
  let mapping: Record<string, string> = {}
  let createMissing = true

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData()
    const file = fd.get("cartridge") as File | null
    if (!file) return NextResponse.json({ error: "cartridge file missing" }, { status: 400 })
    // S2 fix: file.size cap ANTES de arrayBuffer (bomb attack guard).
    if (file.size > SIZE_LIMITS.cartridgeFile) {
      return NextResponse.json({
        error: `Cartridge excede limite (${(file.size / 1024 / 1024).toFixed(1)}MB > ${SIZE_LIMITS.cartridgeFile / 1024 / 1024}MB)`,
      }, { status: 413 })
    }
    if (!isCartridgeMimeAllowed(file.type)) {
      return NextResponse.json({
        error: `Tipo de arquivo invalido: "${file.type}". Esperado .zzosy/.zip`,
      }, { status: 415 })
    }
    const mp = fd.get("mapping") as string | null
    if (mp) { try { mapping = JSON.parse(mp) } catch {} }
    const cm = fd.get("createMissing") as string | null
    if (cm !== null) createMissing = cm === "true" || cm === "1"
    try {
      const parsed = await parseCartridge(file, clientId)
      cartridgeAssets = parsed
    } catch (e) {
      if (e instanceof CartridgeFormatError) {
        return NextResponse.json({ error: e.message, receivedFormat: e.receivedFormat }, { status: 400 })
      }
      return NextResponse.json({ error: "Falha ao parsear cartridge" }, { status: 400 })
    }
  } else {
    const body = await req.json()
    mapping = body.mapping ?? {}
    if (typeof body.createMissing === "boolean") createMissing = body.createMissing
    if (Array.isArray(body.libraryAssetIds) && body.libraryAssetIds.length > 0) {
      const libs = await prisma.clientLibraryAsset.findMany({
        where: { id: { in: body.libraryAssetIds }, clientId },
        include: { smartObject: true },
      })
      cartridgeAssets = libs.map(l => ({
        slotKey: l.slotKey,
        name: l.name,
        type: l.type,
        content: l.content ? safeParse(l.content) : null,
        lastOverride: l.lastOverride,
        imageUrl: l.imageUrl,
        libraryAssetId: l.id,
        version: l.version,
        smartObject: l.smartObject ? {
          filePath: l.smartObject.filePath,
          mime: l.smartObject.mime,
          originalName: l.smartObject.originalName,
          width: l.smartObject.width,
          height: l.smartObject.height,
          guid: l.smartObject.guid,
        } : null,
      }))
    } else {
      return NextResponse.json({ error: "uploadCartridge ou libraryAssetIds requerido" }, { status: 400 })
    }
  }

  // Indexa CampaignAsset por slotKey pra match O(1)
  const campaignBySlot = new Map<string, typeof campaign.assets[0]>()
  for (const a of campaign.assets) {
    if (a.slotKey) campaignBySlot.set(a.slotKey, a)
  }

  const result = {
    updated: [] as Array<{ assetId: string; slotKey: string; name: string }>,
    created: [] as Array<{ assetId: string; slotKey: string | null; name: string }>,
    skipped: [] as Array<{ slotKey: string | null; name: string; reason: string }>,
  }

  for (const ca of cartridgeAssets) {
    // Decisao de target:
    // 1. Manual mapping override (mapping[slotKey] = campaignAssetId)
    // 2. Auto-match por slotKey
    // 3. Criar novo (se createMissing)
    let targetId: string | null = null
    if (ca.slotKey && mapping[ca.slotKey]) {
      targetId = mapping[ca.slotKey]
    } else if (ca.slotKey && campaignBySlot.has(ca.slotKey)) {
      targetId = campaignBySlot.get(ca.slotKey)!.id
    }

    if (targetId) {
      // Update existing CampaignAsset
      const updateData: any = {
        content: ca.content ? JSON.stringify(ca.content) : null,
        lastOverride: ca.lastOverride ?? undefined,
        imageUrl: ca.imageUrl ?? undefined,
      }
      if (ca.libraryAssetId) {
        updateData.libraryAssetId = ca.libraryAssetId
        updateData.libraryAssetVersion = ca.version ?? 1
        updateData.libraryAssetDetached = false
      }
      if (ca.smartObject) {
        // Cria SmartObjectFile na campanha referenciando o binario
        const so = await prisma.smartObjectFile.create({
          data: {
            campaignId,
            guid: ca.smartObject.guid ?? randomUUID(),
            filePath: ca.smartObject.filePath,
            mime: ca.smartObject.mime,
            originalName: ca.smartObject.originalName,
            sizeBytes: ca.smartObject.sizeBytes ?? 0,
            width: ca.smartObject.width,
            height: ca.smartObject.height,
          },
        })
        updateData.smartObjectId = so.id
      }
      const updated = await prisma.campaignAsset.update({
        where: { id: targetId },
        data: updateData,
      })
      result.updated.push({ assetId: updated.id, slotKey: ca.slotKey ?? "?", name: ca.name })
    } else if (createMissing) {
      // Cria novo CampaignAsset. Posicao: prioridade manifest > lastOverride.posX
      // > offset cascata (criados em sequencia ficam espalhados pra serem
      // visiveis em vez de empilhados em (100,100)).
      const lo: any = ca.lastOverride ?? {}
      const idx = result.created.length
      const effPosX = typeof ca.posX === "number" ? ca.posX
                      : typeof lo.posX === "number" ? lo.posX
                      : 100 + idx * 40
      const effPosY = typeof ca.posY === "number" ? ca.posY
                      : typeof lo.posY === "number" ? lo.posY
                      : 100 + idx * 40
      const effWidth = typeof ca.width === "number" ? ca.width
                       : typeof lo.width === "number" ? lo.width
                       : 600
      const effHeight = typeof ca.height === "number" ? ca.height
                        : typeof lo.height === "number" ? lo.height
                        : 100

      let smartObjectId: string | null = null
      if (ca.smartObject) {
        const so = await prisma.smartObjectFile.create({
          data: {
            campaignId,
            guid: ca.smartObject.guid ?? randomUUID(),
            filePath: ca.smartObject.filePath,
            mime: ca.smartObject.mime,
            originalName: ca.smartObject.originalName,
            sizeBytes: ca.smartObject.sizeBytes ?? 0,
            width: ca.smartObject.width,
            height: ca.smartObject.height,
          },
        })
        smartObjectId = so.id
      }
      // Transaction: cria asset com order race-safe (B4 fix).
      const created = await prisma.$transaction(async (tx) => {
        const lastInTx = await tx.campaignAsset.findFirst({
          where: { campaignId }, orderBy: { order: "desc" }, select: { order: true },
        })
        const txOrder = (lastInTx?.order ?? -1) + 1
        return tx.campaignAsset.create({
          data: {
            campaignId,
            type: ca.type,
            label: ca.name,
            content: ca.content ? JSON.stringify(ca.content) : null,
            lastOverride: ca.lastOverride ?? null,
            imageUrl: ca.imageUrl ?? null,
            smartObjectId,
            libraryAssetId: ca.libraryAssetId ?? null,
            libraryAssetVersion: ca.libraryAssetId ? (ca.version ?? 1) : null,
            libraryAssetDetached: false,
            slotKey: ca.slotKey ?? null,
            order: txOrder,
            posX: effPosX,
            posY: effPosY,
            width: effWidth,
            visible: true,
          },
        })
      })
      // KV layer pro asset aparecer no canvas (B1 fix).
      try {
        await addLayersToKv(campaignId, {
          assetId: created.id,
          posX: effPosX, posY: effPosY,
          width: effWidth, height: effHeight,
        })
      } catch (e) {
        console.warn("[apply-cartridge] addLayersToKv falhou:", e)
      }
      result.created.push({ assetId: created.id, slotKey: ca.slotKey, name: ca.name })
    } else {
      result.skipped.push({ slotKey: ca.slotKey, name: ca.name, reason: "Sem slot match + createMissing=false" })
    }
  }

  return NextResponse.json(result)
}

async function parseCartridge(file: File, clientId: string): Promise<any[]> {
  const ab = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(ab)
  const manifestFile = zip.file("manifest.json")
  if (!manifestFile) throw new CartridgeFormatError("manifest.json missing")
  const manifest = parseCartridgeManifest(await manifestFile.async("string"))

  // Persiste binaries em /uploads/clients/{clientId}/library/ pra que o
  // CampaignAsset.imageUrl e o SmartObjectFile.filePath fiquem disponiveis.
  const uploadDir = path.join(process.cwd(), "public", "uploads", "clients", clientId, "library")
  if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true })
  const smartDir = path.join(uploadDir, "smart")
  if (!existsSync(smartDir)) await mkdir(smartDir, { recursive: true })
  const imageDir = path.join(uploadDir, "images")
  if (!existsSync(imageDir)) await mkdir(imageDir, { recursive: true })

  const out: any[] = []
  for (const m of manifest.assets ?? []) {
    const entry: any = {
      slotKey: m.slotKey ?? null,
      name: m.name ?? "Imported",
      type: m.type ?? "IMAGE",
      content: m.content ?? null,
      lastOverride: m.lastOverride ?? null,
      imageUrl: null,
      smartObject: null,
      // Posicionamento opcional (forward-compat: manifest v2 pode trazer).
      // Cartridges atuais de library nao tem; apply usa offset cascata fallback.
      posX: typeof m.posX === "number" ? m.posX : undefined,
      posY: typeof m.posY === "number" ? m.posY : undefined,
      width: typeof m.width === "number" ? m.width : undefined,
      height: typeof m.height === "number" ? m.height : undefined,
    }
    if (m.binary) {
      const f = zip.file(m.binary)
      if (f) {
        const bytes = await f.async("nodebuffer")
        const ext = path.extname(m.binary) || ".png"
        const fname = `${randomUUID()}${ext}`
        await writeFile(path.join(imageDir, fname), bytes)
        entry.imageUrl = `/uploads/clients/${clientId}/library/images/${fname}`
      }
    }
    if (m.smartObject?.binary) {
      const f = zip.file(m.smartObject.binary)
      if (f) {
        const bytes = await f.async("nodebuffer")
        const ext = path.extname(m.smartObject.binary) || ".psb"
        const fname = `${randomUUID()}${ext}`
        await writeFile(path.join(smartDir, fname), bytes)
        entry.smartObject = {
          filePath: `/uploads/clients/${clientId}/library/smart/${fname}`,
          mime: m.smartObject.mime,
          originalName: m.smartObject.originalName,
          sizeBytes: bytes.length,
          width: m.smartObject.width,
          height: m.smartObject.height,
          guid: randomUUID(),
        }
      }
    }
    out.push(entry)
  }
  return out
}

function safeParse(s: any): any { try { return JSON.parse(s) } catch { return null } }
