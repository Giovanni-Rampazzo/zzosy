"use client"
/**
 * /clients/[id]/edit
 *
 * Pagina de edicao de DADOS do cliente (metadata). Identidade visual (cores,
 * fontes, tipografia) mora em /clients/[id]/design-system pra evitar
 * duplicacao de logica + race condition de auto-save (audit F7.1).
 *
 * Contem:
 *  - Slot de logo (upload, trocar, apagar) com AUTO-SAVE — toda mudanca
 *    no logo dispara PATCH imediato, sem precisar clicar Salvar.
 *  - Form de campos texto (name, contact, email, phone, address) com
 *    Salvar/Cancelar fixados no TOPO do card.
 *  - Link "Abrir Design System" pra a pagina dedicada de brand.
 *  - ClientSettingsCard (taxonomia) + Zona de perigo (delete).
 *
 * Upload de logo: /api/upload (base64 data URL). Aceita PNG/JPG/SVG/WEBP
 * ate 5MB. Coluna no banco e LONGTEXT (4GB).
 */
import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { ClientSettingsCard } from "@/components/clients/ClientSettingsCard"
import { Button } from "@/components/ui/Button"
import { CollapsibleCard } from "@/components/ui/CollapsibleCard"
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

/** 4 presets tipograficos. Cada um define peso + tamanho da fonte da marca. */
type BrandPresetKey = "titulo" | "subtitulo" | "body" | "legenda"
interface BrandPreset { fontWeight: number; fontSize: number }
type BrandTypography = Record<BrandPresetKey, BrandPreset>

const PRESET_LABELS: Record<BrandPresetKey, string> = {
  titulo: "Título",
  subtitulo: "Subtítulo",
  body: "Corpo de texto",
  legenda: "Legenda",
}

const PRESET_DESCRIPTIONS: Record<BrandPresetKey, string> = {
  titulo: "Manchete, headline principal",
  subtitulo: "Apoio do título, destaques",
  body: "Texto corrido, paragrafos",
  legenda: "Crédito, observação, rodapé",
}

const PRESET_ORDER: BrandPresetKey[] = ["titulo", "subtitulo", "body", "legenda"]

const DEFAULT_TYPOGRAPHY: BrandTypography = {
  titulo:    { fontWeight: 700, fontSize: 80 },
  subtitulo: { fontWeight: 600, fontSize: 48 },
  body:      { fontWeight: 400, fontSize: 24 },
  legenda:   { fontWeight: 400, fontSize: 16 },
}

/** Normaliza dado vindo do banco (pode ter chaves faltando, valores invalidos). */
function normalizeTypography(raw: any): BrandTypography {
  const out: any = {}
  for (const k of PRESET_ORDER) {
    const r = raw?.[k]
    out[k] = {
      fontWeight: Number.isFinite(r?.fontWeight) ? r.fontWeight : DEFAULT_TYPOGRAPHY[k].fontWeight,
      fontSize:   Number.isFinite(r?.fontSize)   ? r.fontSize   : DEFAULT_TYPOGRAPHY[k].fontSize,
    }
  }
  return out
}

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
  brandLogoUrl: string | null
  brandFont: string | null
  brandColors: BrandColor[] | null
  brandTypography: any | null
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
  const [settingsStatus, setSettingsStatus] = useState<"idle" | "saving" | "saved">("idle")

  const [name, setName] = useState("")
  const [contact, setContact] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [brandFont, setBrandFont] = useState<string>("")
  const [brandColors, setBrandColors] = useState<BrandColor[]>([])
  const [brandTypography, setBrandTypography] = useState<BrandTypography>(DEFAULT_TYPOGRAPHY)
  const [customFontFiles, setCustomFontFiles] = useState<CustomFontFile[]>([])
  const [fontMode, setFontMode] = useState<"google" | "custom">("google")
  const [uploadingFont, setUploadingFont] = useState(false)
  const fontFileInputRef = useRef<HTMLInputElement | null>(null)
  const [savingBrand, setSavingBrand] = useState(false)
  const [brandSavedAt, setBrandSavedAt] = useState<number | null>(null)
  // Progresso do cascade de atualização das peças após save de brandColors.
  // null = sem cascade ativo. total/done = renderizando. touched (no fim) =
  // mostra "N peças atualizadas" por alguns segundos.
  const [cascadeProgress, setCascadeProgress] = useState<{ total: number; done: number; touched?: number } | null>(null)
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
        setLogoUrl(c.brandLogoUrl ?? null)
        setBrandFont(c.brandFont ?? "")
        // brandColors do banco: array dinamico (sem tamanho fixo). Migra
        // valores legados (primary/secondary → principal/secundaria).
        const incoming: BrandColor[] = (Array.isArray(c.brandColors) ? c.brandColors : []).map((x: any) => ({
          hex: x?.hex ?? "#000000",
          name: x?.name,
          role: normalizeRole(x?.role),
        }))
        setBrandColors(incoming)
        setBrandTypography(normalizeTypography((c as any).brandTypography))
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

  // F7.1 (audit M5): auto-save de brandFont/brandColors/brandTypography/
  // customFontFiles removido daqui — esses campos NAO sao editaveis no /edit
  // (so logo + dados de contato sao). Toda a edicao de identidade visual
  // mora em /clients/[id]/design-system. Antes, o effect rodava em duplicata
  // com o /design-system criando race condition em quem deixava as duas abas
  // abertas. State permanece pra preservar o load do client e evitar reescrita
  // por accident — mas o effect que disparava PATCH foi removido.

  function updatePreset(key: BrandPresetKey, patch: Partial<BrandPreset>) {
    setBrandTypography(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

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
    const ok = await patchClient({ brandLogoUrl: data.url })
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
    const ok = await patchClient({ brandLogoUrl: null })
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
          <CollapsibleCard
            title="Dados do cliente"
            style={{marginBottom:24}}
            actions={
              <>
                <Button type="button" variant="secondary" size="sm" onClick={() => router.push(`/clients/${id}`)}>Cancelar</Button>
                <Button type="submit" variant="primary" size="sm" loading={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
              </>
            }
          >
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
                      background:"transparent",
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
          </CollapsibleCard>
        </form>

        {/* CARD: link pra Design System. Configs visuais (logo, cores, fontes,
            tipografia) viraram pagina dedicada /clients/[id]/design-system. */}
        <div style={{maxWidth:640,marginBottom:24}}>
          <CollapsibleCard
            title="Design System"
            actions={
              <Button variant="secondary" size="sm" onClick={() => router.push(`/clients/${id}/design-system`)}>
                Abrir Design System →
              </Button>
            }
          >
            <p style={{fontSize:12,color:"#666",margin:0,lineHeight:1.5}}>
              Logo, cores da marca, fontes e tipografia ficam em uma página dedicada.
            </p>
          </CollapsibleCard>
        </div>

        {/* CARD: link pra Formatos de Midia. Vivem em pagina dedicada /medias
            (catalogo global do tenant). Aqui no cliente, atalho pra abrir. */}
        <div style={{maxWidth:640,marginBottom:24}}>
          <CollapsibleCard
            title="Formatos de mídia"
            actions={
              <Button variant="secondary" size="sm" onClick={() => router.push(`/medias`)}>
                Abrir Formatos →
              </Button>
            }
          >
            <p style={{fontSize:12,color:"#666",margin:0,lineHeight:1.5}}>
              Catálogo de formatos (dimensões, veículos, mídias) que as peças vão usar.
              Compartilhado entre todas as campanhas do tenant.
            </p>
          </CollapsibleCard>
        </div>

        {/* SETTINGS GLOBAIS — listas controladas (segmentos, categorias, filtros)
            do TENANT. Compartilhadas entre todas as empresas/campanhas/pecas. */}
        <div style={{maxWidth:640,marginBottom:24}}>
          <CollapsibleCard
            title="Configurações"
            status={settingsStatus === "saving" ? "salvando…" : settingsStatus === "saved" ? "salvo" : undefined}
          >
            <ClientSettingsCard onStatusChange={setSettingsStatus} />
          </CollapsibleCard>
        </div>

        <div style={{maxWidth:640}}>
          <CollapsibleCard title="Zona de perigo" variant="danger" defaultOpen={false}>
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
          </CollapsibleCard>
        </div>
      </div>
    </div>
  )
}

