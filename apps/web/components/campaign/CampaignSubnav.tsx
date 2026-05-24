"use client"
/**
 * Sub-nav contextual da campanha. Aparece em /campaigns/[id], /assets, /pieces,
 * /presentation. Visual TAB: tabs leves alinhadas a ESQUERDA, com `actions`
 * (botoes de acao da pagina) inline a DIREITA. Diferenciacao clara entre
 * navegacao (tabs underline-style) e CTAs (botoes solidos).
 *
 * Removido o "← Empresa" — o breadcrumb da pagina ja faz esse role, e
 * existe a aba "Campanhas" no TopNav global pra subir o nivel.
 */
import { useRouter } from "next/navigation"
import React from "react"

interface Props {
  campaignId: string
  /** @deprecated mantido pra compat — nao mais renderizado. */
  clientId?: string
  /** @deprecated mantido pra compat — nao mais renderizado. */
  clientName?: string
  /** Acoes da pagina atual — render a direita da barra de tabs. */
  actions?: React.ReactNode
  /** @deprecated unificado com `actions`. */
  inlineActions?: React.ReactNode
  activeTab?: "campaign" | "pieces" | "assets" | "kv" | "presentation" | null
  hasAssets?: boolean
  hasPieces?: boolean
}

/**
 * Estilo PADRAO ZZOSY 2026-05-24 (user pedido) pros botoes de subnavegacao:
 * fundo branco + borda 2px #555 + texto preto bold. Active = fill amarelo
 * brand (#F5C400). Disabled = cinza. Mesmo visual do Button variant=secondary,
 * mas o active vira primary fill.
 *
 * Centralizado aqui pra reuso futuro (outras subnavs).
 */
export const SUBNAV_BUTTON_BASE: React.CSSProperties = {
  padding: "10px 18px",
  background: "white",
  border: "2px solid #555555",
  borderRadius: 6,
  color: "#111111",
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  transition: "background 0.12s, color 0.12s, border-color 0.12s",
  whiteSpace: "nowrap",
}

export function subnavButtonStyle(opts: { active?: boolean; disabled?: boolean }): React.CSSProperties {
  const { active, disabled } = opts
  if (disabled) {
    return { ...SUBNAV_BUTTON_BASE, background: "#F5F5F0", color: "#bbb", borderColor: "#D0D0D0", cursor: "not-allowed" }
  }
  if (active) {
    return { ...SUBNAV_BUTTON_BASE, background: "#F5C400", borderColor: "#F5C400", color: "#111" }
  }
  return SUBNAV_BUTTON_BASE
}

export function CampaignSubnav({ campaignId, actions, inlineActions, activeTab, hasAssets, hasPieces }: Props) {
  const router = useRouter()
  const Tab = (props: { label: string; tab: NonNullable<Props["activeTab"]>; href: string; title: string; disabled?: boolean }) => {
    const isActive = activeTab === props.tab
    return (
      <button
        type="button"
        onClick={() => { if (!isActive && !props.disabled) router.push(props.href) }}
        disabled={props.disabled}
        title={props.title}
        style={subnavButtonStyle({ active: isActive, disabled: props.disabled })}
        onMouseEnter={e => {
          if (!isActive && !props.disabled) {
            e.currentTarget.style.background = "#F5F5F0"
          }
        }}
        onMouseLeave={e => {
          if (!isActive && !props.disabled) {
            e.currentTarget.style.background = "white"
          }
        }}
      >
        {props.label}
      </button>
    )
  }
  const combinedActions = (inlineActions || actions) ? (
    <>{inlineActions}{actions}</>
  ) : null
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 16,
      marginBottom: 16,
      flexWrap: "wrap",
    }}>
      {/* Subnav buttons — esquerda. Padrao ZZOSY: todos com border 2px #555,
          active = fill amarelo brand. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Tab label="Assets" tab="assets" href={`/campaigns/${campaignId}/assets`} title="Lista de assets desta campanha" />
        <Tab
          label="KV"
          tab="kv"
          href={`/editor?campaignId=${campaignId}`}
          title={hasAssets === false ? "Importe um PSD ou adicione assets primeiro" : "Editor da Matriz (Key Vision)"}
          disabled={hasAssets === false}
        />
        <Tab label="Peças" tab="pieces" href={`/pieces?campaignId=${campaignId}`} title="Peças desta campanha" />
        <Tab
          label="Apresentação"
          tab="presentation"
          href={`/campaigns/${campaignId}/presentation`}
          title={hasPieces === false ? "Gere peças primeiro" : "Apresentacao desta campanha"}
          disabled={hasPieces === false}
        />
      </div>
      {combinedActions && (
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {combinedActions}
        </div>
      )}
    </div>
  )
}
