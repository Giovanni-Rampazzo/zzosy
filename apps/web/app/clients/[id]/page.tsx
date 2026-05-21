"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { NewCampaignModal } from "./NewCampaignModal"
import { EditableText } from "@/components/EditableText"
import { RowThumb } from "@/components/ui/RowThumb"
import { Button } from "@/components/ui/Button"
import { ClientLogoBadge } from "@/components/clients/ClientLogoBadge"
import { loadGoogleFont, loadCustomFontFamily } from "@/lib/google-fonts"


interface Campaign {
  id: string; name: string; createdAt: string; _count: { pieces: number }
  keyVision?: { thumbnailUrl?: string | null } | null
}
interface BrandColor {
  hex: string; name?: string; role: "primary" | "secondary"
}
interface CustomFontFile {
  url: string; weight: number; style: "normal" | "italic"; fileName: string
}
interface ClientSettings {
  segments?: string[]
  categories?: string[]
  filters?: string[]
}
interface Client {
  id: string; name: string; contact: string | null; email: string | null; phone: string | null; address: string | null; brandLogoUrl: string | null; brandFont: string | null; brandColors: BrandColor[] | null; customFontFiles: CustomFontFile[] | null; campaigns: Campaign[]; settings?: ClientSettings | null
}

export default function ClientPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [client, setClient] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null) // campanha id
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)

  async function load() {
    const res = await fetch(`/api/clients/${id}`)
    if (res.ok) {
      const c = await res.json()
      setClient(c)
      if (c.brandFont) {
        const files: CustomFontFile[] = Array.isArray(c.customFontFiles) ? c.customFontFiles : []
        if (files.length > 0) loadCustomFontFamily(c.brandFont, files)
        else loadGoogleFont(c.brandFont)
      }
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  async function deleteCampaign(campaignId: string) {
    await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" })
    setClient(prev => prev ? { ...prev, campaigns: prev.campaigns.filter(c => c.id !== campaignId) } : prev)
    setConfirmDelete(null)
  }

  async function duplicateCampaign(campaignId: string) {
    setDuplicatingId(campaignId)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/duplicate`, { method: "POST" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert("Falha ao duplicar campanha: " + (err.detail ?? err.error ?? "?"))
        return
      }
      // Recarregar lista pra mostrar a duplicada
      await load()
    } finally {
      setDuplicatingId(null)
    }
  }

  if (loading) return <div style={{display:"flex",flexDirection:"column",height:"100vh"}}><TopNav /><div style={{padding:32,color:"#888"}}>Carregando...</div></div>
  if (!client) return <div style={{display:"flex",flexDirection:"column",height:"100vh"}}><TopNav /><div style={{padding:32,color:"#888"}}>Cliente não encontrado</div></div>

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh"}}>
      <TopNav />
      <div style={{flex:1,overflowY:"auto",padding:32,background:"#F5F5F0"}}>
        {/* Padrao ZZOSY: Voltar (variant view, stroke amarelo) lado a lado
            com CTA principal (primary) — mesma estrutura que /medias usa.
            Header de identidade (logo + nome + brand) fica ABAIXO. */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,gap:16,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:16,flex:1,minWidth:0}}>
            <Button
              variant="view"
              size="md"
              onClick={() => router.push("/dashboard")}
            >
              ← Empresas
            </Button>
            <ClientLogoBadge client={{id, name: client.name, brandLogoUrl: client.brandLogoUrl}} size={48} radius={8} />
            <div style={{display:"flex",flexDirection:"column",gap:2,flex:1,minWidth:0}}>
              <div style={{fontSize:22,fontWeight:700,color:"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{client.name}</div>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                {client.brandColors && client.brandColors.length > 0 && (
                  <div style={{display:"flex",gap:4,alignItems:"center"}} title="Cores da marca — clique pra abrir o Design System">
                    {client.brandColors.slice(0,6).map((c, i) => (
                      <div key={i} style={{width:14,height:14,borderRadius:"50%",background:c.hex,border:"1px solid rgba(0,0,0,0.1)",cursor:"pointer"}} onClick={() => router.push(`/clients/${id}/design-system`)} />
                    ))}
                  </div>
                )}
                {client.brandFont && (
                  <span
                    onClick={() => router.push(`/clients/${id}/design-system`)}
                    title="Tipografia da marca — clique pra abrir o Design System"
                    style={{fontSize:12,color:"#666",fontFamily:`'${client.brandFont}', sans-serif`,cursor:"pointer",borderBottom:"1px dashed #ccc"}}>
                    {client.brandFont}
                  </span>
                )}
                <button
                  onClick={() => router.push(`/clients/${id}/design-system`)}
                  title="Design System — cores, fontes, tipografia e logo da marca"
                  style={{background:"transparent",border:"1px solid #D0D0D0",color:"#666",fontSize:11,padding:"3px 10px",borderRadius:4,cursor:"pointer"}}>
                  Design System
                </button>
                <button
                  onClick={() => router.push(`/clients/${id}/edit`)}
                  title="Editar dados administrativos da empresa (contato, endereço, etc)"
                  style={{background:"transparent",border:"1px solid #D0D0D0",color:"#666",fontSize:11,padding:"3px 10px",borderRadius:4,cursor:"pointer"}}>
                  Editar empresa
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Lista de campanhas — PROTAGONISTA da pagina. Botao "+ Nova Campanha"
            fica no header da SECAO de campanhas (alinhado ao titulo "Campanhas"),
            nao no header da pagina. Razao: o CTA pertence ao contexto da lista,
            nao da identidade da empresa. */}
        <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",overflow:"hidden"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 24px",borderBottom:"1px solid #E0E0E0"}}>
              <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                <div style={{fontSize:18,fontWeight:700,color:"#111"}}>Campanhas</div>
                <div style={{fontSize:13,color:"#888"}}>({client.campaigns.length})</div>
              </div>
              <Button variant="primary" size="md" onClick={() => setShowModal(true)}>+ Nova Campanha</Button>
            </div>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr>
                  <th style={{textAlign:"left",padding:"8px 8px",borderBottom:"1px solid #E0E0E0",width:72}}></th>
                  {["Campanha","Peças","Criada em",""].map(h => (
                    <th key={h} style={{textAlign:"left",fontSize:11,fontWeight:600,color:"#888",textTransform:"uppercase",letterSpacing:"0.5px",padding:"8px 16px",borderBottom:"1px solid #E0E0E0"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {client.campaigns.length === 0 ? (
                  <tr><td colSpan={5} style={{textAlign:"center",padding:"48px",color:"#888",fontSize:13}}>Nenhuma campanha criada</td></tr>
                ) : client.campaigns.map(c => (
                  <tr key={c.id} style={{borderBottom:"1px solid #f0f0f0"}}>
                    <td style={{padding:"8px 8px",cursor:"pointer"}} onClick={() => router.push(`/campaigns/${c.id}`)}>
                      <RowThumb src={c.keyVision?.thumbnailUrl} alt={c.name} fallbackText={c.name} />
                    </td>
                    <td style={{padding:"12px 16px",fontWeight:600,fontSize:13}}>
                      <EditableText value={c.name} variant="inline" onSave={async (newName) => {
                        const res = await fetch(`/api/campaigns/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) })
                        if (!res.ok) throw new Error()
                        setClient(prev => prev ? { ...prev, campaigns: prev.campaigns.map(x => x.id === c.id ? { ...x, name: newName } : x) } : prev)
                      }} />
                    </td>
                    <td style={{padding:"12px 16px",color:"#888",fontSize:13}}>{c._count.pieces}</td>
                    <td style={{padding:"12px 16px",color:"#888",fontSize:13}}>{new Date(c.createdAt).toLocaleDateString("pt-BR")}</td>
                    <td style={{padding:"12px 16px",textAlign:"right"}}>
                      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                        {confirmDelete === c.id ? (
                          <div style={{display:"flex",gap:6,alignItems:"center"}}>
                            <span style={{fontSize:11,color:"#666"}}>Confirmar?</span>
                            <Button variant="danger" size="sm" onClick={() => deleteCampaign(c.id)}>Sim</Button>
                            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>Não</Button>
                          </div>
                        ) : (
                          <>
                            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(c.id)}>Apagar</Button>
                            <Button variant="info" size="sm" onClick={() => duplicateCampaign(c.id)} loading={duplicatingId === c.id}>{duplicatingId === c.id ? "Duplicando..." : "Duplicar"}</Button>
                            <Button variant="primary" size="sm" onClick={() => router.push(`/campaigns/${c.id}`)}>Abrir</Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </div>

      {showModal && (
        <NewCampaignModal clientId={id} onClose={() => setShowModal(false)} onCreated={campaignId => router.push(`/campaigns/${campaignId}`)} />
      )}
    </div>
  )
}
