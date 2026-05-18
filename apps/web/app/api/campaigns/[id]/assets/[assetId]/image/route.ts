import { NextResponse, NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { maybeSanitizeImage } from "@/lib/svgSanitize"

type Ctx = { params: Promise<{ id: string; assetId: string }> }

export const maxDuration = 30

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id, assetId } = await ctx.params

    const formData = await req.formData()
    const file = formData.get("image") as File
    if (!file) return NextResponse.json({ error: "Imagem nao enviada" }, { status: 400 })

    let buf: Buffer = Buffer.from(await file.arrayBuffer())
    const ext = (file.name.split(".").pop() || "png").toLowerCase()
    buf = maybeSanitizeImage(buf, ext) as Buffer
    const filename = `asset-${randomUUID()}.${ext}`
    const dir = path.join(process.cwd(), "public", "uploads", "campaigns", id)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, filename), buf)
    const imageUrl = `/uploads/campaigns/${id}/${filename}`

    await prisma.campaignAsset.update({
      where: { id: assetId },
      data: { imageUrl }
    })

    return NextResponse.json({ ok: true, imageUrl })
  } catch (err: any) {
    console.error("asset image upload error:", err)
    return NextResponse.json({ error: err?.message ?? "Erro" }, { status: 500 })
  }
}
