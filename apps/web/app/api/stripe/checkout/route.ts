/**
 * POST /api/stripe/checkout
 * Body: { planKey: "pro" | "agency" }
 *
 * Cria Stripe Checkout Session pra plano pago. Tenant + planKey vao no metadata
 * pro webhook reconciliar apos pagamento.
 *
 * Starter (free) NAO passa por aqui — basta nao ter Subscription pra ser
 * considerado Starter (fallback no /api/billing).
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

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) return apiErrors.unauthorized()
    const tenantId = (session.user as any).tenantId
    if (!tenantId) return apiErrors.unauthorized()

    const body = await req.json()
    const planKey = body?.planKey as string
    if (!planKey || planKey === "starter") {
      return apiErrors.badRequest("Plano invalido (use 'pro' ou 'agency')")
    }

    const plan = await prisma.plan.findUnique({ where: { key: planKey } })
    if (!plan || !plan.stripePriceId) {
      return apiErrors.badRequest(`Plano '${planKey}' sem Stripe Price ID configurado`)
    }

    // Reuse Stripe customer se ja existe (evita criar duplicata)
    const existing = await prisma.subscription.findUnique({ where: { tenantId } })
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000"

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      ...(existing?.stripeCustomerId
        ? { customer: existing.stripeCustomerId }
        : { customer_email: session.user.email }),
      success_url: `${baseUrl}/dashboard/billing?upgraded=true`,
      cancel_url: `${baseUrl}/plans`,
      metadata: { tenantId, planKey },
      subscription_data: { metadata: { tenantId, planKey } },
    })

    return NextResponse.json({ url: checkout.url })
  } catch (err: any) {
    logger.error("[stripe-checkout]", err)
    return apiErrors.internal()
  }
}
