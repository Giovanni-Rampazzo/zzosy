/**
 * POST /api/auth/reset-password
 * Body: { token: string, password: string }
 *
 * Valida token, atualiza User.password (bcrypt hash), apaga VerificationToken.
 * Rate-limited por IP (proteção contra brute-force em tokens).
 */
import { NextRequest, NextResponse } from "next/server"
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

  let body: any
  try { body = await req.json() } catch { return apiErrors.badRequest("JSON invalido") }
  const token = typeof body?.token === "string" ? body.token : ""
  const password = typeof body?.password === "string" ? body.password : ""
  if (!token) return apiErrors.badRequest("Token ausente")
  if (password.length < MIN_PASSWORD) {
    return apiErrors.badRequest(`Senha deve ter no minimo ${MIN_PASSWORD} caracteres`)
  }

  const record = await prisma.verificationToken.findUnique({ where: { token } })
  if (!record) return apiErrors.badRequest("Token invalido ou expirado", { code: "INVALID_TOKEN" })
  if (record.expires < new Date()) {
    await prisma.verificationToken.delete({ where: { token } }).catch(() => {})
    return apiErrors.badRequest("Token expirado", { code: "EXPIRED_TOKEN" })
  }

  const user = await prisma.user.findUnique({ where: { email: record.identifier } })
  if (!user) return apiErrors.badRequest("Usuario nao encontrado")

  const hashed = await bcrypt.hash(password, 10)
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { password: hashed } }),
    prisma.verificationToken.delete({ where: { token } }),
  ])

  logger.info("[reset-password]", "senha redefinida", { userId: user.id })
  return NextResponse.json({ ok: true })
}
