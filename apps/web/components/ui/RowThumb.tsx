"use client"

interface Props {
  src?: string | null
  alt?: string
  /** Texto pra fallback (avatar com inicial). Usado quando nao tem src */
  fallbackText?: string
  /** Cor de fundo do fallback (ex: "#F5C400"). Default cinza claro */
  fallbackBg?: string
  /** Size em px. Default 56 (cabe bem em tabela com padding 12px) */
  size?: number
  /** Border radius. Default 8 */
  rounded?: number
  /** Aplicado no img. Default "contain" pra nao cortar peca */
  fit?: "contain" | "cover"
}

/**
 * Preview pra primeira coluna de listas. Padronizado pra todo o sistema.
 * - Com src: mostra imagem
 * - Sem src + fallbackText: avatar circular com inicial(is)
 * - Sem nada: placeholder cinza
 */
export function RowThumb({ src, alt, fallbackText, fallbackBg, size = 56, rounded = 8, fit = "contain" }: Props) {
  const initials = (fallbackText ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("")

  const styleBase: React.CSSProperties = {
    width: size, height: size, borderRadius: rounded, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    overflow: "hidden", border: "1px solid #E0E0E0", background: "#F5F5F0",
  }

  if (src) {
    return (
      <div style={{...styleBase, border: "none", background: "transparent"}}>
        <img src={src} alt={alt ?? ""} style={{ width: "100%", height: "100%", objectFit: fit }} />
      </div>
    )
  }

  if (initials) {
    return (
      <div style={{
        ...styleBase,
        background: fallbackBg ?? "#F5F5F0",
        border: "none",
        color: fallbackBg ? "white" : "#888",
        fontSize: Math.round(size * 0.36), fontWeight: 700, letterSpacing: "-0.5px",
      }}>
        {initials}
      </div>
    )
  }

  return <div style={styleBase} />
}

/**
 * Cor estavel a partir de uma string (nome). Mesmo nome → mesma cor.
 * Util pra dar identidade visual a clientes/usuarios sem logo.
 * Paleta sobria, profissional (nada de neon).
 */
const PALETTE = [
  "#5b6cff", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
  "#14b8a6", "#d946ef",
]
export function colorFromString(s: string): string {
  if (!s) return PALETTE[0]
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
}
