"use client"
/**
 * Sub-nav contextual da campanha. Aparece em todas as paginas internas:
 * /campaigns/[id], /campaigns/[id]/assets, /campaigns/[id]/pieces, etc.
 *
 * Linha 1 (navegacao):
 *   - "← Cliente" (volta pro pai)
 *   - "Peças" (vai pra /campaigns/[id]/pieces)
 *
 * Linha 2 (acoes da pagina atual, opcional):
 *   - configuravel via prop `actions`
 *   - botoes lado a lado, mesma altura, alinhados a esquerda
 *
 * Padrao de estilos seguido: ver docs/UI_BUTTONS.md
 */
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import React from "react"

interface Props {
  campaignId: string
  clientId?: string
  // Acoes da pagina atual (opcional). Cada acao vira um Button na linha 2.
  // Permite cada pagina decidir suas proprias acoes mantendo o estilo consistente.
  actions?: React.ReactNode
  // Marca o botao "Peças" como ativo (highlight). Util quando ja estamos
  // dentro da pagina de pecas e queremos sinalizar.
  activeTab?: "pieces" | null
}

export function CampaignSubnav({ campaignId, clientId, actions, activeTab }: Props) {
  const router = useRouter()
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
      {/* Linha 1: navegacao */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Button
          variant="secondary"
          size="md"
          onClick={() => clientId ? router.push(`/clients/${clientId}`) : router.back()}
          title="Voltar para o cliente"
        >
          ← Cliente
        </Button>
        <Button
          variant={activeTab === "pieces" ? "dark" : "primary"}
          size="md"
          onClick={() => router.push(`/campaigns/${campaignId}/pieces`)}
          title="Ver pecas desta campanha"
          disabled={activeTab === "pieces"}
        >
          Peças
        </Button>
      </div>

      {/* Linha 2: acoes da pagina (opcional) */}
      {actions && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {actions}
        </div>
      )}
    </div>
  )
}
