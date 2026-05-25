"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { Button } from "@/components/ui/Button"
import { PLAN_DEFS, type PlanKey } from "@/lib/billing/plans"

export default function PlansPage() {
  const router = useRouter()
  const { status } = useSession()
  const [loadingKey, setLoadingKey] = useState<PlanKey | null>(null)

  async function pickPlan(key: PlanKey) {
    if (status !== "authenticated") {
      router.push(`/login?callbackUrl=${encodeURIComponent("/plans")}`)
      return
    }
    if (key === "starter") {
      // Starter free — sem checkout. Sub nao existir = é Starter implicito.
      router.push("/dashboard/billing")
      return
    }
    setLoadingKey(key)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey: key }),
      })
      const j = await res.json()
      if (res.ok && j?.url) {
        window.location.href = j.url
      } else {
        alert(j?.error ?? "Falha ao iniciar checkout")
      }
    } finally {
      setLoadingKey(null)
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F5F5F0", fontFamily: "var(--font-dm-sans), system-ui, sans-serif" }}>
      <header style={{
        background: "white",
        borderBottom: "2px solid #555",
        padding: "16px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <Link href="/" style={{ fontSize: 20, fontWeight: 800, color: "#111", textDecoration: "none", letterSpacing: -0.5 }}>
          ZZOSY
        </Link>
        <nav style={{ display: "flex", gap: 16, fontSize: 13 }}>
          {status === "authenticated" ? (
            <Link href="/dashboard" style={{ color: "#555", textDecoration: "none", fontWeight: 500 }}>Dashboard</Link>
          ) : (
            <Link href="/login" style={{ color: "#555", textDecoration: "none", fontWeight: 500 }}>Entrar</Link>
          )}
        </nav>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 32px 96px" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, margin: "0 0 8px", letterSpacing: -0.5, color: "#111" }}>
            Planos
          </h1>
          <p style={{ fontSize: 15, color: "#666" }}>
            Comece grátis. Escale conforme seu negócio cresce.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          {Object.values(PLAN_DEFS).map(def => (
            <PlanCard
              key={def.key}
              def={def}
              loading={loadingKey === def.key}
              onPick={() => pickPlan(def.key)}
              highlighted={def.key === "pro"}
            />
          ))}
        </div>

        <p style={{ textAlign: "center", marginTop: 48, fontSize: 12, color: "#888" }}>
          Cobrança mensal em BRL via Stripe. Cancele a qualquer momento direto no painel.
        </p>
      </main>
    </div>
  )
}

function PlanCard({ def, loading, onPick, highlighted }: {
  def: typeof PLAN_DEFS[PlanKey]
  loading: boolean
  onPick: () => void
  highlighted: boolean
}) {
  const isFree = def.monthlyPriceCents === 0
  return (
    <div style={{
      background: "white",
      border: highlighted ? "3px solid #F5C400" : "1px solid #E0E0E0",
      borderRadius: 14,
      padding: 28,
      position: "relative",
      display: "flex", flexDirection: "column",
    }}>
      {highlighted && (
        <div style={{
          position: "absolute", top: -12, right: 20,
          background: "#F5C400", color: "#111",
          fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
          padding: "4px 10px", borderRadius: 12,
        }}>
          Recomendado
        </div>
      )}
      <div style={{ fontSize: 13, color: "#888", fontWeight: 600, marginBottom: 4 }}>{def.name}</div>
      <div style={{ fontSize: 32, fontWeight: 800, color: "#111", marginBottom: 4 }}>
        {isFree ? "Grátis" : (
          <>
            R$ {(def.monthlyPriceCents / 100).toFixed(0)}
            <span style={{ fontSize: 14, color: "#888", fontWeight: 500 }}> /mês</span>
          </>
        )}
      </div>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 20, minHeight: 36 }}>{def.description}</p>
      <Button
        variant={highlighted ? "primary" : "secondary"}
        size="md"
        onClick={onPick}
        loading={loading}
        className="w-full"
      >
        {isFree ? "Começar grátis" : `Assinar ${def.name}`}
      </Button>
      <ul style={{ listStyle: "none", padding: 0, margin: "24px 0 0", fontSize: 13, color: "#444" }}>
        {def.features.map((f, i) => (
          <li key={i} style={{ padding: "6px 0", borderTop: i === 0 ? "none" : "1px solid #F0F0F0", display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ color: "#4caf50", flexShrink: 0 }}>✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
