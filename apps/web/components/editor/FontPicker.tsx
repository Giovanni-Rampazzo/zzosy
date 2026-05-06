"use client"
import { useEffect, useRef, useState } from "react"
import { listFontFamilies, FontFamily, findFamilyAndVariant } from "@/lib/fonts"

let _familiesCache: FontFamily[] | null = null

interface PickerProps {
  /** fontFamily APLICADO ao texto (pode ser "Helvetica Neue" ou "Helvetica Neue Bold") */
  value: string
  onChange: (newFontFamily: string) => void
  buttonStyle?: React.CSSProperties
}

/**
 * Picker de FAMILIA. Mostra apenas o nome canonico (ex: "Helvetica Neue").
 * Ao escolher, aplica a variante "Regular" da familia.
 * Se ja houver variante (ex: Bold), preserva o variant atual quando troca de familia.
 */
export function FontPicker({ value, onChange, buttonStyle }: PickerProps) {
  const [families, setFamilies] = useState<FontFamily[]>(_familiesCache ?? [])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listFontFamilies(true).then(f => { _familiesCache = f; setFamilies(f) }).catch(() => {})
  }, [])

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

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50) }, [open])

  const { family: currentFamily, variant: currentVariant } = findFamilyAndVariant(value, families)

  const filtered = query.trim()
    ? families.filter(f => f.family.toLowerCase().includes(query.toLowerCase().trim()))
    : families

  function pickFamily(fam: FontFamily) {
    const targetVariant = fam.variants[currentVariant] ? currentVariant : "Regular"
    const newValue = fam.variants[targetVariant] ?? fam.variants["Regular"] ?? fam.family
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

/**
 * Picker de PESO/VARIANTE da familia atualmente aplicada.
 * Ex: pra "Helvetica Neue Bold", mostra Regular/Light/Bold/etc da familia "Helvetica Neue".
 */
export function WeightPicker({ value, onChange, buttonStyle }: PickerProps) {
  const [families, setFamilies] = useState<FontFamily[]>(_familiesCache ?? [])
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (_familiesCache) { setFamilies(_familiesCache); return }
    listFontFamilies(false).then(f => { _familiesCache = f; setFamilies(f) }).catch(() => {})
  }, [])

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
  const variants = familyObj ? Object.keys(familyObj.variants) : ["Regular"]

  function pickVariant(label: string) {
    const newValue = familyObj?.variants[label] ?? value
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
