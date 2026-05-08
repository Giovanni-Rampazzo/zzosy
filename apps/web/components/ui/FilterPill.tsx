"use client"
/**
 * Botao-pill reusavel pra filtros e tabs.
 *
 * Estilo padrao do ZZOSY (mesmo do filtro de Formatos no DeliveryDialog):
 *  - Inativo: borda 1px #ddd, fundo branco, texto cinza, fontWeight 600
 *  - Ativo: borda 2px da cor de destaque, fundo claro da cor, texto da cor
 *  - Default usa amarelo da marca (#F5C400). Pode ser sobrescrito via accent/accentBg/accentText
 *    para casos com cor semantica (ex: status de peca verde/vermelho).
 *
 * Uso:
 *   <FilterPill active={x === "ALL"} onClick={() => setX("ALL")}>Todas</FilterPill>
 *   <FilterPill active={view === "grid"} onClick={() => setView("grid")} accent="#F5C400">Grid</FilterPill>
 */
import React from "react"

interface Props {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  /** Cor de destaque quando ativo. Default: #F5C400 (amarelo da marca). */
  accent?: string
  /** Fundo quando ativo. Default: #fffbeb. */
  accentBg?: string
  /** Cor do texto quando ativo. Default: usa accent. */
  accentText?: string
  /** Tamanho do botao. */
  size?: "sm" | "md"
  title?: string
  disabled?: boolean
}

export function FilterPill({
  active, onClick, children,
  accent = "#F5C400",
  accentBg = "#fffbeb",
  accentText,
  size = "md",
  title,
  disabled,
}: Props) {
  const padding = size === "sm" ? "5px 12px" : "6px 14px"
  const fontSize = size === "sm" ? 11 : 12
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        padding,
        border: active ? `2px solid ${accent}` : "1px solid #ddd",
        borderRadius: 6,
        background: active ? accentBg : "#fff",
        color: active ? (accentText ?? accent) : "#888",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize,
        fontWeight: 600,
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.15s, border-color 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  )
}
