"use client"
/**
 * ColorSwatchPicker — picker estilo Figma.
 *
 * UI inline mostra APENAS o swatch atual (1 linha enxuta). Click no swatch
 * abre popup contendo:
 *   - Native color picker + hex input (linha topo)
 *   - "Cores da marca" (brand colors) — clica vincula via brandIdx
 *   - "Padrão" (default swatches)
 *
 * Popup fecha ao clicar fora ou apertar Esc. Posicao absolute relativa ao
 * swatch trigger.
 *
 * Props:
 *   value: hex atual (ex: "#ff0000"). Aceita "" pra "sem cor".
 *   onChange: callback (hex, brandIdx?) — brandIdx setado quando usuario
 *             clica em swatch da marca; undefined caso contrario.
 *   brandColors: paleta da marca (Client.brandColors).
 *   defaultSwatches: paleta default (SWATCHES const).
 *   activeBrandIdx: opcional — destaca brand color especifica como ativa
 *                   (usado pra "fill vinculado a brand color" via __fillBrandIdx).
 *   allowEmpty: mostra botao ∅ "sem cor" — pra stroke onde nada eh valido.
 *   size: tamanho do swatch trigger (default 36).
 *   title: tooltip opcional.
 */
import { useEffect, useRef, useState } from "react"

interface BrandColor { hex: string; name?: string | null }

interface Props {
  value: string
  onChange: (hex: string, brandIdx?: number) => void
  brandColors: BrandColor[]
  defaultSwatches: string[]
  activeBrandIdx?: number
  allowEmpty?: boolean
  size?: number
  title?: string
}

export function ColorSwatchPicker({
  value,
  onChange,
  brandColors,
  defaultSwatches,
  activeBrandIdx,
  allowEmpty = false,
  size = 36,
  title,
}: Props) {
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState(value)
  const rootRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // Sync externo (value muda fora) → atualiza hex local.
  useEffect(() => { setHex(value) }, [value])

  // Fecha ao clicar fora ou Esc.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (!rootRef.current) return
      const target = e.target as Node
      // Permite clicar dentro do trigger ou do popup; tudo mais fecha.
      if (rootRef.current.contains(target) || popupRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  // Swatch visual atual. "" / null = checker xadrez ("sem cor").
  const swatchBg = value && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : (allowEmpty && !value
        ? undefined
        : value || "#000000")
  const emptyChecker = allowEmpty && !value
    ? "linear-gradient(135deg, #fff 25%, #d0d0d0 25%, #d0d0d0 50%, #fff 50%, #fff 75%, #d0d0d0 75%)"
    : undefined

  const popupS: React.CSSProperties = {
    position: "absolute", top: "calc(100% + 6px)", left: 0,
    minWidth: 240, padding: 12,
    background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    zIndex: 1000,
    display: "flex", flexDirection: "column", gap: 10,
  }
  const labelS: React.CSSProperties = {
    fontSize: 10, fontWeight: 700 as const, textTransform: "uppercase" as const,
    letterSpacing: "0.5px", color: "#888", marginBottom: 4,
  }
  const inputS: React.CSSProperties = {
    width: "100%", background: "#111", border: "1px solid #2a2a2a", color: "white",
    fontSize: 12, padding: "5px 8px", borderRadius: 4, fontFamily: "monospace",
    outline: "none", textTransform: "uppercase",
  }

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      {/* Trigger swatch */}
      <button
        type="button"
        title={title ?? (value || "Sem cor")}
        onClick={() => setOpen(o => !o)}
        style={{
          width: size, height: size, borderRadius: 6,
          background: emptyChecker ?? swatchBg,
          backgroundSize: emptyChecker ? "8px 8px" : undefined,
          border: "1px solid #2a2a2a", cursor: "pointer", padding: 0,
          outline: open ? "2px solid #F5C400" : "none", outlineOffset: 1,
        }}
      />

      {/* Popup */}
      {open && (
        <div ref={popupRef} style={popupS} onMouseDown={e => e.stopPropagation()}>
          {/* Hex + native picker */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <label style={{
              width: 32, height: 32, borderRadius: 4,
              background: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000",
              border: "1px solid #2a2a2a", cursor: "pointer",
              position: "relative", overflow: "hidden", flexShrink: 0,
            }}>
              <input type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000"}
                onChange={e => { setHex(e.target.value); onChange(e.target.value, undefined) }}
                style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", border: 0 }} />
            </label>
            <input type="text" value={hex} placeholder="#RRGGBB"
              onChange={e => {
                const v = e.target.value
                setHex(v)
                if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v, undefined)
              }}
              onBlur={() => {
                if (!/^#[0-9a-fA-F]{6}$/.test(hex)) setHex(value)
              }}
              style={inputS} />
            {allowEmpty && (
              <button type="button" title="Sem cor"
                onClick={() => { setHex(""); onChange("", undefined); setOpen(false) }}
                style={{
                  width: 32, height: 32, padding: 0, cursor: "pointer",
                  background: "#111", border: "1px solid #2a2a2a", color: "#aaa",
                  borderRadius: 4, fontSize: 14, lineHeight: 1, fontFamily: "inherit",
                }}>∅</button>
            )}
          </div>

          {/* Brand colors */}
          {brandColors.length > 0 && (
            <div>
              <div style={labelS}>Cores da marca</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {brandColors.map((bc, i) => {
                  const activeByRef = activeBrandIdx === i
                  const activeByHex = !activeByRef && value.toLowerCase() === bc.hex.toLowerCase()
                  const active = activeByRef || activeByHex
                  return (
                    <button key={`bc-${i}-${bc.hex}`} type="button"
                      title={bc.name ? `${bc.name} (${bc.hex})` : bc.hex}
                      onClick={() => { onChange(bc.hex, i); setOpen(false) }}
                      style={{
                        width: 26, height: 26, borderRadius: 5, background: bc.hex,
                        cursor: "pointer", padding: 0,
                        border: active ? "2px solid #F5C400" : "2px solid #2a2a2a",
                      }} />
                  )
                })}
              </div>
            </div>
          )}

          {/* Default swatches */}
          {defaultSwatches.length > 0 && (
            <div>
              <div style={labelS}>Padrão</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {defaultSwatches.map(c => {
                  const active = value.toLowerCase() === c.toLowerCase()
                  return (
                    <button key={`def-${c}`} type="button" title={c}
                      onClick={() => { onChange(c, undefined); setOpen(false) }}
                      style={{
                        width: 26, height: 26, borderRadius: 5, background: c,
                        cursor: "pointer", padding: 0,
                        border: active ? "2px solid #F5C400" : "2px solid #2a2a2a",
                      }} />
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
