/**
 * Plan tiers do ZZOSY — definição canônica.
 *
 * Usado pra seed inicial no DB (scripts/seed-plans.ts) E pra fallback estático
 * na UI quando DB nao foi seedado ainda.
 *
 * Stripe prices: configurar valores reais em https://dashboard.stripe.com/products
 * e copiar o price_xxx pro env STRIPE_PRICE_PRO + STRIPE_PRICE_AGENCY (ou direto
 * no DB via /admin/plans futuro). Hardcoded aqui = bootstrap.
 *
 * Limits sao enforced no app layer (lib/billing/planLimits.ts futura), via
 * Tenant.subscription.plan join.
 */

export type PlanKey = "starter" | "pro" | "agency"

export interface PlanDef {
  key: PlanKey
  name: string
  monthlyPriceCents: number
  description: string
  features: string[]
  maxClients: number
  maxCampaigns: number
  maxUsersPerTenant: number
  hasLibrary: boolean
  hasMultiStep: boolean
  hasCustomDomain: boolean
  // -1 = ilimitado
}

export const PLAN_DEFS: Record<PlanKey, PlanDef> = {
  starter: {
    key: "starter",
    name: "Starter",
    monthlyPriceCents: 0,
    description: "Pra quem ta começando a testar",
    features: [
      "1 cliente",
      "3 campanhas",
      "1 usuário",
      "Import/export PSD",
      "Editor completo",
    ],
    maxClients: 1,
    maxCampaigns: 3,
    maxUsersPerTenant: 1,
    hasLibrary: false,
    hasMultiStep: false,
    hasCustomDomain: false,
  },
  pro: {
    key: "pro",
    name: "Pro",
    monthlyPriceCents: 9900, // R$ 99,00
    description: "Designer solo / freelancer",
    features: [
      "5 clientes",
      "50 campanhas/mês",
      "1 usuário",
      "Library + cartuchos",
      "Peças multi-step",
      "Suporte prioritário",
    ],
    maxClients: 5,
    maxCampaigns: 50,
    maxUsersPerTenant: 1,
    hasLibrary: true,
    hasMultiStep: true,
    hasCustomDomain: false,
  },
  agency: {
    key: "agency",
    name: "Agency",
    monthlyPriceCents: 29900, // R$ 299,00
    description: "Agências com múltiplos clientes e equipe",
    features: [
      "Clientes ilimitados",
      "Campanhas ilimitadas",
      "Até 10 usuários",
      "Library + cartuchos",
      "Peças multi-step",
      "White-label completo (domínio próprio)",
      "Suporte premium",
    ],
    maxClients: -1,
    maxCampaigns: -1,
    maxUsersPerTenant: 10,
    hasLibrary: true,
    hasMultiStep: true,
    hasCustomDomain: true,
  },
}

/** Stripe Price IDs por env. Configurar no Stripe dashboard + setar nas envs. */
export function stripePriceIdForPlan(key: PlanKey): string | null {
  if (key === "starter") return null // free
  if (key === "pro") return process.env.STRIPE_PRICE_PRO ?? null
  if (key === "agency") return process.env.STRIPE_PRICE_AGENCY ?? null
  return null
}

export const ALL_PLAN_KEYS: PlanKey[] = ["starter", "pro", "agency"]
