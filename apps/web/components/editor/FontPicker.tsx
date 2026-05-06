"use client"
import { useEffect, useRef, useState } from "react"
import { listAvailableFonts, FALLBACK_FONTS } from "@/lib/fonts"

interface Props {
  value: string
  onChange: (font: string) => void
  /** Estilo aplicado ao botao (input no editor tem fundo escuro) */
  buttonStyle?: React.CSSProperties
}

export function FontPicker({ value, onChange, buttonStyle }: Props) {
  const [fonts, setFonts] = useState<string[]>(FALLBACK_FONTS)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Carrega lista de fontes (com permissao) na primeira vez que abre o editor.
  useEffect(() => {
    listAvailableFonts(true).then(setFonts).catch(() => setFonts(FALLBACK_FONTS))
  }, [])

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  // Foca o input ao abrir
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  const filtered = (() => {
    const list = query.trim()
      ? fonts.filter(f => f.toLowerCase().includes(query.toLowerCase().trim()))
      : fonts
    // Dedup defensivo (caso a fonte do sistema retorne duplicatas)
    return Array.from(new Set(list))
  })()

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%",
          background: "#111",
          border: "1px solid #2a2a2a",
          color: "white",
          fontSize: 12,
          padding: "5px 8px",
          borderRadius: 4,
          fontFamily: value || "inherit",
          outline: "none",
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 4,
          ...buttonStyle,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value || "Selecionar fonte"}
        </span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
          background: "#1a1a1a", border: "1px solid #333",
          borderRadius: 6, zIndex: 50,
          maxHeight: 320, display: "flex", flexDirection: "column",
          boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
        }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Escape") { setOpen(false); setQuery("") }
              else if (e.key === "Enter" && filtered.length > 0) {
                onChange(filtered[0])
                setOpen(false)
                setQuery("")
              }
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
                  key={f}
                  type="button"
                  onClick={() => { onChange(f); setOpen(false); setQuery("") }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "6px 12px", border: "none",
                    background: f === value ? "#333" : "transparent",
                    color: "white", fontSize: 13,
                    fontFamily: f, cursor: "pointer",
                  }}
                  onMouseEnter={e => { if (f !== value) (e.currentTarget as HTMLButtonElement).style.background = "#222" }}
                  onMouseLeave={e => { if (f !== value) (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
                >
                  {f}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
