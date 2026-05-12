"use client"
/**
 * Sub-nav contextual da campanha. Aparece em todas as paginas internas:
 * /campaigns/[id], /campaigns/[id]/assets, /campaigns/[id]/pieces, etc.
 *
 * Linha 1 (navegacao):
 *   - "← Cliente" (volta pro cliente)
 *   - "Campanha" (vai pra /campaigns/[id]) — escondido se ja estamos na campanha
 *   - "Peças" (vai pra /pieces?campaignId=X) — escondido se ja estamos em pecas
 *
 * Linha 2 (acoes da pagina atual, opcional):
 *   - configuravel via prop `actions`
 *
 * Padrao: TODA navegacao secundaria fica ALINHADA A DIREITA da tela.
 * O conteudo da pagina (titulo, body) flui da esquerda, mas a barra de
 * navegacao das paginas filhas fica colada na direita pra criar um lugar
 * consistente onde o user procura voltar/navegar.
 */
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import React from "react"

interface Props {
  campaignId: string
  clientId?: string
  // Acoes da pagina atual (opcional). Cada acao vira um Button na linha 2.
  actions?: React.ReactNode
  // Marca a aba ativa (escondendo o respectivo botao da barra de nav, ja
  // que clicar nele seria no-op).
  activeTab?: "campaign" | "pieces" | "assets" | null
}

export function CampaignSubnav({ campaignId, clientId, actions, activeTab }: Props) {
  const router = useRouter()
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
      {/* Linha 1: navegacao — alinhada a DIREITA da tela */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
        <Button
          variant="secondary"
          size="md"
          onClick={() => clientId ? router.push(`/clients/${clientId}`) : router.back()}
          title="Voltar para o cliente"
        >
          ← Cliente
        </Button>
        {activeTab !== "campaign" && (
          <Button
            variant="secondary"
            size="md"
            onClick={() => router.push(`/campaigns/${campaignId}`)}
            title="Ir para a pagina da campanha"
          >
            Campanha
          </Button>
        )}
        {activeTab !== "pieces" && (
          <Button
            variant="primary"
            size="md"
            onClick={() => router.push(`/pieces?campaignId=${campaignId}`)}
            title="Ver pecas desta campanha"
          >
            Peças
          </Button>
        )}
      </div>

      {/* Linha 2: acoes da pagina (opcional) — tambem alinhada a direita */}
      {actions && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {actions}
        </div>
      )}
    </div>
  )
}
