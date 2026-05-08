"use client"
import { useState } from "react"
import { Button } from "@/components/ui/Button"

interface Props {
  onClose: () => void
  onCreated: () => void
}

export function NewClientModal({ onClose, onCreated }: Props) {
  const [form, setForm] = useState({ name: "", contact: "", email: "", phone: "", address: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError("Nome é obrigatório"); return }
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Erro ao criar cliente")
      } else {
        onCreated()
      }
    } catch (err) {
      setError("Erro de conexão")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:12,width:480,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
        <div style={{padding:"16px 24px",borderBottom:"1px solid #E0E0E0"}}>
          <span style={{fontWeight:700,fontSize:16}}>Novo Cliente</span>
        </div>
        <form onSubmit={handleSubmit} style={{padding:24,display:"flex",flexDirection:"column",gap:16}}>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>Nome *</label>
            <input
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder="Nome do cliente"
              required
              style={{padding:"8px 12px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:13,outline:"none",fontFamily:"inherit"}}
            />
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>Contato</label>
              <input value={form.contact} onChange={e => set("contact", e.target.value)} placeholder="Nome do contato" style={{padding:"8px 12px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:13,outline:"none",fontFamily:"inherit"}} />
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>E-mail</label>
              <input type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="email@cliente.com" style={{padding:"8px 12px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:13,outline:"none",fontFamily:"inherit"}} />
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>Telefone</label>
              <input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="(11) 99999-9999" style={{padding:"8px 12px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:13,outline:"none",fontFamily:"inherit"}} />
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>Endereço</label>
              <input value={form.address} onChange={e => set("address", e.target.value)} placeholder="Cidade, Estado" style={{padding:"8px 12px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:13,outline:"none",fontFamily:"inherit"}} />
            </div>
          </div>
          {error && <p style={{color:"#dc2626",fontSize:12,margin:0}}>{error}</p>}
          <div style={{display:"flex",justifyContent:"flex-end",gap:12,marginTop:8}}>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={loading}>{loading ? "Criando..." : "Criar cliente"}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
