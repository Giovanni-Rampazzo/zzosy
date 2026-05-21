import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { toPx, Unit } from "@/lib/unitConversion"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any).tenantId
    const medias = await prisma.mediaFormat.findMany({
      where: { OR: [{ isDefault: true }, { tenantId }] },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    })
    return NextResponse.json(medias)
  } catch (err: any) {
    console.error("medias GET error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return apiErrors.unauthorized()
    const tenantId = (session.user as any).tenantId
    const body = await req.json()
    const { vehicle, media, format, dpi, category, segment } = body
    const name = [vehicle, media, format].filter(Boolean).join(" - ") || "Formato"

    // Aceita 2 formatos no body:
    // 1) {widthValue, widthUnit, heightValue, heightUnit, dpi} -> calcula width/height em px
    // 2) {width, height} -> px direto (back-compat)
    const dpiNum = dpi ? Number(dpi) : 72
    const widthValue = body.widthValue !== undefined ? Number(body.widthValue) : Number(body.width)
    const heightValue = body.heightValue !== undefined ? Number(body.heightValue) : Number(body.height)
    const widthUnit = (body.widthUnit ?? "px") as Unit
    const heightUnit = (body.heightUnit ?? "px") as Unit
    const widthPx = toPx(widthValue, widthUnit, dpiNum)
    const heightPx = toPx(heightValue, heightUnit, dpiNum)

    const mf = await prisma.mediaFormat.create({
      data: {
        tenantId, name, vehicle, media, format,
        width: widthPx, height: heightPx,
        widthValue, heightValue,
        widthUnit, heightUnit,
        dpi: dpiNum,
        category, segment, isDefault: false,
      }
    })
    return NextResponse.json(mf)
  } catch (err: any) {
    console.error("medias POST error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
