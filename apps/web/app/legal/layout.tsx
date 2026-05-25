import type { ReactNode } from "react"
import Link from "next/link"

export default function LegalLayout({ children }: { children: ReactNode }) {
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
          <Link href="/legal/terms" style={legalLinkStyle}>Termos de Uso</Link>
          <Link href="/legal/privacy" style={legalLinkStyle}>Privacidade</Link>
          <Link href="/login" style={legalLinkStyle}>Entrar</Link>
        </nav>
      </header>
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "48px 32px 96px", color: "#222", lineHeight: 1.65 }}>
        {children}
      </main>
      <footer style={{ borderTop: "1px solid #E0E0E0", padding: "24px 32px", textAlign: "center", color: "#888", fontSize: 12 }}>
        © {new Date().getFullYear()} ZZOSY — Automação de layout para campanhas publicitárias
      </footer>
    </div>
  )
}

const legalLinkStyle: React.CSSProperties = {
  color: "#555",
  textDecoration: "none",
  fontWeight: 500,
}
