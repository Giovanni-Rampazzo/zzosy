/**
 * GET /api/billing
 * Retorna estado de billing do tenant atual: plan, subscription status, period,
 * limits (pra UI render).
 */
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { apiErrors } from "@/lib/apiError"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return apiErrors.unauthorized()
  const tenantId = (session.user as any).tenantId
  if (!tenantId) return apiErrors.unauthorized()

  const sub = await prisma.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  })

  // Sem subscription → Starter free implícito (fallback gracioso).
  if (!sub) {
    const starter = await prisma.plan.findUnique({ where: { key: "starter" } })
    if (!starter) {
      return NextResponse.json({ error: "Plans nao seedados — rode scripts/seed-plans.ts" }, { status: 500 })
    }
    return NextResponse.json({
      plan: starter,
      subscription: null,
      status: "free",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    })
  }

  return NextResponse.json({
    plan: sub.plan,
    subscription: {
      id: sub.id,
      status: sub.status,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      canceledAt: sub.canceledAt,
      trialEnd: sub.trialEnd,
    },
    status: sub.status,
    stripeCustomerId: sub.stripeCustomerId,
    stripeSubscriptionId: sub.stripeSubscriptionId,
  })
}
