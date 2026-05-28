"use client"
/**
 * Logo do cliente padrao do ZZOSY. SEMPRE clicavel, SEMPRE navega pra pagina
 * de detalhes do cliente (/clients/{id}). Filosofia: logo do cliente eh
 * "atalho universal" pra o contexto dele — em qualquer parte do app, click
 * leva pra pagina-mae.
 *
 * Fallback: quando nao ha logoUrl, mostra circulo com inicial do nome.
 * Use `disableNavigation` em slots de UPLOAD (onde o click abre file picker
 * ou edita o logo, nao navega).
 */
import { useRouter } from "next/navigation"
import { MouseEvent } from "react"

interface Props {
  client: { id: string; name: string; brandLogoUrl?: string | null }
  /** Tamanho em px do badge quadrado. Default 32. */
  size?: number
  /** Border radius. Default size/6 (suave). */
  radius?: number
  /** Background do fallback (sem logo). Default cinza claro. */
  fallbackBg?: string
  /** Cor da letra fallback. Default cinza medio. */
  fallbackColor?: string
  /** Se true, NAO navega ao clicar (use em slots de upload). */
  disableNavigation?: boolean
  /** Onclick custom (executado depois da navegacao, ou em vez se disableNavigation). */
  onClick?: (e: MouseEvent) => void
  /** Title (tooltip). Default "Abrir pagina do cliente". */
  title?: string
  style?: React.CSSProperties
}

export function ClientLogoBadge({
  client,
  size = 32,
  radius,
  fallbackBg = "#E5E5E0",
  fallbackColor = "#999",
  disableNavigation = false,
  onClick,
  title,
  style,
}: Props) {
  const router = useRouter()
  const br = radius ?? Math.round(size / 6)

  function handleClick(e: MouseEvent) {
    if (onClick) onClick(e)
    if (e.defaultPrevented) return
    if (!disableNavigation) router.push(`/clients/${client.id}`)
  }

  const computedTitle = title ?? (disableNavigation ? client.name : "Abrir pagina do cliente")
  const cursor = disableNavigation && !onClick ? "default" : "pointer"

  if (client.brandLogoUrl) {
    return (
      <div
        onClick={handleClick}
        title={computedTitle}
        style={{
          width: size, height: size,
          borderRadius: br,
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden", flexShrink: 0,
          cursor,
          ...style,
        }}>
        <img
          src={client.brandLogoUrl}
          alt={client.name}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        />
      </div>
    )
  }

  // Fallback: inicial em circulo
  return (
    <div
      onClick={handleClick}
      title={computedTitle}
      style={{
        width: size, height: size,
        borderRadius: br,
        background: fallbackBg,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        color: fallbackColor,
        fontWeight: 700,
        fontSize: Math.round(size * 0.42),
        cursor,
        ...style,
      }}>
      {client.name.charAt(0).toUpperCase()}
    </div>
  )
}
