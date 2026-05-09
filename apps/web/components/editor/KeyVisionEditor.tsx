"use client"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { GeneratePiecesModal } from "./GeneratePiecesModal"
import { FontPicker, WeightPicker } from "./FontPicker"
import { ExportDialog } from "@/components/pieces/ExportDialog"
import { migrateStyles } from "@/lib/migrateStyles"
import { getClipboard, setClipboard } from "@/lib/editorClipboard"

interface TextSpan {
  text: string
  style: { color?: string; fontSize?: number; fontWeight?: string; fontFamily?: string }
}
interface Asset {
  id: string; type: string; label: string; value: string | null
  imageUrl: string | null; content: any
}
interface Layer {
  assetId: string; posX: number; posY: number
  scaleX: number; scaleY: number; rotation: number; zIndex: number; width: number; height?: number
  overrides?: any
}
interface Campaign {
  id: string; name: string; client: { id: string; name: string }
  assets: Asset[]
  keyVision: { bgColor: string; layers: Layer[] | null; width?: number; height?: number } | null
}

const DEFAULT_W = 1920, DEFAULT_H = 1080
const LW = 220, PW = 260, TH = 48, BH = 44
const _FONTS_LEGACY: string[] = [] // mantido como placeholder - lista de fontes agora vem de @/lib/fonts via FontPicker
const SWATCHES = ["#111111","#ffffff","#F5C400","#e63946","#457b9d","#2a9d8f","#264653","#f4a261","#8338ec","#ff006e","#06d6a0","#118ab2"]

function parseContent(raw: any): TextSpan[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

function getSpans(asset: Asset): TextSpan[] {
  const c = parseContent(asset.content)
  if (c.length) return c
  const text = (asset.value?.trim()) || asset.label
  return [{ text, style: { color: "#111111", fontSize: 80, fontWeight: "normal", fontFamily: "Arial" } }]
}


// Le os styles per-caractere de um Textbox e gera TextSpan[] fragmentado
function textboxToSpans(obj: any): TextSpan[] {
  const fullText: string = obj.text ?? ""
  const styles = obj.styles ?? {}
  const defaultStyle = {
    color: obj.fill ?? "#111111",
    fontSize: obj.fontSize ?? 80,
    fontWeight: obj.fontWeight ?? "normal",
    fontFamily: obj.fontFamily ?? "Arial",
  }

  if (!fullText) return [{ text: "", style: defaultStyle }]

  const lines = fullText.split("\n")
  const spans: TextSpan[] = []
  let buf = ""
  let bufStyle: any = null

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]
    const lineStyles = styles[lineNum] ?? {}
    for (let col = 0; col < line.length; col++) {
      const cs = lineStyles[col] ?? {}
      const charStyle = {
        color: cs.fill ?? defaultStyle.color,
        fontSize: cs.fontSize ?? defaultStyle.fontSize,
        fontWeight: cs.fontWeight ?? defaultStyle.fontWeight,
        fontFamily: cs.fontFamily ?? defaultStyle.fontFamily,
      }
      const key = JSON.stringify(charStyle)
      if (bufStyle === null || JSON.stringify(bufStyle) === key) {
        buf += line[col]
        if (bufStyle === null) bufStyle = charStyle
      } else {
        spans.push({ text: buf, style: bufStyle })
        buf = line[col]
        bufStyle = charStyle
      }
    }
    if (lineNum < lines.length - 1) {
      buf += "\n"
    }
  }
  if (buf) spans.push({ text: buf, style: bufStyle ?? defaultStyle })
  return spans
}

// Inverso: converte TextSpan[] em props para criar Textbox + styles per-char
function spansToTextboxData(spans: TextSpan[]) {
  if (!spans.length) return { text: "", styles: {}, defaultStyle: {} }
  const fullText = spans.map(s => s.text).join("")
  const defaultStyle = spans[0].style ?? {}
  const styles: Record<number, Record<number, any>> = {}

  let charIdx = 0
  let lineNum = 0
  let col = 0
  for (const span of spans) {
    const sStyle = span.style ?? {}
    for (const ch of span.text) {
      if (ch === "\n") {
        lineNum++
        col = 0
        charIdx++
        continue
      }
      const styleKey = JSON.stringify(sStyle)
      const defaultKey = JSON.stringify(defaultStyle)
      if (styleKey !== defaultKey) {
        if (!styles[lineNum]) styles[lineNum] = {}
        styles[lineNum][col] = {
          fill: sStyle.color,
          fontSize: sStyle.fontSize,
          fontWeight: sStyle.fontWeight,
          fontFamily: sStyle.fontFamily,
        }
      }
      col++
      charIdx++
    }
  }
  return { text: fullText, styles, defaultStyle }
}


export function KeyVisionEditor({ campaignId, pieceId, from }: { campaignId: string; pieceId?: string; from?: string }) {
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fabricRef = useRef<any>(null)
  const bgRef = useRef<any>(null)
  const campaignRef = useRef<Campaign | null>(null)
  const saveTimer = useRef<any>()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [piece, setPiece] = useState<any>(null)
  const pieceRef = useRef<any>(null)
  const isPieceMode = !!pieceId
  const [selected, setSelected] = useState<any>(null)
  const [hexInput, setHexInput] = useState<string>("#111111")
  const [bgHexInput, setBgHexInput] = useState<string>("#ffffff")
  const [fontSizeInput, setFontSizeInput] = useState<string>("80")
  const [leadingInput, setLeadingInput] = useState<string>("96")
  const [selectedTick, setSelectedTick] = useState(0)
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  const isDirtyRef = useRef(false)
  const [isDirty, setIsDirty] = useState(false)
  const isApplyingHistory = useRef(false)
  const isInitialized = useRef(false)
  const pendingTextPropagation = useRef(false)
  const [confirmExit, setConfirmExit] = useState<null | (() => void)>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportPieces, setExportPieces] = useState<any[]>([])
  const [layers, setLayers] = useState<any[]>([])
  const [editingLayerAssetId, setEditingLayerAssetId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(0.5)
  const zoomRef = useRef(0.5)
  const [bgColor, setBgColor] = useState("#ffffff")
  const bgColorRef = useRef("#ffffff")
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assetId, setAssetId] = useState("")
  const assetIdRef = useRef("")
  const [canvasW, setCanvasW] = useState(DEFAULT_W)
  const [canvasH, setCanvasH] = useState(DEFAULT_H)
  const canvasWRef = useRef(DEFAULT_W)
  const canvasHRef = useRef(DEFAULT_H)

  // Carregar campanha + peça (se for modo peça)
  useEffect(() => {
    async function load() {
      const campRes = await fetch(`/api/campaigns/${campaignId}`)
      const camp: Campaign = await campRes.json()
      campaignRef.current = camp
      if (camp.assets?.length) { assetIdRef.current = camp.assets[0].id }

      // MODO PEÇA: carrega peça PRIMEIRO, atualiza refs, depois disso seta campaign (que dispara init)
      if (pieceId) {
        const pieceRes = await fetch(`/api/pieces/${pieceId}`)
        const p = await pieceRes.json()
        const pdata = typeof p.data === "string" ? JSON.parse(p.data) : p.data
        const pw = pdata?.width ?? DEFAULT_W
        const ph = pdata?.height ?? DEFAULT_H
        // CRITICAL: setar refs ANTES de setCampaign para o init do canvas ter os dados certos
        pieceRef.current = p
        canvasWRef.current = pw
        canvasHRef.current = ph
        const bg = pdata?.bgColor ?? camp.keyVision?.bgColor ?? "#ffffff"
        bgColorRef.current = bg
        // Agora seta states (dispara render + init do canvas)
        setPiece(p)
        setCanvasW(pw); setCanvasH(ph)
        setBgColor(bg)
        if (camp.assets?.length) setAssetId(camp.assets[0].id)
        setCampaign(camp)
      } else {
        // MODO MATRIZ
        const bg = camp.keyVision?.bgColor ?? "#ffffff"
        const cw = camp.keyVision?.width ?? DEFAULT_W
        const ch = camp.keyVision?.height ?? DEFAULT_H
        bgColorRef.current = bg
        canvasWRef.current = cw
        canvasHRef.current = ch
        setBgColor(bg)
        setCanvasW(cw); setCanvasH(ch)
        if (camp.assets?.length) setAssetId(camp.assets[0].id)
        setCampaign(camp)
      }
    }
    load()
  }, [campaignId, pieceId])

  // Sempre que voltar para o editor (foco), apenas atualiza campaignRef em memoria.
  // NAO toca no canvas: qualquer "sync" automatico apaga edicoes locais nao salvas
  // (cor por letra, tamanho custom, etc). Sync visual real acontece so no remount da pagina.
  useEffect(() => {
    function onFocus() {
      fetch(`/api/campaigns/${campaignId}`).then(r => r.json()).then((d: Campaign) => {
        campaignRef.current = d
      }).catch(() => {})
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [campaignId])

  // Atalhos Cmd/Ctrl+Z (undo) e Cmd/Ctrl+Shift+Z (redo)
  // Atalho Cmd/Ctrl+Shift+>/< pra aumentar/diminuir 4pt no fontSize do texto selecionado
  // (igual Photoshop). So funciona quando o textbox esta selecionado mas NAO em edicao inline.
  useEffect(() => {
    function isTypingInPanel(t: EventTarget | null): boolean {
      if (!t) return false
      const el = t as HTMLElement
      const tag = (el.tagName || "").toUpperCase()
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
      if (el.isContentEditable) return true
      return false
    }
    function onKey(e: KeyboardEvent) {
      // Se o usuario esta digitando num input/textarea do painel, nao intercepta atalhos.
      // Permite digitar valores numericos, buscar fontes, etc, sem que Cmd+Z (undo) ou
      // Cmd+Shift+>/< (font size) roubem a tecla.
      if (isTypingInPanel(e.target)) return

      const fc = fabricRef.current
      const active = fc?.getActiveObject() as any
      const isTextActive = active && (active.type === "textbox" || active.type === "i-text")

      // Cmd+Shift+L/C/R/J — alinhamento (Photoshop). Funciona inclusive em modo edicao.
      if (isTextActive && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        const k = e.key.toLowerCase()
        const map: Record<string, string> = { l: "left", c: "center", r: "right", j: "justify" }
        if (map[k]) {
          e.preventDefault()
          active.set("textAlign", map[k])
          if (active.initDimensions) active.initDimensions()
          active.setCoords()
          fc?.renderAll()
          fc?.fire("object:modified", { target: active })
          setSelectedTick(t => t + 1)
          return
        }
      }

      // Option+↑/↓ — entrelinhas em PONTOS (Adobe-style). 1pt sem Shift, 10pt com Shift.
      // Funciona em modo edicao. Se estava em "Auto", primeira mexida congela no valor
      // efetivo atual e comeca a editar dali (igual Photoshop).
      if (isTextActive && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const delta = e.key === "ArrowUp" ? step : -step
        const fs = active.fontSize ?? 48
        const curPt: number = (active.leadingPt !== undefined && active.leadingPt !== null)
          ? active.leadingPt
          : Math.round((active.lineHeight ?? 1.2) * fs) // congela do auto
        const next = Math.max(1, curPt + delta)
        active.leadingPt = next
        // Sincroniza lineHeight do Fabric (detalhe interno do motor)
        active.set("lineHeight", next / fs)
        if (active.initDimensions) active.initDimensions()
        active.setCoords()
        fc?.renderAll()
        fc?.fire("object:modified", { target: active })
        setSelectedTick(t => t + 1)
        return
      }

      if (active?.isEditing) return // demais atalhos: nao interfere com edicao de texto

      // Cmd+C — copia objeto selecionado pro clipboard interno
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && !e.shiftKey && !e.altKey) {
        if (!active || (active as any).__isBg) return
        e.preventDefault()
        // Serializa COM props customizadas que precisamos preservar
        // (__assetId pra link com CampaignAsset; __assetLabel pra rotulo;
        //  leadingPt pra entrelinhas em pt; styles pra formatacao per-char).
        const json = active.toObject([
          "__assetId", "__assetLabel", "__isBg", "leadingPt",
        ])
        setClipboard({ campaignId, json, copiedAt: Date.now() })
        return
      }

      // Cmd+V — cola da clipboard interna
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v" && !e.shiftKey && !e.altKey) {
        const cb = getClipboard()
        if (!cb) return
        if (cb.campaignId !== campaignId) {
          alert("Asset copiado pertence a outra campanha — copie/cole apenas dentro da mesma campanha por enquanto.")
          return
        }
        e.preventDefault()
        ;(async () => {
          const { util } = await import("fabric")
          // enlivenObjects retorna Promise<FabricObject[]> em v6+
          const enlivened = await util.enlivenObjects([cb.json]) as any[]
          const cloned = enlivened?.[0]
          if (!cloned || !fc) return
          // CRITICO: enlivenObjects reconstroi via construtor Fabric, que NAO copia
          // props customizadas (__assetId/__assetLabel/leadingPt). Sem isso, o objeto
          // colado fica com __assetId=undefined e ao salvar/recarregar a peca o load
          // pula esse layer (assetMap[null] = undefined) -> texto "desaparece".
          if (cb.json.__assetId) (cloned as any).__assetId = cb.json.__assetId
          if (cb.json.__assetLabel) (cloned as any).__assetLabel = cb.json.__assetLabel
          if (cb.json.leadingPt !== undefined) (cloned as any).leadingPt = cb.json.leadingPt
          // Offset visivel pra nao ficar exatamente em cima do original
          cloned.set({
            left: (cloned.left ?? 0) + 20,
            top: (cloned.top ?? 0) + 20,
          })
          cloned.setCoords()
          fc.add(cloned)
          fc.setActiveObject(cloned)
          fc.requestRenderAll()
          // Dispara save (via object:modified que ja escuta)
          fc.fire("object:modified", { target: cloned })
        })()
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault()
        redo()
      }
      // Cmd+Shift+> / Cmd+Shift+< (Photoshop-style font size)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === ">" || e.key === "." || e.key === "<" || e.key === ",")) {
        if (!active || (active.type !== "textbox" && active.type !== "i-text")) return
        e.preventDefault()
        const delta = (e.key === ">" || e.key === ".") ? 4 : -4
        const cur = Math.round(active.fontSize ?? 48)
        const next = Math.max(1, cur + delta)
        active.set("fontSize", next)
        if (active.initDimensions) active.initDimensions()
        fc?.renderAll()
        // dispara o mesmo evento que o painel escuta pra reflitir a mudanca
        fc?.fire("object:modified", { target: active })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [campaignId])

  // Hand tool (Photoshop-style): segura Space pra ativar pan do canvas.
  // - So ativa fora de inputs, fora de edicao inline de texto e fora de overlays/menus
  // - Cursor vira grab/grabbing, selecao/edit do canvas desabilitada enquanto ativa
  // - Pan via mouse:down/move/up modificando viewportTransform direto (Photoshop-style)
  // - Soltar Space restaura tudo. O viewport fica onde foi pannado (nao reseta)
  useEffect(() => {
    let isSpaceDown = false
    let isPanning = false
    let lastX = 0, lastY = 0
    // Snapshots de estado pra restaurar ao soltar Space
    let savedSelection: boolean | null = null
    let savedCursors: { default: string; hover: string; move: string } | null = null
    let savedObjectSelectability: Map<any, boolean> | null = null

    function isTypingTarget(t: EventTarget | null): boolean {
      if (!t) return false
      const el = t as HTMLElement
      const tag = (el.tagName || "").toUpperCase()
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
      if (el.isContentEditable) return true
      return false
    }

    function activate() {
      const fc = fabricRef.current
      if (!fc || isSpaceDown) return
      const active = fc.getActiveObject() as any
      if (active?.isEditing) return // nao interfere com edicao inline de texto
      isSpaceDown = true
      // Salva estado anterior
      savedSelection = fc.selection ?? true
      savedCursors = {
        default: fc.defaultCursor ?? "default",
        hover: fc.hoverCursor ?? "move",
        move: fc.moveCursor ?? "move",
      }
      savedObjectSelectability = new Map()
      for (const o of fc.getObjects()) {
        savedObjectSelectability.set(o, (o as any).selectable !== false)
        ;(o as any).selectable = false
        ;(o as any).evented = false
      }
      fc.selection = false
      fc.defaultCursor = "grab"
      fc.hoverCursor = "grab"
      fc.moveCursor = "grab"
      fc.discardActiveObject()
      fc.requestRenderAll()
    }

    function deactivate() {
      const fc = fabricRef.current
      if (!fc || !isSpaceDown) return
      isSpaceDown = false
      isPanning = false
      // Restaura estado
      if (savedCursors) {
        fc.defaultCursor = savedCursors.default
        fc.hoverCursor = savedCursors.hover
        fc.moveCursor = savedCursors.move
      }
      if (savedSelection !== null) fc.selection = savedSelection
      if (savedObjectSelectability) {
        for (const o of fc.getObjects()) {
          const wasSelectable = savedObjectSelectability.get(o) ?? true
          ;(o as any).selectable = wasSelectable
          ;(o as any).evented = wasSelectable
        }
      }
      savedSelection = null
      savedCursors = null
      savedObjectSelectability = null
      fc.requestRenderAll()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space") return
      if (isTypingTarget(e.target)) return // permite Space normal em inputs
      // Importante: prevent default pra Space nao scrollar pagina nem inserir em outros lugares
      e.preventDefault()
      activate()
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return
      deactivate()
    }

    // Pan via mouse handlers do Fabric, ativos so quando isSpaceDown
    function onMouseDown(opt: any) {
      if (!isSpaceDown) return
      const fc = fabricRef.current; if (!fc) return
      isPanning = true
      const ev = opt.e as MouseEvent
      lastX = ev.clientX
      lastY = ev.clientY
      fc.defaultCursor = "grabbing"
    }
    function onMouseMove(opt: any) {
      if (!isPanning) return
      const fc = fabricRef.current; if (!fc) return
      const ev = opt.e as MouseEvent
      const dx = ev.clientX - lastX
      const dy = ev.clientY - lastY
      lastX = ev.clientX
      lastY = ev.clientY
      const vt = fc.viewportTransform
      if (!vt) return
      vt[4] += dx
      vt[5] += dy
      fc.setViewportTransform(vt)
      fc.requestRenderAll()
    }
    function onMouseUp() {
      if (!isPanning) return
      isPanning = false
      const fc = fabricRef.current; if (!fc) return
      fc.defaultCursor = "grab"
      fc.requestRenderAll()
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    // Se a janela perde foco (tab change), desativa pra nao ficar travado
    window.addEventListener("blur", deactivate)

    // Liga handlers do Fabric quando o canvas existir
    let attachedFc: any = null
    const attachInterval = setInterval(() => {
      const fc = fabricRef.current
      if (!fc || attachedFc === fc) return
      attachedFc = fc
      fc.on("mouse:down", onMouseDown)
      fc.on("mouse:move", onMouseMove)
      fc.on("mouse:up", onMouseUp)
    }, 100)

    return () => {
      clearInterval(attachInterval)
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", deactivate)
      if (attachedFc) {
        attachedFc.off("mouse:down", onMouseDown)
        attachedFc.off("mouse:move", onMouseMove)
        attachedFc.off("mouse:up", onMouseUp)
      }
    }
  }, [])

  // beforeunload: avisa se ha mudancas nao salvas
  useEffect(() => {
    function onBefore(e: BeforeUnloadEvent) {
      if (isDirtyRef.current) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", onBefore)
    return () => window.removeEventListener("beforeunload", onBefore)
  }, [])

  // Inicializar Fabric
  useEffect(() => {
    if (!campaign || !canvasRef.current) return
    // Se ja existe um canvas Fabric, mas ele aponta para um DOM element diferente
    // do canvasRef.current atual (Strict Mode re-mount, hot reload, etc), descarta o velho
    if (fabricRef.current) {
      const existingEl = (fabricRef.current as any).lowerCanvasEl ?? (fabricRef.current as any).getElement?.()
      if (existingEl === canvasRef.current) return  // mesmo DOM, ja inicializado
      try { fabricRef.current.dispose() } catch {}
      fabricRef.current = null
    }
    let alive = true
    const cleanupFns: Array<() => void> = []

    const init = async () => {
      const { Canvas, Rect, Textbox, FabricImage } = await import("fabric")
      if (!alive || !canvasRef.current) return

      const cw = canvasWRef.current
      const ch = canvasHRef.current

      const availW = window.innerWidth - LW - PW - 80
      const availH = window.innerHeight - TH - BH - 80
      const z = Math.round(Math.min(0.8, availW / cw, availH / ch) * 10) / 10
      zoomRef.current = z
      setZoom(z)

      const fc = new Canvas(canvasRef.current, {
        width: Math.round(cw * z),
        height: Math.round(ch * z),
        selection: true,
        preserveObjectStacking: true,
      })
      fc.setZoom(z)
      fabricRef.current = fc

      const bg = new Rect({
        left: 0, top: 0, width: cw, height: ch,
        fill: bgColorRef.current,
        selectable: false, evented: false, excludeFromExport: true,
      })
      ;(bg as any).__isBg = true
      bgRef.current = bg
      fc.add(bg)

      fc.on("selection:created", (e: any) => setSelected(e.selected?.[0] ?? null))
      fc.on("selection:updated", (e: any) => setSelected(e.selected?.[0] ?? null))
      fc.on("selection:cleared", () => setSelected(null))
      fc.on("object:modified", () => { if (alive) doSave() })
      // Quando o usuario muda a selecao DENTRO de um textbox em modo edicao (cursor moveu,
      // selecao expandida, palavra selecionada), forca re-render do painel pra ler estilos
      // do caractere onde o cursor esta agora. Sem isso, painel mostra estado obsoleto
      // quando texto tem estilos per-char.
      // Fabric dispara mouseup/keyup nesses casos. Usamos uma checagem leve no proprio canvas.
      const onCanvasInteract = () => {
        const active = fc.getActiveObject() as any
        if (active?.isEditing) setSelectedTick(t => t + 1)
      }
      fc.on("mouse:up", onCanvasInteract)
      // Escalar via canto/handle do box: dispara em real time pra atualizar painel
      // Photoshop-style: ao escalar TEXTBOX pelo canto, consolida o scale em fontSize
      // (em vez de manter scaleX/scaleY do Fabric). Resultado: o numero do tamanho de fonte
      // no painel reflete o tamanho real renderizado, e os exports/PSD sempre veem fontSize
      // limpo sem precisar multiplicar por scale.
      //
      // Cuidados:
      // - So aplica em textbox/i-text — outros objetos mantem scale normal
      // - Multiplica fontSize do obj E todos os styles per-char (overrides)
      // - Multiplica width pra preservar largura visual
      // - Reseta scaleX/scaleY pra 1 e re-aplica initDimensions pra wrap correto
      // - object:modified dispara DEPOIS (ao soltar mouse), com estado ja consolidado,
      //   resultando em UMA entrada de undo
      fc.on("object:scaling" as any, (e: any) => {
        if (!alive) return
        const obj = e?.target
        if (!obj) return
        const isText = obj.type === "textbox" || obj.type === "i-text"
        if (!isText) return

        const corner: string = e?.transform?.corner ?? ""
        const isSide = corner === "ml" || corner === "mr" || corner === "mt" || corner === "mb"

        if (isSide) {
          // LATERAIS (esq/dir/topo/baixo): comportamento Photoshop wrap. Soh muda width
          // e deixa Fabric quebrar texto naturalmente. NUNCA mexer em fontSize aqui — o
          // user esta ajustando a CAIXA, nao o tamanho do texto. Tambem nao reseta scaleX
          // durante o drag (Fabric perde referencia do delta e wrap quebra). object:modified
          // (no soltar mouse) consolida sX/sY em width/height final via re-set.
          return
        }

        // CANTOS (escala uniforme): Photoshop-style — consolida scaleX/scaleY em fontSize
        // e width raw. Resultado: numero do tamanho de fonte no painel reflete o real
        // renderizado; exports/PSD veem fontSize limpo sem multiplicar por scale.
        const sX = obj.scaleX ?? 1
        const sY = obj.scaleY ?? 1
        if (Math.abs(sY - 1) < 0.0001 && Math.abs(sX - 1) < 0.0001) return
        const newFontSize = (obj.fontSize ?? 48) * sY
        if (obj.styles && typeof obj.styles === "object") {
          for (const lineKey of Object.keys(obj.styles)) {
            const line = obj.styles[lineKey]
            for (const colKey of Object.keys(line)) {
              const cs = line[colKey]
              if (cs && typeof cs.fontSize === "number") {
                cs.fontSize = cs.fontSize * sY
              }
            }
          }
        }
        // Photoshop-style: entrelinhas (leadingPt) escala JUNTO com fontSize. Sem isso, ao
        // aumentar o texto pelo canto, o espacamento ficaria desproporcionalmente apertado
        // (e o painel direito mostraria leading antigo enquanto fonte aumenta).
        const curLeadingPt: number | undefined | null = (obj as any).leadingPt
        if (curLeadingPt !== undefined && curLeadingPt !== null) {
          ;(obj as any).leadingPt = curLeadingPt * sY
        }
        const newWidth = (obj.width ?? 100) * sX
        obj.set({ fontSize: newFontSize, width: newWidth, scaleX: 1, scaleY: 1 })
        // Recalcula lineHeight se leadingPt explicito (mantem visual sincronizado)
        if (curLeadingPt !== undefined && curLeadingPt !== null) {
          obj.set({ lineHeight: ((obj as any).leadingPt) / newFontSize })
        }
        if ((obj as any).initDimensions) (obj as any).initDimensions()
        obj.setCoords()
        setSelectedTick(t => t + 1)
      })

      // Ao SOLTAR o mouse apos arrastar lateral, consolida scaleX em width pra que o save
      // grave o estado limpo (scaleX=1, width final). Sem isso, scaleX!=1 ficaria salvo e
      // ao recarregar o textbox apareceria com scale ainda aplicado.
      fc.on("object:modified" as any, (e: any) => {
        if (!alive) return
        const obj = e?.target
        if (!obj) return
        const isText = obj.type === "textbox" || obj.type === "i-text"
        if (!isText) return
        const sX = obj.scaleX ?? 1
        const sY = obj.scaleY ?? 1
        // So consolida se scale ainda nao foi resetado (cantos ja consolidaram em scaling)
        if (Math.abs(sX - 1) < 0.0001 && Math.abs(sY - 1) < 0.0001) return
        // Lateral arrastada: consolida sX em width (mantem fontSize intocado, deixa wrap fluir)
        const newWidth = (obj.width ?? 100) * sX
        const newHeight = (obj.height ?? 100) * sY
        obj.set({ width: newWidth, height: newHeight, scaleX: 1, scaleY: 1 })
        if ((obj as any).initDimensions) (obj as any).initDimensions()
        obj.setCoords()
        fc.requestRenderAll()
      })
      // Tambem captura quando teclas (Shift+Arrow etc) mudam a selecao
      const onKeyUp = (e: KeyboardEvent) => {
        const active = fc.getActiveObject() as any
        if (active?.isEditing) setSelectedTick(t => t + 1)
      }
      window.addEventListener("keyup", onKeyUp)
      cleanupFns.push(() => window.removeEventListener("keyup", onKeyUp))
      fc.on("text:changed", (e: any) => {
        if (!alive) return
        setSelectedTick(t => t + 1)
        // AUTO-FIT: ajusta o width do textbox ao conteudo quando o texto muda.
        // Logica:
        //   1. Salva o width atual.
        //   2. Expande o width pra um valor grande (5000px) — Fabric vai re-wrappar
        //      e como ninguem cabe alem desse limite, o texto ocupa o minimo necessario.
        //   3. Mede calcTextWidth (a maior linha real apos remover wrap forcado).
        //   4. Seta o width pro valor medido + uma margem pequena (8px) pra cursor caber.
        // So roda em textbox (i-text nao tem width restrito), e so quando o conteudo de
        // texto mudou (text:changed). Width arrastado manualmente nao dispara isso.
        const obj = e?.target
        if (!obj || obj.type !== "textbox") return
        try {
          const oldWidth = obj.width
          obj.set("width", 5000)
          if (obj.initDimensions) obj.initDimensions()
          const measured = obj.calcTextWidth ? obj.calcTextWidth() : oldWidth
          const newWidth = Math.max(20, Math.ceil(measured) + 8)
          obj.set("width", newWidth)
          if (obj.initDimensions) obj.initDimensions()
          obj.setCoords()
          fc.requestRenderAll()
        } catch (err) { console.warn("auto-fit textbox fail:", err) }
      })
      fc.on("object:added", () => { if (alive) refreshLayers(fc) })
      fc.on("object:removed", () => { if (alive) refreshLayers(fc) })
      // Captura mudancas para historico de undo/redo
      fc.on("object:modified", () => pushHistory())
      fc.on("object:added", () => { if (!isApplyingHistory.current) pushHistory() })
      fc.on("object:removed", () => { if (!isApplyingHistory.current) pushHistory() })
      // text:changed nao chama pushHistory - text:editing:exited cobre o flush final

      // Captura texto+styles ao ENTRAR em modo edicao (T0 para diff posterior)
      fc.on("text:editing:entered", (e: any) => {
        if (!alive || !e?.target) return
        ;(e.target as any).__editStartText = e.target.text ?? ""
        ;(e.target as any).__editStartStyles = JSON.parse(JSON.stringify(e.target.styles ?? {}))
      })

      fc.on("text:editing:exited", async (e: any) => {
        if (!alive) return
        const obj = e.target
        if (!obj) return
        const oldText = (obj as any).__editStartText ?? ""
        const oldStyles = (obj as any).__editStartStyles ?? {}
        const newText = obj.text ?? ""
        const textChanged = oldText !== newText

        // Sempre limpar refs de edicao
        delete (obj as any).__editStartText
        delete (obj as any).__editStartStyles

        if (!textChanged) {
          // Sem mudança de texto: caminho rápido. doSave normal.
          if (!isApplyingHistory.current) doSave()
          return
        }

        // CASO: texto mudou
        // 1) Migra styles localmente para feedback visual imediato (sem flicker)
        const migratedLocal = migrateStyles(oldText, newText, oldStyles)
        obj.set("styles", migratedLocal)
        if ((obj as any).initDimensions) (obj as any).initDimensions()
        fc.renderAll()

        if (!obj.__assetId) { doSave(); return }

        // 2) Bloqueia doSave enquanto servidor faz migração canônica em todos os escopos
        pendingTextPropagation.current = true
        try {
          const spans = textboxToSpans(obj)
          await fetch(`/api/campaigns/${campaignId}/assets/${obj.__assetId}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: spans, value: obj.text })
          })
        } catch (err) {
          console.warn("[text:editing:exited] PUT asset failed:", err)
        } finally {
          pendingTextPropagation.current = false
        }

        // 3) Agora sim: doSave salva os layers locais (com styles migrados que batem
        // com os que o servidor acabou de gravar nos outros escopos).
        doSave()
      })

      // Zoom Photoshop-style: Ctrl+Scroll
      const wrapper = wrapperRef.current
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return
        if (!alive || !fabricRef.current) return
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.05 : 0.05
        const newZ = Math.min(3, Math.max(0.05, zoomRef.current + delta))
        applyZoom(fabricRef.current, newZ)
      }
      if (wrapper) wrapper.addEventListener("wheel", onWheel, { passive: false })
      cleanupFns.push(() => { if (wrapper) wrapper.removeEventListener("wheel", onWheel) })

      // Delete key remove selected
      const onKey = (e: KeyboardEvent) => {
        if (!alive || !fabricRef.current) return
        if (e.key !== "Delete" && e.key !== "Backspace") return
        // Nao remove o objeto quando o user esta digitando num input do painel
        const t = e.target as HTMLElement | null
        if (t) {
          const tag = (t.tagName || "").toUpperCase()
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
          if (t.isContentEditable) return
        }
        const obj = fabricRef.current.getActiveObject()
        if (obj && !(obj as any).__isBg && !(obj as any).isEditing) {
          fabricRef.current.remove(obj)
          fabricRef.current.renderAll()
          doSave()
        }
      }
      window.addEventListener("keydown", onKey)
      cleanupFns.push(() => window.removeEventListener("keydown", onKey))

      // Em MODO PEÇA, bloquear digitacao mas permitir seleção de caracteres
      // (necessario para mudar cor/tamanho de letras especificas, estilo Photoshop)
      if (pieceId) {
        const blockKey = (e: KeyboardEvent) => {
          const fcc = fabricRef.current
          if (!fcc) return
          // Se o usuario esta digitando num input/select do painel, nao bloqueia.
          const t = e.target as HTMLElement | null
          if (t) {
            const tag = (t.tagName || "").toUpperCase()
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
            if (t.isContentEditable) return
          }
          const active = fcc.getActiveObject() as any
          if (!active || !active.isEditing) return
          // Permitir teclas de navegacao/selecao
          const allowed = new Set([
            "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
            "Home", "End", "PageUp", "PageDown", "Tab", "Escape",
            "Shift", "Control", "Alt", "Meta",
          ])
          if (allowed.has(e.key)) return
          // Permitir Cmd/Ctrl+A, Cmd/Ctrl+C (selecionar/copiar)
          if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "c")) return
          // Bloquear o resto (digitacao, paste, delete, backspace, enter)
          e.preventDefault()
          e.stopPropagation()
        }
        const onPaste = (e: ClipboardEvent) => {
          const fcc = fabricRef.current
          if (!fcc) return
          const active = fcc.getActiveObject() as any
          if (active?.isEditing) { e.preventDefault(); e.stopPropagation() }
        }
        document.addEventListener("keydown", blockKey, true)
        document.addEventListener("paste", onPaste, true)
        ;(fc as any).__blockKeyHandler = blockKey
        ;(fc as any).__blockPasteHandler = onPaste
      }

      // Restaurar layers (bloquear push history para nao poluir undo stack durante init)
      isApplyingHistory.current = true
      const c = campaignRef.current!
      if (pieceId && pieceRef.current) {
        // MODO PEÇA v2: layers + assets (sync automatico com asset)
        const p = pieceRef.current
        const pdata = typeof p.data === "string" ? JSON.parse(p.data) : p.data
        const assetMap = Object.fromEntries(c.assets.map((a: Asset) => [a.id, a]))

        if (pdata?.version === 2 && Array.isArray(pdata?.layers)) {
          // Renderiza cada layer da peca
          const sorted = [...pdata.layers].sort((a: any, b: any) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
          for (const layer of sorted) {
            const asset = assetMap[layer.assetId] as Asset
            if (!asset) continue
            // Aplica overrides ao layer base
            const layerWithOverrides = {
              ...layer,
              ...(layer.overrides ?? {}),
            }
            await addAssetToCanvas(fc, asset, layerWithOverrides)
            // Aplicar overrides especificos de TEXTO depois do textbox criado
            const objs = fc.getObjects()
            const created = objs[objs.length - 1] as any
            if (created && (created.type === "textbox" || created.type === "i-text") && layer.overrides) {
              // DEBUG: log antes/depois do override pra investigar bug "config zera"
              console.log("[PIECE-LOAD-TEXT] before override", {
                assetLabel: asset.label,
                assetId: asset.id,
                fontSize_obj: created.fontSize,
                fontFamily_obj: created.fontFamily,
                fontWeight_obj: created.fontWeight,
                fill_obj: created.fill,
                overrides: layer.overrides,
              })
              if (layer.overrides.fill !== undefined) created.set("fill", layer.overrides.fill)
              if (layer.overrides.fontSize !== undefined) created.set("fontSize", layer.overrides.fontSize)
              if (layer.overrides.fontFamily !== undefined) created.set("fontFamily", layer.overrides.fontFamily)
              if (layer.overrides.fontWeight !== undefined) created.set("fontWeight", layer.overrides.fontWeight)
              if (layer.overrides.charSpacing !== undefined) created.set("charSpacing", layer.overrides.charSpacing)
              if (layer.overrides.lineHeight !== undefined) created.set("lineHeight", layer.overrides.lineHeight)
              if (layer.overrides.textAlign !== undefined) created.set("textAlign", layer.overrides.textAlign)
              // Adobe-style leading: leadingPt e a fonte da verdade. lineHeight e derivado
              // (recomputado aqui pra garantir consistencia com o fontSize atual).
              if (layer.overrides.leadingPt !== undefined && layer.overrides.leadingPt !== null) {
                ;(created as any).leadingPt = layer.overrides.leadingPt
                syncLineHeightFromLeading(created)
              }
              if (layer.overrides.styles !== undefined) {
                created.set("styles", layer.overrides.styles)
                if (created.initDimensions) created.initDimensions()
              }
              ;(created as any).__pieceLayerIdx = sorted.indexOf(layer)
              console.log("[PIECE-LOAD-TEXT] after override", {
                assetLabel: asset.label,
                fontSize_final: created.fontSize,
                fontFamily_final: created.fontFamily,
                fill_final: created.fill,
                styles_count: Object.keys(created.styles ?? {}).length,
              })
              // Em modo peca, deixa editavel pra permitir seleção de caracteres,
              // mas o key handler abaixo bloqueia digitacao real
            } else if (created) {
              ;(created as any).__pieceLayerIdx = sorted.indexOf(layer)
            }
          }
          fc.renderAll()
        } else if (pdata?.canvasData) {
          // LEGACY (v1): peca antiga com canvasData direto - mantem compatibilidade
          const sourceW = pdata?.sourceWidth ?? canvasWRef.current
          const sourceH = pdata?.sourceHeight ?? canvasHRef.current
          const targetW = canvasWRef.current
          const targetH = canvasHRef.current
          await new Promise<void>((resolve) => {
            const r = fc.loadFromJSON(pdata.canvasData, () => { resolve() })
            if (r && typeof r.then === "function") r.then(() => resolve())
          })
          await new Promise(r => setTimeout(r, 250))
          const scale = Math.min(targetW / sourceW, targetH / sourceH)
          const offsetX = (targetW - sourceW * scale) / 2
          const offsetY = (targetH - sourceH * scale) / 2
          for (const obj of fc.getObjects()) {
            if ((obj as any).__isBg) {
              obj.set({ left: 0, top: 0, width: targetW, height: targetH, scaleX: 1, scaleY: 1 })
              continue
            }
            obj.set({
              left: (obj.left ?? 0) * scale + offsetX,
              top: (obj.top ?? 0) * scale + offsetY,
              scaleX: (obj.scaleX ?? 1) * scale,
              scaleY: (obj.scaleY ?? 1) * scale,
            })
            obj.setCoords()
          }
          const bgObj = fc.getObjects().find((o: any) => o.__isBg)
          if (bgObj) fc.sendObjectToBack(bgObj)
        }
      } else {
        // MODO MATRIZ
        const savedLayers = c.keyVision?.layers
        if (savedLayers && Array.isArray(savedLayers) && savedLayers.length > 0) {
          const assetMap = Object.fromEntries(c.assets.map((a: Asset) => [a.id, a]))
          const sorted = [...savedLayers].sort((a: any, b: any) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
          let skippedCount = 0
          for (const layer of sorted) {
            const asset = assetMap[layer.assetId] as Asset
            if (!asset) {
              skippedCount++
              if (!layer.assetId) {
                console.warn("[LOAD-MATRIX] layer com assetId vazio (campanha pode ter dados corrompidos antigos):", layer)
              } else {
                console.warn("[LOAD-MATRIX] layer aponta pra asset inexistente:", layer.assetId)
              }
              continue
            }
            await addAssetToCanvas(fc, asset, layer)
            // Aplicar overrides depois (igual modo peça)
            const objs = fc.getObjects()
            const created = objs[objs.length - 1] as any
            if (created && (created.type === "textbox" || created.type === "i-text") && (layer as any).overrides) {
              const ov = (layer as any).overrides
              if (ov.fill !== undefined) created.set("fill", ov.fill)
              if (ov.fontSize !== undefined) created.set("fontSize", ov.fontSize)
              if (ov.fontFamily !== undefined) created.set("fontFamily", ov.fontFamily)
              if (ov.fontWeight !== undefined) created.set("fontWeight", ov.fontWeight)
              if (ov.charSpacing !== undefined) created.set("charSpacing", ov.charSpacing)
              if (ov.lineHeight !== undefined) created.set("lineHeight", ov.lineHeight)
              if (ov.textAlign !== undefined) created.set("textAlign", ov.textAlign)
              // Adobe-style leading (ver comentario no outro load)
              if (ov.leadingPt !== undefined && ov.leadingPt !== null) {
                ;(created as any).leadingPt = ov.leadingPt
                syncLineHeightFromLeading(created)
              }
              if (ov.styles !== undefined) {
                created.set("styles", ov.styles)
                if (created.initDimensions) created.initDimensions()
              }
            }
          }
        }
      }

      fc.renderAll()
      if (alive) refreshLayers(fc)
      // SAUDE: remove objetos orfaos (sem __assetId) que possam ter vindo do banco
      // ou de bugs antigos. Tanto em PECA quanto em MATRIZ todo objeto deve ter __assetId.
      // Limpar aqui evita que entrem no undoStack e causem desync no undo/redo.
      const orphans = fc.getObjects().filter((o: any) => !o.__isBg && !o.__assetId)
      if (orphans.length > 0) {
        console.warn("[INIT-CLEAN]", pieceId ? "peca" : "matriz", "tinha", orphans.length, "objetos orfaos no canvas. Removendo.")
        for (const orphan of orphans) fc.remove(orphan)
        fc.renderAll()
        if (alive) refreshLayers(fc)
      }
      // Snapshot inicial (estado limpo, sem dirty)
      try {
        const snap = JSON.stringify((fc as any).toJSON(["__assetId", "__assetLabel", "__isBg", "__isImage"]))
        undoStack.current = [snap]
        redoStack.current = []
      } catch (e) {}
      isApplyingHistory.current = false
      // Marca init concluido — saves sao liberados a partir daqui. Antes disso, salvar
      // poderia gravar layers: [] (canvas ainda nao tinha objetos carregados).
      isInitialized.current = true
    }

    init()
    return () => {
      alive = false
      // Bloqueia saves apos cleanup. Sem isso, um saveTimer pendente (debounce 800ms)
      // dispararia depois do dispose, e poderia salvar sobre um canvas em meio de re-init
      // (causando layers: [] no banco — bug "KV volta vazio ao alternar com /assets").
      isInitialized.current = false
      // Cancela qualquer save pendente pra nao gravar lixo apos o user sair
      clearTimeout(saveTimer.current)
      const fcc: any = fabricRef.current
      if (fcc) {
        if (fcc.__blockKeyHandler) document.removeEventListener("keydown", fcc.__blockKeyHandler, true)
        if (fcc.__blockPasteHandler) document.removeEventListener("paste", fcc.__blockPasteHandler, true)
      }
      cleanupFns.forEach(fn => { try { fn() } catch {} })
      // Dispose o canvas e libera fabricRef para que a próxima execução do useEffect
      // (em strict mode, hot reload, ou navegação de peça pra peça) possa re-inicializar
      // num <canvas> DOM novo. Sem isso, fabricRef segura referencia stale.
      if (fabricRef.current) {
        try { fabricRef.current.dispose() } catch {}
        fabricRef.current = null
      }
    }
  }, [campaign])

  function spansToFabricProps(spans: TextSpan[]) {
    const first = spans[0]?.style ?? {}
    const fullText = spans.map(s => s.text).join("")
    return {
      text: fullText,
      fontSize: (first.fontSize as number) ?? 80,
      fontFamily: first.fontFamily ?? "Arial",
      fontWeight: first.fontWeight ?? "normal",
      fill: first.color ?? "#111111",
    }
  }

  function pushHistory() {
    if (isApplyingHistory.current) return
    const fc = fabricRef.current
    if (!fc) return
    try {
      // SAUDE: detecta objetos orfaos (sem __assetId) no canvas. Esses sao
      // "fantasmas" criados por bugs de paste antigos ou caminhos quebrados.
      // Eles nao se persistem (save filtra), mas confundem o undo (entram em
      // snapshots e voltam ao canvas em estado quebrado). Limpa antes de
      // capturar snapshot pra manter undoStack consistente.
      const orphans = fc.getObjects().filter((o: any) => !o.__isBg && !o.__assetId)
      if (orphans.length > 0) {
        console.warn("[UNDO-CLEAN] removendo", orphans.length, "objetos orfaos antes de pushHistory")
        for (const orphan of orphans) fc.remove(orphan)
      }
      const snap = JSON.stringify(fc.toJSON(["__assetId", "__assetLabel", "__isBg", "__isImage"]))
      // Evita push duplicado quando snap eh igual ao topo
      const top = undoStack.current[undoStack.current.length - 1]
      if (top === snap) return
      undoStack.current.push(snap)
      if (undoStack.current.length > 16) undoStack.current.shift() // mantem 15 + estado atual
      redoStack.current = []
      isDirtyRef.current = true
      setIsDirty(true)
    } catch (e) { /* ignora */ }
  }

  async function applySnapshot(snap: string) {
    const fc = fabricRef.current
    if (!fc) return
    isApplyingHistory.current = true
    // Cancela qualquer save pendente IMEDIATAMENTE — antes do loadFromJSON disparar
    // eventos que poderiam re-agendar saves em estado transitorio.
    clearTimeout(saveTimer.current)
    try {
      // Parse o snapshot pra ter acesso aos dados originais (precisaremos pra restaurar
      // styles per-char e props customizadas que loadFromJSON pode perder)
      const snapData = JSON.parse(snap)
      const snapObjects: any[] = Array.isArray(snapData?.objects) ? snapData.objects : []

      // CRITICO 0 (bug fix "tudo preto"): injeta bgColor no snapData ANTES do load
      // pra evitar gap entre load e re-add do bg Rect. Sem isso, loadFromJSON
      // limpa canvas, deixa transparente, e mostra fundo escuro do editor por
      // alguns frames antes do bg ser re-adicionado.
      snapData.background = bgColorRef.current
      // Remove backgroundImage/overlayImage do snap se existirem
      delete snapData.backgroundImage
      delete snapData.overlayImage

      await new Promise<void>((resolve) => {
        const r = fc.loadFromJSON(snapData, () => resolve())
        if (r && typeof r.then === "function") r.then(() => resolve())
      })

      // Reforca a cor (algumas versoes do Fabric ignoram `background` no JSON)
      ;(fc as any).backgroundColor = bgColorRef.current
      ;(fc as any).backgroundImage = null
      ;(fc as any).overlayImage = null
      fc.renderAll() // render imediato com bg setado, antes de qualquer outro processamento

      // CRITICO 1: Fabric Textbox ignora `styles` no construtor. Apos loadFromJSON,
      // os textboxes restaurados perdem styles per-char. Reaplica manualmente do snapshot.
      // CRITICO 2: __assetId / __assetLabel podem se perder na reconstrucao - garante.
      // CRITICO 3 (bug fix): filtramos BG dos restored, MAS snapObjects pode incluir o BG.
      // Isso desalinha os indices (restored[0] eh o 1o nao-BG, mas snapObjects[0] pode ser BG).
      // Solucao: filtra BG dos snapObjects tambem antes de iterar.
      const restored = fc.getObjects().filter((o: any) => !o.__isBg)
      const snapObjectsNoBg = snapObjects.filter((s: any) => !s?.__isBg)
      for (let i = 0; i < restored.length; i++) {
        const obj: any = restored[i]
        const src = snapObjectsNoBg[i]
        if (!src) continue
        // Restaurar props customizadas (sempre que existirem no snapshot, mesmo undefined no obj)
        if (src.__assetId) obj.__assetId = src.__assetId
        if (src.__assetLabel) obj.__assetLabel = src.__assetLabel
        if (src.__isImage !== undefined) obj.__isImage = src.__isImage
        // Restaurar styles per-char em textboxes
        if ((obj.type === "textbox" || obj.type === "i-text") && src.styles && Object.keys(src.styles).length > 0) {
          obj.set("styles", src.styles)
          if (obj.initDimensions) obj.initDimensions()
        }
      }

      // SAUDE pos-restore: qualquer objeto sem __assetId restaurado e fantasma
      // (snap continha objeto com __assetId undefined, ou houve race no restore).
      // Remove pra manter canvas saudavel — esses objetos nunca persistem mesmo.
      const orphansAfterRestore = fc.getObjects().filter((o: any) => !o.__isBg && !o.__assetId)
      if (orphansAfterRestore.length > 0) {
        console.warn("[UNDO-CLEAN] applySnapshot: removendo", orphansAfterRestore.length, "objetos orfaos pos-restore")
        for (const orphan of orphansAfterRestore) fc.remove(orphan)
      }

      // CRITICO 3: bg tem excludeFromExport=true, fica fora do snapshot. Re-adiciona no fundo.
      const { Rect } = await import("fabric")
      const newBg = new Rect({
        left: 0, top: 0, width: canvasWRef.current, height: canvasHRef.current,
        fill: bgColorRef.current,
        selectable: false, evented: false, excludeFromExport: true,
      })
      ;(newBg as any).__isBg = true
      bgRef.current = newBg
      fc.add(newBg)
      fc.sendObjectToBack(newBg)
      fc.renderAll()
      refreshLayers(fc)
    } catch (e) { console.warn("applySnapshot fail:", e) }
    // Limpa quaisquer save timers pendentes que poderiam ter sido enfileirados
    // por eventos de Fabric durante o loadFromJSON (object:added/modified).
    // Esses timers, se disparassem agora, salvariam layers em estado intermediario.
    clearTimeout(saveTimer.current)
    isApplyingHistory.current = false
    // Marca como dirty pra trigger save EXPLICITO (nao via debounce)
    // do estado pos-undo. Sem isso, se usuario fechar e abrir a peca,
    // o estado anterior ao undo permanece no banco.
    isDirtyRef.current = true
    setIsDirty(true)
    // Dispara save imediato do novo estado (sem debounce)
    doSave()
  }

  async function undo() {
    if (undoStack.current.length < 2) return
    const fc = fabricRef.current
    if (!fc) return
    // Topo da pilha eh o estado atual; guarda no redo e aplica o anterior
    const current = undoStack.current.pop()!
    redoStack.current.push(current)
    const previous = undoStack.current[undoStack.current.length - 1]
    if (previous) await applySnapshot(previous)
    setSelected(null)
  }

  async function redo() {
    if (redoStack.current.length === 0) return
    const next = redoStack.current.pop()!
    undoStack.current.push(next)
    await applySnapshot(next)
    setSelected(null)
  }

  function fitLayerToCanvas() {
    const fc = fabricRef.current
    const obj: any = selected
    if (!fc || !obj) return
    const cw = canvasWRef.current, ch = canvasHRef.current
    // Tamanho real do objeto (sem escala) - pega bounding box logico do textbox/imagem
    const ow = obj.width ?? 100
    const oh = obj.height ?? 100
    if (!ow || !oh) return
    // Escala que faz o objeto caber por inteiro dentro do canvas (FIT - menor lado limita)
    const scale = Math.min(cw / ow, ch / oh)
    const newW = ow * scale
    const newH = oh * scale
    // Centralizar
    const left = (cw - newW) / 2
    const top = (ch - newH) / 2
    obj.set({ scaleX: scale, scaleY: scale, left, top, angle: 0 })
    obj.setCoords()
    fc.renderAll()
    setSelectedTick(t => t + 1)
    doSave()
  }

  /**
   * Escala o layer pra ocupar uma porcentagem do canvas (mantendo proporcao).
   * Usa o mesmo criterio do fit (menor lado limita pra caber inteiro), aplicando
   * a porcentagem em cima. Centraliza no canvas. percent = 0.2, 0.4, 0.6, 0.8.
   */
  function scaleLayerToCanvas(percent: number) {
    const fc = fabricRef.current
    const obj: any = selected
    if (!fc || !obj) return
    const cw = canvasWRef.current, ch = canvasHRef.current
    const ow = obj.width ?? 100
    const oh = obj.height ?? 100
    if (!ow || !oh) return
    const scale = Math.min(cw / ow, ch / oh) * percent
    const newW = ow * scale
    const newH = oh * scale
    const left = (cw - newW) / 2
    const top = (ch - newH) / 2
    obj.set({ scaleX: scale, scaleY: scale, left, top, angle: 0 })
    obj.setCoords()
    fc.renderAll()
    setSelectedTick(t => t + 1)
    doSave()
  }

  /**
   * Renomeia um layer (nome do asset). Atualiza Fabric obj.__assetLabel e
   * persiste no banco (PUT no asset). Atualiza o estado da campanha em memoria
   * pra refletir em todas as instancias do mesmo asset (KV usa o mesmo asset
   * em multiplas pecas).
   */
  async function renameLayer(layerObj: any, newLabel: string) {
    const fc = fabricRef.current
    if (!fc || !layerObj) return
    const trimmed = newLabel.trim()
    if (!trimmed) return
    const assetId = layerObj.__assetId
    if (!assetId) return
    // Atualiza imediatamente no Fabric (todos os objetos do mesmo asset)
    fc.getObjects().forEach((o: any) => {
      if (o.__assetId === assetId) o.__assetLabel = trimmed
    })
    refreshLayers(fc)
    // Persiste no banco
    try {
      await fetch(`/api/campaigns/${campaignId}/assets/${assetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      })
      // Atualiza state da campanha em memoria
      setCampaign(prev => prev ? {
        ...prev,
        assets: prev.assets.map(a => a.id === assetId ? { ...a, label: trimmed } : a),
      } : prev)
    } catch (e) {
      console.warn("[renameLayer] falha ao persistir:", e)
    }
  }

  function applyZoom(fc: any, z: number) {
    if (!fc || fc.disposed) return
    // Fabric v7 expoe canvas DOM em diferentes propriedades dependendo do estado
    const hasEl = (fc as any).lowerCanvasEl || (fc as any).lower?.el || (fc as any).elements?.lower
    if (!hasEl) return
    zoomRef.current = z
    setZoom(z)
    try {
      fc.setZoom(z)
      fc.setDimensions({ width: Math.round(canvasWRef.current * z), height: Math.round(canvasHRef.current * z) })
      fc.renderAll()
    } catch (e) { console.warn("applyZoom fail:", e) }
  }

  async function addAssetToCanvas(fc: any, asset: Asset, layer: any) {
    const { Rect, Textbox, FabricImage } = await import("fabric")
    const posX = layer?.posX ?? 100
    const posY = layer?.posY ?? 100
    const width = layer?.width ?? 400
    const scaleX = layer?.scaleX ?? 1
    const scaleY = layer?.scaleY ?? 1
    const angle = layer?.rotation ?? 0

    if (asset.type === "IMAGE") {
      if (asset.imageUrl) {
        try {
          const isSvg = /\.svg(\?|$)/i.test(asset.imageUrl)
          // SVGs sem width/height EXPLICITOS no markup carregam com naturalWidth=150 (default
          // do user-agent), e Fabric usa naturalWidth como tamanho. Solucao robusta:
          // baixa o SVG, injeta width/height extraidos do viewBox no proprio markup,
          // e cria um Blob URL pro <img>. Assim naturalWidth bate com o tamanho real.
          let imgSrc = asset.imageUrl
          if (isSvg) {
            try {
              const txt = await fetch(asset.imageUrl).then(r => r.text())
              const widthAttr = txt.match(/<svg[^>]*\swidth\s*=\s*["']([^"']+)["']/i)?.[1]
              const heightAttr = txt.match(/<svg[^>]*\sheight\s*=\s*["']([^"']+)["']/i)?.[1]
              const viewBox = txt.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
              const numFromAttr = (s?: string) => {
                if (!s) return undefined
                const n = parseFloat(s)
                return Number.isFinite(n) && n > 0 ? n : undefined
              }
              let w = numFromAttr(widthAttr)
              let h = numFromAttr(heightAttr)
              if ((!w || !h) && viewBox) {
                const parts = viewBox.split(/[\s,]+/).map(Number)
                if (parts.length === 4 && parts.every(Number.isFinite)) {
                  w = w ?? parts[2]
                  h = h ?? parts[3]
                }
              }
              if (w && h && (!widthAttr || !heightAttr)) {
                // Injeta width/height na primeira tag <svg ...> do markup
                const patched = txt.replace(/<svg\b([^>]*)>/i, (_, attrs) => {
                  let a = attrs
                  if (!/\swidth\s*=/i.test(a)) a += ` width="${w}"`
                  if (!/\sheight\s*=/i.test(a)) a += ` height="${h}"`
                  return `<svg${a}>`
                })
                const blob = new Blob([patched], { type: "image/svg+xml" })
                imgSrc = URL.createObjectURL(blob)
              }
            } catch (e) { console.warn("[SVG] falha lendo dimensoes:", e) }
          }

          const img = await new Promise<any>((resolve, reject) => {
            const el = new window.Image()
            el.crossOrigin = "anonymous"
            el.onload = () => {
              const naturalW = el.naturalWidth || el.width || 1
              const naturalH = el.naturalHeight || el.height || 1
              const layerH = layer?.height ?? naturalH
              const sx = (scaleX !== 1 || scaleY !== 1) ? scaleX : (width / naturalW)
              const sy = (scaleX !== 1 || scaleY !== 1) ? scaleY : (layerH / naturalH)
              resolve(new FabricImage(el, { left: posX, top: posY, scaleX: sx, scaleY: sy, angle }))
            }
            el.onerror = reject
            el.src = imgSrc
          })
          // Nota: nao revogamos o Blob URL aqui porque Fabric pode reler a fonte
          // em re-renders/exports. Browser libera o blob no GC quando nada mais usa.
          ;(img as any).__assetId = asset.id
          ;(img as any).__assetLabel = asset.label
          fc.add(img)
          fc.requestRenderAll()
          return
        } catch (e) { console.error("Image load failed:", e) }
      }
      const r = new Rect({
        left: posX, top: posY, width, height: layer?.height ?? 300,
        fill: "#d0d0d0", stroke: "#999", strokeWidth: 1,
        scaleX, scaleY, angle
      })
      ;(r as any).__assetId = asset.id
      ;(r as any).__assetLabel = asset.label
      fc.add(r)
    } else {
      const spans = getSpans(asset)
      const data = spansToTextboxData(spans)
      const def = data.defaultStyle
      const t = new Textbox(data.text, {
        left: posX, top: posY,
        width: Math.max(width, 200),
        fontSize: def.fontSize ?? 80,
        fontFamily: def.fontFamily ?? "Arial",
        fontWeight: def.fontWeight ?? "normal",
        fill: def.color ?? "#111111",
        editable: true,
        scaleX, scaleY, angle,
      })
      // NOTA: NAO aplicar `data.styles` per-char vindos do asset aqui.
      // O texto literal (caracteres) eh fonte de verdade no asset; quando o usuario edita o
      // texto na pagina de assets, o numero de caracteres muda e os indices dos styles ficam
      // dessincronizados. Comportamento Photoshop-style: estilo default vem do asset,
      // styles per-char so existem quando editados localmente DENTRO do editor da matriz
      // (e a partir desse momento sao parte do estado do textbox no canvas, nao do asset).
      ;(t as any).__assetId = asset.id
      ;(t as any).__assetLabel = asset.label
      fc.add(t)
    }
  }

  function refreshLayers(fc: any) {
    setLayers(
      fc.getObjects()
        .filter((o: any) => !o.__isBg)
        .map((o: any, i: number) => ({ id: i, label: o.__assetLabel ?? o.type, type: o.type, obj: o }))
        .reverse()
    )
  }

  function moveLayer(obj: any, direction: "up" | "down") {
    const fc = fabricRef.current
    if (!fc || !obj) return
    if (direction === "up") fc.bringObjectForward(obj)
    else fc.sendObjectBackwards(obj)
    fc.renderAll()
    refreshLayers(fc)
    doSave()
  }

  async function uploadPieceThumb(fc: any, pId: string) {
    try {
      const w = canvasWRef.current
      const h = canvasHRef.current
      // Thumbnail: render num StaticCanvas offscreen no tamanho real da peça
      // para garantir nitidez na apresentação (sem depender do zoom do editor).
      const TARGET = 1600
      const thumbScale = Math.min(TARGET / w, TARGET / h, 1)
      const tw = Math.round(w * thumbScale)
      const th = Math.round(h * thumbScale)
      const { StaticCanvas: _ThumbSC } = await import("fabric") as any
      const thumbEl = document.createElement("canvas")
      thumbEl.width = tw; thumbEl.height = th
      const thumbFc = new _ThumbSC(thumbEl, { width: tw, height: th, enableRetinaScaling: false, backgroundColor: bgColorRef.current })
      await Promise.all(fc.getObjects().map((obj: any) => new Promise<void>(res => {
        obj.clone((cloned: any) => {
          cloned.set({ left: (obj.left ?? 0) * thumbScale, top: (obj.top ?? 0) * thumbScale, scaleX: (obj.scaleX ?? 1) * thumbScale, scaleY: (obj.scaleY ?? 1) * thumbScale })
          thumbFc.add(cloned); res()
        })
      })))
      thumbFc.renderAll()
      await new Promise(r => setTimeout(r, 100))
      const dataUrl = thumbFc.toDataURL({ format: "jpeg", quality: 0.92, multiplier: 1 })
      thumbFc.dispose()
      const blob = await (await fetch(dataUrl)).blob()
      const fd = new FormData()
      fd.append("thumbnail", blob, "thumb.jpg")
      await fetch(`/api/pieces/${pId}/thumbnail`, { method: "POST", body: fd })
    } catch (e) { console.warn("piece thumb upload failed:", e) }
  }

  async function saveNow() {
    clearTimeout(saveTimer.current)
    setSaving(true)
    const fc = fabricRef.current
    if (!fc) { setSaving(false); return }

    if (pieceId && pieceRef.current) {
      const p = pieceRef.current
      const oldData = typeof p.data === "string" ? JSON.parse(p.data) : (p.data ?? {})
      const newLayers = fc.getObjects()
        .filter((o: any) => {
          if (o.__isBg) return false
          if (!o.__assetId) {
            console.warn("[PIECE-SAVE-NOW] objeto sem __assetId BLOQUEADO:", {
              type: o.type, text: (o as any).text?.slice(0, 30),
              left: o.left, top: o.top,
            })
            return false
          }
          return true
        })
        .map((o: any, i: number) => {
          const layer: any = {
            assetId: o.__assetId,
            posX: Math.round(o.left ?? 0), posY: Math.round(o.top ?? 0),
            scaleX: o.scaleX ?? 1, scaleY: o.scaleY ?? 1,
            rotation: o.angle ?? 0, zIndex: i,
            width: Math.round(o.width ?? 400), height: Math.round(o.height ?? 100),
            overrides: {},
          }
          if (o.type === "textbox" || o.type === "i-text") {
            layer.overrides.fill = o.fill
            layer.overrides.fontSize = o.fontSize
            layer.overrides.fontFamily = o.fontFamily
            layer.overrides.fontWeight = o.fontWeight
            if (o.charSpacing !== undefined) layer.overrides.charSpacing = o.charSpacing
            if (o.lineHeight !== undefined) layer.overrides.lineHeight = o.lineHeight
            if (o.textAlign !== undefined) layer.overrides.textAlign = o.textAlign
            // Adobe-style leading: salva leadingPt (fonte da verdade). lineHeight tambem
            // e salvo (back-compat com pecas antigas), mas leadingPt manda no load.
            if ((o as any).leadingPt !== undefined && (o as any).leadingPt !== null) {
              layer.overrides.leadingPt = (o as any).leadingPt
            }
            if (o.styles && Object.keys(o.styles).length > 0) layer.overrides.styles = o.styles
          }
          return layer
        })
      const newData = { ...oldData, version: 2, width: canvasWRef.current, height: canvasHRef.current, bgColor: bgColorRef.current, layers: newLayers }
      await fetch(`/api/pieces/${pieceId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: JSON.stringify(newData) }) })
      await uploadPieceThumb(fc, pieceId)
      isDirtyRef.current = false
      setIsDirty(false)
    } else {
      const layersToSave: Layer[] = fc.getObjects()
        .filter((o: any) => {
          if (o.__isBg) return false
          // Bloqueia save de objetos sem __assetId — antes salvava com "" e o load
          // descartava silenciosamente, fazendo o canvas voltar vazio (bug grave de
          // perda de conteudo). Se acontecer, logamos pra detectar a causa-raiz.
          if (!o.__assetId) {
            console.warn("[SAVE-MATRIX] objeto sem __assetId ignorado no save:", o.type, { left: o.left, top: o.top, text: (o as any).text })
            return false
          }
          return true
        })
        .map((o: any, i: number) => {
          const layer: any = {
            assetId: o.__assetId,
            posX: Math.round(o.left ?? 0), posY: Math.round(o.top ?? 0),
            scaleX: o.scaleX ?? 1, scaleY: o.scaleY ?? 1,
            rotation: o.angle ?? 0, zIndex: i,
            width: Math.round(o.width ?? 400),
            height: Math.round((o.height ?? 300) * (o.scaleY ?? 1)),
            overrides: {},
          }
          // Espelha a logica do modo PECA: salva overrides per-instancia (fill,
          // fontSize, styles per-char, leadingPt, etc) pra preservar formatacao
          // ao alternar entre KV/Assets/Campanha. Sem isso, recarregar o KV
          // perdia mudancas de estilo (estilos sao salvos no asset.content e
          // sobrescritos por overrides do layer).
          if (o.type === "textbox" || o.type === "i-text") {
            layer.overrides.fill = o.fill
            layer.overrides.fontSize = o.fontSize
            layer.overrides.fontFamily = o.fontFamily
            layer.overrides.fontWeight = o.fontWeight
            if (o.charSpacing !== undefined) layer.overrides.charSpacing = o.charSpacing
            if (o.lineHeight !== undefined) layer.overrides.lineHeight = o.lineHeight
            if (o.textAlign !== undefined) layer.overrides.textAlign = o.textAlign
            // Adobe-style leading: salva leadingPt (fonte da verdade)
            if ((o as any).leadingPt !== undefined && (o as any).leadingPt !== null) {
              layer.overrides.leadingPt = (o as any).leadingPt
            }
            if (o.styles && Object.keys(o.styles).length > 0) layer.overrides.styles = o.styles
          }
          return layer
        })
      // Circuit breaker (mesma logica do doSave): nao grava matriz vazia sobre KV que tinha layers
      if (layersToSave.length === 0) {
        const previousLayers = (campaignRef.current?.keyVision?.layers as any) ?? []
        const hadLayers = Array.isArray(previousLayers) && previousLayers.length > 0
        if (hadLayers) {
          console.warn("[saveNow MATRIX] abortado — tentaria gravar layers:[] sobre KV que tinha", previousLayers.length, "layers. Provavel race condition.")
          isDirtyRef.current = false
          setIsDirty(false)
          setSaving(false)
          return
        }
      }
      await fetch(`/api/campaigns/${campaignId}/key-vision`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bgColor: bgColorRef.current, layers: layersToSave, width: canvasWRef.current, height: canvasHRef.current }) })
      try {
        const thumbScale = Math.min(480 / canvasWRef.current, 480 / canvasHRef.current, 1)
        const dataUrl = fc.toDataURL({ format: "jpeg", quality: 0.85, multiplier: thumbScale / (zoomRef.current || 1) })
        const blob = await (await fetch(dataUrl)).blob()
        const fd = new FormData()
        fd.append("thumbnail", blob, "kv-thumb.jpg")
        await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: fd })
      } catch (e) { console.warn("KV thumb upload failed:", e) }
    }
    isDirtyRef.current = false
    setIsDirty(false)
    setSaving(false)
  }

  function doSave() {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      // Guard 0: durante apply de undo/redo, NUNCA salva. loadFromJSON dispara
      // object:added/modified que poderiam acionar saves com canvas em estado
      // transitorio (sem __assetId restaurados, sem bg, etc).
      if (isApplyingHistory.current) {
        console.warn("[doSave] abortado — undo/redo em andamento")
        return
      }
      // Guard 1: se o init nao terminou (ou se o cleanup ja rodou), aborta.
      // Sem isso, um timer que ficou pendurado dispara depois que o useEffect re-rodou
      // mas antes do init recarregar todos os layers, gravando layers: [] no banco.
      if (!isInitialized.current) {
        console.warn("[doSave] abortado — init nao terminou (canvas em re-mount)")
        return
      }
      // Se há propagação de texto em curso (PUT asset migrando styles em todos escopos),
      // adia o save: rodar agora salvaria layers com styles em índices errados.
      if (pendingTextPropagation.current) {
        // Reagendar daqui a 200ms até liberar
        saveTimer.current = setTimeout(() => doSave(), 200)
        return
      }
      const fc = fabricRef.current
      if (!fc) return
      setSaving(true)

      if (pieceId && pieceRef.current) {
        // MODO PEÇA v2: salva layers[] com posicoes + overrides
        const p = pieceRef.current
        const oldData = typeof p.data === "string" ? JSON.parse(p.data) : (p.data ?? {})

        const newLayers = fc.getObjects()
          .filter((o: any) => {
            if (o.__isBg) return false
            // CRITICO (defesa em profundidade): bloqueia salvar objetos sem __assetId
            // no banco. Sem o vinculo com Asset, no proximo load assetMap[null]=undefined
            // e o layer e PULADO -> texto "desaparece" da peca. Caminhos que poderiam
            // criar objetos sem __assetId: copy/paste mal feito, drag-from-asset com
            // bug, manipulacao manual via DevTools. Loga warning pra detectar.
            if (!o.__assetId) {
              console.warn("[PIECE-SAVE] objeto sem __assetId BLOQUEADO:", {
                type: o.type, text: (o as any).text?.slice(0, 30),
                left: o.left, top: o.top,
              })
              return false
            }
            return true
          })
          .map((o: any, i: number) => {
            const layer: any = {
              assetId: o.__assetId,
              posX: Math.round(o.left ?? 0),
              posY: Math.round(o.top ?? 0),
              scaleX: o.scaleX ?? 1,
              scaleY: o.scaleY ?? 1,
              rotation: o.angle ?? 0,
              zIndex: i,
              width: Math.round(o.width ?? 400),
              height: Math.round(o.height ?? 100),
              overrides: {},
            }
            // Captura overrides para textos (cor, tamanho, fonte, peso, espacamento, entrelinha, alinhamento, styles per-char)
            if (o.type === "textbox" || o.type === "i-text") {
              layer.overrides.fill = o.fill
              layer.overrides.fontSize = o.fontSize
              layer.overrides.fontFamily = o.fontFamily
              layer.overrides.fontWeight = o.fontWeight
              if (o.charSpacing !== undefined) layer.overrides.charSpacing = o.charSpacing
              if (o.lineHeight !== undefined) layer.overrides.lineHeight = o.lineHeight
              if (o.textAlign !== undefined) layer.overrides.textAlign = o.textAlign
              if ((o as any).leadingPt !== undefined && (o as any).leadingPt !== null) {
                layer.overrides.leadingPt = (o as any).leadingPt
              }
              if (o.styles && Object.keys(o.styles).length > 0) layer.overrides.styles = o.styles
            }
            return layer
          })

        const newData = {
          ...oldData,
          version: 2,
          width: canvasWRef.current,
          height: canvasHRef.current,
          bgColor: bgColorRef.current,
          layers: newLayers,
        }
        console.log("[PIECE-SAVE]", {
          pieceId,
          layersCount: newLayers.length,
          textLayers: newLayers
            .filter((l: any) => l.overrides && (l.overrides.fontSize !== undefined || l.overrides.fontFamily !== undefined))
            .map((l: any) => ({
              assetId: l.assetId,
              fontSize: l.overrides.fontSize,
              fontFamily: l.overrides.fontFamily,
              fontWeight: l.overrides.fontWeight,
              fill: l.overrides.fill,
              hasStyles: !!l.overrides.styles && Object.keys(l.overrides.styles).length > 0,
            })),
        })
        await fetch(`/api/pieces/${pieceId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: JSON.stringify(newData) })
        })
        await uploadPieceThumb(fc, pieceId)
        isDirtyRef.current = false
        setIsDirty(false)
      } else {
        // MODO MATRIZ
        const layersToSave: any[] = fc.getObjects()
          .filter((o: any) => {
            if (o.__isBg) return false
            if (!o.__assetId) {
              console.warn("[SAVE-MATRIX-2] objeto sem __assetId ignorado:", o.type, { left: o.left, top: o.top })
              return false
            }
            return true
          })
          .map((o: any, i: number) => {
            const layer: any = {
              assetId: o.__assetId,
              posX: Math.round(o.left ?? 0),
              posY: Math.round(o.top ?? 0),
              scaleX: o.scaleX ?? 1,
              scaleY: o.scaleY ?? 1,
              rotation: o.angle ?? 0,
              zIndex: i,
              width: Math.round(o.width ?? 400),
              height: Math.round((o.height ?? 300) * (o.scaleY ?? 1)),
              overrides: {},
            }
            // Captura overrides para textos: cor, fonte, tamanho, peso, espacamento, alinhamento, styles per-char
            // Igual peça - matriz tambem persiste essas customizações localmente sem depender do asset
            if (o.type === "textbox" || o.type === "i-text") {
              layer.overrides.fill = o.fill
              layer.overrides.fontSize = o.fontSize
              layer.overrides.fontFamily = o.fontFamily
              layer.overrides.fontWeight = o.fontWeight
              if (o.charSpacing !== undefined) layer.overrides.charSpacing = o.charSpacing
              if (o.lineHeight !== undefined) layer.overrides.lineHeight = o.lineHeight
              if (o.textAlign !== undefined) layer.overrides.textAlign = o.textAlign
              if ((o as any).leadingPt !== undefined && (o as any).leadingPt !== null) {
                layer.overrides.leadingPt = (o as any).leadingPt
              }
              if (o.styles && Object.keys(o.styles).length > 0) layer.overrides.styles = o.styles
            }
            return layer
          })
        // Circuit breaker: se o save tentaria gravar matriz VAZIA mas o KV anterior tinha
        // layers, eh quase certamente um init incompleto disparando save por engano. Aborta
        // pra nao perder o trabalho. O usuario pode esvaziar de propriedade clicando em Apagar
        // em cada layer (passa por moveLayer/remove + doSave com canvas ja inicializado).
        if (layersToSave.length === 0) {
          const previousLayers = (campaignRef.current?.keyVision?.layers as any) ?? []
          const hadLayers = Array.isArray(previousLayers) && previousLayers.length > 0
          if (hadLayers) {
            console.warn("[SAVE-MATRIX-2] abortado — tentaria gravar layers:[] sobre KV que tinha", previousLayers.length, "layers. Provavel race condition.")
            setSaving(false)
            return
          }
        }
        await fetch(`/api/campaigns/${campaignId}/key-vision`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bgColor: bgColorRef.current, layers: layersToSave, width: canvasWRef.current, height: canvasHRef.current })
        })

        // Gerar e enviar thumbnail do KV (max 480px maior lado, JPEG 0.85)
        try {
          const thumbScale = Math.min(480 / canvasWRef.current, 480 / canvasHRef.current, 1)
          const dataUrl = fc.toDataURL({ format: "jpeg", quality: 0.85, multiplier: thumbScale / (zoomRef.current || 1) })
          const blob = await (await fetch(dataUrl)).blob()
          const fd = new FormData()
          fd.append("thumbnail", blob, "kv-thumb.jpg")
          await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: fd })
        } catch (e) { console.warn("KV thumb upload failed:", e) }
        isDirtyRef.current = false
        setIsDirty(false)
      }
      setSaving(false)
    }, 800)
  }

  async function addLayer() {
    const fc = fabricRef.current
    const c = campaignRef.current
    const aid = assetIdRef.current
    if (!fc || !c || !aid) return
    const asset = c.assets.find((a: Asset) => a.id === aid)
    if (!asset) return
    await addAssetToCanvas(fc, asset, { posX: 100, posY: 100, width: asset.type === "TEXT" ? 800 : 400, scaleX: 1, scaleY: 1, rotation: 0 })
    fc.renderAll()
    doSave()
  }

  function changeBg(c: string) {
    const bg = bgRef.current; const fc = fabricRef.current
    if (!bg || !fc) return
    bg.set("fill", c); fc.renderAll(); setBgColor(c); bgColorRef.current = c; doSave()
  }

  // Sincroniza hexInput com a cor efetiva (do caractere ou do textbox)
  useEffect(() => {
    const obj = selected as any
    if (!obj) return
    const isText = obj.type === "textbox" || obj.type === "i-text"
    let fill: string | undefined = obj.fill
    if (isText && obj.getSelectionStyles) {
      try {
        if (obj.isEditing && obj.selectionStart !== obj.selectionEnd) {
          const styles = obj.getSelectionStyles(obj.selectionStart, obj.selectionEnd)
          if (styles?.length > 0 && styles[0].fill) fill = styles[0].fill
        } else if (obj.isEditing) {
          const idx = (obj.selectionStart ?? 1) > 0 ? obj.selectionStart - 1 : 0
          const text: string = obj.text ?? ""
          if (idx < text.length) {
            const styles = obj.getSelectionStyles(idx, idx + 1)
            if (styles?.length > 0 && styles[0].fill) fill = styles[0].fill
          }
        } else {
          const text: string = obj.text ?? ""
          if (text.length > 0) {
            const styles = obj.getSelectionStyles(0, text.length)
            if (styles?.length > 0) {
              const fills = new Set(styles.map((s: any) => s.fill ?? obj.fill))
              if (fills.size === 1) fill = [...fills][0] as string
            }
          }
        }
      } catch {}
    }
    if (fill) setHexInput(fill)
  }, [selected, selectedTick])

  // Sincroniza bgHexInput com bgColor
  useEffect(() => { setBgHexInput(bgColor) }, [bgColor])

  // Sincroniza fontSizeInput com o tamanho efetivo do objeto selecionado.
  // - Se ha selecao parcial dentro do textbox: usa fontSize do caractere selecionado
  // - Se nao: usa fontSize raw (sem scale, igual Photoshop mostra)
  // selectedTick refresca em mouseup/keyup/object:modified, garantindo update apos
  // qualquer interacao (mover cursor, escalar pelo box, etc).
  // SKIP se o usuario esta digitando num input do painel — evita sobrescrever digitacao
  // em curso (ex: user tipo "8", reload do useEffect colocaria "5" antigo).
  useEffect(() => {
    if (!selected) return
    // Se um input numerico do painel esta focado, NAO sincroniza — o user esta digitando
    const ae = document.activeElement
    if (ae && ae.tagName === "INPUT" && (ae as HTMLInputElement).type === "number") return

    const obj = selected as any
    const isText = obj.type === "textbox" || obj.type === "i-text"
    let fs: number = obj.fontSize ?? 80
    if (isText && obj.getSelectionStyles) {
      try {
        if (obj.isEditing && obj.selectionStart !== obj.selectionEnd) {
          // edit mode + range: tamanho do range
          const styles = obj.getSelectionStyles(obj.selectionStart, obj.selectionEnd)
          if (styles?.length > 0 && styles[0].fontSize) fs = styles[0].fontSize
        } else if (obj.isEditing) {
          // edit mode + cursor: tamanho do caractere atual
          const idx = (obj.selectionStart ?? 1) > 0 ? obj.selectionStart - 1 : 0
          const text: string = obj.text ?? ""
          if (idx < text.length) {
            const styles = obj.getSelectionStyles(idx, idx + 1)
            if (styles?.length > 0 && styles[0].fontSize) fs = styles[0].fontSize
          }
        } else {
          // caixa selecionada: tamanho do TEXTO INTEIRO se uniforme; senao default
          const text: string = obj.text ?? ""
          if (text.length > 0) {
            const styles = obj.getSelectionStyles(0, text.length)
            if (styles?.length > 0) {
              const sizes = new Set(styles.map((s: any) => s.fontSize ?? obj.fontSize))
              if (sizes.size === 1) fs = [...sizes][0] as number
            }
          }
        }
      } catch {}
    }
    setFontSizeInput(String(Math.round(fs)))

    // Sincroniza leadingInput tambem (Adobe-style: leadingPt explicito ou Auto computado)
    if (isText) {
      const lh = obj.lineHeight ?? 1.16
      const leadingPt = obj.leadingPt
      const effectiveLeading = (leadingPt === undefined || leadingPt === null)
        ? Math.round(lh * fs)
        : leadingPt
      setLeadingInput(String(Math.round(effectiveLeading)))
    }
  }, [selected, selectedTick])

  function applyStyle(key: string, val: any) {
    const fc = fabricRef.current; const obj = selected
    if (!fc || !obj) return
    const value = key === "fontSize" ? Number(val) : val
    const styleKey = key === "fill" ? "fill" : key

    const isText = obj.type === "textbox" || obj.type === "i-text"
    const isEditing = (obj as any).isEditing
    const selStart = obj.selectionStart ?? 0
    const selEnd = obj.selectionEnd ?? 0
    const hasSelection = isEditing && selStart !== selEnd

    if (isText && hasSelection) {
      // Photoshop: aplica so nos caracteres selecionados
      obj.setSelectionStyles({ [styleKey]: value }, selStart, selEnd)
      // initDimensions so eh necessario quando mudanca afeta layout (fontSize, fontFamily).
      // Mudar cor (fill) nao muda layout — chamar initDimensions a toa pode trigger bugs
      // (ex: ate observado que pode "comer" espacos em algumas situacoes de styles per-char).
      if (styleKey !== "fill" && (obj as any).initDimensions) (obj as any).initDimensions()
    } else if (isText) {
      // Aplica como default do textbox. Caracteres com override per-char MANTEM seu estilo
      // (igual Photoshop: mudar a cor padrao nao apaga as cores das letras especificas).
      obj.set(styleKey, value)
      // Adobe-style: leading e fontSize sao independentes. Quando muda fontSize, o leadingPt
      // (em pontos absolutos) fica congelado, mas o lineHeight do Fabric (multiplicador)
      // precisa recalcular pra renderizar com o leading correto.
      if (styleKey === "fontSize") syncLineHeightFromLeading(obj)
      if (styleKey !== "fill" && (obj as any).initDimensions) (obj as any).initDimensions()
    } else {
      obj.set(styleKey, value)
    }

    obj.setCoords()
    fc.renderAll()
    // Mantém a referencia REAL do Fabric (sem proxy zumbi).
    // Para forcar re-render do painel, incrementa um contador separado.
    setSelectedTick(t => t + 1)
    doSave()
  }

  /**
   * Aplica propriedade no textbox INTEIRO, ignorando selecao parcial.
   * Usado pra textAlign — Fabric nao suporta esses per-char.
   */
  function applyTextboxStyle(key: string, value: any) {
    const fc = fabricRef.current; const obj = selected
    if (!fc || !obj) return
    const isText = (obj as any).type === "textbox" || (obj as any).type === "i-text"
    if (!isText) return
    ;(obj as any).set(key, value)
    if ((obj as any).initDimensions) (obj as any).initDimensions()
    ;(obj as any).setCoords()
    fc.renderAll()
    setSelectedTick(t => t + 1)
    doSave()
  }

  /**
   * Sincroniza Fabric.lineHeight a partir do modelo de tipografia (Adobe-style):
   *   - Se leadingPt definido: lineHeight = leadingPt / fontSize
   *   - Se Auto (leadingPt undefined/null): lineHeight = 1.2 (~120%)
   *
   * Detalhe interno do motor — chamado quando muda leadingPt OU quando muda fontSize.
   * Usuario nao "sente" isso, ele soh pensa em pontos absolutos ou Auto.
   */
  function syncLineHeightFromLeading(obj: any) {
    if (!obj) return
    const isText = obj.type === "textbox" || obj.type === "i-text"
    if (!isText) return
    const fs = obj.fontSize ?? 48
    const leadingPt = obj.leadingPt
    const lh = (leadingPt === undefined || leadingPt === null)
      ? 1.2
      : leadingPt / fs
    obj.set("lineHeight", lh)
  }

  /**
   * Define leading em pontos (Adobe-style). Pass null pra resetar pra "Auto".
   * Leading e fontSize sao independentes — mudar um nao mexe no outro.
   */
  function setLeading(pt: number | null) {
    const fc = fabricRef.current; const obj = selected as any
    if (!fc || !obj) return
    const isText = obj.type === "textbox" || obj.type === "i-text"
    if (!isText) return
    if (pt === null) delete obj.leadingPt
    else obj.leadingPt = pt
    syncLineHeightFromLeading(obj)
    if (obj.initDimensions) obj.initDimensions()
    obj.setCoords()
    fc.renderAll()
    setSelectedTick(t => t + 1)
    doSave()
  }

  function changeZoom(delta: number) {
    const fc = fabricRef.current; if (!fc) return
    applyZoom(fc, Math.min(3, Math.max(0.05, zoomRef.current + delta)))
  }

  /**
   * Troca o asset associado a um objeto preservando seu transform
   * (left/top/scale/angle/width). Util pra "Trocar asset" no painel:
   * usuario reposicionou o layer e quer trocar o conteudo sem perder
   * o trabalho de layout.
   *
   * Apenas swaps entre assets do MESMO tipo (texto<->texto, imagem<->imagem).
   * Filtragem feita na UI (PropertiesPanel/dropdown).
   */
  async function swapAsset(currentObj: any, newAsset: Asset) {
    const fc = fabricRef.current
    if (!fc || !currentObj || !newAsset) return
    if (currentObj.__assetId === newAsset.id) return // no-op

    // Captura transform + overrides de estilo do objeto atual
    const overrides: any = {}
    if (currentObj.type === "textbox" || currentObj.type === "i-text") {
      if (currentObj.fill !== undefined) overrides.fill = currentObj.fill
      if (currentObj.fontSize !== undefined) overrides.fontSize = currentObj.fontSize
      if (currentObj.fontFamily !== undefined) overrides.fontFamily = currentObj.fontFamily
      if (currentObj.fontWeight !== undefined) overrides.fontWeight = currentObj.fontWeight
      if (currentObj.charSpacing !== undefined) overrides.charSpacing = currentObj.charSpacing
      if (currentObj.lineHeight !== undefined) overrides.lineHeight = currentObj.lineHeight
      if (currentObj.textAlign !== undefined) overrides.textAlign = currentObj.textAlign
      if ((currentObj as any).leadingPt !== undefined && (currentObj as any).leadingPt !== null) overrides.leadingPt = (currentObj as any).leadingPt
      if (currentObj.styles && Object.keys(currentObj.styles).length > 0) overrides.styles = currentObj.styles
    }

    const layerSpec = {
      posX: currentObj.left ?? 0,
      posY: currentObj.top ?? 0,
      width: currentObj.width ?? 400,
      height: currentObj.height ?? 100,
      scaleX: currentObj.scaleX ?? 1,
      scaleY: currentObj.scaleY ?? 1,
      rotation: currentObj.angle ?? 0,
      overrides,
    }

    // Remove o atual e adiciona o novo asset com mesmo transform.
    // addAssetToCanvas faz fc.add(newObj) — nao retorna referencia.
    // Pego o ultimo objeto adicionado pra selecionar como ativo.
    const beforeIds = new Set(fc.getObjects())
    fc.remove(currentObj)
    await addAssetToCanvas(fc, newAsset, layerSpec)
    fc.requestRenderAll()
    const newObj = fc.getObjects().find((o: any) => !beforeIds.has(o))
    if (newObj) {
      fc.setActiveObject(newObj)
      fc.fire("object:modified", { target: newObj })
    }
  }

  if (!campaign) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#1a1a1a", color: "#888", fontSize: 14 }}>
      Carregando...
    </div>
  )

  const isText = selected && (selected.type === "textbox" || selected.type === "i-text")
  const pS = { position: "fixed" as const, top: 0, bottom: 0, background: "rgba(18,18,18,0.97)", backdropFilter: "blur(12px)", zIndex: 100, display: "flex", flexDirection: "column" as const, overflowY: "auto" as const }
  const bS = { background: "transparent", border: "none", cursor: "pointer", color: "#aaa", fontSize: 18, padding: "0 4px" } as React.CSSProperties
  const inpS = { width: "100%", background: "#111", border: "1px solid #2a2a2a", color: "white", fontSize: 12, padding: "5px 8px", borderRadius: 4, outline: "none" } as React.CSSProperties
  const secS = { fontSize: 10, fontWeight: 700 as const, textTransform: "uppercase" as const, letterSpacing: "0.8px", color: "#555", marginBottom: 8 }

  return (
    <div ref={wrapperRef} style={{ position: "fixed", inset: 0, background: "#1e1e1e", overflow: "hidden" }}>
      <div style={{
        position: "absolute",
        left: LW, top: TH + BH, right: PW, bottom: 0,
        overflow: "auto",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ boxShadow: "0 8px 64px rgba(0,0,0,0.8)", lineHeight: 0, flexShrink: 0 }}>
          <canvas ref={canvasRef} style={{ display: "block" }} />
        </div>
      </div>

      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: TH, background: "rgba(17,17,17,0.98)", borderBottom: "1px solid #2a2a2a", display: "flex", alignItems: "center", padding: "0 16px", gap: 12, zIndex: 200 }}>
        <button onClick={() => {
          // Quando o editor foi aberto a partir da apresentacao (?from=presentation),
          // o botao volta pra apresentacao em vez da pagina geral da campanha.
          const dest = from === "presentation"
            ? `/campaigns/${campaignId}/presentation`
            : `/campaigns/${campaignId}`
          const go = () => router.push(dest)
          if (isDirtyRef.current) setConfirmExit(() => go)
          else go()
        }} style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "6px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#111" }}
          title={from === "presentation" ? "Voltar para a apresentacao" : "Voltar para a campanha"}>
          {from === "presentation" ? "← Voltar para apresentação" : "← Voltar para campanha"}
        </button>
        <button onClick={() => {
          const go = () => router.push(`/campaigns/${campaignId}/assets`)
          if (isDirtyRef.current) setConfirmExit(() => go)
          else go()
        }} style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", color: "#aaa" }}
          title="Ir para a pagina de assets desta campanha">
          Assets
        </button>
        <span style={{ fontSize: 13, color: "#888", marginLeft: 4 }}>{isPieceMode && piece ? piece.name : campaign.name}</span>
        <div style={{ flex: 1 }} />
        {saving && <span style={{ fontSize: 11, color: "#555" }}>Salvando...</span>}
        <span style={{ fontSize: 11, color: "#555" }}>{canvasW} × {canvasH}</span>
        <button
          onClick={undo}
          title="Desfazer (Cmd+Z)"
          disabled={undoStack.current.length < 2}
          style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "6px 10px", fontSize: 13, cursor: undoStack.current.length < 2 ? "not-allowed" : "pointer", color: undoStack.current.length < 2 ? "#444" : "#aaa", opacity: undoStack.current.length < 2 ? 0.5 : 1 }}
        >↶</button>
        <button
          onClick={redo}
          title="Refazer (Cmd+Shift+Z)"
          disabled={redoStack.current.length === 0}
          style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "6px 10px", fontSize: 13, cursor: redoStack.current.length === 0 ? "not-allowed" : "pointer", color: redoStack.current.length === 0 ? "#444" : "#aaa", opacity: redoStack.current.length === 0 ? 0.5 : 1 }}
        >↷</button>
        <button
          onClick={async () => {
            // Salvar antes de exportar
            await saveNow()
            if (isPieceMode && piece) {
              setExportPieces([{
                id: piece.id, name: piece.name, data: piece.data,
                width: canvasWRef.current, height: canvasHRef.current,
              }])
              setExportOpen(true)
              return
            }
            // Modo matriz (KV): exporta SO O KV, nao todas as pecas geradas.
            // Constroi pseudo-piece a partir do estado atual do canvas (layers + bg).
            try {
              const fc = fabricRef.current
              if (!fc) { alert("Canvas indisponivel"); return }
              const W = canvasWRef.current
              const H = canvasHRef.current
              const layers = fc.getObjects()
                .filter((o: any) => !o.__isBg && o.__assetId)
                .map((o: any, i: number) => {
                  const isText = o.type === "textbox" || o.type === "i-text"
                  const overrides: any = {}
                  if (isText) {
                    overrides.content = o.text
                    if (o.fill) overrides.fill = o.fill
                    if (o.fontSize) overrides.fontSize = o.fontSize
                    if (o.fontFamily) overrides.fontFamily = o.fontFamily
                    if (o.fontWeight) overrides.fontWeight = o.fontWeight
                    if (o.fontStyle) overrides.fontStyle = o.fontStyle
                    if (o.textAlign) overrides.textAlign = o.textAlign
                    if (o.lineHeight !== undefined) overrides.lineHeight = o.lineHeight
                    if (o.styles && Object.keys(o.styles).length) overrides.styles = o.styles
                    if ((o as any).leadingPt !== undefined) overrides.leadingPt = (o as any).leadingPt
                  }
                  return {
                    assetId: o.__assetId,
                    posX: Math.round(o.left ?? 0),
                    posY: Math.round(o.top ?? 0),
                    scaleX: o.scaleX ?? 1,
                    scaleY: o.scaleY ?? 1,
                    rotation: o.angle ?? 0,
                    zIndex: i,
                    width: Math.round(o.width ?? 400),
                    height: Math.round(o.height ?? 100),
                    overrides,
                  }
                })
              const pseudoData = {
                version: 2,
                width: W, height: H,
                bgColor: bgColorRef.current,
                layers,
                sourceWidth: W,
                sourceHeight: H,
              }
              setExportPieces([{
                id: `kv-${campaignId}`,
                name: `${campaign.name} (Key Vision)`,
                data: pseudoData,
                width: W, height: H,
              }])
              setExportOpen(true)
            } catch (e) {
              console.error("[KV-EXPORT] falha", e)
              alert("Falha ao preparar exportacao do Key Vision")
            }
          }}
          style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "6px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", color: "#aaa" }}
          title={isPieceMode ? "Exportar esta peca" : "Exportar Key Vision (matriz)"}
        >
          Exportar
        </button>
        <button
          onClick={saveNow}
          disabled={saving}
          style={{
            background: saving ? "#2a2a2a" : "white",
            border: "1px solid #333",
            borderRadius: 6, padding: "6px 14px",
            fontWeight: 600, fontSize: 13,
            cursor: saving ? "wait" : "pointer",
            color: saving ? "#888" : "#111",
          }}
        >
          {saving ? "Salvando..." : "💾 Salvar"}
        </button>
        {!isPieceMode && (
          <button onClick={() => setModal(true)} style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "6px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#111" }}>▶ Gerar Peças</button>
        )}
      </div>

      <div style={{ position: "fixed", top: TH, left: LW, right: PW, height: BH, background: "rgba(26,26,26,0.98)", borderBottom: "1px solid #2a2a2a", display: "flex", alignItems: "center", padding: "0 16px", gap: 8, zIndex: 200, overflowX: "auto" }}>
        <span style={{ fontSize: 11, color: "#555", fontWeight: 600, flexShrink: 0 }}>Asset:</span>
        <select value={assetId} onChange={e => { setAssetId(e.target.value); assetIdRef.current = e.target.value }}
          style={{ background: "#222", color: "white", border: "1px solid #333", borderRadius: 4, padding: "4px 8px", fontSize: 12, maxWidth: 260 }}>
          {campaign.assets.map((a: Asset) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <button onClick={addLayer} style={{ background: "#F5C400", color: "#111", border: "none", padding: "5px 14px", borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Adicionar ao canvas</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => changeZoom(-0.1)} style={bS}>−</button>
        <span style={{ fontSize: 11, color: "#555", minWidth: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => changeZoom(+0.1)} style={bS}>+</button>
      </div>

      <div style={{ ...pS, left: 0, width: LW, borderRight: "1px solid #2a2a2a", paddingTop: TH }}>
        <div style={{ padding: "10px 14px", ...secS, borderBottom: "1px solid #2a2a2a", marginBottom: 0 }}>Layers</div>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {!layers.length && <div style={{ fontSize: 11, color: "#444", textAlign: "center", padding: "24px 12px" }}>Adicione assets ao canvas</div>}
          {layers.map((layer, i) => {
            const isSel = selected === layer.obj
            const layerAssetId = layer.obj?.__assetId
            const isEditingThis = editingLayerAssetId && layerAssetId === editingLayerAssetId
            return (
              <div key={i} onClick={() => { if (isEditingThis) return; fabricRef.current?.setActiveObject(layer.obj); fabricRef.current?.renderAll(); setSelected(layer.obj) }}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 8px 8px 12px", cursor: isEditingThis ? "default" : "pointer", borderLeft: isSel ? "2px solid #F5C400" : "2px solid transparent", background: isSel ? "rgba(245,196,0,0.08)" : "transparent" }}>
                <div style={{ width: 7, height: 7, borderRadius: 2, background: layer.type === "textbox" ? "#F5C400" : "#86efac", flexShrink: 0 }} />
                {isEditingThis ? (
                  <input
                    autoFocus
                    defaultValue={layer.label}
                    onClick={e => e.stopPropagation()}
                    onBlur={async e => {
                      const v = e.target.value.trim()
                      if (v && v !== layer.label) await renameLayer(layer.obj, v)
                      setEditingLayerAssetId(null)
                    }}
                    onKeyDown={async e => {
                      if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur() }
                      else if (e.key === "Escape") { e.preventDefault(); setEditingLayerAssetId(null) }
                    }}
                    style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#fff", background: "#0d0d0d", border: "1px solid #F5C400", borderRadius: 3, padding: "2px 6px", outline: "none", fontFamily: "inherit" }}
                  />
                ) : (
                  <span
                    title="Duplo clique para renomear"
                    onDoubleClick={e => { e.stopPropagation(); if (layerAssetId) setEditingLayerAssetId(layerAssetId) }}
                    style={{ fontSize: 12, color: isSel ? "#fff" : "#888", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}
                  >{layer.label}</span>
                )}
                <button title="Mover para cima" onClick={e => { e.stopPropagation(); moveLayer(layer.obj, "up") }}
                  style={{ color: "#666", background: "transparent", border: "none", cursor: "pointer", fontSize: 11, padding: "2px 4px", lineHeight: 1 }}>▲</button>
                <button title="Mover para baixo" onClick={e => { e.stopPropagation(); moveLayer(layer.obj, "down") }}
                  style={{ color: "#666", background: "transparent", border: "none", cursor: "pointer", fontSize: 11, padding: "2px 4px", lineHeight: 1 }}>▼</button>
                <button title="Remover" onClick={e => { e.stopPropagation(); fabricRef.current?.remove(layer.obj); fabricRef.current?.renderAll(); setSelected(null); doSave() }}
                  style={{ color: "#555", background: "transparent", border: "none", cursor: "pointer", fontSize: 12, padding: "2px 4px", lineHeight: 1 }}>✕</button>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ ...pS, right: 0, width: PW, borderLeft: "1px solid #2a2a2a", paddingTop: TH }}>
        <div style={{ padding: "12px 16px", ...secS, borderBottom: "1px solid #2a2a2a", marginBottom: 0 }}>Propriedades</div>
        {!selected ? (
          <div style={{ padding: 16 }}>
            <div style={{ ...secS, color: "#F5C400", marginBottom: 12 }}>Background</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <label style={{ width: 36, height: 36, borderRadius: 6, background: bgColor, border: "1px solid #333", flexShrink: 0, cursor: "pointer", position: "relative", overflow: "hidden" }}>
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(bgColor) ? bgColor : "#ffffff"}
                  onChange={e => changeBg(e.target.value)}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", border: 0 }}
                />
              </label>
              <input
                type="text"
                value={bgHexInput}
                onChange={e => {
                  const v = e.target.value
                  setBgHexInput(v)
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) changeBg(v)
                }}
                onBlur={() => {
                  if (!/^#[0-9a-fA-F]{6}$/.test(bgHexInput)) setBgHexInput(bgColor)
                }}
                placeholder="#RRGGBB"
                style={{ ...inpS, fontFamily: "monospace", fontSize: 13, textTransform: "uppercase" }}
              />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SWATCHES.map(c => (
                <div key={c} onClick={() => changeBg(c)}
                  style={{ width: 26, height: 26, borderRadius: 5, background: c, cursor: "pointer", border: bgColor.toLowerCase() === c.toLowerCase() ? "2px solid #F5C400" : "2px solid #2a2a2a" }} />
              ))}
            </div>
          </div>
        ) : isText ? (
          (() => {
            // Quando ha selecao parcial dentro do textbox em modo edicao, le os estilos
            // do caractere onde o cursor esta — nao do objeto inteiro. Garante que o
            // painel reflete a fonte aplicada na selecao quando o texto tem partes em
            // pesos/fontes diferentes (ex: parte Helvetica Bold, parte Helvetica Regular).
            const isEditingText = (selected as any).isEditing
            const selStart = (selected as any).selectionStart ?? 0
            const selEnd = (selected as any).selectionEnd ?? 0
            const hasInlineSelection = isEditingText && selStart !== selEnd
            const isText = selected.type === "textbox" || selected.type === "i-text"
            let effectiveFontFamily = selected.fontFamily ?? "Arial"
            let effectiveFontSize = selected.fontSize ?? 80
            let effectiveFill = selected.fill ?? "#111111"
            // Detector de "valor misto" — quando o texto tem partes com fontes/tamanhos/cores
            // diferentes, painel mostra placeholder em vez de um valor incorreto.
            let mixedFontFamily = false
            let mixedFontSize = false
            let mixedFill = false
            // lineHeight e textAlign sao propriedades do textbox inteiro (Fabric nao suporta
            // per-char nelas), entao nao tentam ler de getSelectionStyles.
            const effectiveLineHeight: number = (selected as any).lineHeight ?? 1.16
            const effectiveTextAlign: string = (selected as any).textAlign ?? "left"
            // Photoshop-style leading em pt:
            // - Se leadingPt foi definido: usa direto
            // - Senao: "Auto" = lineHeight × fontSize (calculo, mostrado em cinza)
            const leadingPtRaw: number | undefined = (selected as any).leadingPt
            const isLeadingAuto = leadingPtRaw === undefined || leadingPtRaw === null
            const effectiveLeadingPt: number = isLeadingAuto
              ? Math.round(effectiveLineHeight * effectiveFontSize)
              : leadingPtRaw

            // Helper: le estilo "efetivo" de uma faixa de caracteres respeitando overrides
            // per-char. Retorna { fontFamily, fontSize, fill } e flags de mistura.
            // Adobe/Photoshop-style: estilo do caractere = override per-char OU default do box.
            function readRange(start: number, end: number) {
              if (!isText || !(selected as any).getSelectionStyles) return null
              try {
                const styles = (selected as any).getSelectionStyles(start, end) || []
                if (styles.length === 0) return null
                const boxFont = (selected as any).fontFamily
                const boxSize = (selected as any).fontSize
                const boxFill = (selected as any).fill
                const fams = new Set<string>()
                const sizes = new Set<number>()
                const fills = new Set<string>()
                for (const s of styles) {
                  fams.add(s.fontFamily ?? boxFont)
                  sizes.add(s.fontSize ?? boxSize)
                  fills.add(s.fill ?? boxFill)
                }
                return {
                  fontFamily: fams.size === 1 ? [...fams][0] : null,
                  fontSize: sizes.size === 1 ? [...sizes][0] : null,
                  fill: fills.size === 1 ? [...fills][0] : null,
                  mixedFamily: fams.size > 1,
                  mixedSize: sizes.size > 1,
                  mixedFill: fills.size > 1,
                }
              } catch { return null }
            }

            if (hasInlineSelection) {
              // Edit mode + range: le estilo do range (pode ser misto)
              const r = readRange(selStart, selEnd)
              if (r) {
                if (r.fontFamily !== null) effectiveFontFamily = r.fontFamily
                else mixedFontFamily = true
                if (r.fontSize !== null) effectiveFontSize = r.fontSize
                else mixedFontSize = true
                if (r.fill !== null) effectiveFill = r.fill
                else mixedFill = true
              }
            } else if (isEditingText && isText) {
              // Edit mode + cursor (sem range): le do caractere atual (do anterior se cursor no fim)
              const text: string = (selected as any).text ?? ""
              const charIdx = selStart > 0 ? selStart - 1 : 0
              if (charIdx < text.length) {
                const r = readRange(charIdx, charIdx + 1)
                if (r) {
                  if (r.fontFamily !== null) effectiveFontFamily = r.fontFamily
                  if (r.fontSize !== null) effectiveFontSize = r.fontSize
                  if (r.fill !== null) effectiveFill = r.fill
                }
              }
            } else if (isText) {
              // Caixa selecionada (sem edit mode): mostra estilo dominante do TEXTO INTEIRO,
              // nao o default do textbox. Adobe-style: se tem caracteres em "Exo 2", mostra
              // "Exo 2", nao "Arial" (default fictício do box).
              const text: string = (selected as any).text ?? ""
              if (text.length > 0) {
                const r = readRange(0, text.length)
                if (r) {
                  if (r.fontFamily !== null) effectiveFontFamily = r.fontFamily
                  else mixedFontFamily = true
                  if (r.fontSize !== null) effectiveFontSize = r.fontSize
                  else mixedFontSize = true
                  if (r.fill !== null) effectiveFill = r.fill
                  else mixedFill = true
                }
              }
            }
            return (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={secS}>Trocar asset</div>
              <select
                value={(selected as any).__assetId ?? ""}
                onChange={e => {
                  const newAsset = (campaign?.assets ?? []).find(a => a.id === e.target.value)
                  if (newAsset) swapAsset(selected, newAsset)
                }}
                style={{ ...inpS, cursor: "pointer", appearance: "none", paddingRight: 24 }}
              >
                {(campaign?.assets ?? [])
                  .filter(a => a.type === "TEXT")
                  .map(a => (
                    <option key={a.id} value={a.id}>{a.label || a.value || "Sem nome"}</option>
                  ))
                }
              </select>
            </div>
            <div>
              <div style={secS}>Fonte {mixedFontFamily && <span style={{ color: "#888", fontWeight: 400, fontStyle: "italic" }}>(múltiplas)</span>}</div>
              <FontPicker
                value={mixedFontFamily ? "" : effectiveFontFamily}
                onChange={(f) => applyStyle("fontFamily", f)}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={secS}>Tamanho {mixedFontSize && <span style={{ color: "#888", fontWeight: 400, fontStyle: "italic" }}>(múlt.)</span>}</div>
                <input
                  key={`fs-${(selected as any).__assetId ?? "x"}`}
                  type="number"
                  value={mixedFontSize ? "" : fontSizeInput}
                  placeholder={mixedFontSize ? "—" : ""}
                  onChange={e => {
                    const raw = e.target.value
                    setFontSizeInput(raw)
                    const n = Number(raw)
                    if (Number.isFinite(n) && n > 0) applyStyle("fontSize", n)
                  }}
                  onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                  style={inpS}
                />
              </div>
              <div>
                <div style={secS}>Peso</div>
                <WeightPicker value={effectiveFontFamily} onChange={(f) => applyStyle("fontFamily", f)} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                {[0.2, 0.4, 0.6, 0.8].map(pct => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => scaleLayerToCanvas(pct)}
                    title={`Escala o layer pra ${Math.round(pct * 100)}% do canvas (centralizado)`}
                    style={{ background: "#222", border: "1px solid #2a2a2a", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#aaa" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.color = "#fff" }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.color = "#aaa" }}
                  >
                    {Math.round(pct * 100)}%
                  </button>
                ))}
              </div>
              <button onClick={fitLayerToCanvas}
                style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#111" }}
                title="Escala e centraliza o layer dentro da peça (100%)">
                Encaixar no canvas
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={secS}>Entrelinhas</div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input
                    key={`lh-${(selected as any).__assetId ?? "x"}`}
                    type="number"
                    step="1"
                    value={leadingInput}
                    onChange={e => {
                      const raw = e.target.value
                      setLeadingInput(raw)
                      const n = Number(raw)
                      if (Number.isFinite(n) && n > 0) setLeading(n)
                    }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                    title={isLeadingAuto ? `Auto (${Math.round(effectiveLeadingPt)}pt) — Option+↑/↓ ajusta` : "Option+↑/↓ ajusta (Shift = 10pt)"}
                    style={{ ...inpS, color: isLeadingAuto ? "#888" : "white" }}
                  />
                  <button type="button"
                    onClick={() => setLeading(null)}
                    disabled={isLeadingAuto}
                    title="Resetar pra Auto"
                    style={{
                      width: 28, height: 28, fontSize: 11,
                      background: isLeadingAuto ? "#1a1a1a" : "#111",
                      border: "1px solid #2a2a2a", color: isLeadingAuto ? "#444" : "#888",
                      borderRadius: 4, cursor: isLeadingAuto ? "default" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                    A
                  </button>
                </div>
              </div>
              <div>
                <div style={secS}>Alinhamento</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {[
                    { v: "left", icon: "⫷", title: "Esquerda (Cmd+Shift+L)" },
                    { v: "center", icon: "≡", title: "Centro (Cmd+Shift+C)" },
                    { v: "right", icon: "⫸", title: "Direita (Cmd+Shift+R)" },
                    { v: "justify", icon: "☰", title: "Justificar (Cmd+Shift+J)" },
                  ].map(a => {
                    const active = effectiveTextAlign === a.v
                    return (
                      <button key={a.v} type="button"
                        onClick={() => applyTextboxStyle("textAlign", a.v)}
                        title={a.title}
                        style={{
                          flex: 1, height: 28,
                          background: active ? "#F5C400" : "#111",
                          border: active ? "none" : "1px solid #2a2a2a",
                          color: active ? "#111" : "white",
                          borderRadius: 4, cursor: "pointer",
                          fontSize: 14, fontWeight: 700,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                        {a.icon}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            <div>
              <div style={secS}>Cor {mixedFill && <span style={{ color: "#888", fontWeight: 400, fontStyle: "italic" }}>(múltiplas)</span>}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <label style={{
                  width: 36, height: 36, borderRadius: 6,
                  backgroundImage: mixedFill ? "linear-gradient(135deg, #aaa 25%, #ccc 25%, #ccc 50%, #aaa 50%, #aaa 75%, #ccc 75%)" : "none",
                  backgroundColor: mixedFill ? undefined : effectiveFill,
                  backgroundSize: mixedFill ? "8px 8px" : undefined,
                  border: "1px solid #333", flexShrink: 0, cursor: "pointer", position: "relative", overflow: "hidden",
                }}>
                  <input
                    type="color"
                    value={effectiveFill.length === 7 ? effectiveFill : "#111111"}
                    onChange={e => applyStyle("fill", e.target.value)}
                    style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", border: 0 }}
                  />
                </label>
                <input
                  type="text"
                  value={mixedFill ? "" : hexInput}
                  placeholder={mixedFill ? "—" : "#RRGGBB"}
                  onChange={e => {
                    const v = e.target.value
                    setHexInput(v)
                    if (/^#[0-9a-fA-F]{6}$/.test(v)) applyStyle("fill", v)
                  }}
                  onBlur={() => {
                    if (!/^#[0-9a-fA-F]{6}$/.test(hexInput)) setHexInput(selected.fill ?? "#111111")
                  }}
                  style={{ ...inpS, fontFamily: "monospace", fontSize: 13, textTransform: "uppercase" }}
                />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {SWATCHES.map(c => (
                  <div key={c} onClick={() => applyStyle("fill", c)}
                    style={{ width: 24, height: 24, borderRadius: 4, background: c, cursor: "pointer", border: (selected.fill ?? "").toLowerCase() === c.toLowerCase() ? "2px solid #F5C400" : "2px solid #2a2a2a" }} />
                ))}
              </div>
            </div>
          </div>
            )
          })()
        ) : (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontWeight: 600, color: "#888", fontSize: 13 }}>{selected.__assetLabel ?? "Elemento"}</div>
            <div>
              <div style={secS}>Trocar asset</div>
              <select
                value={(selected as any).__assetId ?? ""}
                onChange={e => {
                  const newAsset = (campaign?.assets ?? []).find(a => a.id === e.target.value)
                  if (newAsset) swapAsset(selected, newAsset)
                }}
                style={{ ...inpS, cursor: "pointer", appearance: "none", paddingRight: 24 }}
              >
                {(campaign?.assets ?? [])
                  .filter(a => a.type === "IMAGE")
                  .map(a => (
                    <option key={a.id} value={a.id}>{a.label || "Sem nome"}</option>
                  ))
                }
              </select>
            </div>
            <div style={{ color: "#444", fontSize: 11 }}>Mova e redimensione no canvas.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
              {[0.2, 0.4, 0.6, 0.8].map(pct => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => scaleLayerToCanvas(pct)}
                  title={`Escala o layer pra ${Math.round(pct * 100)}% do canvas (centralizado)`}
                  style={{ background: "#222", border: "1px solid #2a2a2a", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#aaa" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.color = "#fff" }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.color = "#aaa" }}
                >
                  {Math.round(pct * 100)}%
                </button>
              ))}
            </div>
            <button onClick={fitLayerToCanvas}
              style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#111" }}
              title="Escala e centraliza o layer dentro da peça (100%)">
              Encaixar no canvas
            </button>
          </div>
        )}
      </div>

      {confirmExit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#1a1a1a", borderRadius: 10, padding: 24, width: 420, border: "1px solid #333" }}>
            <div style={{ color: "white", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Salvar alterações?</div>
            <div style={{ color: "#888", fontSize: 13, marginBottom: 18 }}>Você tem mudanças não salvas. O que deseja fazer?</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmExit(null)}
                style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "8px 14px", color: "#888", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => { const go = confirmExit; setConfirmExit(null); if (go) go() }}
                style={{ background: "transparent", border: "1px solid #d33", borderRadius: 6, padding: "8px 14px", color: "#d33", fontSize: 13, cursor: "pointer" }}>Descartar</button>
              <button onClick={async () => { const go = confirmExit; setConfirmExit(null); await saveNow(); if (go) go() }}
                style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "8px 14px", color: "#111", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Salvar e sair</button>
            </div>
          </div>
        </div>
      )}

      {exportOpen && exportPieces.length > 0 && (
        <ExportDialog
          pieces={exportPieces}
          campaignName={(campaign as any)?.title ?? (campaign as any)?.name}
          onClose={() => { setExportOpen(false); setExportPieces([]) }}
        />
      )}

      {modal && <GeneratePiecesModal campaignId={campaignId} fabricRef={fabricRef} onClose={() => setModal(false)} onGenerated={() => { setModal(false); router.push(`/pieces?campaignId=${campaignId}`) }} />}
    </div>
  )
}
