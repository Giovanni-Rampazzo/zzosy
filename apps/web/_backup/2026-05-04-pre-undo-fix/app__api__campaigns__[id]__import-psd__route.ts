import { NextResponse, NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { randomUUID } from "crypto"

type Ctx = { params: Promise<{ id: string }> }

export const maxDuration = 60

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await ctx.params

    const formData = await req.formData()
    const psdFile = formData.get("psd") as File
    const assetsJson = formData.get("assets") as string
    const canvasWidth = Number(formData.get("canvasWidth"))
    const canvasHeight = Number(formData.get("canvasHeight"))
    const bgColor = (formData.get("bgColor") as string) ?? "#ffffff"
    const images = formData.getAll("images") as File[]

    if (!psdFile || !assetsJson) {
      return NextResponse.json({ error: "PSD e assets sao obrigatorios" }, { status: 400 })
    }

    const assets = JSON.parse(assetsJson) as Array<{
      label: string
      type: "TEXT" | "IMAGE"
      content?: any
      imageIndex?: number
      posX: number
      posY: number
      width: number
      height: number
      zIndex: number
    }>

    // Pasta de uploads desta campanha
    const uploadDir = path.join(process.cwd(), "public", "uploads", "campaigns", id)
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true })
    }

    // Salvar PSD original
    const psdBuffer = Buffer.from(await psdFile.arrayBuffer())
    const psdFilename = `master-${randomUUID()}.psd`
    const psdPath = path.join(uploadDir, psdFilename)
    await writeFile(psdPath, psdBuffer)
    const psdUrl = `/uploads/campaigns/${id}/${psdFilename}`

    // Salvar imagens dos layers
    const imageUrls: string[] = []
    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      const buf = Buffer.from(await img.arrayBuffer())
      const imgFilename = `layer-${randomUUID()}.png`
      const imgPath = path.join(uploadDir, imgFilename)
      await writeFile(imgPath, buf)
      imageUrls.push(`/uploads/campaigns/${id}/${imgFilename}`)
    }

    // Apagar assets antigos
    await prisma.campaignAsset.deleteMany({ where: { campaignId: id } })

    // Criar assets
    const created = []
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i]
      const imageUrl = asset.type === "IMAGE" && asset.imageIndex !== undefined
        ? imageUrls[asset.imageIndex] ?? null
        : null

      const record = await prisma.campaignAsset.create({
        data: {
          campaignId: id,
          label: asset.label,
          type: asset.type,
          content: asset.content ? JSON.stringify(asset.content) : null,
          imageUrl,
          order: i,
          posX: asset.posX,
          posY: asset.posY,
          width: asset.width || 400,
          visible: true,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
        }
      })
      created.push(record)
    }

    // Layers para a Matriz
    const layers = created.map((a, i) => ({
      assetId: a.id,
      posX: assets[i].posX,
      posY: assets[i].posY,
      width: assets[i].width || 400,
      height: assets[i].height || 100,
      scaleX: 1, scaleY: 1, rotation: 0,
      zIndex: assets[i].zIndex,
    }))

    // KeyVision (Matriz)
    await prisma.keyVision.upsert({
      where: { campaignId: id },
      create: {
        campaignId: id,
        data: "{}",
        bgColor,
        layers: JSON.stringify(layers),
        width: canvasWidth,
        height: canvasHeight,
      },
      update: {
        bgColor,
        layers: JSON.stringify(layers),
        width: canvasWidth,
        height: canvasHeight,
      },
    })

    // Atualizar Campaign com PSD master
    await prisma.campaign.update({
      where: { id },
      data: { psdUrl, psdName: psdFile.name },
    })

    return NextResponse.json({ ok: true, assetsCreated: created.length, psdUrl })
  } catch (err: any) {
    console.error("import-psd error:", err)
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 })
  }
}
