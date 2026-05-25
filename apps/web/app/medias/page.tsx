"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PageShell } from "@/components/layout/PageShell"
import { Button } from "@/components/ui/Button"
import { UNITS, toPx, Unit } from "@/lib/unitConversion"

interface MediaFormat {
  id: string; vehicle: string; media: string; format: string
  width: number; height: number; dpi: number
  widthValue?: number | null; heightValue?: number | null
  widthUnit?: string | null; heightUnit?: string | null
  category: string; segment?: string | null; isDefault: boolean
}

type FormState = {
  vehicle: string; media: string; format: string;
  // Valores na unidade escolhida (NAO em px).
  widthValue: string; heightValue: string;
  widthUnit: Unit; heightUnit: Unit;
  dpi: string; category: string; segment: string;
}

const emptyForm: FormState = {
  vehicle: "", media: "", format: "",
  widthValue: "", heightValue: "",
  widthUnit: "px", heightUnit: "px",
  dpi: "72", category: "", segment: "",
}

/** Formata numero pra exibicao: inteiro sem decimais, decimal com 2 casas. */
function formatNum(v: number | string): string {
  const n = typeof v === "number" ? v : Number(v)
  if (!isFinite(n)) return String(v)
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "")
}

export default function MediasPage() {
  const router = useRouter()
  const [formats, setFormats] = useState<MediaFormat[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [segmentSuggestions, setSegmentSuggestions] = useState<string[]>([])
  const isEditing = editingId !== null

  useEffect(() => {
    fetch("/api/medias", { cache: "no-store" }).then(r => r.json()).then(d => { setFormats(Array.isArray(d)?d:[]); setLoading(false) })
    // Sugestoes de segmento: union dos segments ja usados em pecas + os ja
    // setados em outros MediaFormats. Datalist mostra ambos.
    fetch("/api/pieces/segments").then(r => r.json()).then(d => {
      setSegmentSuggestions(Array.isArray(d?.segments) ? d.segments : [])
    }).catch(() => {})
  }, [])

  function openCreate() {
    setForm(emptyForm)
    setEditingId(null)
    setShowModal(true)
  }

  function openEdit(f: MediaFormat) {
    // Se o formato tem widthValue/widthUnit salvos, usa eles direto.
    // Senao (formatos antigos cadastrados antes do refactor), assume px.
    const dpiNum = f.dpi ?? 72
    const widthUnit = (f.widthUnit as Unit) ?? "px"
    const heightUnit = (f.heightUnit as Unit) ?? "px"
    const widthVal = (f.widthValue != null) ? f.widthValue : f.width
    const heightVal = (f.heightValue != null) ? f.heightValue : f.height
    setForm({
      vehicle: f.vehicle ?? "",
      media: f.media ?? "",
      format: f.format ?? "",
      widthValue: String(widthVal),
      heightValue: String(heightVal),
      widthUnit,
      heightUnit,
      dpi: String(dpiNum),
      category: f.category ?? "",
      segment: f.segment ?? "",
    })
    setEditingId(f.id)
    setShowModal(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Envia widthValue/heightValue + units + dpi. Backend calcula width/height (px).
    const payload = {
      vehicle: form.vehicle,
      media: form.media,
      format: form.format,
      widthValue: +form.widthValue,
      heightValue: +form.heightValue,
      widthUnit: form.widthUnit,
      heightUnit: form.heightUnit,
      dpi: +form.dpi,
      category: form.category,
      segment: form.segment.trim() || null,
    }
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
    const dpiNum = f.dpi ?? 72
    const widthUnit = (f.widthUnit as Unit) ?? "px"
    const heightUnit = (f.heightUnit as Unit) ?? "px"
    const widthVal = (f.widthValue != null) ? f.widthValue : f.width
    const heightVal = (f.heightValue != null) ? f.heightValue : f.height
    const payload = {
      vehicle: f.vehicle,
      media: f.media,
      format: `${f.format} (cópia)`,
      widthValue: widthVal,
      heightValue: heightVal,
      widthUnit, heightUnit,
      dpi: dpiNum,
      category: f.category,
      segment: f.segment ?? null,
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
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:32,gap:16}}>
          <div style={{display:"flex",alignItems:"center",gap:12,flex:1,minWidth:0}}>
            {/* Voltar com stroke amarelo, mesmo size do "+ Novo formato".
                Padrao ZZOSY: variant="view" = fill branco + stroke amarelo +
                texto preto. Mesma altura/peso visual do CTA principal. */}
            <Button
              variant="view"
              size="md"
              onClick={() => { router.push("/dashboard") }}
            >
              ← Voltar
            </Button>
            <div>
              <h1 style={{fontSize:22,fontWeight:700,margin:0}}>Mídias e Formatos</h1>
            </div>
          </div>
          <Button variant="primary" size="md" onClick={openCreate}>+ Novo formato</Button>
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
                  {groupedFormats[label].map(f => {
                    // Exibicao: se o formato tem widthValue+unit salvos, mostra na unidade
                    // original com (px) entre parenteses. Senao mostra so px.
                    const wU = (f.widthUnit as Unit) ?? "px"
                    const hU = (f.heightUnit as Unit) ?? "px"
                    const wV = f.widthValue ?? f.width
                    const hV = f.heightValue ?? f.height
                    const dimText = (wU === "px" && hU === "px")
                      ? `${f.width}×${f.height} px`
                      : `${formatNum(wV)} ${wU} × ${formatNum(hV)} ${hU}`
                    return (
                  <div key={f.id} style={{display:"flex",alignItems:"center",padding:"10px 20px",borderBottom:"1px solid #f0f0f0"}}>
                    <div style={{flex:1,fontWeight:600,fontSize:13}}>{f.vehicle}</div>
                    <div style={{width:140,fontSize:12,color:"#888"}}>{f.media}</div>
                    <div style={{width:150,fontSize:12,color:"#888"}}>{f.format}</div>
                    <div style={{width:170,fontSize:12,color:"#888"}}>{dimText}</div>
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
                    )
                  })}
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
                  <CategorySelect
                    value={form.category}
                    onChange={v => setForm(f => ({...f, category: v}))}
                    options={categories.filter(c => c !== "Sem categoria")}
                    placeholder="Selecione..."
                    inp={inp}
                    required
                  />
                </div>
              </div>
              {/* Segmento: opcional. Dropdown com options inferidas de pecas existentes
                  + segments ja salvos em outros MediaFormats. "+ Nova" abre input inline. */}
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.5px",color:"#888"}}>Segmento</label>
                <CategorySelect
                  value={form.segment}
                  onChange={v => setForm(f => ({...f, segment: v}))}
                  options={Array.from(new Set([
                    ...segmentSuggestions,
                    ...formats.map(f => f.segment ?? "").filter(s => s.length > 0),
                  ])).sort()}
                  placeholder="Opcional — selecione..."
                  inp={inp}
                />
              </div>
              {/* Largura + unidade. Photoshop-style: valor numerico + dropdown de unidade. */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.5px",color:"#888"}}>Largura</label>
                  <div style={{display:"flex",gap:6}}>
                    <input
                      type="number"
                      step="any"
                      value={form.widthValue}
                      onChange={e => setForm(f => ({...f,widthValue:e.target.value}))}
                      required
                      style={{...inp,flex:1}}
                    />
                    <select
                      value={form.widthUnit}
                      onChange={e => setForm(f => ({...f,widthUnit:e.target.value as Unit}))}
                      style={{...inp,width:110}}
                    >
                      {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  </div>
                  {form.widthUnit !== "px" && form.widthValue && !isNaN(+form.widthValue) && (
                    <span style={{fontSize:10,color:"#aaa"}}>= {toPx(+form.widthValue, form.widthUnit, +form.dpi || 72)} px</span>
                  )}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.5px",color:"#888"}}>Altura</label>
                  <div style={{display:"flex",gap:6}}>
                    <input
                      type="number"
                      step="any"
                      value={form.heightValue}
                      onChange={e => setForm(f => ({...f,heightValue:e.target.value}))}
                      required
                      style={{...inp,flex:1}}
                    />
                    <select
                      value={form.heightUnit}
                      onChange={e => setForm(f => ({...f,heightUnit:e.target.value as Unit}))}
                      style={{...inp,width:110}}
                    >
                      {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  </div>
                  {form.heightUnit !== "px" && form.heightValue && !isNaN(+form.heightValue) && (
                    <span style={{fontSize:10,color:"#aaa"}}>= {toPx(+form.heightValue, form.heightUnit, +form.dpi || 72)} px</span>
                  )}
                </div>
              </div>
              {/* DPI: Photoshop-style "Resolution: 300 Pixels/Inch" */}
              <div style={{display:"grid",gridTemplateColumns:"1fr",gap:10}}>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  <label style={{fontSize:11,fontWeight:600,textTransform:"uppercase" as const,letterSpacing:"0.5px",color:"#888"}}>Resolução (DPI)</label>
                  <input
                    type="number"
                    step="1"
                    value={form.dpi}
                    onChange={e => setForm(f => ({...f,dpi:e.target.value}))}
                    required
                    style={inp}
                  />
                  <span style={{fontSize:10,color:"#aaa"}}>72 = tela / 300 = impressão</span>
                </div>
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

/**
 * Combobox: dropdown nativo com as opcoes existentes + ultima opcao "+ Adicionar nova"
 * que troca pra input de texto inline (autoFocus). Esc / Blur com valor vazio volta
 * pra dropdown. Padrao pra Categoria e Segmento — constrange escolha mas permite
 * criar nova quando necessario.
 */
function CategorySelect({
  value, onChange, options, placeholder, inp, required,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder: string
  inp: React.CSSProperties
  required?: boolean
}) {
  const [creatingNew, setCreatingNew] = useState(false)
  // Se o valor atual nao existe nas opcoes (ex: edit de um formato antigo com
  // valor custom), ativa modo de input ao carregar pra mostrar o valor real.
  const valueInOptions = !value || options.includes(value)
  const showInput = creatingNew || !valueInOptions

  if (showInput) {
    return (
      <div style={{display:"flex",gap:6}}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Digite novo valor..."
          autoFocus
          required={required}
          style={{...inp, flex:1}}
          onKeyDown={e => {
            if (e.key === "Escape") {
              onChange("")
              setCreatingNew(false)
            }
          }}
        />
        {options.length > 0 && (
          <button
            type="button"
            onClick={() => { onChange(""); setCreatingNew(false) }}
            style={{padding:"0 10px",background:"transparent",border:"1px solid #E0E0E0",borderRadius:6,cursor:"pointer",fontSize:11,color:"#888"}}
            title="Voltar pra lista"
          >
            ←
          </button>
        )}
      </div>
    )
  }

  return (
    <select
      value={value}
      onChange={e => {
        if (e.target.value === "__new__") {
          onChange("")
          setCreatingNew(true)
        } else {
          onChange(e.target.value)
        }
      }}
      required={required}
      style={inp}
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o} value={o}>{o}</option>
      ))}
      <option value="__new__">+ Adicionar novo...</option>
    </select>
  )
}
