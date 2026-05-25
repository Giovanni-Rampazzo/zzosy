/**
 * Seed inicial dos planos. Roda 1x apos `prisma migrate deploy`.
 *
 * Idempotente — usa upsert por `key`.
 *
 * Rodar:
 *   cd apps/web && npx tsx scripts/seed-plans.ts
 *
 * Em prod (Railway): executar manualmente via `railway run npx tsx scripts/seed-plans.ts`
 * OU adicionar ao start command (custo: roda toda vez que container sobe).
 */
import { PrismaClient } from "@prisma/client"
import { PLAN_DEFS, stripePriceIdForPlan } from "../lib/billing/plans"

const prisma = new PrismaClient()

async function main() {
  for (const def of Object.values(PLAN_DEFS)) {
    const priceId = stripePriceIdForPlan(def.key)
    const plan = await prisma.plan.upsert({
      where: { key: def.key },
      update: {
        name: def.name,
        monthlyPriceCents: def.monthlyPriceCents,
        maxClients: def.maxClients,
        maxCampaigns: def.maxCampaigns,
        maxUsersPerTenant: def.maxUsersPerTenant,
        hasLibrary: def.hasLibrary,
        hasMultiStep: def.hasMultiStep,
        hasCustomDomain: def.hasCustomDomain,
        stripePriceId: priceId,
        active: true,
      },
      create: {
        key: def.key,
        name: def.name,
        monthlyPriceCents: def.monthlyPriceCents,
        maxClients: def.maxClients,
        maxCampaigns: def.maxCampaigns,
        maxUsersPerTenant: def.maxUsersPerTenant,
        hasLibrary: def.hasLibrary,
        hasMultiStep: def.hasMultiStep,
        hasCustomDomain: def.hasCustomDomain,
        stripePriceId: priceId,
        active: true,
      },
    })
    console.log(`[seed-plans] ${plan.key} — R$ ${(plan.monthlyPriceCents / 100).toFixed(2)}/mês — stripe=${plan.stripePriceId ?? "—"}`)
  }
  console.log("[seed-plans] done")
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
