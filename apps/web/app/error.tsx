"use client"
/**
 * Next.js error boundary (client component). Pega erros runtime em qualquer
 * nivel do app router. Mostra mensagem amigavel + opcao retry.
 *
 * Captura: erros em server components, fetches que throw, render bugs.
 * NAO captura: erros no root layout (pra isso, global-error.tsx).
 */
import { useEffect } from "react"
import { logger } from "@/lib/logger"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logger.error("[app-error-boundary]", error.message, {
      digest: error.digest,
      stack: error.stack,
    })
  }, [error])

  return (
    <div style={{
      minHeight: "100vh", background: "var(--zz-bg-page, #F5F5F0)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 24, fontFamily: "var(--zz-font-family, 'DM Sans', system-ui, sans-serif)",
    }}>
      <div style={{
        fontSize: 64, fontWeight: 800, color: "#dc2626", marginBottom: 12, lineHeight: 1,
      }}>
        ⚠
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#111", marginBottom: 8 }}>
        Algo deu errado
      </div>
      <div style={{ fontSize: 14, color: "#555", marginBottom: 24, textAlign: "center", maxWidth: 480 }}>
        Erro inesperado. Tente novamente — se persistir, recarregue a página ou volte ao dashboard.
      </div>
      {error.digest && (
        <div style={{ fontSize: 11, color: "#888", marginBottom: 24, fontFamily: "monospace" }}>
          Ref: {error.digest}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={reset}
          style={{
            background: "#F5C400", color: "#111", padding: "10px 20px", borderRadius: 6,
            fontWeight: 700, fontSize: 13, border: "2px solid #555", cursor: "pointer",
          }}
        >
          Tentar de novo
        </button>
        <a
          href="/dashboard"
          style={{
            background: "white", color: "#111", padding: "10px 20px", borderRadius: 6,
            fontWeight: 700, fontSize: 13, textDecoration: "none", border: "2px solid #555",
          }}
        >
          ← Dashboard
        </a>
      </div>
    </div>
  )
}
