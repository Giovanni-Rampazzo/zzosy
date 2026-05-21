import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

async function checkSuperAdmin(email: string) {
  const me = await prisma.user.findUnique({ where: { email } })
  return me?.role === "SUPER_ADMIN" ? me : null
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return apiErrors.unauthorized()
  const me = await checkSuperAdmin(session.user.email)
  if (!me) return apiErrors.forbidden()
  const { id } = await ctx.params
  if (id === me.id) return NextResponse.json({ error: "Nao pode deletar a propria conta" }, { status: 400 })
  await prisma.user.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
