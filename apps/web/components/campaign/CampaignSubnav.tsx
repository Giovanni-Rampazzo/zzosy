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
        style={{
          padding: "8px 4px",
          background: "transparent",
          border: "none",
          borderBottom: isActive ? "2px solid #111" : "2px solid transparent",
          color: props.disabled ? "#bbb" : (isActive ? "#111" : "#666"),
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: isActive ? 700 : 500,
          cursor: props.disabled ? "not-allowed" : (isActive ? "default" : "pointer"),
          marginBottom: -1,
        }}
      >
        {props.label}
      </button>
    )
  }
  // Suporte legado: inlineActions agora vai junto com `actions` (mesmo bucket)
  const combinedActions = (inlineActions || actions) ? (
    <>{inlineActions}{actions}</>
  ) : null
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 24,
      borderBottom: "1px solid #E5E5E5",
      marginBottom: 24,
      paddingBottom: 0,
    }}>
      {/* Tabs — esquerda */}
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <Tab label="Campanha" tab="campaign" href={`/campaigns/${campaignId}`} title="Visao geral da campanha" />
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
      {/* Actions — direita, alinhadas inline com as tabs */}
      {combinedActions && (
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingBottom: 8 }}>
          {combinedActions}
        </div>
      )}
    </div>
  )
}
