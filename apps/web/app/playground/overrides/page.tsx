"use client"
/**
 * Playground pra visualizar a relação asset.content ↔ overrides ↔ pieces.
 *
 * Esquerda: editor de assets (asset.content = spans com text+style)
 * Direita: 2 "peças" mock cada com 2 layers (asset 1 + asset 2). Cada layer
 *          tem overrides editáveis (texto local com \n + cor + fontSize).
 * Renderiza tudo em memória — sem tocar no banco.
 *
 * Mostra:
 *  - Como rebuildSpans (diff prefix/suffix) preserva styles per-char
 *  - Como overrides.text local da peça sobrescreve asset.content
 *  - Como migrateOverrideText preserva quebras quando asset muda
 *
 * Edita textos e overrides e vê o resultado renderizar imediatamente.
 */
import { useMemo, useState } from "react"

type Style = { color?: string; fontSize?: number; fontWeight?: string; fontFamily?: string }
type Span = { text: string; style: Style }

interface Asset {
  id: string
  label: string
  content: Span[]
  /** Entrelinhas global do asset (multiplicador de fontSize, ex: 1.2). */
  lineHeight?: number
}

interface Layer {
  assetId: string
  overrides: {
    text?: string      // override local (com \n)
    fill?: string      // cor padrão local
    fontSize?: number  // tamanho local
  }
}

interface PieceMock {
  id: string
  name: string
  layers: Layer[]
}

// ============= Helpers replicando a lógica do app =============

function getText(asset: Asset): string {
  return asset.content.map(s => s.text).join("")
}

// Mesmo algoritmo do /campaigns/[id]/assets/page.tsx (rebuildSpans).
// Diff por common prefix/suffix preserva styles dos chars inalterados.
function rebuildSpans(prev: Span[], newText: string): Span[] {
  const defaultStyle = prev?.[0]?.style ?? { color: "#111111", fontSize: 48, fontWeight: "normal", fontFamily: "Arial" }
  const prevText = prev.map(s => s.text).join("")
  if (prevText === newText) return prev
  const prevStyles: Style[] = []
  for (const span of prev) {
    for (let i = 0; i < span.text.length; i++) prevStyles.push(span.style)
  }
  let prefixLen = 0
  const minLen = Math.min(prevText.length, newText.length)
  while (prefixLen < minLen && prevText[prefixLen] === newText[prefixLen]) prefixLen++
  let suffixLen = 0
  while (
    suffixLen < prevText.length - prefixLen &&
    suffixLen < newText.length - prefixLen &&
    prevText[prevText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
  ) suffixLen++
  const newStyles: Style[] = []
  for (let i = 0; i < newText.length; i++) {
    if (i < prefixLen) newStyles.push(prevStyles[i] ?? defaultStyle)
    else if (i >= newText.length - suffixLen) newStyles.push(prevStyles[prevText.length - (newText.length - i)] ?? defaultStyle)
    else newStyles.push(defaultStyle)
  }
  const result: Span[] = []
  let buf = ""
  let bufStyle: Style | null = null
  for (let i = 0; i < newText.length; i++) {
    const cs = newStyles[i]
    if (bufStyle === null) { buf = newText[i]; bufStyle = cs; continue }
    if (JSON.stringify(bufStyle) === JSON.stringify(cs)) buf += newText[i]
    else { result.push({ text: buf, style: bufStyle }); buf = newText[i]; bufStyle = cs }
  }
  if (buf) result.push({ text: buf, style: bufStyle ?? defaultStyle })
  return result.length > 0 ? result : [{ text: newText, style: defaultStyle }]
}

// migrateOverrideText: distribui tokens do novo texto pelas linhas do override antigo
function migrateOverrideText(oldOverrideText: string, newAssetCleanText: string): string {
  if (!oldOverrideText.includes("\n")) return ""
  const oldLines = oldOverrideText.split("\n")
  const lineTokenCounts = oldLines.map(line => line.trim().split(/\s+/).filter(t => t.length > 0).length)
  const newTokens = newAssetCleanText.trim().split(/\s+/).filter(t => t.length > 0)
  if (newTokens.length === 0) return ""
  const newLines: string[] = []
  let cursor = 0
  for (let i = 0; i < lineTokenCounts.length - 1; i++) {
    const take = lineTokenCounts[i]
    newLines.push(newTokens.slice(cursor, cursor + take).join(" "))
    cursor += take
  }
  newLines.push(newTokens.slice(cursor).join(" "))
  while (newLines.length > 1 && newLines[newLines.length - 1] === "") newLines.pop()
  return newLines.join("\n")
}

// ============= Componente =============

export default function OverridesPlayground() {
  // Estado inicial: 2 assets com cores per char e 2 peças que os usam
  const [assets, setAssets] = useState<Asset[]>([
    {
      id: "a1",
      label: "Título",
      content: [
        { text: "Hello", style: { color: "#FF006E", fontSize: 48, fontWeight: "bold", fontFamily: "Arial" } },
        { text: " ", style: { color: "#111", fontSize: 48, fontWeight: "bold", fontFamily: "Arial" } },
        { text: "World", style: { color: "#06D6A0", fontSize: 48, fontWeight: "bold", fontFamily: "Arial" } },
      ],
    },
    {
      id: "a2",
      label: "Subtitulo",
      content: [
        { text: "Subtitulo simples", style: { color: "#555", fontSize: 24, fontWeight: "normal", fontFamily: "Arial" } },
      ],
    },
  ])

  const [pieces, setPieces] = useState<PieceMock[]>([
    {
      id: "p1",
      name: "Peça A",
      layers: [
        { assetId: "a1", overrides: { text: "Hello\nWorld" } }, // quebra local
        { assetId: "a2", overrides: {} },
      ],
    },
    {
      id: "p2",
      name: "Peça B",
      layers: [
        { assetId: "a1", overrides: { fill: "#118AB2" } }, // cor override
        { assetId: "a2", overrides: { fontSize: 32 } }, // size override
      ],
    },
  ])

  // Atualiza style de UM char especifico (per-char editing)
  function updateCharStyle(assetId: string, charIdx: number, patch: Partial<Style>) {
    setAssets(prev => prev.map(a => {
      if (a.id !== assetId) return a
      // Expand spans em chars individuais
      const chars: { ch: string; style: Style }[] = []
      for (const span of a.content) {
        for (const ch of span.text) chars.push({ ch, style: { ...span.style } })
      }
      if (charIdx < 0 || charIdx >= chars.length) return a
      chars[charIdx].style = { ...chars[charIdx].style, ...patch }
      // Re-merge chars adjacentes com mesmo style
      const newContent: Span[] = []
      for (const { ch, style } of chars) {
        const last = newContent[newContent.length - 1]
        if (last && JSON.stringify(last.style) === JSON.stringify(style)) last.text += ch
        else newContent.push({ text: ch, style })
      }
      return { ...a, content: newContent }
    }))
  }

  function updateAssetLineHeight(assetId: string, lineHeight: number) {
    setAssets(prev => prev.map(a => a.id === assetId ? { ...a, lineHeight } : a))
  }

  // REALTIME 2026-05-24: edit no textarea aplica IMEDIATAMENTE no asset
  // state + migra overrides das pecas. Sem botao Salvar. Padrao ZZOSY
  // "preview realtime em tudo".
  function updateAssetText(assetId: string, newText: string) {
    const asset = assets.find(a => a.id === assetId)
    if (!asset) return
    const oldText = getText(asset)
    if (oldText === newText) return
    const skipMigrate = newText.trim().length === 0
    const newContent = rebuildSpans(asset.content, newText)
    setAssets(prev => prev.map(a => a.id === assetId ? { ...a, content: newContent } : a))
    if (!skipMigrate) {
      setPieces(prev => prev.map(p => ({
        ...p,
        layers: p.layers.map(l => {
          if (l.assetId !== assetId) return l
          if (typeof l.overrides.text === "string" && l.overrides.text.includes("\n")) {
            const migrated = migrateOverrideText(l.overrides.text, newText)
            return { ...l, overrides: { ...l.overrides, text: migrated } }
          }
          return l
        }),
      })))
    }
  }

  function updateLayerOverride(pieceId: string, layerIdx: number, patch: Partial<Layer["overrides"]>) {
    setPieces(prev => prev.map(p => {
      if (p.id !== pieceId) return p
      return {
        ...p,
        layers: p.layers.map((l, i) => i === layerIdx ? { ...l, overrides: { ...l.overrides, ...patch } } : l),
      }
    }))
  }

  function resetAll() {
    setAssets([
      { id: "a1", label: "Título", content: [
        { text: "Hello", style: { color: "#FF006E", fontSize: 48, fontWeight: "bold", fontFamily: "Arial" } },
        { text: " ", style: { color: "#111", fontSize: 48, fontWeight: "bold", fontFamily: "Arial" } },
        { text: "World", style: { color: "#06D6A0", fontSize: 48, fontWeight: "bold", fontFamily: "Arial" } },
      ] },
      { id: "a2", label: "Subtitulo", content: [{ text: "Subtitulo simples", style: { color: "#555", fontSize: 24, fontWeight: "normal", fontFamily: "Arial" } }] },
    ])
    setPieces([
      { id: "p1", name: "Peça A", layers: [{ assetId: "a1", overrides: { text: "Hello\nWorld" } }, { assetId: "a2", overrides: {} }] },
      { id: "p2", name: "Peça B", layers: [{ assetId: "a1", overrides: { fill: "#118AB2" } }, { assetId: "a2", overrides: { fontSize: 32 } }] },
    ])
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d0d", color: "#ddd", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Playground: Asset ↔ Overrides ↔ Peças</h1>
          <button onClick={resetAll}
            style={{ padding: "6px 12px", background: "#222", border: "1px solid #444", borderRadius: 4, color: "#aaa", cursor: "pointer", fontSize: 12 }}>
            Reset
          </button>
        </div>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 24, lineHeight: 1.5 }}>
          Mexe nos assets à esquerda — mudança propaga REALTIME nas peças à direita (sem botão Salvar). <code>asset.content</code> é fonte da verdade dos chars, <code>overrides.text</code> sobrescreve LOCAL (com <code>\n</code>), <code>overrides.fill/fontSize</code> sobrescreve estilo padrão. Cores per char do asset são preservadas no texto da peça.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 24 }}>
          {/* ============ ESQUERDA: Assets ============ */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: "#F5C400", margin: 0, textTransform: "uppercase", letterSpacing: "0.5px" }}>Assets (fonte da verdade)</h2>
            {assets.map(asset => {
              const text = getText(asset)
              // Expand chars individuais pra UI per-char
              const chars: { ch: string; style: Style; idx: number }[] = []
              let absIdx = 0
              for (const span of asset.content) {
                for (const ch of span.text) {
                  chars.push({ ch, style: span.style, idx: absIdx++ })
                }
              }
              return (
                <div key={asset.id} style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>{asset.label}</div>
                  <textarea
                    value={text}
                    onChange={e => updateAssetText(asset.id, e.target.value)}
                    style={{ width: "100%", minHeight: 48, padding: 10, fontSize: 13, background: "#111", color: "#ddd", border: "1px solid #333", borderRadius: 4, fontFamily: "inherit", resize: "vertical", outline: "none" }}
                  />
                  {/* Entrelinhas (asset-level) */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 11, color: "#888" }}>
                    <span>Entrelinhas (lineHeight)</span>
                    <input
                      type="number"
                      step={0.05}
                      min={0.5}
                      max={3}
                      value={asset.lineHeight ?? 1.2}
                      onChange={e => updateAssetLineHeight(asset.id, Number(e.target.value) || 1.2)}
                      style={{ width: 60, padding: "2px 6px", background: "#0d0d0d", color: "#ddd", border: "1px solid #2a2a2a", borderRadius: 3, fontSize: 11 }}
                    />
                  </div>
                  {/* Per-char editor */}
                  <div style={{ marginTop: 12, fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px" }}>Editar per-char</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, maxHeight: 280, overflowY: "auto", border: "1px solid #2a2a2a", borderRadius: 4, padding: 6 }}>
                    {chars.map(({ ch, style, idx }) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "28px 36px 50px 70px 90px", gap: 4, alignItems: "center", fontSize: 10 }}>
                        <span style={{ textAlign: "center", color: style.color ?? "#fff", fontWeight: style.fontWeight === "bold" ? 700 : 400, fontFamily: style.fontFamily ?? "inherit", background: "#0a0a0a", padding: "2px 0", borderRadius: 2 }}>
                          {ch === " " ? "·" : ch === "\n" ? "↵" : ch}
                        </span>
                        <input
                          type="color"
                          value={style.color ?? "#000000"}
                          onChange={e => updateCharStyle(asset.id, idx, { color: e.target.value })}
                          style={{ width: 36, height: 22, padding: 0, border: "1px solid #2a2a2a", background: "transparent", cursor: "pointer" }}
                          title="Cor"
                        />
                        <input
                          type="number"
                          min={6}
                          max={500}
                          value={style.fontSize ?? 16}
                          onChange={e => updateCharStyle(asset.id, idx, { fontSize: Number(e.target.value) || 16 })}
                          style={{ padding: "2px 4px", background: "#0d0d0d", color: "#ddd", border: "1px solid #2a2a2a", borderRadius: 2, fontSize: 10 }}
                          title="Tamanho"
                        />
                        <select
                          value={style.fontWeight ?? "normal"}
                          onChange={e => updateCharStyle(asset.id, idx, { fontWeight: e.target.value })}
                          style={{ padding: "2px 4px", background: "#0d0d0d", color: "#ddd", border: "1px solid #2a2a2a", borderRadius: 2, fontSize: 10 }}
                          title="Peso"
                        >
                          <option value="normal">normal</option>
                          <option value="bold">bold</option>
                          <option value="100">100</option>
                          <option value="300">300</option>
                          <option value="500">500</option>
                          <option value="700">700</option>
                          <option value="900">900</option>
                        </select>
                        <select
                          value={style.fontFamily ?? "Arial"}
                          onChange={e => updateCharStyle(asset.id, idx, { fontFamily: e.target.value })}
                          style={{ padding: "2px 4px", background: "#0d0d0d", color: "#ddd", border: "1px solid #2a2a2a", borderRadius: 2, fontSize: 10 }}
                          title="Família"
                        >
                          <option value="Arial">Arial</option>
                          <option value="Helvetica">Helvetica</option>
                          <option value="Georgia">Georgia</option>
                          <option value="'Courier New', monospace">Courier</option>
                          <option value="'Times New Roman', serif">Times</option>
                          <option value="'DM Sans', sans-serif">DM Sans</option>
                        </select>
                      </div>
                    ))}
                  </div>
                  {/* Debug spans */}
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ fontSize: 10, color: "#666", cursor: "pointer" }}>spans (debug)</summary>
                    <pre style={{ fontSize: 10, color: "#888", marginTop: 6, padding: 8, background: "#0a0a0a", borderRadius: 4, overflow: "auto" }}>
{JSON.stringify(asset.content, null, 2)}
                    </pre>
                  </details>
                </div>
              )
            })}
          </div>

          {/* ============ DIREITA: Peças ============ */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: "#F5C400", margin: 0, textTransform: "uppercase", letterSpacing: "0.5px" }}>Peças (renderizadas em tempo real)</h2>
            {pieces.map(piece => (
              <div key={piece.id} style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>{piece.name}</div>
                {/* Render visual */}
                <div style={{ background: "#fff", borderRadius: 6, padding: "20px 16px", marginBottom: 12, minHeight: 120 }}>
                  {piece.layers.map((layer, lidx) => (
                    <LayerRender key={lidx} layer={layer} asset={assets.find(a => a.id === layer.assetId)!} />
                  ))}
                </div>
                {/* Editor de overrides */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {piece.layers.map((layer, lidx) => {
                    const asset = assets.find(a => a.id === layer.assetId)
                    if (!asset) return null
                    return (
                      <div key={lidx} style={{ background: "#111", padding: 10, borderRadius: 4, fontSize: 11 }}>
                        <div style={{ color: "#888", marginBottom: 6 }}>Layer {lidx + 1} → asset <strong style={{ color: "#F5C400" }}>{asset.label}</strong></div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px", gap: 6 }}>
                          <div>
                            <div style={{ color: "#666", fontSize: 9, marginBottom: 2 }}>override.text (\n local)</div>
                            <textarea
                              value={layer.overrides.text ?? ""}
                              onChange={e => updateLayerOverride(piece.id, lidx, { text: e.target.value })}
                              placeholder="vazio = usa asset"
                              style={{ width: "100%", minHeight: 40, padding: 6, background: "#0a0a0a", color: "#ddd", border: "1px solid #2a2a2a", borderRadius: 3, fontSize: 11, fontFamily: "inherit", resize: "none", outline: "none" }}
                            />
                          </div>
                          <div>
                            <div style={{ color: "#666", fontSize: 9, marginBottom: 2 }}>override.fill</div>
                            <input type="color"
                              value={layer.overrides.fill ?? "#111111"}
                              onChange={e => updateLayerOverride(piece.id, lidx, { fill: e.target.value })}
                              style={{ width: "100%", height: 28, padding: 0, background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: 3, cursor: "pointer" }}
                            />
                            <button onClick={() => updateLayerOverride(piece.id, lidx, { fill: undefined })}
                              style={{ width: "100%", marginTop: 2, padding: "2px 4px", background: "transparent", color: "#666", border: "1px solid #2a2a2a", borderRadius: 3, cursor: "pointer", fontSize: 9 }}>
                              Reset
                            </button>
                          </div>
                          <div>
                            <div style={{ color: "#666", fontSize: 9, marginBottom: 2 }}>override.fontSize</div>
                            <input type="number"
                              value={layer.overrides.fontSize ?? ""}
                              placeholder="auto"
                              onChange={e => updateLayerOverride(piece.id, lidx, { fontSize: e.target.value ? Number(e.target.value) : undefined })}
                              style={{ width: "100%", height: 28, padding: "0 6px", background: "#0a0a0a", color: "#ddd", border: "1px solid #2a2a2a", borderRadius: 3, fontSize: 11, fontFamily: "inherit", outline: "none" }}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 24, padding: 14, background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Como testar o bug que foi corrigido:</div>
          <ol style={{ fontSize: 12, color: "#aaa", paddingLeft: 18, lineHeight: 1.6, margin: 0 }}>
            <li>Repara que a <strong>Peça A</strong> tem o título "Hello World" QUEBRADO em 2 linhas (via override.text = "Hello\nWorld") e mantém cores per char (rosa + verde).</li>
            <li>No textarea do asset "Título" à esquerda, seleciona TUDO + apaga + digita um texto novo (ex: "Oi Mundo") + clica Salvar.</li>
            <li>Veja: a Peça A AINDA QUEBRA em 2 linhas com o texto novo (override.text foi migrado pra "Oi\nMundo"). Cores per char foram remapeadas via prefix/suffix.</li>
            <li>Antes do fix: passar por estado vazio destruía o override.text → Peça A virava 1 linha.</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

// Renderiza UM layer da peça: aplica overrides.text + overrides.fill/fontSize.
function LayerRender({ layer, asset }: { layer: Layer; asset: Asset }) {
  const overrides = layer.overrides
  // Se override.text setado: usa esse (com \n local). Senão usa asset.content render direto.
  const useOverrideText = typeof overrides.text === "string" && overrides.text.length > 0
  const textToRender = useOverrideText ? overrides.text! : asset.content.map(s => s.text).join("")

  // Pra renderizar com cores per char (do asset), mapeio cada char do textToRender
  // pra um style. Se useOverrideText, usa diff prefix/suffix (igual rebuildSpans).
  const assetText = asset.content.map(s => s.text).join("")
  const assetStyles: Style[] = []
  for (const span of asset.content) {
    for (let i = 0; i < span.text.length; i++) assetStyles.push(span.style)
  }
  const defaultStyle = asset.content[0]?.style ?? {}

  const charStyles: Style[] = useMemo(() => {
    if (!useOverrideText) return assetStyles
    // Diff prefix/suffix entre assetText e textToRender
    let prefixLen = 0
    const minLen = Math.min(assetText.length, textToRender.length)
    while (prefixLen < minLen && assetText[prefixLen] === textToRender[prefixLen]) prefixLen++
    let suffixLen = 0
    while (
      suffixLen < assetText.length - prefixLen &&
      suffixLen < textToRender.length - prefixLen &&
      assetText[assetText.length - 1 - suffixLen] === textToRender[textToRender.length - 1 - suffixLen]
    ) suffixLen++
    const out: Style[] = []
    for (let i = 0; i < textToRender.length; i++) {
      if (i < prefixLen) out.push(assetStyles[i] ?? defaultStyle)
      else if (i >= textToRender.length - suffixLen) out.push(assetStyles[assetText.length - (textToRender.length - i)] ?? defaultStyle)
      else out.push(defaultStyle)
    }
    return out
  }, [useOverrideText, assetText, textToRender, JSON.stringify(assetStyles)])

  // Aplica overrides.fill/fontSize SOBRESCREVENDO no char level
  const lines: Array<Array<{ ch: string; style: Style }>> = []
  let currentLine: Array<{ ch: string; style: Style }> = []
  for (let i = 0; i < textToRender.length; i++) {
    const ch = textToRender[i]
    if (ch === "\n") { lines.push(currentLine); currentLine = []; continue }
    const baseStyle = charStyles[i] ?? defaultStyle
    const finalStyle: Style = {
      ...baseStyle,
      ...(typeof overrides.fill === "string" ? { color: overrides.fill } : {}),
      ...(typeof overrides.fontSize === "number" ? { fontSize: overrides.fontSize } : {}),
    }
    currentLine.push({ ch, style: finalStyle })
  }
  lines.push(currentLine)

  return (
    <div style={{ marginBottom: 8 }}>
      {lines.map((line, li) => (
        <div key={li} style={{ lineHeight: asset.lineHeight ?? 1.1 }}>
          {line.map(({ ch, style }, ci) => (
            <span key={ci} style={{
              color: style.color ?? "#111",
              fontSize: style.fontSize ?? 16,
              fontWeight: style.fontWeight ?? "normal",
              fontFamily: style.fontFamily ?? "inherit",
            }}>{ch}</span>
          ))}
        </div>
      ))}
    </div>
  )
}
