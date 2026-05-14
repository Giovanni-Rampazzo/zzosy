"use client"
/**
 * /clients/[id]/edit
 *
 * Pagina de edicao do cliente. Mantida como rota separada (e nao modal)
 * porque eventualmente vai virar dashboard rico do cliente (metricas,
 * historico, configs).
 *
 * Contem:
 *  - Slot de logo (upload, trocar, apagar) com AUTO-SAVE — toda mudanca
 *    no logo dispara PATCH imediato, sem precisar clicar Salvar.
 *  - Form de campos texto (name, contact, email, phone, address) com
 *    Salvar/Cancelar fixados no TOPO do card (alinhados a direita).
 *  - Zona de perigo: apagar cliente com confirmacao dupla.
 *
 * Upload de logo: /api/upload (base64 data URL). Aceita PNG/JPG/SVG/WEBP
 * ate 5MB. Coluna no banco e LONGTEXT (4GB).
 */
import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { Button } from "@/components/ui/Button"
import { GOOGLE_FONTS, loadGoogleFont } from "@/lib/google-fonts"

interface BrandColor {
  hex: string
  name?: string
  role: "primary" | "secondary"
}

const DEFAULT_BRAND_COLORS: BrandColor[] = [
  { hex: "#000000", role: "primary" },
  { hex: "#FFFFFF", role: "primary" },
  { hex: "#888888", role: "secondary" },
  { hex: "#CCCCCC", role: "secondary" },
]

interface Client {
  id: string
  name: string
  contact: string | null
  email: string | null
  phone: string | null
  address: string | null
  logoUrl: string | null
  brandFont: string | null
  brandColors: BrandColor[] | null
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

const MAX_LOGO_BYTES = 5 * 1024 * 1024  // 5MB (aumentado de 2MB)
const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"]

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
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

  const [name, setName] = useState("")
  const [contact, setContact] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [brandFont, setBrandFont] = useState<string>("")
  const [brandColors, setBrandColors] = useState<BrandColor[]>(DEFAULT_BRAND_COLORS)
  const [savingBrand, setSavingBrand] = useState(false)
  const [brandSavedAt, setBrandSavedAt] = useState<number | null>(null)
  const brandFirstLoadRef = useRef(true)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [savingLogo, setSavingLogo] = useState(false)
  const [logoSavedAt, setLogoSavedAt] = useState<number | null>(null)
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
        setBrandFont(c.brandFont ?? "")
        // brandColors do banco pode vir null (cliente antigo) ou com array
        // de tamanho diferente. Normaliza pra 4 items garantidos.
        const incoming = Array.isArray(c.brandColors) ? c.brandColors : []
        const merged = DEFAULT_BRAND_COLORS.map((def, i) => incoming[i] ?? def)
        setBrandColors(merged)
        if (c.brandFont) loadGoogleFont(c.brandFont)
        setLoading(false)
      })
  }, [id])

  // PATCH parcial usado pelo auto-save do logo
  async function patchClient(partial: Partial<Client>): Promise<boolean> {
    const res = await fetch(`/api/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    })
    return res.ok
  }

  // AUTO-SAVE da identidade visual: debounced 600ms.
  // brandFirstLoadRef evita disparar PATCH no carregamento inicial dos dados.
  useEffect(() => {
    if (loading) return
    if (brandFirstLoadRef.current) { brandFirstLoadRef.current = false; return }

    const handle = setTimeout(async () => {
      setSavingBrand(true)
      const ok = await patchClient({
        brandFont: brandFont || null,
        brandColors: brandColors as any,
      })
      setSavingBrand(false)
      if (ok) {
        setBrandSavedAt(Date.now())
        setTimeout(() => setBrandSavedAt(null), 2000)
      } else {
        setError("Falha ao salvar identidade visual.")
      }
    }, 600)
    return () => clearTimeout(handle)
  }, [brandFont, brandColors, loading])

  function updateColor(index: number, patch: Partial<BrandColor>) {
    setBrandColors(prev => prev.map((c, i) => i === index ? { ...c, ...patch } : c))
  }

  function handleFontChange(font: string) {
    setBrandFont(font)
    if (font) loadGoogleFont(font)
  }

  async function uploadLogoFile(file: File) {
    setError("")
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setError("Formato não suportado. Use PNG, JPG, SVG ou WEBP. SVG é o ideal — vetor leve que não perde qualidade.")
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(`Arquivo muito grande (${formatBytes(file.size)}). O limite é 5MB. Reduza o tamanho ou prefira SVG — vetor leve que não perde qualidade.`)
      return
    }
    setUploadingLogo(true)
    const fd = new FormData()
    fd.append("file", file)
    const res = await fetch("/api/upload", { method: "POST", body: fd })
    setUploadingLogo(false)
    if (!res.ok) {
      setError("Falha ao enviar logo. Tente reduzir o tamanho do arquivo (ideal usar SVG).")
      return
    }
    const data = await res.json()
    setLogoUrl(data.url)

    // AUTO-SAVE: persiste o logo no banco imediatamente apos upload
    setSavingLogo(true)
    const ok = await patchClient({ logoUrl: data.url })
    setSavingLogo(false)
    if (ok) {
      setLogoSavedAt(Date.now())
      setTimeout(() => setLogoSavedAt(null), 2000)
    } else {
      setError("Logo enviado mas falhou ao salvar no banco. Tente um arquivo menor (ideal usar SVG).")
    }
  }

  async function handleDeleteLogo() {
    setError("")
    setSavingLogo(true)
    const ok = await patchClient({ logoUrl: null })
    setSavingLogo(false)
    if (ok) {
      setLogoUrl(null)
      setLogoSavedAt(Date.now())
      setTimeout(() => setLogoSavedAt(null), 2000)
    } else {
      setError("Não foi possível apagar o logo.")
    }
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
    const ok = await patchClient({
      name: name.trim(),
      contact: contact.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
    })
    setSaving(false)
    if (ok) {
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

  // Status do auto-save do logo, mostrado discreto ao lado do label
  const logoStatus = savingLogo
    ? <span style={{fontSize:10,color:"#888",fontWeight:400,textTransform:"none",letterSpacing:0,marginLeft:8}}>salvando…</span>
    : logoSavedAt
      ? <span style={{fontSize:10,color:"#15803d",fontWeight:400,textTransform:"none",letterSpacing:0,marginLeft:8}}>✓ salvo</span>
      : null

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
            {/* Header com titulo e botoes Salvar/Cancelar no topo */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:14,fontWeight:700}}>Dados do cliente</div>
              <div style={{display:"flex",gap:10}}>
                <Button type="button" variant="secondary" size="md" onClick={() => router.push(`/clients/${id}`)}>Cancelar</Button>
                <Button type="submit" variant="primary" size="md" loading={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
              </div>
            </div>

            {/* Logo (auto-save) */}
            <div style={{marginBottom:20}}>
              <div style={{...labelStyle,display:"flex",alignItems:"center"}}>
                Logo
                {logoStatus}
              </div>
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
                      <Button type="button" variant="secondary" size="sm" onClick={triggerFilePicker} disabled={uploadingLogo || savingLogo}>
                        {uploadingLogo ? "Enviando..." : "Trocar"}
                      </Button>
                      <Button type="button" variant="danger" size="sm" onClick={handleDeleteLogo} disabled={uploadingLogo || savingLogo}>
                        Apagar
                      </Button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={triggerFilePicker}
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    disabled={uploadingLogo || savingLogo}
                    style={{
                      width:120,height:120,
                      border: dragOver ? "2px dashed #F09300" : "2px dashed #D0D0D0",
                      borderRadius:8,
                      background: dragOver ? "rgba(240,147,0,0.05)" : "transparent",
                      cursor: (uploadingLogo || savingLogo) ? "wait" : "pointer",
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
                    {(uploadingLogo || savingLogo) ? (
                      <span>{uploadingLogo ? "Enviando…" : "Salvando…"}</span>
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
              {/* Aviso sobre tamanho e formato */}
              <div style={{fontSize:11,color:"#888",marginTop:10,lineHeight:1.5,maxWidth:480}}>
                <strong style={{color:"#111"}}>Prefira SVG</strong> — vetor, leve e nunca pixeliza.
                Aceita PNG, JPG, SVG ou WEBP. Tamanho máximo <strong>5MB</strong> (quanto menor, mais rápido carrega).
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

            {error && <p style={{color:"#dc2626",fontSize:12,margin:"16px 0 0",lineHeight:1.5}}>{error}</p>}
          </div>
        </form>

        {/* CARD: Identidade Visual (auto-save) */}
        <div style={{maxWidth:640,background:"white",borderRadius:10,border:"1px solid #E0E0E0",padding:24,marginBottom:24}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <div style={{fontSize:14,fontWeight:700}}>Identidade visual</div>
            {savingBrand ? <span style={{fontSize:10,color:"#888"}}>salvando…</span>
              : brandSavedAt ? <span style={{fontSize:10,color:"#15803d"}}>✓ salvo</span>
              : null}
          </div>
          <p style={{fontSize:12,color:"#888",margin:"0 0 20px",lineHeight:1.4}}>
            Fonte e cores da marca. Será usado como padrão ao criar textos e peças desse cliente.
          </p>

          {/* Tipografia */}
          <div style={{marginBottom:24}}>
            <label style={labelStyle}>Tipografia</label>
            <div style={{display:"flex",gap:10,alignItems:"center",marginTop:8}}>
              <select
                value={brandFont}
                onChange={e => handleFontChange(e.target.value)}
                style={{...inputStyle,minWidth:220,cursor:"pointer"}}
              >
                <option value="">— Sem fonte definida —</option>
                <optgroup label="Sans-serif">
                  {GOOGLE_FONTS.filter(f => f.category === "sans").map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                </optgroup>
                <optgroup label="Serif">
                  {GOOGLE_FONTS.filter(f => f.category === "serif").map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                </optgroup>
                <optgroup label="Display">
                  {GOOGLE_FONTS.filter(f => f.category === "display").map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                </optgroup>
                <optgroup label="Monospace">
                  {GOOGLE_FONTS.filter(f => f.category === "mono").map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                </optgroup>
                <optgroup label="Handwriting">
                  {GOOGLE_FONTS.filter(f => f.category === "handwriting").map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                </optgroup>
              </select>
            </div>
            {brandFont && (
              <div style={{
                marginTop:12,padding:"14px 16px",
                background:"#FAFAFA",border:"1px solid #E0E0E0",borderRadius:8,
                fontFamily:`'${brandFont}', sans-serif`,
              }}>
                <div style={{fontSize:22,fontWeight:700,lineHeight:1.2,marginBottom:4}}>The quick brown fox</div>
                <div style={{fontSize:14,fontWeight:400,color:"#555"}}>Jumps over the lazy dog • 1234567890</div>
              </div>
            )}
          </div>

          {/* Cores */}
          <div style={{display:"flex",flexDirection:"column",gap:18}}>
            <ColorGroup label="Cores principais" colors={brandColors} startIndex={0} updateColor={updateColor} />
            <ColorGroup label="Cores secundárias" colors={brandColors} startIndex={2} updateColor={updateColor} />
          </div>
        </div>

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

/**
 * Renderiza 2 slots de cor (par primary ou secondary).
 * `startIndex` define qual par do array brandColors[] mostrar (0 ou 2).
 */
function ColorGroup({
  label, colors, startIndex, updateColor,
}: {
  label: string
  colors: BrandColor[]
  startIndex: number
  updateColor: (index: number, patch: Partial<BrandColor>) => void
}) {
  return (
    <div>
      <div style={{...{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"},marginBottom:8}}>{label}</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {[0,1].map(offset => {
          const i = startIndex + offset
          const c = colors[i]
          if (!c) return null
          return (
            <div key={i} style={{display:"flex",gap:10,alignItems:"center"}}>
              <input
                type="color"
                value={c.hex}
                onChange={e => updateColor(i, { hex: e.target.value.toUpperCase() })}
                style={{width:44,height:36,border:"1px solid #E0E0E0",borderRadius:6,padding:2,cursor:"pointer",background:"white"}}
              />
              <input
                type="text"
                value={c.hex}
                onChange={e => updateColor(i, { hex: e.target.value })}
                placeholder="#000000"
                maxLength={7}
                style={{padding:"8px 12px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:13,outline:"none",fontFamily:"monospace",width:100,textTransform:"uppercase"}}
              />
              <input
                type="text"
                value={c.name ?? ""}
                onChange={e => updateColor(i, { name: e.target.value || undefined })}
                placeholder="Nome (opcional, ex: Verde Sicredi)"
                style={{padding:"8px 12px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:13,outline:"none",fontFamily:"inherit",flex:1}}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
