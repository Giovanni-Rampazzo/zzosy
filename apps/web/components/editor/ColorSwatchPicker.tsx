"use client"
/**
 * ColorSwatchPicker — picker estilo Figma + Adobe.
 *
 * UI inline mostra APENAS o swatch atual (1 linha enxuta). Click no swatch
 * abre popup contendo, nessa ordem:
 *   - SV picker (gradient saturacao x valor) + hue slider — escolha visual
 *   - Format toggle HEX | RGB | CMYK — escolha por valor numerico
 *   - "Brand colors" — clica vincula via brandIdx
 *   - "Default" — paleta neutra
 *
 * Popup fecha ao clicar fora ou apertar Esc. Posicao absolute relativa ao
 * swatch trigger.
 */
import { useEffect, useMemo, useRef, useState } from "react"

// ── Color conversion utils ────────────────────────────────────────────
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)) }
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}
function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")
  return `#${h(r)}${h(g)}${h(b)}`
}
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rr = r / 255, gg = g / 255, bb = b / 255
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6
    else if (max === gg) h = (bb - rr) / d + 2
    else h = (rr - gg) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return { h, s: s * 100, v: max * 100 }
}
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const ss = s / 100, vv = v / 100
  const c = vv * ss
  const hh = (h % 360) / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  let rp = 0, gp = 0, bp = 0
  if (hh < 1) { rp = c; gp = x }
  else if (hh < 2) { rp = x; gp = c }
  else if (hh < 3) { gp = c; bp = x }
  else if (hh < 4) { gp = x; bp = c }
  else if (hh < 5) { rp = x; bp = c }
  else { rp = c; bp = x }
  const m = vv - c
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 }
}
function rgbToCmyk(r: number, g: number, b: number): { c: number; m: number; y: number; k: number } {
  const rr = r / 255, gg = g / 255, bb = b / 255
  const k = 1 - Math.max(rr, gg, bb)
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 }
  const c = (1 - rr - k) / (1 - k)
  const m = (1 - gg - k) / (1 - k)
  const y = (1 - bb - k) / (1 - k)
  return { c: c * 100, m: m * 100, y: y * 100, k: k * 100 }
}
function cmykToRgb(c: number, m: number, y: number, k: number): { r: number; g: number; b: number } {
  const cc = c / 100, mm = m / 100, yy = y / 100, kk = k / 100
  return {
    r: 255 * (1 - cc) * (1 - kk),
    g: 255 * (1 - mm) * (1 - kk),
    b: 255 * (1 - yy) * (1 - kk),
  }
}

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
  const [fmt, setFmt] = useState<"hex" | "rgb" | "cmyk">("hex")
  // Hue local: SV picker manipula h independente do v atual. Sem state
  // separado, mover knob para o branco puro (v=0) zera o hue e perde a
  // posicao no slider — comportamento ruim igual Photoshop antigo.
  const [localHue, setLocalHue] = useState<number>(() => {
    const rgb = hexToRgb(value || "#000000")
    return rgbToHsv(rgb.r, rgb.g, rgb.b).h
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const showOpacity = typeof opacity === "number" && !!onOpacityChange

  // Sync externo (value muda fora) → atualiza hex local.
  useEffect(() => { setHex(value) }, [value])
  // Sync hue local quando value muda externamente E o hue resultante eh
  // valido (> 0 saturacao). Branco/preto puro preservam hue anterior.
  useEffect(() => {
    const rgb = hexToRgb(value || "#000000")
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
    if (hsv.s > 0) setLocalHue(hsv.h)
  }, [value])

  // Componentes RGB/HSV/CMYK derivados do value atual (memoized).
  const colorParts = useMemo(() => {
    const rgb = hexToRgb(value || "#000000")
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
    const cmyk = rgbToCmyk(rgb.r, rgb.g, rgb.b)
    return { rgb, hsv: { ...hsv, h: hsv.s > 0 ? hsv.h : localHue }, cmyk }
  }, [value, localHue])

  // Emite nova cor a partir de RGB (clamped). Usado por todos os controles.
  function emitRgb(r: number, g: number, b: number) {
    const newHex = rgbToHex(r, g, b)
    setHex(newHex)
    onChange(newHex, undefined)
  }
  function emitHsv(h: number, s: number, v: number) {
    const { r, g, b } = hsvToRgb(h, s, v)
    setLocalHue(h)
    emitRgb(r, g, b)
  }

  // Drag SV picker (saturacao x valor). Click+drag dentro da box.
  function svPointerHandler(clientX: number, clientY: number) {
    const el = svRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = clamp(clientX - rect.left, 0, rect.width)
    const y = clamp(clientY - rect.top, 0, rect.height)
    const s = (x / rect.width) * 100
    const v = (1 - y / rect.height) * 100
    emitHsv(localHue, s, v)
  }
  function onSvMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    svPointerHandler(e.clientX, e.clientY)
    function onMove(ev: MouseEvent) { svPointerHandler(ev.clientX, ev.clientY) }
    function onUp() {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  // Drag hue slider.
  function huePointerHandler(clientX: number) {
    const el = hueRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = clamp(clientX - rect.left, 0, rect.width)
    const h = (x / rect.width) * 360
    emitHsv(h, colorParts.hsv.s, colorParts.hsv.v)
  }
  function onHueMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    huePointerHandler(e.clientX)
    function onMove(ev: MouseEvent) { huePointerHandler(ev.clientX) }
    function onUp() {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

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
    // Popup preenche a LARGURA do container do swatch (left: 0 + right: 0).
    // Antes era width: 240 fixo + right:0 — em painel resizable estreito o
    // popup overflowava pra esquerda alem do panel, cortando os labels
    // "CORES DA MARCA" / "PADRÃO". Min 200 garante usabilidade em panels
    // muito apertados (corre verticalmente se precisar).
    position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
    minWidth: 200, padding: 0,
    background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    zIndex: 1000,
    display: "flex", flexDirection: "column",
    maxHeight: "min(560px, calc(100vh - 120px))", overflow: "auto",
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
          title={title ?? (value || "No color")}
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
              title="Opacity %"
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

      {/* Popup — lista de cores estilo Figma. User pediu 2026-05-27:
          remover header (native color picker + hex repeat) — cor atual
          ja eh editavel pelo hex input do TRIGGER (inline acima). Popup
          serve so pra escolher cores ja prontas (brand + default). */}
      {open && (
        <div ref={popupRef} style={popupS} onMouseDown={e => e.stopPropagation()}>
          {/* SV picker + hue slider + format toggle. User pediu 2026-05-28:
              "todas as cores, podendo alterar para HEX, RGB, CMYK". */}
          <div style={{ padding: "10px 10px 8px", borderBottom: "1px solid #2a2a2a" }}>
            {/* SV box: saturacao (X) x valor (Y). Background = hue puro;
                overlay branco horizontal (->right) + overlay preto vertical (down). */}
            <div
              ref={svRef}
              onMouseDown={onSvMouseDown}
              style={{
                position: "relative",
                width: "100%", height: 120, borderRadius: 4,
                cursor: "crosshair", userSelect: "none",
                backgroundColor: `hsl(${Math.round(colorParts.hsv.h)}, 100%, 50%)`,
                backgroundImage: "linear-gradient(to right, #fff, rgba(255,255,255,0)), linear-gradient(to top, #000, rgba(0,0,0,0))",
              }}
            >
              <div style={{
                position: "absolute",
                left: `calc(${colorParts.hsv.s}% - 6px)`,
                top: `calc(${100 - colorParts.hsv.v}% - 6px)`,
                width: 12, height: 12, borderRadius: "50%",
                border: "2px solid #fff",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
                pointerEvents: "none",
              }} />
            </div>
            {/* Hue slider */}
            <div
              ref={hueRef}
              onMouseDown={onHueMouseDown}
              style={{
                position: "relative",
                width: "100%", height: 12, borderRadius: 6, marginTop: 10,
                cursor: "ew-resize", userSelect: "none",
                background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
              }}
            >
              <div style={{
                position: "absolute",
                left: `calc(${(colorParts.hsv.h / 360) * 100}% - 6px)`,
                top: -2,
                width: 12, height: 16, borderRadius: 3,
                border: "2px solid #fff",
                background: `hsl(${Math.round(colorParts.hsv.h)}, 100%, 50%)`,
                boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
                pointerEvents: "none",
              }} />
            </div>
            {/* Format toggle */}
            <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
              {(["hex", "rgb", "cmyk"] as const).map(f => (
                <button key={f} type="button"
                  onClick={() => setFmt(f)}
                  style={{
                    flex: 1, padding: "4px 0", fontSize: 10, fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: "0.6px",
                    background: fmt === f ? "#F5C400" : "transparent",
                    color: fmt === f ? "#111" : "#888",
                    border: "1px solid " + (fmt === f ? "#F5C400" : "#2a2a2a"),
                    borderRadius: 4, cursor: "pointer",
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
            {/* Inputs por formato */}
            <div style={{ marginTop: 8 }}>
              {fmt === "hex" && (
                <input type="text"
                  value={hex}
                  onChange={e => {
                    const v = e.target.value
                    setHex(v)
                    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                      const { r, g, b } = hexToRgb(v)
                      emitRgb(r, g, b)
                    }
                  }}
                  onBlur={() => { if (!/^#[0-9a-fA-F]{6}$/.test(hex)) setHex(value) }}
                  style={{
                    width: "100%", padding: "5px 8px", fontSize: 12, fontFamily: "monospace",
                    background: "#111", border: "1px solid #2a2a2a", color: "#fff",
                    borderRadius: 4, textTransform: "uppercase", outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              )}
              {fmt === "rgb" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                  {(["r", "g", "b"] as const).map(k => (
                    <label key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 9, color: "#666", fontWeight: 700, textAlign: "center", textTransform: "uppercase" }}>{k}</span>
                      <input type="number" min={0} max={255}
                        value={Math.round(colorParts.rgb[k])}
                        onChange={e => {
                          const v = clamp(Number(e.target.value) || 0, 0, 255)
                          const next = { ...colorParts.rgb, [k]: v }
                          emitRgb(next.r, next.g, next.b)
                        }}
                        style={{
                          width: "100%", padding: "5px 4px", fontSize: 11, fontFamily: "monospace",
                          background: "#111", border: "1px solid #2a2a2a", color: "#fff",
                          borderRadius: 4, textAlign: "center", outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
              {fmt === "cmyk" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
                  {(["c", "m", "y", "k"] as const).map(k => (
                    <label key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 9, color: "#666", fontWeight: 700, textAlign: "center", textTransform: "uppercase" }}>{k}</span>
                      <input type="number" min={0} max={100}
                        value={Math.round(colorParts.cmyk[k])}
                        onChange={e => {
                          const v = clamp(Number(e.target.value) || 0, 0, 100)
                          const next = { ...colorParts.cmyk, [k]: v }
                          const rgb = cmykToRgb(next.c, next.m, next.y, next.k)
                          emitRgb(rgb.r, rgb.g, rgb.b)
                        }}
                        style={{
                          width: "100%", padding: "5px 4px", fontSize: 11, fontFamily: "monospace",
                          background: "#111", border: "1px solid #2a2a2a", color: "#fff",
                          borderRadius: 4, textAlign: "center", outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* List scrollavel */}
          {/* Filtra a cor ATUAL (value) das listas — ela ja eh mostrada no
              header com hex input. Mostrar de novo na lista eh duplicacao.
              User pediu 2026-05-27: 'apenas a lista das outras cores'. */}
          <div style={{ overflowY: "auto" }}>
            {(() => {
              const curLow = (value || "").toLowerCase()
              const filteredBrand = brandColors
                .map((bc, i) => ({ bc, i }))
                .filter(({ bc, i }) => {
                  // Mantem entrada se eh referenciada por brandIdx (activeBrandIdx) E
                  // hex bate — nesse caso preserva pra mostrar "linkada". Senao,
                  // filtra qualquer entrada com mesma cor da current.
                  if (activeBrandIdx === i) return false
                  return bc.hex.toLowerCase() !== curLow
                })
              const filteredDefaults = defaultSwatches.filter(c => c.toLowerCase() !== curLow)
              return (
                <>
                  {allowEmpty && value && (
                    <button type="button"
                      onClick={() => { setHex(""); onChange("", undefined); setOpen(false) }}
                      style={{ ...itemS, background: "transparent" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#1f1f1f" }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
                    >
                      <div style={{ width: 20, height: 20, borderRadius: 3, border: "1px solid #2a2a2a", flexShrink: 0,
                        background: "linear-gradient(135deg, #fff 25%, #d0d0d0 25%, #d0d0d0 50%, #fff 50%, #fff 75%, #d0d0d0 75%)",
                        backgroundSize: "8px 8px" }} />
                      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#aaa" }}>Nenhuma cor</div>
                    </button>
                  )}
                  {filteredBrand.length > 0 && (
                    <>
                      <div style={groupLabelS}>Brand colors</div>
                      {filteredBrand.map(({ bc, i }) => {
                        const hasName = !!bc.name && bc.name.trim().length > 0
                        return (
                          <button key={`bc-${i}-${bc.hex}`} type="button"
                            onClick={() => { onChange(bc.hex, i); setOpen(false) }}
                            style={{ ...itemS, background: "transparent" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#1f1f1f" }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
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
                  {filteredDefaults.length > 0 && (
                    <>
                      <div style={groupLabelS}>Default</div>
                      {filteredDefaults.map(c => (
                        <button key={`def-${c}`} type="button"
                          onClick={() => { onChange(c, undefined); setOpen(false) }}
                          style={{ ...itemS, background: "transparent" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#1f1f1f" }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
                        >
                          <div style={{ width: 20, height: 20, borderRadius: 3, background: c, border: "1px solid #2a2a2a", flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: "monospace", textTransform: "uppercase", color: "#ccc" }}>
                            {c}
                          </div>
                        </button>
                      ))}
                    </>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
