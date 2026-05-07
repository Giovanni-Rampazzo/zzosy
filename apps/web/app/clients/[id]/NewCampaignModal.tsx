"use client"
import { useState } from "react"
import { Button } from "@/components/ui/Button"

interface Props {
  clientId: string
  onClose: () => void
  onCreated: (campaignId: string) => void
}

export function NewCampaignModal({ clientId, onClose, onCreated }: Props) {
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError("Nome obrigatório"); return }
    setLoading(true)
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, clientId }),
    })
    setLoading(false)
    if (res.ok) {
      const data = await res.json()
      onCreated(data.id)
    } else {
      setError("Erro ao criar campanha")
    }
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:12,width:440,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 24px",borderBottom:"1px solid #E0E0E0"}}>
          <span style={{fontWeight:700,fontSize:16}}>Nova Campanha</span>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#888"}}>✕</button>
        </div>
        <form onSubmit={handleSubmit} style={{padding:24,display:"flex",flexDirection:"column",gap:16}}>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>Nome da campanha *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Verão 2026"
              autoFocus
              style={{padding:"8px 12px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:13,outline:"none",fontFamily:"inherit"}}
            />
          </div>
          {error && <p style={{color:"#dc2626",fontSize:12,margin:0}}>{error}</p>}
          <div style={{display:"flex",justifyContent:"flex-end",gap:12,marginTop:8}}>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={loading}>{loading ? "Criando..." : "Criar campanha"}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
