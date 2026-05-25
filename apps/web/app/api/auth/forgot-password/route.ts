/**
 * POST /api/auth/forgot-password
 * Body: { email: string }
 *
 * Gera token, grava em VerificationToken, envia email com link de reset.
 * SEMPRE retorna 200 (mesmo se email nao existe) pra prevenir email
 * enumeration attack — atacante nao consegue descobrir quais emails sao
 * usuarios reais.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendPasswordResetEmail } from "@/lib/email"
import { rateLimit, identifierFromRequest } from "@/lib/rateLimit"
import { apiErrors } from "@/lib/apiError"
import { logger } from "@/lib/logger"
import { randomBytes } from "crypto"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  // Rate limit por IP — previne flood de reset emails.
  const rl = await rateLimit.auth.check(identifierFromRequest(req))
  if (!rl.ok) return apiErrors.tooManyRequests(rl.retryAfter)

  let body: any
  try { body = await req.json() } catch { return apiErrors.badRequest("JSON invalido") }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
  if (!email || !email.includes("@")) return apiErrors.badRequest("Email invalido")

  const user = await prisma.user.findUnique({ where: { email } })
  // Sempre responde 200, mas so envia email se user existe
  if (user) {
    const token = randomBytes(32).toString("hex")
    const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hora

    // Limpa tokens antigos pro mesmo email (so 1 ativo por vez).
    await prisma.verificationToken.deleteMany({ where: { identifier: email } })
    await prisma.verificationToken.create({
      data: { identifier: email, token, expires },
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000"
    const resetUrl = `${appUrl}/reset-password?token=${token}`
    const result = await sendPasswordResetEmail(email, resetUrl)
    if (!result.ok) {
      logger.warn("[forgot-password]", "envio falhou", { email, error: result.error })
    }
  }

  return NextResponse.json({ ok: true, message: "Se o email existir, você receberá um link em alguns minutos." })
}
