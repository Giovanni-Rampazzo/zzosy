/**
 * GAM Cartridge — formato .zzosy (ZIP internamente).
 *
 * POST /api/clients/[id]/library/cartridge  — export: gera .zzosy contendo
 *   manifest.json + binarios (image/smartObject)
 * PUT  /api/clients/[id]/library/cartridge  — import: parseia .zzosy upload,
 *   cria ClientLibraryAsset(s) na library do cliente
 *
 * Estrutura .zzosy:
 *   manifest.json
 *   assets/<slotKey|index>.png      (image binaries — pegos do imageUrl original)
 *   assets/<slotKey|index>.psb      (smart object binaries)
 *
 * manifest.json:
 *   {
 *     "format": "zzosy-cartridge-v1",
 *     "name": "Sicredi Q1 2026",
 *     "createdAt": "2026-05-25T03:00:00Z",
 *     "assets": [
 *       { slotKey, name, type, content, lastOverride, tags, meta, binary?, thumbnail? }
 *     ]
 *   }
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"
import JSZip from "jszip"
import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { randomUUID } from "crypto"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

const FORMAT = "zzosy-cartridge-v1"

async function assertClient(clientId: string, tenantId: string) {
  const c = await prisma.client.findFirst({ where: { id: clientId, tenantId }, select: { id: true, name: true } })
  return c
}

// ── EXPORT ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const { id: clientId } = await ctx.params
  const client = await assertClient(clientId, tenantId)
  if (!client) return apiErrors.notFound()

  const body = await req.json().catch(() => ({}))
  const name = (body.name as string)?.trim() || `${client.name}-cartridge`
  const assetIds = Array.isArray(body.assetIds) ? body.assetIds : null

  const where: any = { clientId }
  if (assetIds && assetIds.length > 0) where.id = { in: assetIds }
  const assets = await prisma.clientLibraryAsset.findMany({
    where,
    include: { smartObject: true },
  })

  const zip = new JSZip()
  const manifestAssets: any[] = []

  for (let i = 0; i < assets.length; i++) {
    const a = assets[i]
    const key = a.slotKey || `asset-${i}`
    const manifestEntry: any = {
      slotKey: key,
      name: a.name,
      type: a.type,
      content: a.content ? safeParse(a.content) : null,
      lastOverride: a.lastOverride,
      tags: Array.isArray(a.tags) ? a.tags : [],
      notes: a.notes ?? null,
      meta: a.meta ?? {},
    }

    // Image binary
    if (a.imageUrl) {
      const bytes = await readLocalUpload(a.imageUrl)
      if (bytes) {
        const ext = guessExt(a.imageUrl)
        const fname = `assets/${key}.${ext}`
        zip.file(fname, bytes)
        manifestEntry.binary = fname
      }
    }

    // Thumb separado se houver
    if (a.thumbnailUrl && a.thumbnailUrl !== a.imageUrl) {
      const bytes = await readLocalUpload(a.thumbnailUrl)
      if (bytes) {
        const fname = `assets/${key}.thumb.png`
        zip.file(fname, bytes)
        manifestEntry.thumbnail = fname
      }
    }

    // Smart object binary
    if (a.smartObject) {
      const bytes = await readLocalUpload(a.smartObject.filePath)
      if (bytes) {
        const ext = guessExt(a.smartObject.originalName) || "psb"
        const fname = `assets/${key}.so.${ext}`
        zip.file(fname, bytes)
        manifestEntry.smartObject = {
          binary: fname,
          mime: a.smartObject.mime,
          originalName: a.smartObject.originalName,
          width: a.smartObject.width,
          height: a.smartObject.height,
        }
      }
    }

    manifestAssets.push(manifestEntry)
  }

  const manifest = {
    format: FORMAT,
    name,
    sourceClient: client.name,
    createdAt: new Date().toISOString(),
    assets: manifestAssets,
  }
  zip.file("manifest.json", JSON.stringify(manifest, null, 2))

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
  // Retorna como download. Browser pega Content-Disposition pra nomear.
  return new NextResponse(buffer as any, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}.zzosy"`,
    },
  })
}

// ── IMPORT ─────────────────────────────────────────────────────────
export async function PUT(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  const userId = (session.user as any).id
  const { id: clientId } = await ctx.params
  const client = await assertClient(clientId, tenantId)
  if (!client) return apiErrors.notFound()

  const formData = await req.formData()
  const file = formData.get("cartridge") as File | null
  if (!file) return NextResponse.json({ error: "cartridge file missing" }, { status: 400 })

  const arrayBuf = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(arrayBuf)
  const manifestFile = zip.file("manifest.json")
  if (!manifestFile) return NextResponse.json({ error: "manifest.json missing in cartridge" }, { status: 400 })
  const manifest = safeParse(await manifestFile.async("string"))
  if (!manifest || manifest.format !== FORMAT) {
    return NextResponse.json({ error: `formato invalido (esperado ${FORMAT})` }, { status: 400 })
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "clients", clientId, "library")
  if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true })
  const smartDir = path.join(uploadDir, "smart")
  if (!existsSync(smartDir)) await mkdir(smartDir, { recursive: true })
  const imageDir = path.join(uploadDir, "images")
  if (!existsSync(imageDir)) await mkdir(imageDir, { recursive: true })
  const thumbDir = path.join(uploadDir, "thumbs")
  if (!existsSync(thumbDir)) await mkdir(thumbDir, { recursive: true })

  let created = 0
  const createdAssets: any[] = []
  for (const m of manifest.assets ?? []) {
    let imageUrl: string | null = null
    let thumbnailUrl: string | null = null
    let smartObjectId: string | null = null

    if (m.binary) {
      const f = zip.file(m.binary)
      if (f) {
        const bytes = await f.async("nodebuffer")
        const ext = path.extname(m.binary) || ".png"
        const fname = `${randomUUID()}${ext}`
        await writeFile(path.join(imageDir, fname), bytes)
        imageUrl = `/uploads/clients/${clientId}/library/images/${fname}`
      }
    }
    if (m.thumbnail) {
      const f = zip.file(m.thumbnail)
      if (f) {
        const bytes = await f.async("nodebuffer")
        const fname = `${randomUUID()}.png`
        await writeFile(path.join(thumbDir, fname), bytes)
        thumbnailUrl = `/uploads/clients/${clientId}/library/thumbs/${fname}`
      }
    }
    if (m.smartObject?.binary) {
      const f = zip.file(m.smartObject.binary)
      if (f) {
        const bytes = await f.async("nodebuffer")
        const ext = path.extname(m.smartObject.binary) || ".psb"
        const fname = `${randomUUID()}${ext}`
        await writeFile(path.join(smartDir, fname), bytes)
        const filePath = `/uploads/clients/${clientId}/library/smart/${fname}`
        const so = await prisma.clientLibrarySmartObjectFile.create({
          data: {
            clientId,
            guid: randomUUID(),
            filePath,
            mime: m.smartObject.mime ?? "application/octet-stream",
            originalName: m.smartObject.originalName ?? fname,
            sizeBytes: bytes.length,
            width: m.smartObject.width ?? null,
            height: m.smartObject.height ?? null,
          },
        })
        smartObjectId = so.id
      }
    }

    const asset = await prisma.clientLibraryAsset.create({
      data: {
        clientId,
        name: m.name ?? "Imported",
        slotKey: m.slotKey ?? null,
        type: m.type ?? "IMAGE",
        content: m.content ? JSON.stringify(m.content) : null,
        lastOverride: m.lastOverride ?? null,
        imageUrl,
        thumbnailUrl,
        smartObjectId,
        tags: Array.isArray(m.tags) ? m.tags : [],
        notes: m.notes ?? null,
        meta: m.meta ?? {},
        version: 1,
        createdBy: userId,
      },
    })
    createdAssets.push(asset)
    created++
  }

  return NextResponse.json({ ok: true, created, name: manifest.name, assets: createdAssets })
}

// ── helpers ──
function safeParse(s: any): any { try { return JSON.parse(s) } catch { return null } }

function guessExt(urlOrName: string): string {
  const ext = path.extname(urlOrName).replace(".", "").toLowerCase()
  return ext || "bin"
}

async function readLocalUpload(url: string): Promise<Buffer | null> {
  if (!url) return null
  // Suporta URLs locais /uploads/... → resolve pra public/uploads/...
  if (url.startsWith("/uploads/")) {
    const p = path.join(process.cwd(), "public", url)
    try { return await readFile(p) } catch { return null }
  }
  // URLs absolutas externas (R2, S3) — fetch
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const ab = await res.arrayBuffer()
    return Buffer.from(ab)
  } catch {
    return null
  }
}
