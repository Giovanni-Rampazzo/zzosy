import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { maybeSanitizeImage } from "@/lib/svgSanitize"

type Params = { id: string }
export const maxDuration = 30

export async function GET(_: Request, context: { params: Promise<Params> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await context.params
  const tenantId = (session.user as any).tenantId
  const campaign = await prisma.campaign.findFirst({ where: { id, client: { tenantId } } })
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const assets = await prisma.campaignAsset.findMany({
    where: { campaignId: id },
    orderBy: { order: "asc" },
    include: { smartObject: true },
  })
  return NextResponse.json(assets)
}

export async function POST(req: Request, context: { params: Promise<Params> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await context.params
  const tenantId = (session.user as any).tenantId
  const campaign = await prisma.campaign.findFirst({ where: { id, client: { tenantId } } })
  if (!campaign) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const contentType = req.headers.get("content-type") ?? ""

  // Caso 1: criar asset de IMAGEM via FormData (com upload)
  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData()
    const file = fd.get("image") as File | null
    const label = String(fd.get("label") ?? "Nova imagem")
    if (!file) return NextResponse.json({ error: "Imagem nao enviada" }, { status: 400 })

    let buf = Buffer.from(await file.arrayBuffer())
    const ext = (file.name.split(".").pop() || "png").toLowerCase()
    buf = maybeSanitizeImage(buf, ext)

    const filename = `asset-${randomUUID()}.${ext}`
    const dir = path.join(process.cwd(), "public", "uploads", "campaigns", id)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, filename), buf)
    const imageUrl = `/uploads/campaigns/${id}/${filename}`

    const lastOrder = await prisma.campaignAsset.findFirst({
      where: { campaignId: id }, orderBy: { order: "desc" }, select: { order: true }
    })
    const asset = await prisma.campaignAsset.create({
      data: {
        campaignId: id,
        type: "IMAGE",
        label,
        imageUrl,
        order: (lastOrder?.order ?? 0) + 1,
      }
    })
    return NextResponse.json(asset)
  }

  // Caso 2: criar asset genérico via JSON (texto, principalmente)
  const body = await req.json()
  const lastOrder = await prisma.campaignAsset.findFirst({
    where: { campaignId: id }, orderBy: { order: "desc" }, select: { order: true }
  })
  const order = body.order ?? (lastOrder?.order ?? 0) + 1
  const data: any = { campaignId: id, order, ...body }
  // Garantir que content seja string se for objeto
  if (data.content && typeof data.content !== "string") {
    data.content = JSON.stringify(data.content)
  }
  const asset = await prisma.campaignAsset.create({ data })
  return NextResponse.json(asset)
}
