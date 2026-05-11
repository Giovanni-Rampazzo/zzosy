"use client"
import { useEffect, useState } from "react"
import { PageShell } from "@/components/layout/PageShell"
import { Button } from "@/components/ui/Button"

interface MediaFormat {
  id: string; vehicle: string; media: string; format: string
  width: number; height: number; dpi: number; category: string; isDefault: boolean
}

type FormState = {
  vehicle: string; media: string; format: string;
  width: string; height: string; dpi: string; category: string;
}

const emptyForm: FormState = {vehicle:"",media:"",format:"",width:"",height:"",dpi:"72",category:""}

export default function MediasPage() {
  const [formats, setFormats] = useState<MediaFormat[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const isEditing = editingId !== null

  useEffect(() => {
    fetch("/api/medias").then(r => r.json()).then(d => { setFormats(Array.isArray(d)?d:[]); setLoading(false) })
  }, [])

  function openCreate() {
    setForm(emptyForm)
    setEditingId(null)
    setShowModal(true)
  }

  function openEdit(f: MediaFormat) {
    setForm({
      vehicle: f.vehicle ?? "",
      media: f.media ?? "",
      format: f.format ?? "",
      width: String(f.width),
      height: String(f.height),
      dpi: String(f.dpi),
      category: f.category,
    })
    setEditingId(f.id)
    setShowModal(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = { ...form, width: +form.width, height: +form.height, dpi: +form.dpi }
    if (isEditing) {
      const res = await fetch(`/api/medias/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const updated = await res.json()
      setFormats(prev => prev.map(f => f.id === editingId ? updated : f))
    } else {
      const res = await fetch("/api/medias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const created = await res.json()
      setFormats(prev => [...prev, created])
    }
    setShowModal(false)
    setForm(emptyForm)
    setEditingId(null)
  }

  async function handleDuplicate(f: MediaFormat) {
    const payload = {
      vehicle: f.vehicle,
      media: f.media,
      format: `${f.format} (cópia)`,
      width: f.width,
      height: f.height,
      dpi: f.dpi,
      category: f.category,
    }
    const res = await fetch("/api/medias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const created = await res.json()
    setFormats(prev => [...prev, created])
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este formato?")) return
    await fetch(`/api/medias/${id}`, { method: "DELETE" })
    setFormats(prev => prev.filter(f => f.id !== id))
  }

  function closeModal() {
    setShowModal(false)
    setEditingId(null)
  }

  // Agrupa formatos pelos valores unicos de category (texto livre).
  // Formatos sem categoria sao agrupados em "Sem categoria".
  const categories = Array.from(new Set(formats.map(f => f.category || "Sem categoria"))).sort()
  const groupedFormats: Record<string, MediaFormat[]> = {}
  for (const f of formats) {
    const k = f.category || "Sem categoria"
    if (!groupedFormats[k]) groupedFormats[k] = []
    groupedFormats[k].push(f)
  }
  const inp = {width:"100%",padding:"7px 10px",border:"1px solid #E0E0E0",borderRadius:5,fontSize:12,outline:"none",fontFamily:"inherit"} as React.CSSProperties

  return (
    <PageShell>
      <div style={{padding:32}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:32}}>
          <div>
            <h1 style={{fontSize:22,fontWeight:700,margin:0}}>Mídias e Formatos</h1>
            <p style={{fontSize:12,color:"#888",margin:"4px 0 0"}}>Formatos disponíveis para geração de peças</p>
          </div>
          <Button variant="primary" onClick={openCreate}>+ Novo formato</Button>
        </div>

        {loading ? <div style={{textAlign:"center",padding:"64px 0",color:"#888"}}>Carregando...</div> : (
          <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",overflow:"hidden"}}>
            {categories.length === 0 ? (
              <div style={{padding:"32px 20px",textAlign:"center",color:"#888",fontSize:13}}>
                Nenhum formato cadastrado. Clique em "+ Novo formato" pra criar.
              </div>
            ) : (
              categories.map(label => (
                <div key={label}>
                  <div style={{padding:"10px 20px",background:"#F5F5F0",borderBottom:"1px solid #E0E0E0"}}>
                    <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.8px",color:"#888"}}>{label}</span>
                  </div>
                  {groupedFormats[label].map(f => (
                  <div key={f.id} style={{display:"flex",alignItems:"center",padding:"10px 20px",borderBottom:"1px solid #f0f0f0"}}>
                    <div style={{flex:1,fontWeight:600,fontSize:13}}>{f.vehicle}</div>
                    <div style={{width:140,fontSize:12,color:"#888"}}>{f.media}</div>
                    <div style={{width:150,fontSize:12,color:"#888"}}>{f.format}</div>
                    <div style={{width:110,fontSize:12,color:"#888"}}>{f.width}×{f.height}</div>
                    <div style={{width:70,fontSize:12,color:"#888"}}>{f.dpi}dpi</div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      {!f.isDefault ? (
                        <>
                          <Button variant="danger" size="sm" onClick={() => handleDelete(f.id)}>Remover</Button>
                          <Button variant="info" size="sm" onClick={() => handleDuplicate(f)}>Duplicar</Button>
                          <Button variant="secondary" size="sm" onClick={() => openEdit(f)}>Editar</Button>
                        </>
                      ) : (
                        <>
                          <Button variant="info" size="sm" onClick={() => handleDuplicate(f)}>Duplicar</Button>
                          <span style={{fontSize:11,color:"#aaa",padding:"0 8px"}}>padrão</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {showModal && (
        <div
          onMouseDown={e => { if (e.target === e.currentTarget) closeModal() }}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center"}}
        >
          <div style={{background:"white",borderRadius:12,width:500,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{padding:"16px 24px",borderBottom:"1px solid #E0E0E0"}}>
              <span style={{fontWeight:700,fontSize:16}}>{isEditing ? "Editar Formato" : "Novo Formato"}</span>
            </div>
            <form onSubmit={handleSubmit} style={{padding:24,display:"flex",flexDirection:"column",gap:12}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {([["vehicle","Veículo","Ex: Instagram"],["media","Mídia","Ex: Feed"],["format","Formato","Ex: Post Quadrado"]] as [string,string,string][]).map(([k,l,p]) => (
                  <div key={k} style={{display:"flex",flexDirection:"column",gap:5}}>
                    <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.5px",color:"#888"}}>{l}</label>
                    <input value={(form as any)[k]} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} placeholder={p} required style={inp} />
                  </div>
                ))}
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.5px",color:"#888"}}>Categoria</label>
                  <input
                    type="text"
                    value={form.category}
                    onChange={e => setForm(f => ({...f,category:e.target.value}))}
                    placeholder="Ex: Digital, Offline, Vídeo..."
                    list="media-category-suggestions"
                    required
                    style={inp}
                  />
                  <datalist id="media-category-suggestions">
                    {categories.filter(c => c !== "Sem categoria").map(c => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
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
                <Button type="button" variant="secondary" onClick={closeModal}>Cancelar</Button>
                <Button type="submit" variant="primary">{isEditing ? "Salvar alterações" : "Criar"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageShell>
  )
}
