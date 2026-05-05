"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { NewCampaignModal } from "./NewCampaignModal"
import { EditableText } from "@/components/EditableText"
import { ClientEditModal } from "@/components/clients/ClientEditModal"

interface Campaign {
  id: string; name: string; createdAt: string; _count: { pieces: number }
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
  const [confirmDeleteClient, setConfirmDeleteClient] = useState(false)
  const [activeTab, setActiveTab] = useState("campaigns")
  const [showEditModal, setShowEditModal] = useState(false)

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

  async function deleteClient() {
    await fetch(`/api/clients/${id}`, { method: "DELETE" })
    router.push("/dashboard")
  }

  if (loading) return <div style={{display:"flex",flexDirection:"column",height:"100vh"}}><TopNav /><div style={{padding:32,color:"#888"}}>Carregando...</div></div>
  if (!client) return <div style={{display:"flex",flexDirection:"column",height:"100vh"}}><TopNav /><div style={{padding:32,color:"#888"}}>Cliente não encontrado</div></div>

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh"}}>
      <TopNav />
      <div style={{flex:1,overflowY:"auto",padding:32,background:"#F5F5F0"}}>
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
              <div style={{fontSize:20,fontWeight:700, display:"flex", alignItems:"center", gap: 10}}>
                <span>{client.name}</span>
                <button
                  onClick={() => setShowEditModal(true)}
                  style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, background: "#f0f0f0", color: "#555", border: "none", borderRadius: 6, cursor: "pointer" }}
                >
                  Editar
                </button>
              </div>
              {client.address && <div style={{color:"#888",fontSize:12,marginTop:4}}>{client.address}</div>}
            </div>
            <div style={{display:"flex",gap:10}}>
              <button
                onClick={() => setConfirmDeleteClient(true)}
                style={{padding:"6px 14px",background:"#f0f0f0",border:"none",borderRadius:6,color:"#555",fontWeight:600,fontSize:12,cursor:"pointer"}}
              >
                🗑 Apagar cliente
              </button>
              <button
                onClick={() => setShowModal(true)}
                style={{background:"#F5C400",border:"none",borderRadius:6,padding:"8px 16px",fontWeight:600,fontSize:12,cursor:"pointer"}}
              >
                + Nova Campanha
              </button>
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

        {/* Tabs */}
        <div style={{display:"flex",borderBottom:"1px solid #E0E0E0",marginBottom:24}}>
          {["campaigns","pieces","deliveries","medias"].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding:"10px 20px",fontSize:13,fontWeight:500,cursor:"pointer",
              background:"transparent",border:"none",
              color: activeTab===tab ? "#111" : "#888",
              borderBottom: activeTab===tab ? "2px solid #F5C400" : "2px solid transparent",
              marginBottom:-1,
            }}>
              {tab==="campaigns"?"Campanhas":tab==="pieces"?"Peças":tab==="deliveries"?"Entregas":"Mídias"}
            </button>
          ))}
        </div>

        {activeTab === "campaigns" && (
          <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr>
                  {["Campanha","Peças","Criada em",""].map(h => (
                    <th key={h} style={{textAlign:"left",fontSize:11,fontWeight:600,color:"#888",textTransform:"uppercase",letterSpacing:"0.5px",padding:"8px 16px",borderBottom:"1px solid #E0E0E0"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {client.campaigns.length === 0 ? (
                  <tr><td colSpan={4} style={{textAlign:"center",padding:"48px",color:"#888",fontSize:13}}>Nenhuma campanha criada</td></tr>
                ) : client.campaigns.map(c => (
                  <tr key={c.id} style={{borderBottom:"1px solid #f0f0f0"}}>
                    <td style={{padding:"12px 16px",fontWeight:600,fontSize:13,cursor:"pointer"}} onClick={() => router.push(`/campaigns/${c.id}`)}>{c.name}</td>
                    <td style={{padding:"12px 16px",color:"#888",fontSize:13}}>{c._count.pieces}</td>
                    <td style={{padding:"12px 16px",color:"#888",fontSize:13}}>{new Date(c.createdAt).toLocaleDateString("pt-BR")}</td>
                    <td style={{padding:"12px 16px",textAlign:"right"}}>
                      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                        <button onClick={() => router.push(`/campaigns/${c.id}`)} style={{fontSize:11,fontWeight:600,border:"1px solid #E0E0E0",padding:"5px 12px",borderRadius:6,background:"white",cursor:"pointer"}}>Abrir</button>
                        {confirmDelete === c.id ? (
                          <div style={{display:"flex",gap:6,alignItems:"center"}}>
                            <span style={{fontSize:11,color:"#666"}}>Confirmar?</span>
                            <button onClick={() => deleteCampaign(c.id)} style={{fontSize:11,fontWeight:600,border:"none",padding:"5px 10px",borderRadius:6,background:"#555",color:"white",cursor:"pointer"}}>Sim</button>
                            <button onClick={() => setConfirmDelete(null)} style={{fontSize:11,fontWeight:600,border:"1px solid #E0E0E0",padding:"5px 10px",borderRadius:6,background:"white",cursor:"pointer"}}>Não</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(c.id)} style={{fontSize:11,fontWeight:600,border:"none",padding:"5px 10px",borderRadius:6,background:"#f0f0f0",color:"#555",cursor:"pointer"}}>🗑</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab !== "campaigns" && (
          <div style={{textAlign:"center",padding:"64px 0",color:"#888"}}>Em breve</div>
        )}
      </div>

      {/* Modal apagar cliente */}
      {confirmDeleteClient && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"white",borderRadius:12,padding:32,width:400,textAlign:"center"}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:12}}>Apagar cliente?</div>
            <div style={{fontSize:13,color:"#888",marginBottom:24}}>Esta ação é irreversível e apagará todas as campanhas do cliente.</div>
            <div style={{display:"flex",gap:12,justifyContent:"center"}}>
              <button onClick={() => setConfirmDeleteClient(false)} style={{padding:"8px 20px",border:"1px solid #E0E0E0",borderRadius:6,background:"white",cursor:"pointer",fontSize:13,fontWeight:600}}>Cancelar</button>
              <button onClick={deleteClient} style={{padding:"8px 20px",border:"none",borderRadius:6,background:"#555",color:"white",cursor:"pointer",fontSize:13,fontWeight:600}}>Apagar</button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && client && (
        <ClientEditModal
          client={client}
          onClose={() => setShowEditModal(false)}
          onSaved={(u) => setClient(prev => prev ? { ...prev, ...u } : prev)}
        />
      )}

      {showModal && (
        <NewCampaignModal clientId={id} onClose={() => setShowModal(false)} onCreated={campaignId => router.push(`/campaigns/${campaignId}`)} />
      )}
    </div>
  )
}
