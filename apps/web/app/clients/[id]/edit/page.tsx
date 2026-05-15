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
import { GOOGLE_FONTS, loadGoogleFont, loadCustomFontFamily, detectFontMetadata, CustomFontFile } from "@/lib/google-fonts"

interface BrandColor {
  hex: string
  name?: string
  /** Categoria da cor no sistema de marca. Aceita valores legados em ingles. */
  role: "principal" | "secundaria" | "apoio" | "neutra" | "primary" | "secondary"
}

/** Migra valores legados (primary/secondary) pros nomes novos. */
function normalizeRole(r: any): "principal" | "secundaria" | "apoio" | "neutra" {
  if (r === "primary") return "principal"
  if (r === "secondary") return "secundaria"
  if (r === "principal" || r === "secundaria" || r === "apoio" || r === "neutra") return r
  return "principal"
}

const ROLE_OPTIONS: Array<{ value: "principal" | "secundaria" | "apoio" | "neutra"; label: string }> = [
  { value: "principal", label: "Principal" },
  { value: "secundaria", label: "Secundária" },
  { value: "apoio", label: "Apoio" },
  { value: "neutra", label: "Neutra" },
]

const WEIGHT_OPTIONS = [
  { value: 100, label: "100 Thin" },
  { value: 200, label: "200 ExtraLight" },
  { value: 300, label: "300 Light" },
  { value: 400, label: "400 Regular" },
  { value: 500, label: "500 Medium" },
  { value: 600, label: "600 SemiBold" },
  { value: 700, label: "700 Bold" },
  { value: 800, label: "800 ExtraBold" },
  { value: 900, label: "900 Black" },
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
  customFontFiles: CustomFontFile[] | null
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
  const [brandColors, setBrandColors] = useState<BrandColor[]>([])
  const [customFontFiles, setCustomFontFiles] = useState<CustomFontFile[]>([])
  const [fontMode, setFontMode] = useState<"google" | "custom">("google")
  const [uploadingFont, setUploadingFont] = useState(false)
  const fontFileInputRef = useRef<HTMLInputElement | null>(null)
  const [savingBrand, setSavingBrand] = useState(false)
  const [brandSavedAt, setBrandSavedAt] = useState<number | null>(null)
  const brandFirstLoadRef = useRef(true)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [savingLogo, setSavingLogo] = useState(false)
  const [logoSavedAt, setLogoSavedAt] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    srvLog("edit-page-MOUNTED", { id, version: "v3-multi-fonts" })
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
        // brandColors do banco: array dinamico (sem tamanho fixo). Migra
        // valores legados (primary/secondary → principal/secundaria).
        const incoming: BrandColor[] = (Array.isArray(c.brandColors) ? c.brandColors : []).map((x: any) => ({
          hex: x?.hex ?? "#000000",
          name: x?.name,
          role: normalizeRole(x?.role),
        }))
        setBrandColors(incoming)
        const files: CustomFontFile[] = Array.isArray(c.customFontFiles) ? c.customFontFiles : []
        setCustomFontFiles(files)
        if (files.length > 0) {
          setFontMode("custom")
          if (c.brandFont) loadCustomFontFamily(c.brandFont, files)
        } else {
          setFontMode("google")
          if (c.brandFont) loadGoogleFont(c.brandFont)
        }
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
        customFontFiles: customFontFiles.length > 0 ? customFontFiles as any : null,
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
  }, [brandFont, brandColors, customFontFiles, loading])

  function updateColor(index: number, patch: Partial<BrandColor>) {
    setBrandColors(prev => prev.map((c, i) => i === index ? { ...c, ...patch } : c))
  }

  function addColor() {
    setBrandColors(prev => [...prev, { hex: "#000000", role: "principal" }])
  }

  function removeColor(index: number) {
    setBrandColors(prev => prev.filter((_, i) => i !== index))
  }

  // Drag-and-drop para reordenar cores
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  function handleColorDragStart(index: number) { setDragIndex(index) }
  function handleColorDragOver(e: React.DragEvent) { e.preventDefault() }
  function handleColorDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) { setDragIndex(null); return }
    setBrandColors(prev => {
      const copy = [...prev]
      const [moved] = copy.splice(dragIndex, 1)
      copy.splice(targetIndex, 0, moved)
      return copy
    })
    setDragIndex(null)
  }

  function srvLog(tag: string, data: any) {
    try {
      fetch("/api/debug/client-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, data }),
      }).catch(() => {})
    } catch {}
  }

  // Captura erros JS globais e manda pro terminal do server
  useEffect(() => {
    const onErr = (ev: ErrorEvent) => srvLog("font-WINDOW-ERROR", { msg: ev.message, src: ev.filename, line: ev.lineno })
    window.addEventListener("error", onErr)
    return () => window.removeEventListener("error", onErr)
  }, [])

  function handleFontChange(font: string) {
    setBrandFont(font)
    if (font) loadGoogleFont(font)
  }

  async function uploadOneFontFile(file: File): Promise<CustomFontFile | null> {
    srvLog("font-ONE-START", { name: file.name, size: file.size, type: file.type })
    const fname = (file.name || "").toLowerCase()
    const validExt = fname.endsWith(".ttf") || fname.endsWith(".otf") || fname.endsWith(".woff") || fname.endsWith(".woff2")
    if (!validExt) {
      srvLog("font-ONE-INVALID-EXT", { name: file.name })
      setError(`"${file.name}": formato não suportado. Use TTF, OTF, WOFF ou WOFF2.`)
      return null
    }
    if (file.size > 2 * 1024 * 1024) {
      srvLog("font-ONE-TOO-BIG", { name: file.name, size: file.size })
      setError(`"${file.name}": maior que 2MB.`)
      return null
    }
    const fd = new FormData()
    fd.append("file", file)
    srvLog("font-ONE-FETCH-START", { name: file.name })
    let res: Response
    try {
      res = await fetch("/api/upload", { method: "POST", body: fd })
    } catch (e: any) {
      srvLog("font-ONE-FETCH-THREW", { name: file.name, error: String(e?.message ?? e) })
      setError(`Falha de rede ao enviar "${file.name}".`)
      return null
    }
    srvLog("font-ONE-FETCH-DONE", { name: file.name, status: res.status, ok: res.ok })
    if (!res.ok) {
      setError(`Falha ao enviar "${file.name}" (status ${res.status}).`)
      return null
    }
    let data: any
    try {
      data = await res.json()
    } catch (e: any) {
      srvLog("font-ONE-JSON-FAIL", { name: file.name, error: String(e?.message ?? e) })
      return null
    }
    srvLog("font-ONE-OK", { name: file.name, urlLen: data?.url?.length ?? 0 })
    const detected = detectFontMetadata(file.name)
    return {
      url: data.url,
      weight: detected.weight,
      style: detected.style,
      fileName: file.name,
    }
  }

  async function uploadFontFiles(fileList: FileList | File[]) {
    setError("")
    const allFiles = Array.from(fileList)
    srvLog("font-MULTI-START", { count: allFiles.length, names: allFiles.map(f => f.name) })

    const MAX_TOTAL = 50
    const spaceLeft = MAX_TOTAL - customFontFiles.length
    let files = allFiles
    let ignoredCount = 0
    if (spaceLeft <= 0) {
      setError(`Limite de ${MAX_TOTAL} arquivos atingido. Remova alguns antes de adicionar mais.`)
      return
    }
    if (allFiles.length > spaceLeft) {
      files = allFiles.slice(0, spaceLeft)
      ignoredCount = allFiles.length - spaceLeft
      srvLog("font-MULTI-TRUNCATED", { processed: files.length, ignored: ignoredCount })
    }

    setUploadingFont(true)
    const newFiles: CustomFontFile[] = []
    const replacedSlots: string[] = []
    for (const file of files) {
      const uploaded = await uploadOneFontFile(file)
      if (uploaded) {
        // Se peso+style ja existe, substitui (silencioso, mas guarda info pra avisar)
        const dupIdx = [...customFontFiles, ...newFiles].findIndex(f => f.weight === uploaded.weight && f.style === uploaded.style)
        if (dupIdx >= 0) {
          replacedSlots.push(`${uploaded.weight} ${uploaded.style}`)
          if (dupIdx < customFontFiles.length) {
            const updated = [...customFontFiles]
            updated[dupIdx] = uploaded
            setCustomFontFiles(updated)
            continue
          } else {
            newFiles[dupIdx - customFontFiles.length] = uploaded
            continue
          }
        }
        newFiles.push(uploaded)
      }
    }
    setUploadingFont(false)
    srvLog("font-MULTI-DONE", { uploadedCount: newFiles.length, totalAfter: customFontFiles.length + newFiles.length, replaced: replacedSlots.length })

    // Avisos finais (nao bloqueia, so informa)
    const warnings: string[] = []
    if (ignoredCount > 0) warnings.push(`${ignoredCount} arquivo(s) ignorado(s) — limite ${MAX_TOTAL}`)
    if (replacedSlots.length > 0) warnings.push(`${replacedSlots.length} peso(s) substituído(s): ${replacedSlots.join(", ")}`)
    if (warnings.length > 0) setError(warnings.join(" • "))

    if (newFiles.length === 0 && replacedSlots.length === 0) return

    const merged = [...customFontFiles, ...newFiles].sort((a, b) =>
      a.weight !== b.weight ? a.weight - b.weight : a.style.localeCompare(b.style)
    )
    setCustomFontFiles(merged)

    // Se ainda nao tem nome de fonte, deriva do primeiro arquivo
    let nameToUse = brandFont
    if (!nameToUse) {
      const baseName = (newFiles[0] || files[0] as any)?.fileName
        ? newFiles[0]?.fileName.replace(/\.(ttf|otf|woff2|woff)$/i, "").replace(/[-_](thin|extralight|ultralight|light|regular|book|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique)+/gi, "").replace(/[-_]/g, " ").trim()
        : ""
      nameToUse = baseName || "Fonte custom"
      setBrandFont(nameToUse)
    }
    loadCustomFontFamily(nameToUse, merged)
  }

  function triggerFontPicker() { fontFileInputRef.current?.click() }

  async function handleFontFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    srvLog("font-INPUT-CHANGE", { fileCount: files?.length ?? 0 })
    if (!files || files.length === 0) {
      srvLog("font-INPUT-NO-FILES", {})
      return
    }
    // Converte FileList pra array ANTES de mexer no input (zerar value invalida FileList em alguns browsers)
    const fileArray: File[] = Array.from(files)
    srvLog("font-INPUT-ARRAY", { count: fileArray.length, firstName: fileArray[0]?.name })
    e.target.value = ""
    await uploadFontFiles(fileArray)
  }

  function updateFontFileMeta(index: number, patch: Partial<CustomFontFile>) {
    const updated = customFontFiles.map((f, i) => i === index ? { ...f, ...patch } : f)
    setCustomFontFiles(updated)
    if (brandFont) loadCustomFontFamily(brandFont, updated)
  }

  function removeFontFile(index: number) {
    const updated = customFontFiles.filter((_, i) => i !== index)
    setCustomFontFiles(updated)
    if (brandFont && updated.length > 0) loadCustomFontFamily(brandFont, updated)
  }

  function handleCustomFontNameChange(newName: string) {
    setBrandFont(newName)
    if (newName && customFontFiles.length > 0) loadCustomFontFamily(newName, customFontFiles)
  }

  function handleSwitchToCustom() {
    setFontMode("custom")
    if (customFontFiles.length === 0) setBrandFont("")
  }

  function handleSwitchToGoogle() {
    setFontMode("google")
    if (customFontFiles.length > 0) {
      setCustomFontFiles([])
      setBrandFont("")
    }
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

            {/* Toggle Google Font / Fonte custom */}
            <div style={{display:"flex",gap:0,marginTop:8,marginBottom:12,border:"1px solid #E0E0E0",borderRadius:6,overflow:"hidden",width:"fit-content"}}>
              <button
                type="button"
                onClick={handleSwitchToGoogle}
                style={{
                  padding:"6px 14px",border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
                  background: fontMode === "google" ? "#111" : "white",
                  color: fontMode === "google" ? "white" : "#666",
                  fontFamily:"inherit",
                }}
              >Google Font</button>
              <button
                type="button"
                onClick={handleSwitchToCustom}
                style={{
                  padding:"6px 14px",border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
                  background: fontMode === "custom" ? "#111" : "white",
                  color: fontMode === "custom" ? "white" : "#666",
                  fontFamily:"inherit",
                  borderLeft:"1px solid #E0E0E0",
                }}
              >Fonte custom (família)</button>
            </div>

            {fontMode === "google" ? (
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
            ) : (
              <div>
                {/* Nome da familia */}
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14,maxWidth:360}}>
                  <label style={{fontSize:10,color:"#888",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px"}}>Nome da família</label>
                  <input
                    type="text"
                    value={brandFont}
                    onChange={e => handleCustomFontNameChange(e.target.value)}
                    placeholder="Ex: Sicredi Sans"
                    style={inputStyle}
                  />
                </div>

                {/* Lista de arquivos da familia */}
                {customFontFiles.length > 0 ? (
                  <div style={{border:"1px solid #E0E0E0",borderRadius:8,overflow:"hidden",marginBottom:10}}>
                    <div style={{display:"grid",gridTemplateColumns:"48px 1fr 160px 110px 36px",gap:0,background:"#FAFAFA",padding:"8px 12px",borderBottom:"1px solid #E0E0E0",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>
                      <div>Aa</div>
                      <div>Arquivo</div>
                      <div>Peso</div>
                      <div>Estilo</div>
                      <div></div>
                    </div>
                    {customFontFiles.map((f, i) => (
                      <div key={i} style={{display:"grid",gridTemplateColumns:"48px 1fr 160px 110px 36px",gap:0,padding:"8px 12px",borderTop: i === 0 ? "none" : "1px solid #F0F0F0",alignItems:"center"}}>
                        <div style={{
                          fontFamily: brandFont ? `'${brandFont}', sans-serif` : "inherit",
                          fontWeight: f.weight,
                          fontStyle: f.style,
                          fontSize: 22,
                          lineHeight: 1,
                        }}>Aa</div>
                        <div style={{fontSize:12,color:"#444",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:8}} title={f.fileName}>{f.fileName}</div>
                        <select
                          value={f.weight}
                          onChange={e => updateFontFileMeta(i, { weight: Number(e.target.value) })}
                          style={{...inputStyle,padding:"4px 8px",fontSize:11,cursor:"pointer"}}
                        >
                          {WEIGHT_OPTIONS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                        </select>
                        <select
                          value={f.style}
                          onChange={e => updateFontFileMeta(i, { style: e.target.value as "normal" | "italic" })}
                          style={{...inputStyle,padding:"4px 8px",fontSize:11,cursor:"pointer",marginLeft:6}}
                        >
                          <option value="normal">Normal</option>
                          <option value="italic">Italic</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => removeFontFile(i)}
                          title="Remover este arquivo"
                          style={{background:"transparent",border:"none",cursor:"pointer",color:"#999",fontSize:18,padding:"0 8px",lineHeight:1}}
                        >×</button>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Input file NATIVO visivel — sem label/ref pra eliminar mediacao */}
                <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:10}}>
                  <input
                    type="file"
                    accept=".ttf,.otf,.woff,.woff2"
                    multiple
                    onChange={handleFontFileChange}
                    disabled={uploadingFont || customFontFiles.length >= 50}
                    style={{fontSize:12,fontFamily:"inherit"}}
                  />
                  {uploadingFont && <span style={{fontSize:11,color:"#888"}}>Enviando...</span>}
                </div>

                <div style={{fontSize:11,color:"#888",marginTop:10,lineHeight:1.5,maxWidth:520}}>
                  Suba <strong>todos os pesos da família</strong> de uma vez (Regular, Bold, Light, Italic, etc). O peso e estilo são detectados pelo nome do arquivo — você pode ajustar nos dropdowns se errar. <strong>TTF, OTF, WOFF ou WOFF2</strong>, máximo 2MB cada.
                </div>
              </div>
            )}

            {brandFont && (fontMode === "google" || customFontFiles.length > 0) && (
              <div style={{
                marginTop:14,padding:"14px 16px",
                background:"#FAFAFA",border:"1px solid #E0E0E0",borderRadius:8,
                fontFamily:`'${brandFont}', sans-serif`,
              }}>
                <div style={{fontSize:22,fontWeight:700,lineHeight:1.2,marginBottom:4}}>The quick brown fox</div>
                <div style={{fontSize:14,fontWeight:400,color:"#555"}}>Jumps over the lazy dog • 1234567890</div>
              </div>
            )}
          </div>

          {/* Cores — lista dinamica com drag, categoria editavel, swatch grande */}
          <div>
            <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",color:"#888"}}>Cores da marca</div>
              <div style={{fontSize:11,color:"#AAA"}}>Arraste pra reordenar</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
              {brandColors.length === 0 ? (
                <div style={{fontSize:12,color:"#999",fontStyle:"italic",padding:"10px 0"}}>Nenhuma cor cadastrada. Adicione abaixo.</div>
              ) : brandColors.map((c, i) => {
                const role = normalizeRole(c.role)
                const placeholderByRole: Record<string,string> = {
                  principal: "Ex: Verde principal",
                  secundaria: "Ex: Amarelo secundário",
                  apoio: "Ex: Laranja apoio",
                  neutra: "Ex: Cinza claro",
                }
                const isDragging = dragIndex === i
                return (
                  <div
                    key={i}
                    draggable
                    onDragStart={() => handleColorDragStart(i)}
                    onDragOver={handleColorDragOver}
                    onDrop={() => handleColorDrop(i)}
                    style={{
                      display:"flex",gap:10,alignItems:"center",
                      padding:8,
                      background:"#FAFAFA",
                      border:"1px solid #E8E8E8",
                      borderRadius:8,
                      opacity: isDragging ? 0.4 : 1,
                      cursor: isDragging ? "grabbing" : "default",
                    }}
                  >
                    {/* Handle de drag — grip vertical */}
                    <div
                      style={{cursor:"grab",color:"#BBB",fontSize:14,padding:"0 2px",userSelect:"none",lineHeight:1}}
                      title="Arraste pra reordenar"
                    >⋮⋮</div>
                    {/* Swatch grande clicavel */}
                    <label style={{position:"relative",display:"inline-block",cursor:"pointer",flexShrink:0}}>
                      <div style={{
                        width:40,height:40,borderRadius:8,
                        background:c.hex,
                        border:"2px solid white",
                        boxShadow:"0 0 0 1px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06)",
                      }} />
                      <input
                        type="color"
                        value={c.hex}
                        onChange={e => updateColor(i, { hex: e.target.value.toUpperCase() })}
                        style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:0,cursor:"pointer"}}
                      />
                    </label>
                    {/* Hex */}
                    <input
                      type="text"
                      value={c.hex}
                      onChange={e => updateColor(i, { hex: e.target.value })}
                      placeholder="#000000"
                      maxLength={7}
                      style={{padding:"7px 10px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:12,outline:"none",fontFamily:"monospace",width:88,textTransform:"uppercase",background:"white"}}
                    />
                    {/* Nome */}
                    <input
                      type="text"
                      value={c.name ?? ""}
                      onChange={e => updateColor(i, { name: e.target.value || undefined })}
                      placeholder={placeholderByRole[role]}
                      style={{padding:"7px 10px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:12,outline:"none",fontFamily:"inherit",flex:1,minWidth:0,background:"white"}}
                    />
                    {/* Categoria */}
                    <select
                      value={role}
                      onChange={e => updateColor(i, { role: e.target.value as any })}
                      style={{padding:"7px 8px",border:"1px solid #E0E0E0",borderRadius:6,fontSize:11,cursor:"pointer",background:"white",fontFamily:"inherit"}}
                    >
                      {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {/* Remover */}
                    <button
                      type="button"
                      onClick={() => removeColor(i)}
                      title="Remover cor"
                      style={{background:"transparent",border:"none",cursor:"pointer",color:"#999",fontSize:18,padding:"0 8px",lineHeight:1,flexShrink:0}}
                    >×</button>
                  </div>
                )
              })}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={addColor}>+ Adicionar cor</Button>
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

