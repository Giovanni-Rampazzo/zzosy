"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { NewCampaignModal } from "./NewCampaignModal"
import { EditableText } from "@/components/EditableText"
import { RowThumb } from "@/components/ui/RowThumb"
import { Button } from "@/components/ui/Button"


interface Campaign {
  id: string; name: string; createdAt: string; _count: { pieces: number }
  keyVision?: { thumbnailUrl?: string | null } | null
}
interface Client {
  id: string; name: string; contact: string | null; email: string | null; phone: string | null; address: string | null; campaigns: Campaign[]
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
    if (res.ok) setClient(await res.json())
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
        <button
          onClick={() => router.push("/dashboard")}
          style={{background:"transparent",border:"none",color:"#888",fontSize:12,cursor:"pointer",padding:0,marginBottom:12}}
        >
          ← Clientes
        </button>
        {/* Breadcrumb */}
        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"#888",marginBottom:20}}>
          <span style={{cursor:"pointer"}} onClick={() => router.push("/dashboard")}>Clientes</span>
          <span style={{color:"#ccc"}}>/</span>
          <span style={{fontWeight:600,color:"#111"}}>{client.name}</span>
        </div>

        {/* Header */}
        <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",padding:24,marginBottom:24}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
            <div>
              <div style={{fontSize:20,fontWeight:700}}>{client.name}</div>
              {client.address && <div style={{color:"#888",fontSize:12,marginTop:4}}>{client.address}</div>}
            </div>
            <div style={{display:"flex",gap:10}}>
              <Button variant="primary" onClick={() => setShowModal(true)}>+ Nova Campanha</Button>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16}}>
            {[["Contato",client.contact],["E-mail",client.email],["Telefone",client.phone]].map(([l,v]) => (
              <div key={l as string}>
                <div style={{fontSize:11,color:"#888",marginBottom:2}}>{l}</div>
                <div style={{fontSize:13}}>{v ?? "—"}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Lista de campanhas */}
        <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",overflow:"hidden"}}>
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
