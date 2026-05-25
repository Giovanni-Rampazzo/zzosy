"use client"
/**
 * Card colapsavel padrao do ZZOSY. Header clicavel com titulo + chevron
 * (rotaciona 180deg quando aberto) + slots opcionais pra status/acoes
 * (botoes que ficam visiveis no header, sem disparar toggle).
 *
 * Filosofia: padronizado em todo o app — qualquer agrupamento "card com
 * conteudo expansivel" usa esse componente, nao reimplementa.
 */
import { ReactNode, useState, MouseEvent } from "react"

interface Props {
  title: string
  /** Estado inicial aberto. Default: true. */
  defaultOpen?: boolean
  /** Modo controlado (opcional). Se passado, ignora estado interno. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Conteudo no header a direita do titulo (texto curto: "salvo", contagem, etc). */
  status?: ReactNode
  /** Botoes/acoes no header — clicks neles NAO disparam toggle. */
  actions?: ReactNode
  /** Variante visual. "danger" usa borda vermelha pra zona de perigo. */
  variant?: "default" | "danger"
  /** Estilo extra no wrapper externo (ex: marginBottom). */
  style?: React.CSSProperties
  children: ReactNode
}

export function CollapsibleCard({
  title,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  status,
  actions,
  variant = "default",
  style,
  children,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen! : internalOpen

  function toggle() {
    const next = !isOpen
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  function onActionsClick(e: MouseEvent) {
    e.stopPropagation()
  }

  const borderColor = variant === "danger" ? "#FCA5A5" : "#E0E0E0"
  const titleColor = variant === "danger" ? "#991B1B" : "#111"

  return (
    <div style={{
      background: "white",
      borderRadius: 10,
      border: `1px solid ${borderColor}`,
      overflow: "hidden",
      ...style,
    }}>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle() } }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: isOpen ? "16px 20px" : "14px 20px",
          cursor: "pointer",
          userSelect: "none",
          borderBottom: isOpen ? `1px solid ${borderColor}` : "none",
          transition: "padding 0.15s",
        }}
      >
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          <svg
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke={titleColor} strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            style={{
              flexShrink: 0,
              transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
            }}
          >
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <div style={{fontSize:14,fontWeight:700,color:titleColor,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{title}</div>
          {status && (
            <div style={{fontSize:11,color:"#888",marginLeft:4,whiteSpace:"nowrap"}}>{status}</div>
          )}
        </div>
        {actions && (
          <div onClick={onActionsClick} style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            {actions}
          </div>
        )}
      </div>
      <div style={{display: isOpen ? "block" : "none", padding: 24}}>
        {children}
      </div>
    </div>
  )
}
