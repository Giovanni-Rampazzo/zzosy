"use client"
/**
 * /clients/[id]/edit
 *
 * Pagina de edicao do cliente. Mantida como rota separada (e nao modal)
 * porque eventualmente vai virar dashboard rico do cliente (metricas,
 * historico, configs).
 *
 * Contem:
 *  - Slot de logo (upload, trocar, apagar)
 *  - Form com 5 campos (name, contact, email, phone, address)
 *  - Zona de perigo: apagar cliente com confirmacao dupla
 *
 * Upload de logo usa /api/upload (data URL base64 ate ter R2).
 * Aceita PNG/JPG/SVG/WEBP ate 2MB.
 */
import { useEffect, useRef, useState } from "react"
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
  logoUrl: string | null
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

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"]

export default function EditClientPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [client, setClient] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmText, setConfirmText] = useState("")

  const [name, setName] = useState("")
  const [contact, setContact] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [dragOver, setDragOver] = useState(false)

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
        setLogoUrl(c.logoUrl ?? null)
        setLoading(false)
      })
  }, [id])

  async function uploadLogoFile(file: File) {
    setError("")
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setError("Formato não suportado. Use PNG, JPG, SVG ou WEBP.")
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError("Logo deve ter no máximo 2MB.")
      return
    }
    setUploadingLogo(true)
    const fd = new FormData()
    fd.append("file", file)
    const res = await fetch("/api/upload", { method: "POST", body: fd })
    setUploadingLogo(false)
    if (!res.ok) { setError("Falha ao enviar logo. Tente novamente."); return }
    const data = await res.json()
    setLogoUrl(data.url)
  }

  function triggerFilePicker() {
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (file) await uploadLogoFile(file)
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) await uploadLogoFile(file)
  }

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
        logoUrl: logoUrl ?? null,
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

        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"#888",marginBottom:20}}>
          <span style={{cursor:"pointer"}} onClick={() => router.push("/dashboard")}>Clientes</span>
          <span style={{color:"#ccc"}}>/</span>
          <span style={{cursor:"pointer"}} onClick={() => router.push(`/clients/${id}`)}>{client.name}</span>
          <span style={{color:"#ccc"}}>/</span>
          <span style={{fontWeight:600,color:"#111"}}>Editar</span>
        </div>

        <form onSubmit={handleSave} style={{maxWidth:640}}>
          <div style={{background:"white",borderRadius:10,border:"1px solid #E0E0E0",padding:24,marginBottom:24}}>
            <div style={{fontSize:14,fontWeight:700,marginBottom:20}}>Dados do cliente</div>

            {/* Logo */}
            <div style={{marginBottom:20}}>
              <div style={labelStyle}>Logo</div>
              <div style={{display:"flex",alignItems:"flex-start",gap:14,marginTop:8}}>
                {logoUrl ? (
                  <>
                    <div style={{
                      width:120,height:120,
                      border:"1px solid #E0E0E0",
                      borderRadius:8,
                      background:"#FAFAFA",
                      display:"flex",alignItems:"center",justifyContent:"center",
                      overflow:"hidden",
                      padding:8,
                      flexShrink:0,
                    }}>
                      <img src={logoUrl} alt="Logo" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}} />
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:6,paddingTop:4}}>
                      <Button type="button" variant="secondary" size="sm" onClick={triggerFilePicker} disabled={uploadingLogo}>
                        {uploadingLogo ? "Enviando..." : "Trocar"}
                      </Button>
                      <Button type="button" variant="danger" size="sm" onClick={() => setLogoUrl(null)} disabled={uploadingLogo}>
                        Apagar
                      </Button>
                      <div style={{fontSize:10,color:"#999",marginTop:4,lineHeight:1.4}}>PNG, JPG, SVG, WEBP<br/>máx 2MB</div>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={triggerFilePicker}
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    disabled={uploadingLogo}
                    style={{
                      width:120,height:120,
                      border: dragOver ? "2px dashed #F09300" : "2px dashed #D0D0D0",
                      borderRadius:8,
                      background: dragOver ? "rgba(240,147,0,0.05)" : "transparent",
                      cursor: uploadingLogo ? "wait" : "pointer",
                      display:"flex",flexDirection:"column",
                      alignItems:"center",justifyContent:"center",
                      gap:6,
                      color:"#888",
                      fontSize:11,
                      padding:8,
                      textAlign:"center",
                      fontFamily:"inherit",
                      transition:"border-color 0.15s, background 0.15s",
                    }}
                  >
                    {uploadingLogo ? (
                      <span>Enviando...</span>
                    ) : (
                      <>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="17 8 12 3 7 8"/>
                          <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        <span>Clique ou arraste</span>
                      </>
                    )}
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleFileChange}
                  style={{display:"none"}}
                />
              </div>
            </div>

            {/* Campos texto */}
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <label style={labelStyle}>Nome *</label>
                <input value={name} onChange={e=>setName(e.target.value)} style={inputStyle} />
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
