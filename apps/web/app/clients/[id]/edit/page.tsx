"use client"
/**
 * /clients/[id]/edit
 *
 * Pagina de edicao do cliente. Mantida como rota separada (e nao modal)
 * porque eventualmente vai virar dashboard rico do cliente (metricas,
 * historico, configs).
 *
 * Hoje contem:
 *  - Form com 5 campos (name, contact, email, phone, address) -> PATCH /api/clients/[id]
 *  - Apagar cliente com confirmacao dupla -> DELETE /api/clients/[id]
 */
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { Button } from "@/components/ui/Button"

interface Client {
  id: string
  name: string
  contact: string | null
  email: string | null
  phone: string | null
  address: string | null
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: "#888",
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #E0E0E0",
  borderRadius: 6,
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
  background: "white",
}

export default function EditClientPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [client, setClient] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmText, setConfirmText] = useState("")

  // Campos do form (controlados separadamente do client carregado pra
  // permitir cancelar sem perder o estado original)
  const [name, setName] = useState("")
  const [contact, setContact] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")

  useEffect(() => {
    fetch(`/api/clients/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then((c: Client | null) => {
        if (!c) { setLoading(false); return }
        setClient(c)
        setName(c.name)
        setContact(c.contact ?? "")
        setEmail(c.email ?? "")
        setPhone(c.phone ?? "")
        setAddress(c.address ?? "")
        setLoading(false)
      })
  }, [id])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError("Nome obrigatório"); return }
    setError("")
    setSaving(true)
    const res = await fetch(`/api/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        contact: contact.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
      }),
    })
    setSaving(false)
    if (res.ok) {
      router.push(`/clients/${id}`)
    } else {
      setError("Erro ao salvar. Tente novamente.")
    }
  }

  async function handleDelete() {
    // Confirmacao dupla: precisa digitar o nome exato pra liberar
    if (confirmText.trim() !== (client?.name ?? "")) {
      setError(`Digite "${client?.name}" exatamente pra confirmar.`)
      return
    }
    const res = await fetch(`/api/clients/${id}`, { method: "DELETE" })
    if (res.ok) {
      router.push("/dashboard")
    } else {
      setError("Erro ao apagar cliente.")
    }
  }

  if (loading) {
    return (
      <div style={{display:"flex",flexDirection:"column",height:"100vh"}}>
        <TopNav />
        <div style={{padding:32,color:"#888"}}>Carregando...</div>
      </div>
    )
  }
  if (!client) {
    return (
      <div style={{display:"flex",flexDirection:"column",height:"100vh"}}>
        <TopNav />
        <div style={{padding:32,color:"#888"}}>Cliente não encontrado</div>
      </div>
    )
  }

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh"}}>
      <TopNav />
      <div style={{flex:1,overflowY:"auto",padding:32,background:"#F5F5F0"}}>
        <button
          onClick={() => router.push(`/clients/${id}`)}
          style={{background:"transparent",border:"none",color:"#888",fontSize:12,cursor:"pointer",padding:0,marginBottom:12}}
        >
          ← {client.name}
        </button>

        {/* Breadcrumb */}
        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"#888",marginBottom:20}}>
          <span style={{cursor:"pointer"}} onClick={() => router.push("/dashboard")}>Clientes</span>
          <span style={{color:"#ccc"}}>/</span>
          <span style={{cursor:"pointer"}} onClick={() => router.push(`/clients/${id}`)}>{client.name}</span>
          <span style={{color:"#ccc"}}>/</span>
          <span style={{fontWeight:600,color:"#111"}}>Editar</span>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} style={{maxWidth:640}}>
          <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",padding:24,marginBottom:24}}>
            <div style={{fontSize:14,fontWeight:700,marginBottom:20}}>Dados do cliente</div>

            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <label style={labelStyle}>Nome *</label>
                <input value={name} onChange={e=>setName(e.target.value)} style={inputStyle} autoFocus />
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <label style={labelStyle}>Contato</label>
                  <input value={contact} onChange={e=>setContact(e.target.value)} placeholder="Nome do contato" style={inputStyle} />
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <label style={labelStyle}>E-mail</label>
                  <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="contato@cliente.com" style={inputStyle} />
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <label style={labelStyle}>Telefone</label>
                <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(11) 99999-9999" style={inputStyle} />
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <label style={labelStyle}>Endereço</label>
                <input value={address} onChange={e=>setAddress(e.target.value)} placeholder="Endereço completo" style={inputStyle} />
              </div>
            </div>

            {error && <p style={{color:"#dc2626",fontSize:12,margin:"16px 0 0"}}>{error}</p>}

            <div style={{display:"flex",justifyContent:"flex-end",gap:12,marginTop:24}}>
              <Button type="button" variant="secondary" onClick={() => router.push(`/clients/${id}`)}>Cancelar</Button>
              <Button type="submit" variant="primary" loading={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </div>
          </div>
        </form>

        {/* Zona de perigo: apagar cliente */}
        <div style={{maxWidth:640,background:"white",borderRadius:10,border:"1px solid #FCA5A5",padding:24}}>
          <div style={{fontSize:14,fontWeight:700,color:"#991B1B",marginBottom:8}}>Zona de perigo</div>
          <p style={{fontSize:12,color:"#666",margin:"0 0 16px",lineHeight:1.5}}>
            Apagar o cliente remove permanentemente todas as campanhas, peças e entregas associadas. Esta ação não pode ser desfeita.
          </p>
          {!confirmDelete ? (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Apagar cliente</Button>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <label style={{fontSize:12,color:"#666"}}>
                Digite <strong>{client.name}</strong> pra confirmar:
              </label>
              <input
                value={confirmText}
                onChange={e=>setConfirmText(e.target.value)}
                style={{...inputStyle,maxWidth:320}}
                autoFocus
              />
              <div style={{display:"flex",gap:8}}>
                <Button variant="secondary" size="sm" onClick={() => { setConfirmDelete(false); setConfirmText(""); setError("") }}>Cancelar</Button>
                <Button variant="danger" size="sm" onClick={handleDelete} disabled={confirmText.trim() !== client.name}>Apagar definitivamente</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
