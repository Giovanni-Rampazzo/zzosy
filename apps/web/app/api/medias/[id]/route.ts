import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { toPx, Unit } from "@/lib/unitConversion"

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await req.json()

  // Se vier widthValue+widthUnit, recalcula width/height em px usando o dpi.
  // Senao usa width/height direto (back-compat).
  const data: any = { ...body }
  if (body.widthValue !== undefined || body.heightValue !== undefined || body.widthUnit || body.heightUnit) {
    const dpi = Number(body.dpi ?? 72)
    const widthValue = body.widthValue !== undefined ? Number(body.widthValue) : Number(body.width)
    const heightValue = body.heightValue !== undefined ? Number(body.heightValue) : Number(body.height)
    const widthUnit = (body.widthUnit ?? "px") as Unit
    const heightUnit = (body.heightUnit ?? "px") as Unit
    data.width = toPx(widthValue, widthUnit, dpi)
    data.height = toPx(heightValue, heightUnit, dpi)
    data.widthValue = widthValue
    data.heightValue = heightValue
    data.widthUnit = widthUnit
    data.heightUnit = heightUnit
    data.dpi = dpi
  }

  const mf = await prisma.mediaFormat.update({ where: { id }, data })
  return NextResponse.json(mf)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  await prisma.mediaFormat.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
