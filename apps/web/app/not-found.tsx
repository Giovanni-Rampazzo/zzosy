/**
 * Next.js 404 page (server component). Captura todas as rotas nao encontradas
 * em qualquer nivel do app. Branding ZZOSY consistente com paginas reais.
 */
import Link from "next/link"

export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh", background: "var(--zz-bg-page, #F5F5F0)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 24, fontFamily: "var(--zz-font-family, 'DM Sans', system-ui, sans-serif)",
    }}>
      <div style={{
        fontSize: 72, fontWeight: 800, color: "#111", letterSpacing: "-0.02em", marginBottom: 12, lineHeight: 1,
      }}>
        404
      </div>
      <div style={{ fontSize: 18, color: "#444", marginBottom: 24, textAlign: "center", maxWidth: 480 }}>
        Página não encontrada. O link pode estar quebrado ou a página foi movida.
      </div>
      <Link href="/dashboard" style={{
        background: "#F5C400", color: "#111", padding: "10px 20px", borderRadius: 6,
        fontWeight: 700, fontSize: 13, textDecoration: "none", border: "2px solid #555",
      }}>
        ← Voltar ao Dashboard
      </Link>
    </div>
  )
}
