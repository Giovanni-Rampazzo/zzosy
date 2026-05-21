"use client"
/**
 * Modal shell padrao: backdrop semitransparente, fecha em ESC e click-fora
 * (configuravel), zIndex consistente.
 *
 * Antes (audit F5.4) cada dialog rolava o proprio com inconsistencias:
 *   - ClientEditModal/CampaignEditModal: ESC + click-fora + zIndex 50 (reference)
 *   - DeliveryDialog: so click-fora, sem ESC
 *   - ExportDialog/DuplicateFormatDialog/NewClientModal/GeneratePiecesModal:
 *     nem ESC nem click-fora
 *   - Variavam tons do backdrop (0.5 vs 0.6 vs 0.7)
 *
 * Agora: rgba(0,0,0,0.5), zIndex 50, ESC sempre, click-fora opt-in via
 * `closeOnBackdrop`. `lock` desabilita ambos enquanto operacao critica roda.
 */
import { ReactNode, MouseEvent } from "react"
import { useModalEscape } from "@/lib/useModalEscape"

export interface ModalProps {
  open: boolean
  onClose: () => void
  /** Bloqueia ESC + click-fora enquanto true (ex: durante salvamento/export). */
  lock?: boolean
  /** Default true — clicar no backdrop fecha. */
  closeOnBackdrop?: boolean
  /** Largura do card. Default min(560px, 92vw). */
  width?: number | string
  /** Altura maxima. Default 85vh. */
  maxHeight?: number | string
  /** Cor de fundo do card. Default branco. Use "#1a1a1a" pra dialog dark. */
  background?: string
  /** Estilo extra do card. */
  cardStyle?: React.CSSProperties
  /** zIndex (default 50). Sobre tudo do app, abaixo de tooltips do browser. */
  zIndex?: number
  children: ReactNode
}

export function Modal({
  open,
  onClose,
  lock = false,
  closeOnBackdrop = true,
  width,
  maxHeight = "85vh",
  background = "white",
  cardStyle,
  zIndex = 50,
  children,
}: ModalProps) {
  useModalEscape(open && !lock, onClose)
  if (!open) return null

  function handleBackdrop(e: MouseEvent) {
    if (lock || !closeOnBackdrop) return
    if (e.target === e.currentTarget) onClose()
  }

  const resolvedWidth = typeof width === "number" ? `${width}px` : (width ?? "min(560px, 92vw)")

  return (
    <div
      onMouseDown={handleBackdrop}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background,
          borderRadius: 12,
          width: resolvedWidth,
          maxHeight,
          overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          display: "flex",
          flexDirection: "column",
          ...cardStyle,
        }}
      >
        {children}
      </div>
    </div>
  )
}
