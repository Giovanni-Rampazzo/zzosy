/**
 * POST /api/billing/portal
 * Cria Stripe Customer Portal session. Retorna URL pro user gerenciar
 * sua assinatura (cancelar, atualizar cartão, ver invoices).
 *
 * Pre-req: tenant precisa de subscription com stripeCustomerId. Sem isso = 404
 * (user precisa fazer checkout primeiro).
 */
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { stripe } from "@/lib/stripe"
import { apiErrors } from "@/lib/apiError"
import { logger } from "@/lib/logger"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  if (!tenantId) return apiErrors.unauthorized()

  const sub = await prisma.subscription.findUnique({ where: { tenantId } })
  if (!sub?.stripeCustomerId) {
    return apiErrors.notFound("Sem assinatura ativa — faça checkout primeiro")
  }

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/dashboard/billing`,
    })
    return NextResponse.json({ url: portalSession.url })
  } catch (err: any) {
    logger.error("[billing-portal]", err, { customerId: sub.stripeCustomerId })
    return apiErrors.internal()
  }
}
