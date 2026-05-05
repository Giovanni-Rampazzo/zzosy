"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PageShell } from "@/components/layout/PageShell"

interface Client {
  id: string; name: string; email: string | null; contact: string | null
  _count: { campaigns: number }; createdAt: string
}

export default function DashboardPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: "", contact: "", email: "", phone: "", address: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => { fetchClients() }, [])

  async function fetchClients() {
    const res = await fetch("/api/clients")
    if (res.ok) setClients(await res.json())
    setLoading(false)
  }

  async function createClient(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError("Nome obrigatório"); return }
    setSaving(true); setError("")
    const res = await fetch("/api/clients", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form)
    })
    if (res.ok) { setShowModal(false); setForm({ name:"",contact:"",email:"",phone:"",address:"" }); fetchClients() }
    else { const d = await res.json(); setError(d.error ?? "Erro ao criar cliente") }
    setSaving(false)
  }

  async function deleteClient(clientId: string) {
    await fetch(`/api/clients/${clientId}`, { method: "DELETE" })
    setClients(prev => prev.filter(c => c.id !== clientId))
    setConfirmDelete(null)
  }

  return (
    <PageShell>
      <div className="p-8">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
          <div>
            <h1 style={{fontSize:22,fontWeight:700,margin:0}}>Clientes</h1>
            <p style={{fontSize:12,color:"#888",margin:"4px 0 0"}}>Gerencie todos os clientes da sua agência</p>
          </div>
          <button onClick={() => setShowModal(true)} style={{background:"#F5C400",border:"none",borderRadius:6,padding:"8px 16px",fontWeight:600,fontSize:12,cursor:"pointer"}}>
            + Novo Cliente
          </button>
        </div>

        <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{borderBottom:"1px solid #E0E0E0"}}>
                {["Cliente","Contato","E-mail","Campanhas",""].map(h => (
                  <th key={h} style={{textAlign:"left",fontSize:11,fontWeight:600,color:"#888",textTransform:"uppercase",letterSpacing:"0.5px",padding:"8px 16px"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} style={{textAlign:"center",padding:48,color:"#888",fontSize:13}}>Carregando...</td></tr>}
              {!loading && clients.length === 0 && <tr><td colSpan={5} style={{textAlign:"center",padding:48,color:"#888",fontSize:13}}>Nenhum cliente ainda. Crie o primeiro!</td></tr>}
              {clients.map(c => (
                <tr key={c.id} style={{borderBottom:"1px solid #f0f0f0"}}>
                  <td style={{padding:"12px 16px",fontWeight:600,fontSize:13,cursor:"pointer"}} onClick={() => router.push(`/clients/${c.id}`)}>{c.name}</td>
                  <td style={{padding:"12px 16px",fontSize:13,color:"#555"}}>{c.contact ?? "—"}</td>
                  <td style={{padding:"12px 16px",fontSize:13,color:"#555"}}>{c.email ?? "—"}</td>
                  <td style={{padding:"12px 16px",fontSize:13}}>{c._count.campaigns}</td>
                  <td style={{padding:"12px 16px",textAlign:"right"}}>
                    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                      <button onClick={() => router.push(`/clients/${c.id}`)} style={{fontSize:11,fontWeight:600,border:"1px solid #E0E0E0",padding:"5px 10px",borderRadius:5,background:"white",cursor:"pointer"}}>Ver</button>
                      {confirmDelete === c.id ? (
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <span style={{fontSize:11,color:"#666"}}>Confirmar?</span>
                          <button onClick={() => deleteClient(c.id)} style={{fontSize:11,border:"none",padding:"5px 10px",borderRadius:5,background:"#555",color:"white",cursor:"pointer",fontWeight:600}}>Sim</button>
                          <button onClick={() => setConfirmDelete(null)} style={{fontSize:11,border:"1px solid #E0E0E0",padding:"5px 10px",borderRadius:5,background:"white",cursor:"pointer",fontWeight:600}}>Não</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(c.id)} style={{fontSize:11,border:"none",padding:"5px 10px",borderRadius:5,background:"#f0f0f0",color:"#666",cursor:"pointer",fontWeight:600}}>🗑</button>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"white",borderRadius:12,width:480,boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 24px",borderBottom:"1px solid #E0E0E0"}}>
              <div style={{fontWeight:700,fontSize:16}}>Novo Cliente</div>
              <button onClick={() => setShowModal(false)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#888"}}>✕</button>
            </div>
            <form onSubmit={createClient} style={{padding:24,display:"flex",flexDirection:"column",gap:14}}>
              {[["name","Nome *","Nome do cliente"],["contact","Contato","Nome do contato"],["email","E-mail","email@cliente.com"],["phone","Telefone","(11) 99999-9999"],["address","Endereço","Cidade, Estado"]].map(([k,l,p]) => (
                <div key={k}>
                  <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.5px",color:"#888",display:"block",marginBottom:5}}>{l}</label>
                  <input
                    type={k==="email"?"email":"text"}
                    value={(form as any)[k]}
                    onChange={e => setForm(f => ({...f,[k]:e.target.value}))}
                    placeholder={p}
                    required={k==="name"}
                    style={{width:"100%",padding:"8px 12px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box" as const}}
                  />
                </div>
              ))}
              {error && <p style={{color:"#666",fontSize:12,margin:0}}>{error}</p>}
              <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:4}}>
                <button type="button" onClick={() => setShowModal(false)} style={{padding:"8px 16px",border:"1px solid #E0E0E0",borderRadius:6,background:"white",cursor:"pointer",fontSize:12,fontWeight:600}}>Cancelar</button>
                <button type="submit" disabled={saving} style={{padding:"8px 16px",border:"none",borderRadius:6,background:"#F5C400",cursor:"pointer",fontSize:12,fontWeight:600,opacity:saving?0.7:1}}>
                  {saving ? "Criando..." : "Criar cliente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageShell>
  )
}
