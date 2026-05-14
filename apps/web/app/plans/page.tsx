"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { plans } from "@/lib/plans-config";

export default function PlansPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const handleCTA = async (planId: string) => {
    if (planId === "enterprise") {
      window.location.href = "mailto:contato@zzysy.com?subject=Enterprise";
      return;
    }
    if (!session) {
      router.push(`/register?plan=${planId}`);
      return;
    }
    if (planId === "free") {
      router.push("/dashboard");
      return;
    }
    setLoading(planId);
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    setLoading(null);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAFA", fontFamily: "'DM Sans', sans-serif" }}>

      <div style={{ padding: "64px 24px 0", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginBottom: "32px" }}>
          <span style={{ fontSize: "1.5rem", fontWeight: 800, color: "#111", letterSpacing: "-0.04em" }}>ZZ⊙SY</span>
        </div>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.2rem)", fontWeight: 800, color: "#111", margin: "0 0 16px", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
          Simples, transparente,<br />sem surpresas.
        </h1>
        <p style={{ fontSize: "1.1rem", color: "#666", margin: "0 auto", maxWidth: "480px", lineHeight: 1.6 }}>
          Escolha o plano ideal para o seu volume de produção. Cancele quando quiser.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", justifyContent: "center", padding: "48px 24px 80px", maxWidth: "1200px", margin: "0 auto" }}>
        {plans.map((plan) => (
          <div key={plan.id} style={{
            background: plan.highlighted ? "#111" : "#FFFFFF",
            color: plan.highlighted ? "#FFF" : "#111",
            border: plan.highlighted ? "none" : "1.5px solid #E5E5E5",
            borderRadius: "20px",
            padding: "32px 28px",
            width: "220px",
            minWidth: "200px",
            flex: "1 1 200px",
            maxWidth: "240px",
            display: "flex",
            flexDirection: "column",
            position: "relative",
            boxShadow: plan.highlighted ? "0 20px 60px rgba(0,0,0,0.15)" : "none",
            transform: plan.highlighted ? "translateY(-8px)" : "none",
          }}>

            {plan.highlighted && (
              <div style={{ position: "absolute", top: "-12px", left: "50%", transform: "translateX(-50%)", background: "#F5C400", color: "#111", fontSize: "0.72rem", fontWeight: 800, padding: "4px 14px", borderRadius: "20px", letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                Mais popular
              </div>
            )}

            <div style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.5, marginBottom: "12px" }}>{plan.name}</div>

            <div style={{ marginBottom: "4px" }}>
              <span style={{ fontSize: "2.6rem", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1 }}>{plan.priceLabel}</span>
            </div>
            <div style={{ fontSize: "0.82rem", opacity: 0.5, marginBottom: "8px" }}>{plan.period}</div>
            <div style={{ fontSize: "0.85rem", opacity: 0.65, marginBottom: "24px", lineHeight: 1.5 }}>{plan.description}</div>

            <div style={{ height: "1px", background: plan.highlighted ? "rgba(255,255,255,0.15)" : "#F0F0F0", marginBottom: "20px" }} />

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "24px" }}>
              {[
                { label: "Usuários", value: plan.users },
                { label: "Campanhas", value: plan.campaigns ?? "Ilimitadas" },
                { label: "Peças/mês", value: plan.pieces ? Number(plan.pieces).toLocaleString("pt-BR") : "Ilimitadas" },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem" }}>
                  <span style={{ opacity: 0.55 }}>{label}</span>
                  <span style={{ fontWeight: 700 }}>{value}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "28px", flex: 1 }}>
              {plan.features.map((f: string) => (
                <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "0.82rem" }}>
                  <span style={{ color: plan.highlighted ? "#F5C400" : "#34A853", fontWeight: 700, marginTop: "1px", flexShrink: 0 }}>✓</span>
                  <span style={{ opacity: 0.8, lineHeight: 1.4 }}>{f}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => handleCTA(plan.id)}
              disabled={loading === plan.id}
              style={{
                padding: "12px 0", width: "100%",
                border: plan.highlighted ? "none" : "1.5px solid #111",
                borderRadius: "10px",
                background: plan.highlighted ? "#F5C400" : "transparent",
                color: "#111", fontSize: "0.88rem", fontWeight: 700,
                cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                opacity: loading === plan.id ? 0.6 : 1,
              }}
            >
              {loading === plan.id ? "Aguarde..." : plan.cta}
            </button>
          </div>
        ))}
      </div>

      <div style={{ textAlign: "center", padding: "0 24px 48px", color: "#999", fontSize: "0.82rem" }}>
        Todos os planos incluem acesso ao editor e exportação. Sem fidelidade mínima.
      </div>
    </div>
  );
}
