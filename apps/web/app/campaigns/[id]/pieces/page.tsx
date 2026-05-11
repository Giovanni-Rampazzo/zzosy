import { redirect } from "next/navigation"

// Rota dedicada de pecas por campanha. Internamente redireciona pra /pieces
// com filtro de campaignId — assim reaproveitamos toda a logica de listagem,
// filtros, sort, export e grid/list views ja implementada na pagina global.
// A pagina global detecta o campaignId e mostra a CampaignSubnav contextual.
export default async function CampaignPiecesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/pieces?campaignId=${id}`)
}
