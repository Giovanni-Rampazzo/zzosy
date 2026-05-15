"use client"
import { useEffect, useRef, useState } from "react"
import { listFontFamilies, FontFamily, findFamilyAndVariant, ensureFontLoaded } from "@/lib/fonts"

// Cache + promise compartilhada entre todos os Pickers (FontPicker e WeightPicker).
// Garante que ambos vejam exatamente a mesma lista de familias/variantes.
let _familiesCache: FontFamily[] | null = null
let _loadPromise: Promise<FontFamily[]> | null = null

function loadFamilies(triggerPermission: boolean): Promise<FontFamily[]> {
  if (_familiesCache) return Promise.resolve(_familiesCache)
  if (_loadPromise) return _loadPromise
  _loadPromise = listFontFamilies(triggerPermission).then(f => {
    _familiesCache = f
    _loadPromise = null
    return f
  }).catch(() => {
    _loadPromise = null
    return []
  })
  return _loadPromise
}

interface PickerProps {
  /** fontFamily APLICADO ao texto (pode ser "Helvetica Neue" ou "Helvetica Neue Bold") */
  value: string
  onChange: (newFontFamily: string) => void
  buttonStyle?: React.CSSProperties
  /** Fonte da marca do cliente (Google ou custom). Se presente, aparece como secao destacada no topo. */
  brandFont?: string | null
}

/** Picker de FAMILIA. */
export function FontPicker({ value, onChange, buttonStyle, brandFont }: PickerProps) {
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
            {/* Fontes da marca — destaque no topo se cliente tiver brandFont */}
            {brandFont && brandFont.trim() && (!query.trim() || brandFont.toLowerCase().includes(query.toLowerCase().trim())) && (
              <div>
                <div style={{ padding: "8px 12px 4px", fontSize: 9, color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Fonte da marca</div>
                <button
                  type="button"
                  onClick={async () => {
                    try { await ensureFontLoaded(brandFont) } catch {}
                    onChange(brandFont)
                    setOpen(false); setQuery("")
                  }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "6px 12px", border: "none",
                    background: brandFont === currentFamily ? "#3a3a1a" : "transparent",
                    color: "white", fontSize: 13, fontFamily: `'${brandFont}', sans-serif`, cursor: "pointer",
                    borderLeft: "2px solid #F5C400",
                  }}
                  onMouseEnter={e => { if (brandFont !== currentFamily) (e.currentTarget as HTMLButtonElement).style.background = "#2a2a1a" }}
                  onMouseLeave={e => { if (brandFont !== currentFamily) (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
                >
                  {brandFont}
                </button>
                <div style={{ height: 1, background: "#333", margin: "6px 0" }} />
                <div style={{ padding: "0 12px 4px", fontSize: 9, color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Sistema</div>
              </div>
            )}
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

/**
 * Picker de PESO dedicado a fonte da marca (Google ou custom).
 * Diferente do WeightPicker padrao (que opera em "Family + Variant" das
 * fontes do sistema operacional), esse opera direto no fontWeight numerico.
 *
 * - Se customFontFiles tem itens: lista APENAS os pesos+estilos subidos.
 * - Senao (Google Font): lista todos os 9 pesos (100-900) presumindo
 *   que a familia tem todos disponiveis.
 */
const BRAND_WEIGHT_LABELS: Record<number, string> = {
  100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular",
  500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black",
}

export interface BrandWeightOption {
  weight: number
  style: "normal" | "italic"
  label: string
}

export function BrandWeightPicker({
  value, onChange, buttonStyle, customFontFiles,
}: {
  /** fontWeight atual ("400", "700", "normal", "bold") + opcional fontStyle separado nao tratado aqui */
  value: string
  /** Recebe a string do peso ("400", "700", etc) e estilo separado nao usado pra simplificar */
  onChange: (weight: string, style: "normal" | "italic") => void
  buttonStyle?: React.CSSProperties
  /** Se preenchido, restringe a lista aos pesos/estilos disponiveis na familia custom */
  customFontFiles?: Array<{ weight: number; style: "normal" | "italic" }> | null
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  // Constroi a lista de opcoes
  let options: BrandWeightOption[]
  if (customFontFiles && customFontFiles.length > 0) {
    // Apenas os subidos, ordenados por peso e estilo
    const sorted = [...customFontFiles].sort((a, b) =>
      a.weight !== b.weight ? a.weight - b.weight : a.style.localeCompare(b.style)
    )
    options = sorted.map(f => ({
      weight: f.weight,
      style: f.style,
      label: `${f.weight} ${BRAND_WEIGHT_LABELS[f.weight] ?? ""}${f.style === "italic" ? " Italic" : ""}`.trim(),
    }))
  } else {
    // Google Font ou fallback: todos os 9 pesos sem italico
    options = [100, 200, 300, 400, 500, 600, 700, 800, 900].map(w => ({
      weight: w, style: "normal", label: `${w} ${BRAND_WEIGHT_LABELS[w]}`,
    }))
  }

  // Parse do valor atual ("400", "700", "normal", "bold") → numero
  function parseWeight(v: string): number {
    if (v === "normal") return 400
    if (v === "bold") return 700
    const n = Number(v)
    return Number.isFinite(n) ? n : 400
  }
  const currentWeight = parseWeight(value)
  const currentLabel = `${currentWeight} ${BRAND_WEIGHT_LABELS[currentWeight] ?? ""}`.trim()

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", background: "#111", border: "1px solid #2a2a2a",
          color: "white", fontSize: 12, padding: "5px 8px", borderRadius: 4,
          outline: "none", textAlign: "left", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4,
          ...buttonStyle,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {currentLabel}
        </span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
          background: "#1a1a1a", border: "1px solid #333", borderRadius: 6, zIndex: 50,
          maxHeight: 280, overflowY: "auto",
          boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
        }}>
          {options.map(o => {
            const isCurrent = o.weight === currentWeight
            return (
              <button
                key={`${o.weight}-${o.style}`} type="button"
                onClick={() => { onChange(String(o.weight), o.style); setOpen(false) }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "6px 12px", border: "none",
                  background: isCurrent ? "#333" : "transparent",
                  color: "white", fontSize: 12, cursor: "pointer",
                }}
                onMouseEnter={e => { if (!isCurrent) (e.currentTarget as HTMLButtonElement).style.background = "#222" }}
                onMouseLeave={e => { if (!isCurrent) (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
