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
import { useEffect, useMemo, useState } from "react"

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
    /** Cor PER-CHAR override (chave = índice no textToRender). 2026-05-24. */
    charFills?: Record<number, string>
  }
}

interface PieceMock {
  id: string
  name: string
  layers: Layer[]
  /** Marca a peca-template (matriz). Edits na matriz NAO propagam pra pecas
   *  ja geradas — matriz e ponto de partida pra futuras geracoes. Asset edits
   *  SIM propagam (text migration), igual ZZOSY real. */
  isMatriz?: boolean
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
  // Detecta SUBSTITUICAO: havia chars antigos entre prefix e suffix?
  // Se sim, novo texto herda do PRIMEIRO char SUBSTITUIDO (Adobe/Figma).
  // Se nao (insercao pura), herda do vizinho da esquerda.
  const hadReplacement = prevText.length > prefixLen + suffixLen
  const replacedStyle = hadReplacement ? prevStyles[prefixLen] : undefined
  const newStyles: Style[] = []
  for (let i = 0; i < newText.length; i++) {
    if (i < prefixLen) newStyles.push(prevStyles[i] ?? defaultStyle)
    else if (i >= newText.length - suffixLen) newStyles.push(prevStyles[prevText.length - (newText.length - i)] ?? defaultStyle)
    else {
      const inheritedStyle = replacedStyle ?? (i > 0 ? newStyles[i - 1] : undefined)
      newStyles.push(inheritedStyle ?? prevStyles[0] ?? defaultStyle)
    }
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

// migrateOverrideText: distribui tokens do novo texto pelas linhas do override antigo.
// Funciona pra single-line tambem (preservada qtd de linhas/tokens originais).
// Bug fix 2026-05-24: antes retornava early se nao havia '\n' — override single-line
// ficava congelado e nao atualizava mais quando asset mudava.
function migrateOverrideText(oldOverrideText: string, newAssetCleanText: string): string {
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

// Migra charFills aplicando mesma logica de heranca do rebuildSpans:
// - common prefix/suffix: mantem indices
// - novos chars: herdam do vizinho esquerdo (ou do substituido se houve replacement)
// Usado quando user edita texto e tem charFills aplicados — novos chars puxam
// a cor per-char do char anterior, igual Adobe/Figma.
function migrateCharFillsForEdit(
  prevText: string,
  newText: string,
  charFills: Record<number, string>
): Record<number, string> {
  if (Object.keys(charFills).length === 0) return charFills
  if (prevText === newText) return charFills
  let prefixLen = 0
  const minLen = Math.min(prevText.length, newText.length)
  while (prefixLen < minLen && prevText[prefixLen] === newText[prefixLen]) prefixLen++
  let suffixLen = 0
  while (
    suffixLen < prevText.length - prefixLen &&
    suffixLen < newText.length - prefixLen &&
    prevText[prevText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
  ) suffixLen++
  const hadReplacement = prevText.length > prefixLen + suffixLen
  const replacedFill = hadReplacement ? charFills[prefixLen] : undefined
  const out: Record<number, string> = {}
  for (let i = 0; i < newText.length; i++) {
    if (i < prefixLen) {
      if (charFills[i]) out[i] = charFills[i]
    } else if (i >= newText.length - suffixLen) {
      const prevIdx = prevText.length - (newText.length - i)
      if (charFills[prevIdx]) out[i] = charFills[prevIdx]
    } else {
      const inherited = replacedFill ?? (i > 0 ? out[i - 1] : undefined)
      if (inherited) out[i] = inherited
    }
  }
  return out
}

// Resolve a cor REAL do char na posicao charIdx aplicando a precedencia:
// charFills[i] > overrides.fill > style do asset (com subsequence match se ha override.text).
// Usado pra fazer o color picker refletir a cor atual do primeiro char selecionado.
function resolveCharColor(layer: Layer, asset: Asset | undefined, charIdx: number): string | undefined {
  if (layer.overrides.charFills?.[charIdx]) return layer.overrides.charFills[charIdx]
  if (layer.overrides.fill) return layer.overrides.fill
  if (!asset) return undefined
  const useOverrideText = typeof layer.overrides.text === "string" && layer.overrides.text.length > 0
  const assetText = asset.content.map(s => s.text).join("")
  const assetStyles: Style[] = []
  for (const span of asset.content) {
    for (let i = 0; i < span.text.length; i++) assetStyles.push(span.style)
  }
  if (!useOverrideText) return assetStyles[charIdx]?.color
  const textToRender = layer.overrides.text!
  let cursor = 0
  for (let i = 0; i <= charIdx && i < textToRender.length; i++) {
    const ch = textToRender[i]
    if (ch === "\n") continue
    let found = -1
    for (let j = cursor; j < assetText.length; j++) {
      if (assetText[j] === ch) { found = j; break }
    }
    if (found !== -1) {
      if (i === charIdx) return assetStyles[found]?.color
      cursor = found + 1
    } else if (i === charIdx) {
      return asset.content[0]?.style.color
    }
  }
  return asset.content[0]?.style.color
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
  ])

  const [pieces, setPieces] = useState<PieceMock[]>([
    {
      id: "matriz",
      name: "Matriz",
      isMatriz: true,
      layers: [
        { assetId: "a1", overrides: { text: "Hello\nWorld" } }, // quebra local
      ],
    },
    {
      id: "p1",
      name: "Peça 1",
      layers: [
        { assetId: "a1", overrides: { fill: "#118AB2" } }, // cor override
      ],
    },
  ])
  const [pieceCounter, setPieceCounter] = useState(2)

  // Gera nova peca clonando os overrides da matriz como ponto de partida.
  // Snapshot no momento da geracao — edits posteriores na matriz NAO afetam.
  function generateFromMatriz() {
    const matriz = pieces.find(p => p.isMatriz)
    if (!matriz) return
    const newPiece: PieceMock = {
      id: `p${pieceCounter}`,
      name: `Peça ${pieceCounter}`,
      layers: matriz.layers.map(l => ({
        assetId: l.assetId,
        overrides: {
          ...l.overrides,
          charFills: l.overrides.charFills ? { ...l.overrides.charFills } : undefined,
        },
      })),
    }
    setPieces(prev => [...prev, newPiece])
    setPieceCounter(c => c + 1)
  }

  function deletePiece(pieceId: string) {
    setPieces(prev => prev.filter(p => p.id !== pieceId))
  }

  // Add/remove layer DA MATRIZ propaga pras pecas geradas — comportamento real
  // do ZZOSY (/api/campaigns/[id]/key-vision/route.ts:63-114). Add layer cria
  // overrides vazios nas pecas; remove apaga layer com mesmo assetId.
  function addLayerToMatriz(assetId: string) {
    setPieces(prev => prev.map(p => {
      if (p.isMatriz) {
        return { ...p, layers: [...p.layers, { assetId, overrides: {} }] }
      }
      // peca gerada: adiciona layer se ainda nao tiver esse assetId
      if (p.layers.some(l => l.assetId === assetId)) return p
      return { ...p, layers: [...p.layers, { assetId, overrides: {} }] }
    }))
  }

  function removeLayerFromMatriz(layerIdx: number) {
    const matriz = pieces.find(p => p.isMatriz)
    if (!matriz) return
    const assetId = matriz.layers[layerIdx]?.assetId
    if (!assetId) return
    setPieces(prev => prev.map(p => {
      if (p.isMatriz) {
        return { ...p, layers: p.layers.filter((_, i) => i !== layerIdx) }
      }
      // peca gerada: remove TODAS layers com esse assetId
      return { ...p, layers: p.layers.filter(l => l.assetId !== assetId) }
    }))
  }

  // Selection per-char nas pecas (igual editor matriz/pecas).
  // Click+drag em chars seleciona range. Color picker aplica nos selecionados.
  const [pieceSelection, setPieceSelection] = useState<{ layerKey: string; start: number; end: number } | null>(null)
  // Para drag global no mouseup
  useEffect(() => {
    const stop = () => { (window as any).__zzosyDragging = false }
    window.addEventListener("mouseup", stop)
    return () => window.removeEventListener("mouseup", stop)
  }, [])

  // Aplica cor pros chars selecionados via overrides.charFills
  function applyColorToSelection(color: string) {
    if (!pieceSelection) return
    const { layerKey, start, end } = pieceSelection
    const [pieceId, layerIdxStr] = layerKey.split(":")
    const layerIdx = Number(layerIdxStr)
    const lo = Math.min(start, end)
    const hi = Math.max(start, end)
    setPieces(prev => prev.map(p => {
      if (p.id !== pieceId) return p
      return {
        ...p,
        layers: p.layers.map((l, i) => {
          if (i !== layerIdx) return l
          const charFills = { ...(l.overrides.charFills ?? {}) }
          for (let k = lo; k <= hi; k++) charFills[k] = color
          return { ...l, overrides: { ...l.overrides, charFills } }
        }),
      }
    }))
  }

  function clearColorSelection() {
    if (!pieceSelection) return
    const { layerKey, start, end } = pieceSelection
    const [pieceId, layerIdxStr] = layerKey.split(":")
    const layerIdx = Number(layerIdxStr)
    const lo = Math.min(start, end)
    const hi = Math.max(start, end)
    setPieces(prev => prev.map(p => {
      if (p.id !== pieceId) return p
      return {
        ...p,
        layers: p.layers.map((l, i) => {
          if (i !== layerIdx) return l
          const charFills = { ...(l.overrides.charFills ?? {}) }
          for (let k = lo; k <= hi; k++) delete charFills[k]
          return { ...l, overrides: { ...l.overrides, charFills } }
        }),
      }
    }))
  }

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
  // state + migra overrides das pecas. Sem botao Salvar.
  // IMPORTANTE: usar setAssets com updater pra ler estado MAIS RECENTE.
  // Antes lia `assets` do closure → ficava STALE se user trocava cor per-char
  // e logo digitava (rebuildSpans usava estado antigo, heranca quebrava).
  function updateAssetText(assetId: string, newText: string) {
    // prevText pode vir do closure (texto nao muda por updateCharStyle, so cores
    // mudam — entao closure tem texto correto sempre). Mas o CONTENT precisa
    // vir do updater pra pegar cores atualizadas.
    const closureAsset = assets.find(a => a.id === assetId)
    if (!closureAsset) return
    const prevAssetText = getText(closureAsset)
    if (prevAssetText === newText) return
    setAssets(prev => {
      const asset = prev.find(a => a.id === assetId)
      if (!asset) return prev
      const newContent = rebuildSpans(asset.content, newText)
      return prev.map(a => a.id === assetId ? { ...a, content: newContent } : a)
    })
    const skipMigrate = newText.trim().length === 0
    if (skipMigrate) return
    setPieces(prev => prev.map(p => ({
      ...p,
      layers: p.layers.map(l => {
        if (l.assetId !== assetId) return l
        const hadOverrideText = typeof l.overrides.text === "string" && l.overrides.text.length > 0
        const prevTextToRender = hadOverrideText ? l.overrides.text! : prevAssetText!
        const migratedOverrideText = hadOverrideText
          ? migrateOverrideText(l.overrides.text!, newText)
          : null
        const newTextToRender = hadOverrideText ? migratedOverrideText! : newText
        const newCharFills = migrateCharFillsForEdit(
          prevTextToRender,
          newTextToRender,
          l.overrides.charFills ?? {}
        )
        const newOverrides: Layer["overrides"] = { ...l.overrides }
        if (hadOverrideText) newOverrides.text = migratedOverrideText!
        newOverrides.charFills = Object.keys(newCharFills).length > 0 ? newCharFills : undefined
        return { ...l, overrides: newOverrides }
      }),
    })))
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
    ])
    setPieces([
      { id: "matriz", name: "Matriz", isMatriz: true, layers: [{ assetId: "a1", overrides: { text: "Hello\nWorld" } }] },
      { id: "p1", name: "Peça 1", layers: [{ assetId: "a1", overrides: { fill: "#118AB2" } }] },
    ])
    setPieceCounter(2)
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

          {/* ============ DIREITA: Matriz + Peças ============ */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "#F5C400", margin: 0, textTransform: "uppercase", letterSpacing: "0.5px" }}>Matriz + Peças (realtime)</h2>
              <button onClick={generateFromMatriz}
                style={{ padding: "6px 12px", background: "#F5C400", border: "none", borderRadius: 4, color: "#111", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                + Gerar peça
              </button>
            </div>
            {pieces.map(piece => {
              const myLayerSelected = pieceSelection?.layerKey.startsWith(`${piece.id}:`)
              const isMatriz = !!piece.isMatriz
              return (
              <div key={piece.id} style={{
                background: "#1a1a1a",
                border: isMatriz ? "2px solid #F5C400" : "1px solid #2a2a2a",
                borderRadius: 8,
                padding: 14,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {isMatriz && (
                      <span style={{ fontSize: 9, padding: "2px 6px", background: "#F5C400", color: "#111", borderRadius: 3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>Matriz</span>
                    )}
                    <div style={{ fontSize: 11, color: isMatriz ? "#F5C400" : "#888", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: isMatriz ? 700 : 400 }}>{piece.name}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {!isMatriz && (
                    <button onClick={() => deletePiece(piece.id)}
                      style={{ padding: "2px 8px", background: "transparent", border: "1px solid #444", borderRadius: 3, color: "#888", cursor: "pointer", fontSize: 10 }}
                      title="Remove esta peca">
                      Apagar
                    </button>
                  )}
                  </div>
                </div>
                {/* Render visual — double-click no texto = edita inline. Toolbar floating in-canvas. */}
                <div style={{ position: "relative", background: "#fff", borderRadius: 6, padding: "20px 16px", marginBottom: 12, minHeight: 120 }}>
                  {/* Toolbar flutuante DENTRO do canvas — aparece quando ha selecao nesta peca */}
                  {myLayerSelected && (() => {
                    const [, layerIdxStr] = pieceSelection!.layerKey.split(":")
                    const layerIdx = Number(layerIdxStr)
                    const layer = piece.layers[layerIdx]
                    const asset = layer ? assets.find(a => a.id === layer.assetId) : undefined
                    const firstChar = Math.min(pieceSelection!.start, pieceSelection!.end)
                    const realColor = layer ? resolveCharColor(layer, asset, firstChar) ?? "#111111" : "#111111"
                    return (
                    <div style={{
                      position: "absolute",
                      top: -14,
                      left: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "#111",
                      border: "1px solid #F5C400",
                      borderRadius: 6,
                      padding: "4px 8px",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                      zIndex: 10,
                      fontSize: 10,
                    }}>
                      <span style={{ color: "#F5C400", fontWeight: 700, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.5px" }}>Cor:</span>
                      <input
                        type="color"
                        value={realColor}
                        onChange={e => applyColorToSelection(e.target.value)}
                        style={{ width: 28, height: 22, padding: 0, border: "1px solid #333", background: "transparent", cursor: "pointer" }}
                        title={`Cor atual: ${realColor}`}
                      />
                      <button onClick={clearColorSelection}
                        style={{ padding: "2px 8px", background: "#2a2a2a", border: "1px solid #444", borderRadius: 3, color: "#ddd", cursor: "pointer", fontSize: 10 }}
                        title="Remove override de cor dos chars selecionados">
                        Limpar
                      </button>
                      <button onClick={() => setPieceSelection(null)}
                        style={{ padding: "2px 8px", background: "transparent", border: "1px solid #444", borderRadius: 3, color: "#888", cursor: "pointer", fontSize: 10 }}>
                        ✕
                      </button>
                    </div>
                    )
                  })()}
                  {piece.layers.map((layer, lidx) => (
                    <LayerRender
                      key={lidx}
                      layer={layer}
                      asset={assets.find(a => a.id === layer.assetId)!}
                      layerKey={`${piece.id}:${lidx}`}
                      selection={pieceSelection}
                      onSelectionChange={setPieceSelection}
                      onTextEdit={(newText, newCharFills) => updateLayerOverride(piece.id, lidx, { text: newText, charFills: newCharFills })}
                    />
                  ))}
                </div>
                {/* Editor de overrides */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {piece.layers.map((layer, lidx) => {
                    const asset = assets.find(a => a.id === layer.assetId)
                    if (!asset) return null
                    return (
                      <div key={lidx} style={{ background: "#111", padding: 10, borderRadius: 4, fontSize: 11 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <div style={{ color: "#888" }}>Layer {lidx + 1} → asset <strong style={{ color: "#F5C400" }}>{asset.label}</strong></div>
                          {isMatriz && (
                            <button onClick={() => removeLayerFromMatriz(lidx)}
                              style={{ padding: "2px 8px", background: "transparent", border: "1px solid #444", borderRadius: 3, color: "#888", cursor: "pointer", fontSize: 10 }}
                              title="Remove layer da matriz E de todas pecas geradas">
                              Remover
                            </button>
                          )}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
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
                  {/* Add layer DROPDOWN (so na matriz) — propaga pras pecas geradas */}
                  {isMatriz && (() => {
                    const usedAssetIds = new Set(piece.layers.map(l => l.assetId))
                    const available = assets.filter(a => !usedAssetIds.has(a.id))
                    if (available.length === 0) return (
                      <div style={{ fontSize: 10, color: "#555", textAlign: "center", padding: 6 }}>(todos os assets ja estao na matriz)</div>
                    )
                    return (
                      <select
                        value=""
                        onChange={e => { if (e.target.value) addLayerToMatriz(e.target.value) }}
                        style={{ padding: "6px 10px", background: "#0d0d0d", color: "#F5C400", border: "1px dashed #F5C400", borderRadius: 4, fontSize: 11, cursor: "pointer", fontWeight: 700 }}
                      >
                        <option value="">+ Adicionar layer da matriz...</option>
                        {available.map(a => (
                          <option key={a.id} value={a.id} style={{ color: "#111" }}>{a.label}</option>
                        ))}
                      </select>
                    )
                  })()}
                </div>
              </div>
              )
            })}
          </div>
        </div>

        <div style={{ marginTop: 24, padding: 14, background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: "#F5C400", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Comportamento (100% fiel ao ZZOSY):</div>
          <ul style={{ fontSize: 12, color: "#aaa", paddingLeft: 18, lineHeight: 1.6, margin: 0 }}>
            <li><strong style={{color:"#F5C400"}}>Duplo-clique no texto</strong> da peça → edita inline. Enter = nova linha. Esc = cancela. Clicar fora = salva (vira overrides.text).</li>
            <li><strong>Click+drag</strong> nos chars → seleciona range → color picker aplica cor per-char (overrides.charFills).</li>
            <li><strong>+ Gerar peça</strong> = CLONA layers + overrides da matriz como snapshot independente.</li>
            <li><strong>Edit override</strong> na matriz → NÃO propaga pras geradas. Só base pra futuras gerações.</li>
            <li><strong>Add/Remove layer</strong> na matriz → propaga: pecas geradas ganham/perdem o layer.</li>
            <li><strong>Edit asset</strong> (à esquerda) → propaga pra TODAS via migrateOverrideText + remapeamento per-char.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// Renderiza UM layer da peça: aplica overrides.text + overrides.fill/fontSize +
// overrides.charFills (per-char). Suporta SELEÇÃO de chars via click+drag
// E EDIT INLINE via double-click (textarea aparece em cima, Esc/blur salva).
function LayerRender({
  layer,
  asset,
  layerKey,
  selection,
  onSelectionChange,
  onTextEdit,
}: {
  layer: Layer
  asset: Asset
  layerKey: string
  selection: { layerKey: string; start: number; end: number } | null
  onSelectionChange: (sel: { layerKey: string; start: number; end: number } | null) => void
  onTextEdit: (newText: string, newCharFills: Record<number, string> | undefined) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
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

  // Mapeamento subsequence-based 2026-05-24: pra cada char do textToRender,
  // procura o proximo char igual no assetText a partir de um cursor avancante.
  // Robusto pra desalinhamentos (asset cresce/encolhe, override tem \n extras).
  // Antes usava prefix+suffix diff que quebrava se asset terminava com whitespace
  // diferente do override — "World" perdia verde quando user adicionava espaco
  // no final do asset.
  const charStyles: Style[] = useMemo(() => {
    if (!useOverrideText) return assetStyles
    const out: Style[] = []
    let cursor = 0
    for (let i = 0; i < textToRender.length; i++) {
      const ch = textToRender[i]
      if (ch === "\n") {
        out.push(defaultStyle)
        continue
      }
      // Procura ch no assetText a partir do cursor
      let found = -1
      for (let j = cursor; j < assetText.length; j++) {
        if (assetText[j] === ch) { found = j; break }
      }
      if (found !== -1) {
        out.push(assetStyles[found] ?? defaultStyle)
        cursor = found + 1
      } else {
        // Char nao existe no resto do assetText — usa default (char novo no override)
        out.push(defaultStyle)
      }
    }
    return out
  }, [useOverrideText, assetText, textToRender, JSON.stringify(assetStyles)])

  // Aplica overrides.fill/fontSize/charFills SOBRESCREVENDO no char level.
  // Ordem de precedencia (maior → menor):
  //   1. overrides.charFills[i] (per-char especifico)
  //   2. overrides.fill (cor global da layer)
  //   3. charStyles[i] (do asset)
  const lines: Array<Array<{ ch: string; style: Style; idx: number }>> = []
  let currentLine: Array<{ ch: string; style: Style; idx: number }> = []
  for (let i = 0; i < textToRender.length; i++) {
    const ch = textToRender[i]
    if (ch === "\n") { lines.push(currentLine); currentLine = []; continue }
    const baseStyle = charStyles[i] ?? defaultStyle
    const charFill = overrides.charFills?.[i]
    const finalStyle: Style = {
      ...baseStyle,
      ...(typeof overrides.fill === "string" ? { color: overrides.fill } : {}),
      ...(typeof overrides.fontSize === "number" ? { fontSize: overrides.fontSize } : {}),
      ...(typeof charFill === "string" ? { color: charFill } : {}),
    }
    currentLine.push({ ch, style: finalStyle, idx: i })
  }
  lines.push(currentLine)

  // Selection state (drag handlers)
  const isMine = selection?.layerKey === layerKey
  const selStart = isMine ? Math.min(selection!.start, selection!.end) : -1
  const selEnd = isMine ? Math.max(selection!.start, selection!.end) : -1
  const isCharSelected = (i: number) => isMine && i >= selStart && i <= selEnd

  function enterEdit() {
    setDraft(textToRender)
    setEditing(true)
    onSelectionChange(null)
  }
  function commitEdit() {
    // Migra charFills baseado em prev/new text: chars novos herdam do vizinho
    // (mesma logica que Adobe/Figma e o rebuildSpans do asset).
    const newCharFills = migrateCharFillsForEdit(textToRender, draft, overrides.charFills ?? {})
    onTextEdit(draft, Object.keys(newCharFills).length > 0 ? newCharFills : undefined)
    setEditing(false)
  }
  function cancelEdit() {
    setEditing(false)
  }

  if (editing) {
    // Tamanho-base do primeiro char (pra textarea parecer com o render)
    const baseSize = (asset.content[0]?.style.fontSize ?? 16) * (overrides.fontSize ? overrides.fontSize / (asset.content[0]?.style.fontSize ?? 16) : 1)
    return (
      <div style={{ marginBottom: 8 }}>
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === "Escape") { e.preventDefault(); cancelEdit() }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit() }
          }}
          style={{
            width: "100%",
            minHeight: baseSize * 2.4,
            padding: 4,
            fontSize: baseSize,
            fontWeight: asset.content[0]?.style.fontWeight ?? "normal",
            fontFamily: asset.content[0]?.style.fontFamily ?? "inherit",
            lineHeight: asset.lineHeight ?? 1.1,
            border: "2px dashed #F5C400",
            borderRadius: 4,
            outline: "none",
            background: "#fffbe6",
            color: "#111",
            resize: "vertical",
          }}
        />
        <div style={{ fontSize: 9, color: "#888", marginTop: 2 }}>Enter = nova linha · Esc = cancela · clique fora = salva</div>
      </div>
    )
  }

  return (
    <div
      style={{ marginBottom: 8, userSelect: "none", cursor: "text" }}
      onMouseLeave={() => { (window as any).__zzosyDragging = false }}
      onDoubleClick={enterEdit}
      title="Duplo-clique pra editar o texto"
    >
      {lines.map((line, li) => (
        <div key={li} style={{ lineHeight: asset.lineHeight ?? 1.1 }}>
          {line.map(({ ch, style, idx }, ci) => {
            const sel = isCharSelected(idx)
            return (
              <span
                key={ci}
                data-char-idx={idx}
                onMouseDown={(e) => {
                  e.preventDefault()
                  ;(window as any).__zzosyDragging = true
                  onSelectionChange({ layerKey, start: idx, end: idx })
                }}
                onMouseEnter={() => {
                  if ((window as any).__zzosyDragging && isMine) {
                    onSelectionChange({ layerKey, start: selection!.start, end: idx })
                  }
                }}
                onMouseUp={() => { (window as any).__zzosyDragging = false }}
                style={{
                  color: style.color ?? "#111",
                  fontSize: style.fontSize ?? 16,
                  fontWeight: style.fontWeight ?? "normal",
                  fontFamily: style.fontFamily ?? "inherit",
                  background: sel ? "#F5C400" : undefined,
                  boxShadow: sel ? "0 0 0 2px #F5C400" : undefined,
                  borderRadius: sel ? 2 : undefined,
                  cursor: "text",
                }}
              >{ch}</span>
            )
          })}
        </div>
      ))}
    </div>
  )
}
