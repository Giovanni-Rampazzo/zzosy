/**
 * Stripe webhook handler. Recebe events do Stripe e sincroniza com Subscription
 * + Plan no nosso DB.
 *
 * Events tratados:
 *  - checkout.session.completed     → cria/atualiza Subscription apos pagamento
 *  - customer.subscription.created  → idem (redundante mas defensivo)
 *  - customer.subscription.updated  → atualiza status, periodo, cancelAtPeriodEnd
 *  - customer.subscription.deleted  → marca canceled
 *  - invoice.payment_succeeded      → opcional log/email
 *  - invoice.payment_failed         → marca past_due, alerta user
 *
 * SECURITY: valida assinatura via STRIPE_WEBHOOK_SECRET. Sem env: 401.
 *
 * Config no Stripe dashboard:
 *   Endpoint URL: https://app.zzosy.com/api/webhooks/stripe
 *   Events to send: checkout.session.completed, customer.subscription.*,
 *                   invoice.payment_succeeded, invoice.payment_failed
 */
import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { prisma } from "@/lib/prisma"
import { stripe } from "@/lib/stripe"
import { logger } from "@/lib/logger"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

export async function POST(req: NextRequest) {
  if (!webhookSecret) {
    logger.error("[stripe-webhook]", "STRIPE_WEBHOOK_SECRET nao setado")
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 })
  }

  const sig = req.headers.get("stripe-signature")
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 })

  const rawBody = await req.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (err: any) {
    logger.warn("[stripe-webhook]", "signature invalida", { error: err?.message })
    return NextResponse.json({ error: "invalid signature" }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionChange(event.data.object as Stripe.Subscription)
        break
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break
      case "invoice.payment_succeeded":
        await handleInvoicePaid(event.data.object as Stripe.Invoice)
        break
      case "invoice.payment_failed":
        await handleInvoiceFailed(event.data.object as Stripe.Invoice)
        break
      default:
        logger.info("[stripe-webhook]", `evento ignorado: ${event.type}`)
    }
    return NextResponse.json({ received: true })
  } catch (err: any) {
    logger.error("[stripe-webhook]", err, { eventType: event.type, eventId: event.id })
    // 500 → Stripe vai retry. NAO retornar 200 se houver erro real.
    return NextResponse.json({ error: "handler error" }, { status: 500 })
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const tenantId = session.metadata?.tenantId
  const planKey = session.metadata?.planKey
  if (!tenantId || !planKey) {
    logger.warn("[stripe-webhook]", "checkout sem tenantId/planKey metadata", { sessionId: session.id })
    return
  }
  const subId = session.subscription as string | null
  if (!subId) {
    logger.warn("[stripe-webhook]", "checkout sem subscription id", { sessionId: session.id })
    return
  }
  const stripeSub = await stripe.subscriptions.retrieve(subId)
  await upsertSubscription(tenantId, planKey, stripeSub, session.customer as string)
}

async function handleSubscriptionChange(sub: Stripe.Subscription) {
  const tenantId = (sub.metadata?.tenantId as string | undefined)
    ?? (await findTenantByCustomerId(sub.customer as string))
  if (!tenantId) {
    logger.warn("[stripe-webhook]", "sub change sem tenantId match", { subId: sub.id, customer: sub.customer })
    return
  }
  const planKey = (sub.metadata?.planKey as string | undefined)
    ?? (await findPlanKeyByPriceId(sub.items.data[0]?.price?.id))
  if (!planKey) {
    logger.warn("[stripe-webhook]", "sub change sem planKey match", { subId: sub.id })
    return
  }
  await upsertSubscription(tenantId, planKey, sub, sub.customer as string)
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const existing = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: sub.id } })
  if (!existing) return
  await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      status: "canceled",
      canceledAt: new Date(),
      cancelAtPeriodEnd: false,
    },
  })
  logger.info("[stripe-webhook]", "sub canceled", { tenantId: existing.tenantId, subId: sub.id })
}

async function handleInvoicePaid(inv: Stripe.Invoice) {
  logger.info("[stripe-webhook]", "invoice paid", {
    customer: inv.customer,
    amount: inv.amount_paid,
    invoiceId: inv.id,
  })
  // Hook futuro: enviar email "obrigado pelo pagamento" via Resend.
}

async function handleInvoiceFailed(inv: Stripe.Invoice) {
  const customerId = inv.customer as string
  const sub = await prisma.subscription.findFirst({ where: { stripeCustomerId: customerId } })
  if (sub) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: "past_due" },
    })
  }
  logger.warn("[stripe-webhook]", "invoice failed", { customer: customerId, amount: inv.amount_due })
  // Hook futuro: email "atualize seu cartão" via Resend.
}

async function upsertSubscription(
  tenantId: string,
  planKey: string,
  stripeSub: Stripe.Subscription,
  stripeCustomerId: string,
) {
  const plan = await prisma.plan.findUnique({ where: { key: planKey } })
  if (!plan) {
    logger.error("[stripe-webhook]", "plan nao encontrado", { planKey })
    return
  }
  await prisma.subscription.upsert({
    where: { tenantId },
    create: {
      tenantId,
      planId: plan.id,
      stripeCustomerId,
      stripeSubscriptionId: stripeSub.id,
      status: stripeSub.status,
      currentPeriodStart: stripeSub.current_period_start ? new Date(stripeSub.current_period_start * 1000) : null,
      currentPeriodEnd: stripeSub.current_period_end ? new Date(stripeSub.current_period_end * 1000) : null,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
      canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
      trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
    },
    update: {
      planId: plan.id,
      stripeCustomerId,
      stripeSubscriptionId: stripeSub.id,
      status: stripeSub.status,
      currentPeriodStart: stripeSub.current_period_start ? new Date(stripeSub.current_period_start * 1000) : null,
      currentPeriodEnd: stripeSub.current_period_end ? new Date(stripeSub.current_period_end * 1000) : null,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
      canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
      trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
    },
  })
  logger.info("[stripe-webhook]", "subscription upserted", { tenantId, planKey, status: stripeSub.status })
}

async function findTenantByCustomerId(customerId: string): Promise<string | null> {
  const sub = await prisma.subscription.findFirst({ where: { stripeCustomerId: customerId } })
  return sub?.tenantId ?? null
}

async function findPlanKeyByPriceId(priceId: string | undefined): Promise<string | null> {
  if (!priceId) return null
  const plan = await prisma.plan.findFirst({ where: { stripePriceId: priceId } })
  return plan?.key ?? null
}
