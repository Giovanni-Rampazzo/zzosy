"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PageShell } from "@/components/layout/PageShell"
import { RowThumb, colorFromString } from "@/components/ui/RowThumb"
import { Button } from "@/components/ui/Button"
import { ClientEditModal } from "@/components/clients/ClientEditModal"

interface Client {
  id: string; name: string; email: string | null; contact: string | null
  phone?: string | null; address?: string | null; brandLogoUrl?: string | null
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
  const [editingClient, setEditingClient] = useState<Client | null>(null)

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
    else {
      let msg = `Erro ao criar cliente (HTTP ${res.status})`
      try {
        const txt = await res.text()
        if (txt) {
          const d = JSON.parse(txt)
          if (d?.error) msg = d.error
        }
      } catch { /* body nao eh JSON */ }
      setError(msg)
      console.error("[createClient] falhou. status:", res.status)
    }
    setSaving(false)
  }

  async function deleteClient(clientId: string) {
    await fetch(`/api/clients/${clientId}`, { method: "DELETE" })
    setClients(prev => prev.filter(c => c.id !== clientId))
    setConfirmDelete(null)
  }

  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  async function duplicateClient(clientId: string) {
    setDuplicatingId(clientId)
    try {
      const res = await fetch(`/api/clients/${clientId}/duplicate`, { method: "POST" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert("Falha ao duplicar empresa: " + (err.detail ?? err.error ?? "?"))
        return
      }
      await fetchClients()
    } finally {
      setDuplicatingId(null)
    }
  }

  return (
    <PageShell>
      <div className="p-8">

        {/* Padrao ZZOSY: botao de acao primaria dentro da box da lista, nao
            em header separado acima. Header da tabela: titulos das colunas
            + botao + Nova Empresa alinhado a direita. */}
        <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{borderBottom:"1px solid #E0E0E0"}}>
                <th style={{padding:"8px 8px",width:72}}></th>
                {["Empresa","Contato","E-mail","Campanhas"].map(h => (
                  <th key={h} style={{textAlign:"left",fontSize:11,fontWeight:600,color:"#888",textTransform:"uppercase",letterSpacing:"0.5px",padding:"8px 16px"}}>{h}</th>
                ))}
                <th style={{textAlign:"right",padding:"6px 16px"}}>
                  <Button size="sm" onClick={() => setShowModal(true)}>+ Nova Empresa</Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={{textAlign:"center",padding:48,color:"#888",fontSize:13}}>Carregando...</td></tr>}
              {!loading && clients.length === 0 && <tr><td colSpan={6} style={{textAlign:"center",padding:48,color:"#888",fontSize:13}}>Nenhuma empresa ainda. Crie a primeira!</td></tr>}
              {clients.map(c => (
                <tr key={c.id} style={{borderBottom:"1px solid #f0f0f0"}}>
                  <td style={{padding:"8px 8px",cursor:"pointer"}} onClick={() => router.push(`/clients/${c.id}`)}>
                    <RowThumb src={c.brandLogoUrl} alt={c.name} fallbackText={c.name} fallbackBg={colorFromString(c.name)} />
                  </td>
                  <td style={{padding:"12px 16px",fontWeight:600,fontSize:13,cursor:"pointer"}} onClick={() => router.push(`/clients/${c.id}`)}>{c.name}</td>
                  <td style={{padding:"12px 16px",fontSize:13,color:"#555"}}>{c.contact ?? "—"}</td>
                  <td style={{padding:"12px 16px",fontSize:13,color:"#555"}}>{c.email ?? "—"}</td>
                  <td style={{padding:"12px 16px",fontSize:13}}>{c._count.campaigns}</td>
                  <td style={{padding:"12px 16px",textAlign:"right"}}>
                    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                      {confirmDelete === c.id ? (
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <span style={{fontSize:11,color:"#666"}}>Confirmar?</span>
                          <Button variant="danger" size="sm" onClick={() => deleteClient(c.id)}>Sim</Button>
                          <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>Não</Button>
                        </div>
                      ) : (
                        <>
                          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(c.id)}>Apagar</Button>
                          <Button variant="info" size="sm" loading={duplicatingId === c.id} onClick={() => duplicateClient(c.id)}>{duplicatingId === c.id ? "Duplicando..." : "Duplicar"}</Button>
                          <Button variant="secondary" size="sm" onClick={() => router.push(`/clients/${c.id}/edit`)}>Editar</Button>
                          <Button variant="view" size="sm" onClick={() => router.push(`/clients/${c.id}`)}>Entrar</Button>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"white",borderRadius:12,width:480,boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
            <div style={{display:"flex",alignItems:"center",padding:"16px 24px",borderBottom:"1px solid #E0E0E0"}}>
              <div style={{fontWeight:700,fontSize:16}}>Nova Empresa</div>
            </div>
            <form onSubmit={createClient} style={{padding:24,display:"flex",flexDirection:"column",gap:14}}>
              {[["name","Nome *","Nome da empresa"],["contact","Contato","Nome do contato"],["email","E-mail","email@empresa.com"],["phone","Telefone","(11) 99999-9999"],["address","Endereço","Cidade, Estado"]].map(([k,l,p]) => (
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
                <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
                <Button type="submit" loading={saving}>{saving ? "Criando..." : "Criar cliente"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {editingClient && (
        <ClientEditModal
          client={editingClient}
          onClose={() => setEditingClient(null)}
          onSaved={(u) => setClients(prev => prev.map(c => c.id === u.id ? { ...c, ...u } : c))}
        />
      )}
    </PageShell>
  )
}
