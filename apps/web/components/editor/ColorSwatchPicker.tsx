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
  /** Tamanho do swatch trigger (default 24 — Figma-style enxuto). */
  size?: number
  title?: string
  /** Opacidade 0-100. Quando definido + onOpacityChange tambem, renderiza
   *  field de opacity inline na mesma linha (Figma-style). */
  opacity?: number
  onOpacityChange?: (pct: number) => void
  /**
   * Fired no mousedown do trigger ANTES do click roubar foco do contexto
   * atual (ex: textbox em edicao). Pra editor de texto: o parent salva
   * `savedTextSelection.current` aqui pra applyStyle aplicar so nos chars
   * selecionados em vez do textbox inteiro. Sem isso, per-char colors nao
   * funcionam quando user clica no swatch.
   */
  onMouseDownCapture?: () => void
}

export function ColorSwatchPicker({
  value,
  onChange,
  brandColors,
  defaultSwatches,
  activeBrandIdx,
  allowEmpty = false,
  size = 24,
  title,
  opacity,
  onOpacityChange,
  onMouseDownCapture,
}: Props) {
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState(value)
  const rootRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const showOpacity = typeof opacity === "number" && !!onOpacityChange

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
    // Anchor direita + largura FIXA (nao 100% do parent) pra nao herdar
    // container narrow (ex: flex row do STROKE section). Width fixed
    // evita overflow inconsistente em diferentes contextos do panel.
    position: "absolute", top: "calc(100% + 6px)", right: 0, left: "auto",
    width: 240, padding: 0,
    background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    zIndex: 1000,
    display: "flex", flexDirection: "column",
    maxHeight: 360, overflow: "hidden",
  }
  const groupLabelS: React.CSSProperties = {
    fontSize: 9, fontWeight: 700 as const, textTransform: "uppercase" as const,
    letterSpacing: "0.6px", color: "#666",
    padding: "10px 12px 6px",
  }
  const itemS: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 10, padding: "6px 12px",
    cursor: "pointer", background: "transparent", border: "none",
    color: "white", fontFamily: "inherit", textAlign: "left", width: "100%",
  }
  const inlineInpS: React.CSSProperties = {
    background: "transparent", border: "none", color: "white",
    fontSize: 12, padding: 0, fontFamily: "monospace",
    outline: "none", textTransform: "uppercase", flex: 1, minWidth: 0,
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}
      // Capture mousedown ANTES de qualquer child interativo — pra parent
      // salvar text selection antes do click roubar foco do textbox.
      // Critico pra per-char fill: applyStyle ler hasSavedSel = true.
      onMouseDownCapture={onMouseDownCapture}
    >
      {/* Inline row: swatch + hex + opacity (Figma-style enxuto) */}
      <div style={{
        display: "flex", alignItems: "center", gap: 0,
        background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6,
        padding: "4px 6px", height: 32,
      }}>
        {/* Trigger swatch — click abre popup */}
        <button
          type="button"
          title={title ?? (value || "Sem cor")}
          onClick={() => setOpen(o => !o)}
          style={{
            width: size, height: size, borderRadius: 4,
            // Separa background-image (checker pattern) de backgroundColor (cor solida)
            // pra nao conflitar com backgroundSize. React warning: mixing shorthand
            // background com backgroundSize gera "Updating a style property during
            // rerender (background) when a conflicting property is set (backgroundSize)".
            backgroundImage: emptyChecker,
            backgroundColor: emptyChecker ? undefined : (swatchBg as string | undefined),
            backgroundSize: emptyChecker ? "8px 8px" : undefined,
            border: "1px solid #2a2a2a", cursor: "pointer", padding: 0, flexShrink: 0,
            marginRight: 8,
            outline: open ? "2px solid #F5C400" : "none", outlineOffset: 1,
          }}
        />
        {/* Hex input inline (sem borda; o container ja tem) */}
        <input
          type="text"
          value={hex}
          placeholder={allowEmpty && !hex ? "—" : "#RRGGBB"}
          onChange={e => {
            const v = e.target.value
            setHex(v)
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v, undefined)
          }}
          onBlur={() => {
            if (!/^#[0-9a-fA-F]{6}$/.test(hex)) setHex(value)
          }}
          style={inlineInpS}
        />
        {/* Opacity field (opcional — so renderiza quando opacity + onOpacityChange).
            Spinner arrows nativos VISIVEIS por preferencia global do user
            (app/globals.css linha 16). Padding right generoso pra '100' nao
            encostar nos arrows que aparecem no canto direito do input. */}
        {showOpacity && (
          <>
            <div style={{ width: 1, height: 18, background: "#2a2a2a", marginRight: 6 }} />
            <input
              type="number" min={0} max={100} step={1}
              value={Math.round(opacity!)}
              onChange={e => onOpacityChange!(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              title="Opacidade %"
              style={{
                ...inlineInpS, width: 50, flex: "0 0 50px",
                // Text alignment LEFT pra '100' ficar a esquerda do input.
                // Spinner ocupa o lado direito. Sem text-align: right o
                // numero NUNCA toca o spinner — sempre tem espaco visual
                // natural entre texto curto e arrow buttons.
                textAlign: "left", fontFamily: "inherit",
                paddingLeft: 4,
              }}
            />
            <span style={{ fontSize: 11, color: "#666", marginLeft: 8, marginRight: 2 }}>%</span>
          </>
        )}
      </div>

      {/* Popup — lista de cores estilo Figma */}
      {open && (
        <div ref={popupRef} style={popupS} onMouseDown={e => e.stopPropagation()}>
          {/* Header: native color + hex + ∅ */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #2a2a2a" }}>
            <label style={{
              width: 28, height: 28, borderRadius: 4,
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
              style={{
                flex: 1, background: "#111", border: "1px solid #2a2a2a", color: "white",
                fontSize: 12, padding: "5px 8px", borderRadius: 4, fontFamily: "monospace",
                outline: "none", textTransform: "uppercase",
              }} />
            {allowEmpty && (
              <button type="button" title="Sem cor"
                onClick={() => { setHex(""); onChange("", undefined); setOpen(false) }}
                style={{
                  width: 28, height: 28, padding: 0, cursor: "pointer",
                  background: "#111", border: "1px solid #2a2a2a", color: "#aaa",
                  borderRadius: 4, fontSize: 14, lineHeight: 1, fontFamily: "inherit",
                }}>∅</button>
            )}
          </div>

          {/* List scrollavel */}
          <div style={{ overflowY: "auto" }}>
            {brandColors.length > 0 && (
              <>
                <div style={groupLabelS}>Cores da marca</div>
                {brandColors.map((bc, i) => {
                  const activeByRef = activeBrandIdx === i
                  const activeByHex = !activeByRef && value.toLowerCase() === bc.hex.toLowerCase()
                  const active = activeByRef || activeByHex
                  // Sem nome no DS → mostra so hex na esquerda. Right hex fica
                  // omitido pra nao duplicar. Com nome → nome esquerda + hex direita.
                  const hasName = !!bc.name && bc.name.trim().length > 0
                  return (
                    <button key={`bc-${i}-${bc.hex}`} type="button"
                      onClick={() => { onChange(bc.hex, i); setOpen(false) }}
                      style={{ ...itemS, background: active ? "#252525" : "transparent" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = active ? "#2a2a2a" : "#1f1f1f" }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = active ? "#252525" : "transparent" }}
                    >
                      <div style={{ width: 20, height: 20, borderRadius: 3, background: bc.hex, border: "1px solid #2a2a2a", flexShrink: 0 }} />
                      {hasName ? (
                        <>
                          <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                            {bc.name}
                          </div>
                          <div style={{ fontSize: 11, color: "#888", fontFamily: "monospace", textTransform: "uppercase" }}>
                            {bc.hex}
                          </div>
                        </>
                      ) : (
                        <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: "monospace", textTransform: "uppercase", color: "#ccc" }}>
                          {bc.hex}
                        </div>
                      )}
                    </button>
                  )
                })}
              </>
            )}
            {defaultSwatches.length > 0 && (
              <>
                <div style={groupLabelS}>Padrão</div>
                {defaultSwatches.map(c => {
                  const active = value.toLowerCase() === c.toLowerCase()
                  // Default swatches nunca tem nome — sempre mostra hex direto.
                  return (
                    <button key={`def-${c}`} type="button"
                      onClick={() => { onChange(c, undefined); setOpen(false) }}
                      style={{ ...itemS, background: active ? "#252525" : "transparent" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = active ? "#2a2a2a" : "#1f1f1f" }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = active ? "#252525" : "transparent" }}
                    >
                      <div style={{ width: 20, height: 20, borderRadius: 3, background: c, border: "1px solid #2a2a2a", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: "monospace", textTransform: "uppercase", color: "#ccc" }}>
                        {c}
                      </div>
                    </button>
                  )
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
