"use client"
import { useEffect, useState } from "react"
import { PageShell } from "@/components/layout/PageShell"
import { Button } from "@/components/ui/Button"

interface MediaFormat {
  id: string; vehicle: string; media: string; format: string
  width: number; height: number; dpi: number; category: "DIGITAL"|"OFFLINE"; isDefault: boolean
}

export default function MediasPage() {
  const [formats, setFormats] = useState<MediaFormat[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({vehicle:"",media:"",format:"",width:"",height:"",dpi:"72",category:"DIGITAL"})

  useEffect(() => {
    fetch("/api/medias").then(r => r.json()).then(d => { setFormats(Array.isArray(d)?d:[]); setLoading(false) })
  }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch("/api/medias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, width:+form.width, height:+form.height, dpi:+form.dpi }),
    })
    const mf = await res.json()
    setFormats(prev => [...prev, mf])
    setShowModal(false)
    setForm({vehicle:"",media:"",format:"",width:"",height:"",dpi:"72",category:"DIGITAL"})
  }

  async function handleDelete(id: string) {
    await fetch(`/api/medias/${id}`, { method: "DELETE" })
    setFormats(prev => prev.filter(f => f.id !== id))
  }

  const digital = formats.filter(f => f.category === "DIGITAL")
  const offline = formats.filter(f => f.category === "OFFLINE")
  const inp = {width:"100%",padding:"7px 10px",border:"1px solid #E0E0E0",borderRadius:5,fontSize:12,outline:"none",fontFamily:"inherit"} as React.CSSProperties

  return (
    <PageShell>
      <div style={{padding:32}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:32}}>
          <div>
            <h1 style={{fontSize:22,fontWeight:700,margin:0}}>Mídias e Formatos</h1>
            <p style={{fontSize:12,color:"#888",margin:"4px 0 0"}}>Formatos disponíveis para geração de peças</p>
          </div>
          <Button onClick={() => setShowModal(true)}>+ Novo formato</Button>
        </div>

        {loading ? <div style={{textAlign:"center",padding:"64px 0",color:"#888"}}>Carregando...</div> : (
          <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",overflow:"hidden"}}>
            {[{label:"Digital",data:digital},{label:"Offline",data:offline}].map(({label,data}) => (
              <div key={label}>
                <div style={{padding:"10px 20px",background:"#F5F5F0",borderBottom:"1px solid #E0E0E0"}}>
                  <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.8px",color:"#888"}}>{label}</span>
                </div>
                {data.map(f => (
                  <div key={f.id} style={{display:"flex",alignItems:"center",padding:"10px 20px",borderBottom:"1px solid #f0f0f0"}}>
                    <div style={{flex:1,fontWeight:600,fontSize:13}}>{f.vehicle}</div>
                    <div style={{width:140,fontSize:12,color:"#888"}}>{f.media}</div>
                    <div style={{width:150,fontSize:12,color:"#888"}}>{f.format}</div>
                    <div style={{width:110,fontSize:12,color:"#888"}}>{f.width}×{f.height}</div>
                    <div style={{width:70,fontSize:12,color:"#888"}}>{f.dpi}dpi</div>
                    <div>
                      {!f.isDefault ? (
                        <Button variant="danger" size="sm" onClick={() => handleDelete(f.id)}>Remover</Button>
                      ) : (
                        <span style={{fontSize:11,color:"#aaa",padding:"0 8px"}}>padrão</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"white",borderRadius:12,width:500,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 24px",borderBottom:"1px solid #E0E0E0"}}>
              <span style={{fontWeight:700,fontSize:16}}>Novo Formato</span>
              <button onClick={() => setShowModal(false)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#888"}}>✕</button>
            </div>
            <form onSubmit={handleAdd} style={{padding:24,display:"flex",flexDirection:"column",gap:12}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {([["vehicle","Veículo","Ex: Instagram"],["media","Mídia","Ex: Feed"],["format","Formato","Ex: Post Quadrado"]] as [string,string,string][]).map(([k,l,p]) => (
                  <div key={k} style={{display:"flex",flexDirection:"column",gap:5}}>
                    <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.5px",color:"#888"}}>{l}</label>
                    <input value={(form as any)[k]} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} placeholder={p} required style={inp} />
                  </div>
                ))}
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.5px",color:"#888"}}>Categoria</label>
                  <select value={form.category} onChange={e => setForm(f => ({...f,category:e.target.value}))} style={inp}>
                    <option value="DIGITAL">Digital</option>
                    <option value="OFFLINE">Offline</option>
                  </select>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                {([["width","Largura (px)"],["height","Altura (px)"],["dpi","DPI"]] as [string,string][]).map(([k,l]) => (
                  <div key={k} style={{display:"flex",flexDirection:"column",gap:5}}>
                    <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.5px",color:"#888"}}>{l}</label>
                    <input type="number" value={(form as any)[k]} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} required style={inp} />
                  </div>
                ))}
              </div>
              <div style={{display:"flex",justifyContent:"flex-end",gap:12,marginTop:8}}>
                <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
                <Button type="submit">Salvar</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageShell>
  )
}
