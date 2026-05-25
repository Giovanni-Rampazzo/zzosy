"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"

interface PlanDb {
  id: string
  key: string
  name: string
  monthlyPriceCents: number
  maxClients: number
  maxCampaigns: number
  maxUsersPerTenant: number
  hasLibrary: boolean
  hasMultiStep: boolean
  hasCustomDomain: boolean
}

interface SubInfo {
  status: string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  trialEnd: string | null
}

interface BillingInfo {
  plan: PlanDb
  subscription: SubInfo | null
  status: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
}

const FEATURES_DESC: Record<string, string[]> = {
  starter: ["1 cliente", "3 campanhas", "1 usuário", "Editor + PSD", ""],
  pro: ["5 clientes", "50 campanhas/mês", "Library + cartuchos", "Peças multi-step", "Suporte prioritário"],
  agency: ["Clientes ilimitados", "Campanhas ilimitadas", "Até 10 usuários", "White-label completo", "Suporte premium"],
}

export default function BillingPage() {
  const router = useRouter()
  const [billing, setBilling] = useState<BillingInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [portalBusy, setPortalBusy] = useState(false)

  useEffect(() => {
    fetch("/api/billing", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(data => { setBilling(data); setLoading(false) })
  }, [])

  async function openPortal() {
    setPortalBusy(true)
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" })
      const j = await res.json()
      if (res.ok && j?.url) {
        window.location.href = j.url
      } else {
        alert(j?.error ?? "Falha ao abrir portal")
      }
    } finally {
      setPortalBusy(false)
    }
  }

  if (loading) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"DM Sans,sans-serif"}}>
      <div style={{color:"#999"}}>Carregando...</div>
    </div>
  )

  if (!billing) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"DM Sans,sans-serif"}}>
      <div style={{color:"#999"}}>Falha ao carregar billing.</div>
    </div>
  )

  const isFree = !billing.stripeSubscriptionId || billing.plan.monthlyPriceCents === 0
  const features = FEATURES_DESC[billing.plan.key] ?? []
  const periodEnd = billing.subscription?.currentPeriodEnd
    ? new Date(billing.subscription.currentPeriodEnd).toLocaleDateString("pt-BR")
    : null
  const cancelAtPeriodEnd = billing.subscription?.cancelAtPeriodEnd ?? false

  return (
    <div style={{minHeight:"100vh",background:"#FAFAFA",fontFamily:"DM Sans,sans-serif",padding:"40px 24px"}}>
      <div style={{maxWidth:"680px",margin:"0 auto"}}>
        <div style={{marginBottom:"32px"}}>
          <div style={{marginBottom:16}}>
            <Button variant="view" size="md" onClick={() => router.push("/dashboard")}>
              ← Dashboard
            </Button>
          </div>
          <h1 style={{fontSize:"1.8rem",fontWeight:800,color:"#111",margin:0,letterSpacing:"-0.03em"}}>Assinatura</h1>
        </div>

        <div style={{background:"#111",borderRadius:"20px",padding:"32px",marginBottom:"16px",color:"#FFF"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:"16px"}}>
            <div>
              <div style={{fontSize:"0.75rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",opacity:0.5,marginBottom:"8px"}}>Plano atual</div>
              <div style={{fontSize:"2rem",fontWeight:800,letterSpacing:"-0.03em"}}>{billing.plan.name}</div>
              <div style={{fontSize:"0.9rem",opacity:0.6,marginTop:"4px"}}>
                {isFree ? "Grátis" : `R$ ${(billing.plan.monthlyPriceCents / 100).toFixed(2)}/mês`}
              </div>
            </div>
            <div style={{background:isFree?"rgba(255,255,255,0.1)":statusBg(billing.status),borderRadius:"10px",padding:"8px 16px"}}>
              <span style={{fontSize:"0.8rem",fontWeight:700,color:statusColor(billing.status, isFree)}}>
                {statusLabel(billing.status, isFree)}
              </span>
            </div>
          </div>
          <div style={{display:"flex",gap:"24px",marginTop:"28px",flexWrap:"wrap"}}>
            <Metric label="Clientes" value={billing.plan.maxClients < 0 ? "Ilimitados" : String(billing.plan.maxClients)} />
            <Metric label="Campanhas" value={billing.plan.maxCampaigns < 0 ? "Ilimitadas" : String(billing.plan.maxCampaigns)} />
            <Metric label="Usuários" value={billing.plan.maxUsersPerTenant < 0 ? "Ilimitados" : String(billing.plan.maxUsersPerTenant)} />
          </div>
          {periodEnd && (
            <div style={{marginTop:"24px",paddingTop:"20px",borderTop:"1px solid rgba(255,255,255,0.1)",fontSize:"0.85rem",opacity:0.6}}>
              {cancelAtPeriodEnd
                ? `⚠️ Cancelamento agendado para ${periodEnd}`
                : `Próxima cobrança em ${periodEnd}`}
            </div>
          )}
        </div>

        <div style={{display:"flex",gap:"12px",flexWrap:"wrap",marginBottom:"32px"}}>
          {isFree ? (
            <Button variant="primary" size="md" onClick={() => router.push("/plans")}>Fazer upgrade →</Button>
          ) : (
            <>
              <Button variant="secondary" size="md" onClick={openPortal} loading={portalBusy}>
                {portalBusy ? "Abrindo..." : "Gerenciar no Stripe"}
              </Button>
              <Button variant="secondary" size="md" onClick={() => router.push("/plans")}>Mudar plano</Button>
            </>
          )}
        </div>

        {features.length > 0 && (
          <div style={{background:"#FFF",border:"1.5px solid #E5E5E5",borderRadius:"16px",padding:"24px"}}>
            <div style={{fontSize:"0.8rem",fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:"16px"}}>Incluído no seu plano</div>
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {features.filter(Boolean).map(f => (
                <div key={f} style={{display:"flex",alignItems:"center",gap:"10px",fontSize:"0.88rem",color:"#333"}}>
                  <span style={{color:"#34A853",fontWeight:700}}>✓</span>{f}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{fontSize:"0.72rem",opacity:0.5,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:"4px"}}>{label}</div>
      <div style={{fontSize:"1.1rem",fontWeight:700}}>{value}</div>
    </div>
  )
}

function statusLabel(status: string, isFree: boolean): string {
  if (isFree) return "Gratuito"
  if (status === "active" || status === "trialing") return "Ativo"
  if (status === "past_due") return "Pendente"
  if (status === "canceled") return "Cancelado"
  return status
}

function statusBg(status: string): string {
  if (status === "past_due") return "#ff9800"
  if (status === "canceled") return "#888"
  return "#F5C400"
}

function statusColor(status: string, isFree: boolean): string {
  if (isFree) return "#FFF"
  if (status === "past_due" || status === "canceled") return "#FFF"
  return "#111"
}
