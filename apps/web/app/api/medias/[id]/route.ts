import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { toPx, Unit } from "@/lib/unitConversion"

// Whitelist: bloqueia tentativa de mexer em tenantId, isDefault, FKs via PUT.
const MEDIA_PATCH_FIELDS = new Set([
  "name", "vehicle", "media", "format", "category", "segment",
  "width", "height", "dpi", "widthValue", "heightValue", "widthUnit", "heightUnit",
])

// MediaFormat e do tenant OU global (isDefault=true, tenantId=null).
// Defaults globais NAO podem ser mutados — cada tenant deve duplicar pra editar.
async function findEditableMedia(id: string, tenantId: string) {
  return prisma.mediaFormat.findFirst({
    where: { id, tenantId, isDefault: false },
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = (session.user as any).tenantId
  const { id } = await params
  const existing = await findEditableMedia(id, tenantId)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const body = await req.json()

  const data: any = {}
  for (const k of Object.keys(body ?? {})) {
    if (MEDIA_PATCH_FIELDS.has(k)) data[k] = body[k]
  }

  // Se vier widthValue+widthUnit, recalcula width/height em px usando o dpi.
  // Senao usa width/height direto (back-compat).
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
  const tenantId = (session.user as any).tenantId
  const { id } = await params
  const existing = await findEditableMedia(id, tenantId)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await prisma.mediaFormat.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
