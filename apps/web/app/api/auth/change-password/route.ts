/**
 * POST /api/auth/change-password
 * Body: { currentPassword: string, newPassword: string }
 *
 * Troca a senha do user LOGADO. Diferente de /reset-password (que usa token
 * de email), aqui valida via senha atual + sessao. Rate-limited por IP.
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { rateLimit, identifierFromRequest } from "@/lib/rateLimit"
import { apiErrors } from "@/lib/apiError"
import { logger } from "@/lib/logger"
import bcrypt from "bcryptjs"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MIN_PASSWORD = 8

export async function POST(req: NextRequest) {
  const rl = await rateLimit.auth.check(identifierFromRequest(req))
  if (!rl.ok) return apiErrors.tooManyRequests(rl.retryAfter)

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return apiErrors.unauthorized()

  let body: any
  try { body = await req.json() } catch { return apiErrors.badRequest("JSON invalido") }
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : ""
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : ""
  if (!currentPassword) return apiErrors.badRequest("Senha atual obrigatoria")
  if (newPassword.length < MIN_PASSWORD) {
    return apiErrors.badRequest(`Nova senha deve ter no minimo ${MIN_PASSWORD} caracteres`)
  }
  if (currentPassword === newPassword) {
    return apiErrors.badRequest("A nova senha deve ser diferente da atual")
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } })
  if (!user?.password) return apiErrors.badRequest("Usuario nao encontrado ou sem senha cadastrada")

  const ok = await bcrypt.compare(currentPassword, user.password)
  if (!ok) return apiErrors.badRequest("Senha atual incorreta", { code: "WRONG_PASSWORD" })

  const hashed = await bcrypt.hash(newPassword, 10)
  await prisma.user.update({ where: { id: user.id }, data: { password: hashed } })

  logger.info("[change-password]", "senha alterada", { userId: user.id })
  return NextResponse.json({ ok: true })
}
