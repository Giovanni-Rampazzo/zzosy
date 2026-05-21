"use client";
import { colors } from "@/lib/theme";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";

// ─── LOGO ────────────────────────────────────────────────────────
function Logo({ small = false }: { small?: boolean }) {
  const size = small ? "1.2rem" : "1.5rem";
  const circleSize = small ? "1.2rem" : "1.5rem";
  const dotSize = small ? "4px" : "5px";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1px", fontFamily: "'DM Sans', sans-serif", fontWeight: 900, fontSize: size, letterSpacing: "-0.04em", color: colors.text }}>
      ZZ
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: circleSize, height: circleSize, border: "2.5px solid #111111", borderRadius: "50%", margin: "0 1px" }}>
        <span style={{ display: "flex", gap: "1.5px" }}>
          {["#F5C400", "#34A853", "#4285F4"].map(c => (
            <span key={c} style={{ width: dotSize, height: dotSize, borderRadius: "50%", background: c }} />
          ))}
        </span>
      </span>
      SY
    </div>
  );
}

// ─── SIDEBAR ─────────────────────────────────────────────────────
const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Campanhas", href: "/campaigns" },
  { label: "Editor", href: "/editor" },
  { label: "Peças", href: "/pieces" },
  { label: "Planos", href: "/plans" },
  { label: "Assinatura", href: "/dashboard/billing" },
];

function Sidebar({ active }: { active: string }) {
  return (
    <aside style={{
      width: "220px",
      minHeight: "100vh",
      background: colors.surface,
      borderRight: "1px solid #E5E5E5",
      display: "flex",
      flexDirection: "column",
      padding: "24px 0",
      position: "fixed",
      top: 0,
      left: 0,
    }}>
      <div style={{ padding: "0 20px 32px" }}>
        <Logo />
      </div>

      <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", padding: "0 8px" }}>
        {navItems.map(item => (
          <a
            key={item.href}
            href={item.href}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "9px 12px",
              borderRadius: "8px",
              fontSize: "0.875rem",
              fontWeight: active === item.href ? 700 : 400,
              color: active === item.href ? colors.text : "#666666",
              background: active === item.href ? "#EBEBEB" : "transparent",
              textDecoration: "none",
              transition: "background 0.1s",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div style={{ padding: "16px 8px 0", borderTop: "1px solid #E5E5E5", margin: "0 8px" }}>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          style={{
            width: "100%",
            padding: "9px 12px",
            borderRadius: "8px",
            border: "none",
            background: "transparent",
            color: "#888888",
            fontSize: "0.875rem",
            fontFamily: "'DM Sans', sans-serif",
            cursor: "pointer",
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span>🚪</span> Sair
        </button>
      </div>
    </aside>
  );
}

// ─── STAT CARD ───────────────────────────────────────────────────
function StatCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div style={{
      background: colors.primaryText,
      border: "1px solid #E5E5E5",
      borderRadius: "12px",
      padding: "24px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: accent, display: "block" }} />
      <span style={{ fontSize: "2rem", fontWeight: 900, color: colors.text, fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.03em" }}>{value}</span>
      <span style={{ fontSize: "0.8rem", color: "#888888", fontFamily: "'DM Sans', sans-serif", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
    </div>
  );
}

// ─── CAMPAIGN CARD ───────────────────────────────────────────────
function CampaignCard({ campaign, onClick }: { campaign: any; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: colors.primaryText,
        border: "1px solid #E5E5E5",
        borderRadius: "12px",
        padding: "20px",
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
        fontFamily: "'DM Sans', sans-serif",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = colors.text;
        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = colors.border;
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, color: colors.text, margin: 0 }}>{campaign.name}</h3>
        <span style={{
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "#888888",
          background: colors.surface,
          padding: "3px 8px",
          borderRadius: "99px",
        }}>
          {campaign._count.pieces} peça{campaign._count.pieces !== 1 ? "s" : ""}
        </span>
      </div>
      <p style={{ fontSize: "0.8rem", color: "#AAAAAA", margin: 0 }}>
        Criada em {new Date(campaign.createdAt).toLocaleDateString("pt-BR")}
      </p>
    </div>
  );
}

// ─── MODAL CRIAR CAMPANHA ────────────────────────────────────────
function CreateCampaignModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 100,
    }}>
      <div style={{
        background: colors.primaryText, borderRadius: "16px", padding: "32px",
        width: "100%", maxWidth: "400px", fontFamily: "'DM Sans', sans-serif",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
      }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: colors.text, margin: "0 0 24px" }}>
          Nova campanha
        </h2>
        <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: colors.text, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Nome
        </label>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && name.trim() && onCreate(name.trim())}
          placeholder="Ex: Campanha Verão 2026"
          style={{
            width: "100%", padding: "12px 14px", border: "1px solid #E5E5E5",
            borderRadius: "8px", fontSize: "0.95rem", color: colors.text,
            outline: "none", boxSizing: "border-box", marginBottom: "24px",
            fontFamily: "'DM Sans', sans-serif",
          }}
          onFocus={e => e.target.style.borderColor = colors.text}
          onBlur={e => e.target.style.borderColor = colors.border}
        />
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "11px", border: "1px solid #E5E5E5", borderRadius: "8px",
            background: "transparent", color: "#666666", fontSize: "0.875rem",
            fontFamily: "'DM Sans', sans-serif", cursor: "pointer", fontWeight: 600,
          }}>
            Cancelar
          </button>
          <button
            onClick={() => name.trim() && onCreate(name.trim())}
            disabled={!name.trim()}
            style={{
              flex: 1, padding: "11px", border: "none", borderRadius: "8px",
              background: name.trim() ? colors.text : "#CCCCCC", color: colors.primaryText,
              fontSize: "0.875rem", fontFamily: "'DM Sans', sans-serif",
              cursor: name.trim() ? "pointer" : "not-allowed", fontWeight: 700,
            }}
          >
            Criar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN ────────────────────────────────────────────────────────
export default function DashboardClient({ user, campaigns: initialCampaigns, totalPieces }: {
  user: any;
  campaigns: any[];
  totalPieces: number;
}) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const refreshCampaigns = () => { fetch("/api/campaigns", { cache: "no-store" }).then(r => r.json()).then(data => { if (Array.isArray(data)) setCampaigns(data); }); };
  useEffect(() => {
    refreshCampaigns();
    window.addEventListener("focus", refreshCampaigns);
    return () => window.removeEventListener("focus", refreshCampaigns);
  }, []);
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async (name: string) => {
    setCreating(true);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const data = await res.json();
      setCampaigns([{ ...data, _count: { pieces: 0 } }, ...campaigns]);
      setShowModal(false);
    }
    setCreating(false);
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: colors.primaryText, fontFamily: "'DM Sans', sans-serif" }}>
      <Sidebar active="/dashboard" />

      {/* Main content */}
      <main style={{ marginLeft: "220px", flex: 1, padding: "40px 48px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px" }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 900, color: colors.text, margin: "0 0 4px", letterSpacing: "-0.03em" }}>
              Dashboard
            </h1>
            <p style={{ fontSize: "0.875rem", color: "#888888", margin: 0 }}>
              Olá, {(user as any)?.name || "Admin"} 👋
            </p>
          </div>
          <Button variant="dark" size="md" onClick={() => setShowModal(true)}>+ Nova campanha</Button>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "40px" }}>
          <StatCard label="Campanhas" value={campaigns.length} accent="#4285F4" />
          <StatCard label="Peças" value={totalPieces} accent="#34A853" />
          <StatCard label="Este mês" value={campaigns.filter(c => new Date(c.createdAt) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).length} accent="#F5C400" />
        </div>

        {/* Campaigns */}
        <div style={{ marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, color: colors.text, margin: 0 }}>Campanhas</h2>
          <span style={{ fontSize: "0.8rem", color: "#AAAAAA" }}>{campaigns.length} no total</span>
        </div>

        {campaigns.length === 0 ? (
          <div style={{
            border: "1.5px dashed " + colors.border, borderRadius: "12px",
            padding: "60px 40px", textAlign: "center",
          }}>
            <p style={{ fontSize: "0.95rem", color: "#AAAAAA", margin: "0 0 16px" }}>
              Nenhuma campanha ainda.
            </p>
            <Button variant="dark" size="md" onClick={() => setShowModal(true)}>Criar primeira campanha</Button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
            {campaigns.map(c => (
              <CampaignCard
                key={c.id}
                campaign={c}
                onClick={() => router.push(`/editor?campaign=${c.id}`)}
              />
            ))}
          </div>
        )}
      </main>

      {showModal && (
        <CreateCampaignModal
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}