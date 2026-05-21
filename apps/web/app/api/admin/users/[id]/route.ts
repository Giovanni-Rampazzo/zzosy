import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

async function checkSuperAdmin(email: string) {
  const me = await prisma.user.findUnique({ where: { email } })
  return me?.role === "SUPER_ADMIN" ? me : null
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const me = await checkSuperAdmin(session.user.email)
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id } = await ctx.params
  if (id === me.id) return NextResponse.json({ error: "Nao pode deletar a propria conta" }, { status: 400 })
  await prisma.user.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
