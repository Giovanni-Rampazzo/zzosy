"use client"
import { useState, useEffect, useRef } from "react"

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
 * - Com src: mostra imagem com skeleton pulse enquanto carrega; cai pra fallback se 404/erro
 * - Sem src + fallbackText: avatar com inicial(is)
 * - Sem nada: placeholder cinza
 */
export function RowThumb({ src, alt, fallbackText, fallbackBg, size = 56, rounded = 8, fit = "contain" }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)

  // Reseta estado quando src muda (ex: cache-busting via ?v=N).
  // Importante: ler img.complete no mount — imagens do cache do browser
  // disparam onLoad ANTES do React executar, entao sem esse check o state
  // fica preso em 'loading' e mostra skeleton pra sempre.
  useEffect(() => {
    setErrored(false)
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) setLoaded(true)
    else setLoaded(false)
  }, [src])

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

  if (src && !errored) {
    return (
      <div style={{...styleBase, border: "none", background: loaded ? "transparent" : "#EDEDED", position: "relative"}} aria-busy={!loaded}>
        {!loaded && <div style={{ position: "absolute", inset: 0, animation: "rowthumb-pulse 1.2s ease-in-out infinite", background: "linear-gradient(90deg, #EDEDED 0%, #F5F5F5 50%, #EDEDED 100%)", backgroundSize: "200% 100%" }} />}
        <img
          ref={imgRef}
          src={src}
          alt={alt ?? ""}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          style={{ width: "100%", height: "100%", objectFit: fit, opacity: loaded ? 1 : 0, transition: "opacity 0.2s", display: "block" }}
        />
        <style>{`@keyframes rowthumb-pulse { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
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
