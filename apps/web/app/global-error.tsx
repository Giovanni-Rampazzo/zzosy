"use client"
/**
 * Next.js global error boundary — captura erros no root layout (que error.tsx
 * NAO pega). Precisa renderizar <html>+<body> proprios.
 *
 * Acionado quando o layout em si quebra (ex: provider falhou, env invalido
 * carregado client-side, etc).
 */
import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // logger pode nao estar disponivel aqui — usamos console direto
    console.error("[global-error]", error.message, error.stack, error.digest)
  }, [error])

  return (
    <html>
      <body style={{
        margin: 0, padding: 24,
        background: "#F5F5F0",
        fontFamily: "'DM Sans', system-ui, sans-serif",
        minHeight: "100vh",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ fontSize: 64, fontWeight: 800, color: "#dc2626", marginBottom: 12 }}>⚠</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111", marginBottom: 8 }}>
          Erro crítico
        </div>
        <div style={{ fontSize: 14, color: "#555", marginBottom: 24, textAlign: "center", maxWidth: 480 }}>
          O sistema encontrou um erro fatal. Recarregue a página. Se persistir, o time já foi notificado.
        </div>
        {error.digest && (
          <div style={{ fontSize: 11, color: "#888", marginBottom: 24, fontFamily: "monospace" }}>
            Ref: {error.digest}
          </div>
        )}
        <button
          onClick={reset}
          style={{
            background: "#F5C400", color: "#111", padding: "10px 20px", borderRadius: 6,
            fontWeight: 700, fontSize: 13, border: "2px solid #555", cursor: "pointer",
          }}
        >
          Recarregar
        </button>
      </body>
    </html>
  )
}
