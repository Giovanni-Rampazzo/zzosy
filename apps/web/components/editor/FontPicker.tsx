"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { listFontFamilies, FontFamily, findFamilyAndVariant, ensureFontLoaded } from "@/lib/fonts"
import { GOOGLE_FONTS, loadGoogleFont } from "@/lib/google-fonts"

// Injeta UM <link> Google Fonts CSS com TODAS as Google Fonts curated em
// batch (idempotente). Garante que cada item do dropdown possa renderizar
// no proprio fontFamily ja na abertura do picker — preview estilo Figma/PS.
// Loop sobre loadGoogleFont (que ja eh idempotente) injeta 1 <link> por
// family — Google Fonts CSS2 API faz 1 round-trip rapido por familia, e
// o display=swap garante fallback enquanto baixa.
let _gfontsPreviewLoaded = false
function preloadGoogleFontsForPreview() {
  if (_gfontsPreviewLoaded) return
  if (typeof document === "undefined") return
  for (const gf of GOOGLE_FONTS) loadGoogleFont(gf.name)
  _gfontsPreviewLoaded = true
}

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
    // Injeta TODAS as Google Fonts da curated list de uma vez — necessario
    // pra cada item do dropdown renderizar com a propria fonte (preview
    // estilo Figma/Photoshop). Idempotente — so injeta 1x por sessao.
    preloadGoogleFontsForPreview()
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  const { family: currentFamily, variant: currentVariant } = findFamilyAndVariant(value, families)

  const filtered = query.trim()
    ? families.filter(f => f.family.toLowerCase().includes(query.toLowerCase().trim()))
    : families

  // Google Fonts em seções separadas (sans / serif / display / mono /
  // handwriting) — header categoria igual Figma. Filtra pela query.
  const googleFiltered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return GOOGLE_FONTS.filter(gf => !q || gf.name.toLowerCase().includes(q))
  }, [query])
  const googleByCategory = useMemo(() => {
    const groups: Record<string, typeof GOOGLE_FONTS> = {}
    for (const gf of googleFiltered) {
      if (!groups[gf.category]) groups[gf.category] = []
      groups[gf.category].push(gf)
    }
    return groups
  }, [googleFiltered])
  const CATEGORY_LABELS: Record<string, string> = {
    sans: "Google · Sans-serif", serif: "Google · Serif", display: "Google · Display",
    mono: "Google · Monospace", handwriting: "Google · Handwriting",
  }
  const CATEGORY_ORDER = ["sans", "serif", "display", "mono", "handwriting"]

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

  // Pick de Google Font direto: family vira o fontFamily aplicado, e o
  // loadGoogleFont jah foi disparado no preload. ensureFontLoaded espera
  // o @font-face ficar pronto antes do onChange aplicar.
  async function pickGoogleFont(name: string) {
    loadGoogleFont(name)
    try { await ensureFontLoaded(name) } catch {}
    onChange(name)
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
          {currentFamily || "Select font"}
        </span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
          background: "#1a1a1a", border: "1px solid #333", borderRadius: 6, zIndex: 50,
          maxHeight: 480, display: "flex", flexDirection: "column",
          boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
          // Largura minima 280px pra acomodar preview de fontes longas
          // ("Plus Jakarta Sans", "Cormorant Garamond" etc) sem ellipsis.
          minWidth: 280,
        }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Escape") { setOpen(false); setQuery("") }
              else if (e.key === "Enter" && filtered.length > 0) pickFamily(filtered[0])
            }}
            placeholder="Search font..."
            style={{
              background: "#111", border: "none", borderBottom: "1px solid #333",
              color: "white", fontSize: 12, padding: "8px 10px",
              outline: "none", borderRadius: "6px 6px 0 0",
            }}
          />
          <div style={{ overflowY: "auto", maxHeight: 430 }}>
            {/* Fontes da marca — destaque no topo se cliente tiver brandFont */}
            {brandFont && brandFont.trim() && (!query.trim() || brandFont.toLowerCase().includes(query.toLowerCase().trim())) && (
              <div>
                <div style={{ padding: "8px 12px 4px", fontSize: 9, color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Brand font</div>
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
                <div style={{ padding: "0 12px 4px", fontSize: 9, color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>System</div>
              </div>
            )}
            {/* Google Fonts em secoes por categoria — preview estilo Figma/PS.
                Cada item usa fontFamily proprio; preload em batch garante que
                o CSS esteja registrado quando o item renderiza. */}
            {CATEGORY_ORDER.map(cat => {
              const items = googleByCategory[cat]
              if (!items || items.length === 0) return null
              return (
                <div key={cat}>
                  <div style={{ padding: "10px 12px 4px", fontSize: 9, color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    {CATEGORY_LABELS[cat] ?? cat}
                  </div>
                  {items.map(gf => (
                    <button
                      key={`g-${gf.name}`} type="button"
                      onClick={() => pickGoogleFont(gf.name)}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        padding: "8px 12px", border: "none",
                        background: gf.name === currentFamily ? "#333" : "transparent",
                        color: "white", fontSize: 15, fontFamily: `"${gf.name}", sans-serif`,
                        cursor: "pointer", lineHeight: 1.2,
                      }}
                      onMouseEnter={e => { if (gf.name !== currentFamily) (e.currentTarget as HTMLButtonElement).style.background = "#222" }}
                      onMouseLeave={e => { if (gf.name !== currentFamily) (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
                    >
                      {gf.name}
                    </button>
                  ))}
                </div>
              )
            })}
            {/* Separador entre Google e Sistema (so se Google teve resultado) */}
            {Object.keys(googleByCategory).length > 0 && filtered.length > 0 && (
              <div style={{ height: 1, background: "#333", margin: "8px 0" }} />
            )}
            {/* Fontes do sistema (Local Font Access ou fallback) */}
            {filtered.length > 0 && (
              <div style={{ padding: "10px 12px 4px", fontSize: 9, color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Sistema
              </div>
            )}
            {filtered.length === 0 && Object.keys(googleByCategory).length === 0 ? (
              <div style={{ padding: "10px 12px", color: "#888", fontSize: 11 }}>Nenhuma fonte encontrada</div>
            ) : (
              filtered.map(f => (
                <button
                  key={f.family} type="button"
                  onClick={() => pickFamily(f)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "8px 12px", border: "none",
                    background: f.family === currentFamily ? "#333" : "transparent",
                    color: "white", fontSize: 15, fontFamily: f.family, cursor: "pointer",
                    lineHeight: 1.2,
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

// 9 pesos padrao do Google Fonts/CSS — usado quando a familia atual NAO esta
// na lista de variantes do sistema (typical case: Google Font do PSD,
// fonte custom do cliente). Cada peso = numero CSS (100..900); o label e' o
// nome humano que o user reconhece (Photoshop/Adobe).
const NUMERIC_WEIGHTS: Array<{ label: string; weight: number }> = [
  { label: "Thin", weight: 100 },
  { label: "Extra Light", weight: 200 },
  { label: "Light", weight: 300 },
  { label: "Regular", weight: 400 },
  { label: "Medium", weight: 500 },
  { label: "Semi Bold", weight: 600 },
  { label: "Bold", weight: 700 },
  { label: "Extra Bold", weight: 800 },
  { label: "Black", weight: 900 },
]

// Normaliza fontWeight (pode vir como "normal", "bold", "300", 300, "Bold")
// pra numero canonico CSS. Permite o picker mostrar o peso atual corretamente
// mesmo quando o PSD salvou string e o user picou numero (ou vice-versa).
function weightToNumber(w: string | number | undefined | null): number {
  if (typeof w === "number") return w
  if (typeof w === "string") {
    const lower = w.trim().toLowerCase()
    if (lower === "bold") return 700
    if (lower === "normal" || lower === "regular") return 400
    const n = Number(lower)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 400
}

interface WeightPickerProps extends PickerProps {
  /**
   * Peso atual aplicado ao texto. Necessario pro modo numerico (Google/custom):
   * sem isso, o picker nao consegue mostrar qual peso esta ativo, porque a
   * familia nao muda entre pesos (todos compartilham "Exo 2", soh o fontWeight
   * difere). Opcional pro modo de variantes do sistema (onde o peso esta
   * encodado no nome da fonte, ex: "Helvetica Neue Bold").
   */
  fontWeight?: string | number | null
  /**
   * Callback pro modo numerico — chamado com o numero CSS (100..900) quando
   * o user pica um peso de Google Font/custom. Sem isso, o picker tenta
   * trocar fontFamily (modo de variantes). Editor passa este pra Google Fonts.
   */
  onPickWeight?: (weight: number) => void
}

/** Picker de PESO/VARIANTE da familia atualmente aplicada. */
export function WeightPicker({ value, fontWeight, onChange, onPickWeight, buttonStyle }: WeightPickerProps) {
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
  const systemVariants = familyObj ? Object.keys(familyObj.variants) : []

  // Modo numerico: familia NAO esta na lista de variantes do sistema. Isso
  // cobre Google Fonts (loadGoogleFont carrega todos 100-900 com font-weight
  // numerico CSS) e fontes custom do cliente (loadCustomFontFamily registra
  // @font-face por peso). Nesses casos, o seletor de peso muda fontWeight,
  // nao fontFamily.
  const isNumericMode = systemVariants.length <= 1 && !!onPickWeight
  const currentNumericWeight = weightToNumber(fontWeight)

  // Label exibido no botao: modo variantes mostra o label da variante (Bold,
  // Light, etc); modo numerico mostra o nome humano do peso atual.
  const currentLabel = isNumericMode
    ? (NUMERIC_WEIGHTS.find(w => w.weight === currentNumericWeight)?.label ?? `${currentNumericWeight}`)
    : currentVariant

  // Lista de opcoes a renderizar no dropdown. Modo variantes: variantes do
  // sistema (Bold, Light, etc, com fontFamily diferente cada). Modo numerico:
  // 9 pesos padrao (mesmo fontFamily, fontWeight diferente).
  const dropdownOptions: Array<{ label: string; key: string; isActive: boolean }> = isNumericMode
    ? NUMERIC_WEIGHTS.map(w => ({
        label: w.label,
        key: `n${w.weight}`,
        isActive: w.weight === currentNumericWeight,
      }))
    : systemVariants.map(v => ({
        label: v,
        key: `v${v}`,
        isActive: v === currentVariant,
      }))

  async function pickItem(opt: { key: string; label: string }) {
    if (isNumericMode) {
      const weight = Number(opt.key.slice(1))
      if (Number.isFinite(weight) && weight !== currentNumericWeight) {
        onPickWeight!(weight)
      }
      setOpen(false)
      return
    }
    if (!familyObj) return
    const newValue = familyObj.variants[opt.label]
    if (!newValue || newValue === value) { setOpen(false); return }
    // Garante que a fonte esta registrada no document.fonts antes de aplicar.
    // Sem isso, navegador faz fallback CSS pra outra fonte aleatoria.
    await ensureFontLoaded(newValue)
    onChange(newValue)
    setOpen(false)
  }

  // Interativo = tem mais de uma opcao OU esta em modo numerico (sempre 9 opcoes)
  const interactive = isNumericMode || systemVariants.length > 1

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={!interactive}
        style={{
          width: "100%", background: "#111", border: "1px solid #2a2a2a",
          color: "white", fontSize: 12, padding: "5px 8px", borderRadius: 4,
          outline: "none", textAlign: "left",
          cursor: interactive ? "pointer" : "default",
          opacity: interactive ? 1 : 0.6,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4,
          ...buttonStyle,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {currentLabel}
        </span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
      </button>
      {open && interactive && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
          background: "#1a1a1a", border: "1px solid #333", borderRadius: 6, zIndex: 50,
          maxHeight: 280, overflowY: "auto",
          boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
        }}>
          {dropdownOptions.map(opt => (
            <button
              key={opt.key} type="button"
              onClick={() => pickItem(opt)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "6px 12px", border: "none",
                background: opt.isActive ? "#333" : "transparent",
                color: "white", fontSize: 12, cursor: "pointer",
              }}
              onMouseEnter={e => { if (!opt.isActive) (e.currentTarget as HTMLButtonElement).style.background = "#222" }}
              onMouseLeave={e => { if (!opt.isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
