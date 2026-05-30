/**
 * usePanelResize — gerencia largura/persistencia/drag dos paineis laterais
 * do editor (Layers a esquerda + Properties a direita).
 *
 * Extraido de KeyVisionEditor.tsx em 2026-05-29 (audit #5 HIGH — god
 * component 12K linhas). Encapsula:
 *   - state com largura inicial vinda do localStorage
 *   - refs sync pra closures capturadas (canvas onResize closure que foi
 *     criada dentro de useEffect [campaign] e nao re-roda quando a largura
 *     muda — precisa do ref pra ler a largura atual)
 *   - persistencia em localStorage + dispatch de window.resize ao mudar
 *     (forca re-centralizacao do canvas Fabric)
 *   - panelsHidden toggle (Tab shortcut) + effLeft/effRight = 0 quando hidden
 *   - drag handlers (mousedown -> mousemove window listener) + clamp
 *   - reset via double-click
 *
 * Uso (em KeyVisionEditor):
 *   const panels = usePanelResize()
 *   panels.layersPanelWidth, panels.propsPanelWidth, panels.panelsHidden
 *   panels.setPanelsHidden, panels.onLayersDragStart, etc.
 *
 * Refs (panels.effLayersRef etc) lidas em closures de canvas onResize.
 */
import { useCallback, useEffect, useRef, useState } from "react"

// Defaults + caps fora do hook pra constantes serem importaveis em tests.
// User pedido 2026-05-30 (atualizado): "voce acha que essa coluna precisa
// ser assim tao larga?" — sim, exagerei pra 280/340. Reduzido pra um sweet
// spot que mostra o conteudo comum (BACKGROUND/FONT/etc) sem desperdicar
// espaco. MIN deixa user encolher mais se quiser.
//
// Layers: tipica "CTA_Confira e contrate"/"Logo_Catavento_Stroke" cabe em
// 200-240px com padding reduzido (commit 3ff309bb). Folder indent some.
//
// Properties: BACKGROUND com SOLID/LINEAR/RADIAL ja cabe em 240px. Quando
// abre TEXT (font/size/weight/lineHeight/letterSpacing/baseline) precisa
// mais — 280 acomoda confortavel. User arrasta pra alargar se quiser.
const LW = 220
const PW = 280
const LW_MIN = 180
const LW_MAX = 500
const PW_MIN = 240
const PW_MAX = 560
const LW_STORAGE_KEY = "zzosy.editor.layersPanelWidth"
const PW_STORAGE_KEY = "zzosy.editor.propsPanelWidth"

export const PANEL_RESIZE_CONSTANTS = { LW, PW, LW_MIN, LW_MAX, PW_MIN, PW_MAX } as const

function readPanelWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback
  try {
    const saved = window.localStorage?.getItem(key)
    const n = saved ? parseInt(saved, 10) : NaN
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
  } catch {
    return fallback
  }
}

export interface PanelResize {
  layersPanelWidth: number
  propsPanelWidth: number
  setLayersPanelWidth: (n: number) => void
  setPropsPanelWidth: (n: number) => void
  /** Refs sync — usados em closures capturadas (canvas onResize). */
  layersPanelWidthRef: React.MutableRefObject<number>
  propsPanelWidthRef: React.MutableRefObject<number>
  /** Largura efetiva (0 quando panelsHidden). */
  effLayersPanelWidth: number
  effPropsPanelWidth: number
  effLayersRef: React.MutableRefObject<number>
  effPropsRef: React.MutableRefObject<number>
  panelsHidden: boolean
  setPanelsHidden: React.Dispatch<React.SetStateAction<boolean>>
  /** Mousedown handlers — registram mousemove em window + cursor body. */
  onLayersDragStart: (e: React.MouseEvent) => void
  onPropsDragStart: (e: React.MouseEvent) => void
  /** Double-click → volta pro min. */
  resetLayersWidth: () => void
  resetPropsWidth: () => void
}

export function usePanelResize(): PanelResize {
  // States — init do localStorage no first render.
  const [panelsHidden, setPanelsHidden] = useState(false)
  const [layersPanelWidth, setLayersPanelWidth] = useState<number>(
    () => readPanelWidth(LW_STORAGE_KEY, LW, LW_MIN, LW_MAX)
  )
  const [propsPanelWidth, setPropsPanelWidth] = useState<number>(
    () => readPanelWidth(PW_STORAGE_KEY, PW, PW_MIN, PW_MAX)
  )

  // Refs sync com state pra closures capturadas (canvas onResize foi criado
  // dentro de useEffect [campaign] e nao re-roda quando a largura muda).
  const layersPanelWidthRef = useRef(layersPanelWidth)
  const propsPanelWidthRef = useRef(propsPanelWidth)

  // Persiste + dispatch window resize (Fabric canvas re-centraliza).
  useEffect(() => {
    layersPanelWidthRef.current = layersPanelWidth
    try { window.localStorage?.setItem(LW_STORAGE_KEY, String(layersPanelWidth)) } catch {}
    if (typeof window !== "undefined") window.dispatchEvent(new Event("resize"))
  }, [layersPanelWidth])

  useEffect(() => {
    propsPanelWidthRef.current = propsPanelWidth
    try { window.localStorage?.setItem(PW_STORAGE_KEY, String(propsPanelWidth)) } catch {}
    if (typeof window !== "undefined") window.dispatchEvent(new Event("resize"))
  }, [propsPanelWidth])

  // Drag state — refs pra mousedown/mousemove handlers nao virar dependencia.
  const layersResizeRef = useRef<{ startX: number; startW: number } | null>(null)
  const propsResizeRef = useRef<{ startX: number; startW: number } | null>(null)

  // Effective widths (0 quando hidden via Tab — Photoshop-style preview limpo).
  const effLayersPanelWidth = panelsHidden ? 0 : layersPanelWidth
  const effPropsPanelWidth = panelsHidden ? 0 : propsPanelWidth
  const effLayersRef = useRef(effLayersPanelWidth)
  const effPropsRef = useRef(effPropsPanelWidth)
  useEffect(() => {
    effLayersRef.current = effLayersPanelWidth
    effPropsRef.current = effPropsPanelWidth
  }, [effLayersPanelWidth, effPropsPanelWidth])

  // Drag handlers — useCallback pra estabilidade entre renders (handlers
  // sao passados como onMouseDown direto pros DOM nodes; estabilidade evita
  // re-attach desnecessario).
  const onLayersDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startW = layersPanelWidthRef.current
    layersResizeRef.current = { startX: e.clientX, startW }
    const onMove = (ev: MouseEvent) => {
      const st = layersResizeRef.current
      if (!st) return
      const dx = ev.clientX - st.startX
      const next = Math.max(LW_MIN, Math.min(LW_MAX, st.startW + dx))
      setLayersPanelWidth(next)
    }
    const onUp = () => {
      layersResizeRef.current = null
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    document.body.style.cursor = "ew-resize"
    document.body.style.userSelect = "none"
  }, [])

  const onPropsDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startW = propsPanelWidthRef.current
    propsResizeRef.current = { startX: e.clientX, startW }
    const onMove = (ev: MouseEvent) => {
      const st = propsResizeRef.current
      if (!st) return
      const dx = ev.clientX - st.startX
      // INVERSE: arrastando pra ESQUERDA aumenta a largura (borda esquerda).
      const next = Math.max(PW_MIN, Math.min(PW_MAX, st.startW - dx))
      setPropsPanelWidth(next)
    }
    const onUp = () => {
      propsResizeRef.current = null
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    document.body.style.cursor = "ew-resize"
    document.body.style.userSelect = "none"
  }, [])

  const resetLayersWidth = useCallback(() => setLayersPanelWidth(LW_MIN), [])
  const resetPropsWidth = useCallback(() => setPropsPanelWidth(PW_MIN), [])

  return {
    layersPanelWidth, propsPanelWidth,
    setLayersPanelWidth, setPropsPanelWidth,
    layersPanelWidthRef, propsPanelWidthRef,
    effLayersPanelWidth, effPropsPanelWidth,
    effLayersRef, effPropsRef,
    panelsHidden, setPanelsHidden,
    onLayersDragStart, onPropsDragStart,
    resetLayersWidth, resetPropsWidth,
  }
}
