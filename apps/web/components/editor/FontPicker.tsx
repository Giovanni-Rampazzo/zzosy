"use client"
import { useEffect, useRef, useState } from "react"
import { listFontFamilies, FontFamily, findFamilyAndVariant, ensureFontLoaded } from "@/lib/fonts"

// Cache + promise compartilhada entre todos os Pickers (FontPicker e WeightPicker).
// Garante que ambos vejam exatamente a mesma lista de familias/variantes.
let _familiesCache: FontFamily[] | null = null
let _loadPromise: Promise<FontFamily[]> | null = null
// Marca se a ultima chamada bem-sucedida foi a versao "local fonts" (com
// permission) ou so o fallback. Quando triggerPermission=true e o cache atual
// eh fallback, tenta de novo (cobre cenario: mount populou cache com fallback
// porque nao tinha gesture do user, depois user clica picker = gesture valida).
let _cacheIsLocalFonts = false

function loadFamilies(triggerPermission: boolean): Promise<FontFamily[]> {
  if (_familiesCache && (!triggerPermission || _cacheIsLocalFonts)) {
    return Promise.resolve(_familiesCache)
  }
  if (_loadPromise) return _loadPromise
  _loadPromise = listFontFamilies(triggerPermission).then(f => {
    _familiesCache = f
    _cacheIsLocalFonts = triggerPermission && f.length > 0
    _loadPromise = null
    return f
  }).catch(() => {
    _loadPromise = null
    return _familiesCache ?? []
  })
  return _loadPromise
}

interface PickerProps {
  /** fontFamily APLICADO ao texto (pode ser "Helvetica Neue" ou "Helvetica Neue Bold") */
  value: string
  onChange: (newFontFamily: string) => void
  buttonStyle?: React.CSSProperties
}

/** Picker de FAMILIA. */
export function FontPicker({ value, onChange, buttonStyle }: PickerProps) {
  const [families, setFamilies] = useState<FontFamily[]>(_familiesCache ?? [])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Monta sem pedir permissao — usa cache se disponivel.
  useEffect(() => { loadFamilies(false).then(setFamilies) }, [])

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery("")
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  useEffect(() => {
    if (!open) return
    // Pede permissao na primeira abertura (gesto do usuario)
    loadFamilies(true).then(setFamilies)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  const { family: currentFamily, variant: currentVariant } = findFamilyAndVariant(value, families)

  const filtered = query.trim()
    ? families.filter(f => f.family.toLowerCase().includes(query.toLowerCase().trim()))
    : families

  async function pickFamily(fam: FontFamily) {
    const variantNames = Object.keys(fam.variants)
    const targetVariant = fam.variants[currentVariant]
      ? currentVariant
      : (fam.variants["Regular"] ? "Regular" : variantNames[0])
    const newValue = fam.variants[targetVariant] ?? fam.family
    await ensureFontLoaded(newValue)
    onChange(newValue)
    setOpen(false); setQuery("")
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", background: "#111", border: "1px solid #2a2a2a",
          color: "white", fontSize: 12, padding: "5px 8px", borderRadius: 4,
          fontFamily: currentFamily || "inherit", outline: "none",
          textAlign: "left", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4,
          ...buttonStyle,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {currentFamily || "Selecionar fonte"}
        </span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
          background: "#1a1a1a", border: "1px solid #333", borderRadius: 6, zIndex: 50,
          maxHeight: 320, display: "flex", flexDirection: "column",
          boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
        }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Escape") { setOpen(false); setQuery("") }
              else if (e.key === "Enter" && filtered.length > 0) pickFamily(filtered[0])
            }}
            placeholder="Buscar fonte..."
            style={{
              background: "#111", border: "none", borderBottom: "1px solid #333",
              color: "white", fontSize: 12, padding: "8px 10px",
              outline: "none", borderRadius: "6px 6px 0 0",
            }}
          />
          <div style={{ overflowY: "auto", maxHeight: 270 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "10px 12px", color: "#888", fontSize: 11 }}>Nenhuma fonte encontrada</div>
            ) : (
              filtered.map(f => (
                <button
                  key={f.family} type="button"
                  onClick={() => pickFamily(f)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "6px 12px", border: "none",
                    background: f.family === currentFamily ? "#333" : "transparent",
                    color: "white", fontSize: 13, fontFamily: f.family, cursor: "pointer",
                  }}
                  onMouseEnter={e => { if (f.family !== currentFamily) (e.currentTarget as HTMLButtonElement).style.background = "#222" }}
                  onMouseLeave={e => { if (f.family !== currentFamily) (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
                >
                  {f.family}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Picker de PESO/VARIANTE da familia atualmente aplicada. */
export function WeightPicker({ value, onChange, buttonStyle }: PickerProps) {
  const [families, setFamilies] = useState<FontFamily[]>(_familiesCache ?? [])
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Compartilha o mesmo cache do FontPicker. Se ainda nao carregou, espera.
  // Nao chama com triggerPermission=true aqui (o FontPicker ja faz isso).
  useEffect(() => { loadFamilies(false).then(setFamilies) }, [])

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  const { family: currentFamily, variant: currentVariant } = findFamilyAndVariant(value, families)
  const familyObj = families.find(f => f.family === currentFamily)
  // Se nao achou a familia (raro, mas pode acontecer com fontes muito custom), retorna so Regular
  const variants = familyObj ? Object.keys(familyObj.variants) : ["Regular"]

  async function pickVariant(label: string) {
    if (!familyObj) return
    const newValue = familyObj.variants[label]
    if (!newValue || newValue === value) { setOpen(false); return }
    // Garante que a fonte esta registrada no document.fonts antes de aplicar.
    // Sem isso, navegador faz fallback CSS pra outra fonte aleatoria.
    await ensureFontLoaded(newValue)
    onChange(newValue)
    setOpen(false)
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={variants.length <= 1}
        style={{
          width: "100%", background: "#111", border: "1px solid #2a2a2a",
          color: "white", fontSize: 12, padding: "5px 8px", borderRadius: 4,
          outline: "none", textAlign: "left",
          cursor: variants.length > 1 ? "pointer" : "default",
          opacity: variants.length > 1 ? 1 : 0.6,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4,
          ...buttonStyle,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {currentVariant}
        </span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
      </button>
      {open && variants.length > 1 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
          background: "#1a1a1a", border: "1px solid #333", borderRadius: 6, zIndex: 50,
          maxHeight: 280, overflowY: "auto",
          boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
        }}>
          {variants.map(v => (
            <button
              key={v} type="button"
              onClick={() => pickVariant(v)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "6px 12px", border: "none",
                background: v === currentVariant ? "#333" : "transparent",
                color: "white", fontSize: 12, cursor: "pointer",
              }}
              onMouseEnter={e => { if (v !== currentVariant) (e.currentTarget as HTMLButtonElement).style.background = "#222" }}
              onMouseLeave={e => { if (v !== currentVariant) (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
            >
              {v}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
