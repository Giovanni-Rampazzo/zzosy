"use client"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { GeneratePiecesModal } from "./GeneratePiecesModal"
import { FontPicker, WeightPicker } from "./FontPicker"
import { ExportDialog } from "@/components/pieces/ExportDialog"
import { PsdImporter, type PsdImporterHandle } from "@/components/campaign/PsdImporter"
import { MaskPanel } from "./MaskPanel"
import { ColorSwatchPicker } from "./ColorSwatchPicker"
import { MaskThumb } from "./MaskThumb"
import { migrateStyles } from "@/lib/migrateStyles"
import { buildSpansFromPerChar, spansToText, spansToFullPerChar, spansDefaultStyle } from "@/lib/assetSpans"
import { normalizeName } from "@/lib/normalize"
import { getClipboard, setClipboard } from "@/lib/editorClipboard"
import { applyMaskToFabricObject } from "@/lib/applyMaskToFabric"
import { buildShapePath, type ShapeKind } from "@/lib/shapePaths"
import { inpS, numInpS, secS, numFieldGrid, numFieldRight, numFieldUnit } from "@/lib/editorFieldStyles"
import { leadingPtToFabricLineHeight, applyLeadingPtToFabric } from "@/lib/fabricLineHeight"
import { loadGoogleFont, loadCustomFontFamily, ensurePsdFontsReady, forceLoadFontFaces, GOOGLE_FONTS } from "@/lib/google-fonts"
import { useSetActiveClient } from "@/lib/activeClientContext"
import { editorLog, clampTinyFontSize } from "@/lib/editor/editorLogger"
import type {
  TextSpan, Asset, Layer, BrandColor, CustomFontFile, Campaign,
  BgGradientStop, BgBlendMode, BgLayerCommon, BgImageFit, BgLayerData,
} from "@/lib/editor/types"
// Monkey-patch Fabric pra suportar charSpacing per-char (Adobe-style letter
// spacing por trecho). Side-effect import — roda no module init UMA VEZ.
import "@/lib/fabricCharSpacingPatch"

// Cor representativa do BG (usado pra alimentar espelhos legacy bgColor*Ref).
// Solid: cor direta. Gradient: 1o stop. Image: branco (sem cor representavel).
import {
  bgLayerLegacyColor, migrateBgLayerJson, safeColorString,
  buildBgFill, loadImageElement, applyBgFillAsync, syncBgLayerToRect,
} from "@/lib/editor/bgLayerHelpers"
import { usePanelResize } from "@/lib/editor/usePanelResize"
import {
  syncBrandRefsInTextObjects as syncBrandTextHelper,
  syncBrandRefsInBgLayers as syncBrandBgHelper,
} from "@/lib/editor/brandSyncHelpers"
import { useUndoHistory } from "@/lib/editor/useUndoHistory"
import { useStepsManager } from "@/lib/editor/useStepsManager"
import { useSaveQueue } from "@/lib/editor/saveQueue"

const DEFAULT_W = 1920, DEFAULT_H = 1080
// TH = top bar height. BH = bottom toolbar (sub-controls). Larguras dos
// paineis Layers (esquerda) e Properties (direita) sao geridas em hook
// dedicado — vide @/lib/editor/usePanelResize.
const TH = 48, BH = 44
const _FONTS_LEGACY: string[] = [] // mantido como placeholder - lista de fontes agora vem de @/lib/fonts via FontPicker
const SWATCHES = ["#111111","#ffffff","#F5C400","#e63946","#457b9d","#2a9d8f","#264653","#f4a261","#8338ec","#ff006e","#06d6a0","#118ab2"]

import {
  parseContent, getSpans, textboxToSpans, migrateFlatStylesToLineIndexed,
  spansToTextboxData, serializeTextboxOverrides,
} from "@/lib/editor/textSpans"
import {
  parseSimpleSvgPathToFabric, applyShapePathInPlace, applyStrokePositionVisual,
  serializeShapeOverrides,
} from "@/lib/editor/shapeOverrides"
import { clampTextboxWidth } from "@/lib/editor/textboxWidth"
import {
  psdColorToHex, sampleHexAt, isCanvasUniform, extractPsdBgLayer,
  psdTextLayerToOverride, applyPsdLayerMetadata,
} from "@/lib/editor/psdImport"
import {
  HISTORY_PROPS_TO_INCLUDE, composeRasterMaskIntoImage, createBleedOverlays,
} from "@/lib/editor/canvasOverlays"


export function KeyVisionEditor({ campaignId, pieceId, from, initialStepIndex, openGenerator }: { campaignId: string; pieceId?: string; from?: string; initialStepIndex?: number; openGenerator?: boolean }) {
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fabricRef = useRef<any>(null)
  const psdStepInputRef = useRef<HTMLInputElement>(null)
  // File System Access API: handle pro PSD externo vinculado pra sync.
  // Quando user clica "Editar Externo", exporta PSD + salva via showSaveFilePicker
  // + guarda handle. Botão "Sync" depois re-lê o arquivo (depois do user salvar
  // no Photoshop) e re-importa.
  const externalPsdHandle = useRef<any>(null)
  const [externalPsdName, setExternalPsdName] = useState<string | null>(null)
  const bgRef = useRef<any>(null)
  const campaignRef = useRef<Campaign | null>(null)
  const saveTimer = useRef<any>()
  const savedTextSelection = useRef<{ obj: any; start: number; end: number } | null>(null)
  // Debounce timer pro auto-fit do textbox (text:changed). Sem isso, cada
  // keystroke executava 2x initDimensions + setCoords + requestRenderAll —
  // em textos grandes com styles per-char ficava VISIVELMENTE lento.
  const autoFitTimer = useRef<any>(null)
  // Tick do Properties panel agendado via rAF pra coalescer re-renders.
  const selectedTickRaf = useRef<number | null>(null)
  // Debounce dos PUTs de lastOverride / asset content. Sem debounce, mudar
  // fontSize via input ou aplicar styles em sequencia rapida disparava 1
  // PUT por mudanca — backend ficava sob carga e a UI percebia 'lag'.
  const lastOverridePutTimer = useRef<any>(null)
  const lastOverridePendingPayload = useRef<{ aid: string; payload: any } | null>(null)
  const assetContentPutTimer = useRef<any>(null)
  const assetContentPendingPayload = useRef<{ aid: string; payload: any } | null>(null)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  // Hookea cliente da campaign no TopNav (logo do cliente substitui ZZOSY)
  useSetActiveClient((campaign?.client as any) ? {
    id: (campaign!.client as any).id,
    name: (campaign!.client as any).name ?? "",
    brandLogoUrl: (campaign!.client as any).brandLogoUrl,
  } : null)
  const [piece, setPiece] = useState<any>(null)
  const pieceRef = useRef<any>(null)
  const isPieceMode = !!pieceId
  // STEPS (carrossel Meta etc): cada peca pode ter 1+ steps.
  //
  // Estrutura no piece.data:
  //   {
  //     width, height, bgColor,            // dimens\u00f5es da peca (compartilhadas)
  //     layers: [...],                     // step ATIVO (compat com pecas legadas)
  //     activeStepIndex?: number,          // 0-based; 0 = step 1
  //     steps?: Array<{ layers, bgColor, thumbnailUrl?, imageUrl? }>,
  //                                        // SNAPSHOTS dos steps inativos.
  //                                        // Tamanho = N-1 onde N = total de steps.
  //                                        // Index map: depende do step ativo.
  //   }
  //
  // Como funciona internamente:
  // - Total de steps = 1 + (steps?.length ?? 0)
  // - O step ATIVO esta no canvas + layers.
  // - Os step INATIVOS ficam serializados em steps[].
  // - Ao trocar de step ativo: salva canvas atual em steps[old], carrega steps[new] no canvas.
  //
  // Pra simplicidade no codigo client, mantemos no React state:
  //  - stepCount: total de steps
  //  - activeStepIndex: qual esta sendo editado (0-based)
  //  - inactiveStepsRef: array com OS OUTROS steps (length = stepCount - 1)
  // Steps state/refs em hook (audit #5 extracao). loadStepIntoCanvas + switchToStep
  // + add/removeStep ficam inline — tocam Fabric canvas demais.
  const stepsApi = useStepsManager()
  const stepCount = stepsApi.stepCount
  const activeStepIndex = stepsApi.activeStepIndex
  const stepCountRef = stepsApi.stepCountRef
  const activeStepIndexRef = stepsApi.activeStepIndexRef
  const inactiveStepsRef = stepsApi.inactiveStepsRef
  const setStepCountSync = stepsApi.setStepCountSync
  const setActiveStepIndexSync = stepsApi.setActiveStepIndexSync
  const [selected, setSelected] = useState<any>(null)
  // Toggle do popover de selecionar asset existente — agora disparado pelo
  // botao ASSETS (2026-05-30: user inverteu — antes era no botao +).
  const [showAddAsset, setShowAddAsset] = useState(false)
  // Toggle do dialog "Criar novo asset" — agora disparado pelo botao +.
  // Antes o + abria o popover de selecao; user pediu 2026-05-30 pra inverter:
  // ASSETS = selecionar existente, + = criar novo (text/image/shape).
  const [showCreateAsset, setShowCreateAsset] = useState(false)
  const [createAssetBusy, setCreateAssetBusy] = useState(false)
  const createAssetFileRef = useRef<HTMLInputElement>(null)
  // Step do dialog "Criar novo asset" — substitui prompt() nativo do browser
  // (user 2026-05-30: "a web nao pergunta, quem pergunta e o zzosy").
  type CreateAssetStep = "select" | "text" | "shape"
  const [createAssetStep, setCreateAssetStep] = useState<CreateAssetStep>("select")
  const [createAssetTextValue, setCreateAssetTextValue] = useState("")
  useEffect(() => {
    if (showCreateAsset) { setCreateAssetStep("select"); setCreateAssetTextValue("") }
  }, [showCreateAsset])
  // Modo "place text" (user 2026-05-30): botao T na toolbar bottom ativa.
  // Proximo click no canvas cria Fabric.Textbox naquela posicao + enter
  // editing. Ao sair da edicao, o texto vira ClientLibraryAsset type=TEXT.
  const [placingText, setPlacingText] = useState(false)
  const placingTextRef = useRef(false)
  useEffect(() => { placingTextRef.current = placingText }, [placingText])
  // Ref pra placeTextAtPointer — useEffect mouse:down captura closure antiga,
  // entao precisamos de um ref pra chamar a versao atual da funcao.
  const placeTextAtPointerRef = useRef<((x: number, y: number) => void) | null>(null)
  // Set de IDs de textboxes "freshly placed" (T mode) que devem virar
  // Library asset ao sair da edicao. Sem isso, NAO da pra distinguir
  // textbox de placement vs textbox de asset normal no exited handler.
  const placedTextIdsRef = useRef<Set<string>>(new Set())
  // Auto-dismiss do popover de assets apos 3s sem interacao (user pedido
  // 2026-05-27: 'quando eu clicar em + quero que os assets desaparecam em
  // 3 segundos se ninguem selecionar nenhum'). Pausa enquanto mouse esta
  // sobre o popover; reinicia quando sai.
  const addAssetDismissTimerRef = useRef<number | null>(null)
  const clearAddAssetDismissTimer = useCallback(() => {
    if (addAssetDismissTimerRef.current != null) {
      window.clearTimeout(addAssetDismissTimerRef.current)
      addAssetDismissTimerRef.current = null
    }
  }, [])
  const startAddAssetDismissTimer = useCallback(() => {
    clearAddAssetDismissTimer()
    addAssetDismissTimerRef.current = window.setTimeout(() => {
      setShowAddAsset(false)
      addAssetDismissTimerRef.current = null
    }, 3000)
  }, [clearAddAssetDismissTimer])
  useEffect(() => {
    if (!showAddAsset) {
      clearAddAssetDismissTimer()
      return
    }
    startAddAssetDismissTimer()
    return clearAddAssetDismissTimer
  }, [showAddAsset, startAddAssetDismissTimer, clearAddAssetDismissTimer])
  // Font section ABERTA por DEFAULT (user pedido 2026-05-29: "porque fontes,
  // que e tao importante, esta tao escondida? resolva isso"). Reverte decisao
  // de 2026-05-26 — texto sem ver font/size/weight ao abrir quebra workflow
  // do redator. Eh a propriedade #1 do textbox. MASK fica collapsed (uso menos
  // frequente). Chevron continua pra quem quiser recolher.
  const [fontSectionOpen, setFontSectionOpen] = useState(true)
  // Seletor SOLID/LINEAR/RADIAL no Background panel — SEMPRE visivel
  // (user pedido 2026-05-27 revogou a decisao anterior de 2026-05-23: 'ja
  // pode aparecer tudo de uma vez'). State mantido como const true pra
  // nao precisar editar todos os usos.
  const showBgTypeSelector = true
  // Panels (Layers/Properties): largura + persistencia + drag + Tab toggle
  // encapsulados em hook dedicado (audit #5 extracao 2026-05-29). Refs lidas
  // por closures capturadas em useEffect [campaign] do canvas onResize.
  const panels = usePanelResize()
  const {
    layersPanelWidth, propsPanelWidth,
    layersPanelWidthRef, propsPanelWidthRef,
    effLayersPanelWidth, effPropsPanelWidth,
    effLayersRef, effPropsRef,
    panelsHidden, setPanelsHidden,
    onLayersDragStart, onPropsDragStart,
    resetLayersWidth, resetPropsWidth,
  } = panels
  void layersPanelWidth; void propsPanelWidth // silencia warning quando consumido apenas via JSX/refs
  void layersPanelWidthRef; void propsPanelWidthRef
  // Force-rerender counter pra LayerPanel quando rename precisa atualizar
  // labels alem do refreshLayers normal (defensivo — sintoma 2026-05-23).
  const [layerVersion, setLayerVersion] = useState(0)
  void layerVersion
  // selectedRef: usado em handlers/funcoes (changeBg, addBgLayer, etc) que
  // precisam ler o selected atual sem depender de stale closure de re-renders.
  const selectedRef = useRef<any>(null)
  useEffect(() => { selectedRef.current = selected }, [selected])
  const [hexInput, setHexInput] = useState<string>("#111111")
  const [bgHexInput, setBgHexInput] = useState<string>("#ffffff")
  const [fontSizeInput, setFontSizeInput] = useState<string>("80")
  const [leadingInput, setLeadingInput] = useState<string>("96")
  const [charSpacingInput, setCharSpacingInput] = useState<string>("0")
  // Baseline shift UI input (PSD baselineShift / Fabric deltaY negativo).
  // Adobe-style: pontos positivos elevam o char, negativos rebaixam.
  const [baselineShiftInput, setBaselineShiftInput] = useState<string>("0")
  // Ref pra rastrear se algum input numérico do painel está em digitação.
  // Mais confiável que document.activeElement (que pode estar stale em
  // re-renders concorrentes do React 18). Usado pra impedir o useEffect
  // de sobrescrever fontSizeInput/leadingInput durante a digitação do user.
  const numericInputFocusedRef = useRef(false)
  const [selectedTick, setSelectedTick] = useState(0)
  // Coalesce ticks via rAF (usa selectedTickRaf definido acima) — multiplos
  // eventos no mesmo frame (text:changed + selection:changed + mouseup
  // durante digitacao) geravam N re-renders do Properties panel (huge JSX).
  // Com rAF, todos viram 1 render por frame. Padrao ja existente pra
  // text:changed (linha 2810); helper centraliza pra reuso.
  const scheduleSelectedTick = () => {
    if (selectedTickRaf.current !== null) return
    selectedTickRaf.current = requestAnimationFrame(() => {
      selectedTickRaf.current = null
      setSelectedTick(t => t + 1)
    })
  }
  // Pulse key — incrementa toda vez que um NOVO layer eh selecionado. Usado no
  // painel Layers pra disparar uma animacao breve de glow (cor da marca) que
  // ajuda o user a localizar o layer correspondente apos clicar no canvas.
  // Trocar o `key` da div forca o React a remontar com a animation no inicio.
  const [layerPulseKey, setLayerPulseKey] = useState(0)
  // Quando largura efetiva dos paineis muda, re-dimensiona o Fabric canvas pra
  // preencher a nova area visivel. Sem isso, o canvas DOM mantem o tamanho
  // calculado antes do toggle/resize e nao expande. (usePanelResize ja sincroniza
  // effLayersRef/effPropsRef e ja dispara window.resize event tambem.)
  useEffect(() => {
    const fc = fabricRef.current
    if (!fc) return
    const newAvailW = window.innerWidth - effLayersPanelWidth - effPropsPanelWidth
    const newAvailH = window.innerHeight - TH - BH
    ;(fabricRef as any).__canvasFullW = Math.max(1, newAvailW)
    ;(fabricRef as any).__canvasFullH = Math.max(1, newAvailH)
    fc.setDimensions({ width: Math.round(newAvailW), height: Math.round(newAvailH) })
    applyZoom(fc, zoomRef.current)
  }, [effLayersPanelWidth, effPropsPanelWidth])
  // Estado do drag-and-drop no painel Layers (visualIndex sendo arrastado / sobre)
  const [dragLayerIdx, setDragLayerIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  // Drag de FOLDER inteiro: armazena o path do folder sendo arrastado pra que
  // o drop em outro folder/layer mova o folder completo (com subfolders).
  const [dragFolderPath, setDragFolderPath] = useState<string[] | null>(null)
  // Renaming inline: folder cujo nome esta sendo editado in-place no painel.
  const [renamingFolderKey, setRenamingFolderKey] = useState<string | null>(null)
  // Folder header sob o cursor durante drag (pra magnify dock-style)
  const [dragOverFolderKey, setDragOverFolderKey] = useState<string | null>(null)
  // Posicao do drop dentro do row alvo: "before" (top half) ou "after" (bottom
  // half). Permite distinguir "vai cair entre A e B" (gap), com os dois rows
  // vizinhos sofrendo magnify pra abrir espaco — feedback Photoshop+Dock.
  const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(null)
  const isDirtyRef = useRef(false)
  const [isDirty, setIsDirty] = useState(false)
  // Undo/redo refs + pushHistory encapsulados em hook dedicado (audit #5 ext).
  // applySnapshot/undo/redo permanecem inline — tightly coupled com loadFromJSON,
  // mask rebake, brand resync, saveTimer cancel.
  const history = useUndoHistory({
    fabricRef,
    onMarkDirty: () => {
      isDirtyRef.current = true
      setIsDirty(true)
    },
    getCurrentSelectionIds: (fc) => getCurrentSelectionIds(fc),
  })
  const undoStack = history.undoStack
  const redoStack = history.redoStack
  const isApplyingHistory = history.isApplyingHistory
  const applySnapshotSeq = history.applySnapshotSeq
  const historyTick = history.historyTick
  const setHistoryTick = history.setHistoryTick
  const pushHistory = history.pushHistory
  void historyTick // consumido por JSX dos botoes Undo/Redo via re-render
  void setHistoryTick // chamado por undo/redo abaixo
  const isInitialized = useRef(false)
  // Blob URLs criados via createObjectURL (SVG patcher e similares) precisam
  // ser revogados explicitamente — o GC do browser NAO libera blob URLs
  // criados via URL.createObjectURL ate revokeObjectURL ou navegacao. Sem
  // limpeza, abrir/fechar editor varias vezes acumula MBs/GBs de blobs.
  const svgBlobUrlsRef = useRef<string[]>([])
  // Guard sincrono pra prevenir double-init em Strict Mode / re-renders rapidos.
  // useEffect roda 2x em dev (strict mode). Se init e async, ambos podem passar pelos
  // guards iniciais antes do primeiro chegar a setar fabricRef.current = fc, resultando
  // em 2 canvas criados e cada layer adicionado 2x. Esse flag e setado SINCRONO antes
  // de qualquer await.
  const isInitInProgress = useRef(false)
  const pendingTextPropagation = useRef(false)
  // Fila serializada de saves (audit #6 2026-05-29). Substitui o padrao
  // anterior de busy-wait + flag (que tinha race: N callers paralelos saiam
  // do loop simultaneamente e rodavam PATCH em paralelo). Hook serializa via
  // promise chain + coalesce callers redundantes — so o ULTIMO save importa
  // (cada save le fabricRef.current AGORA).
  const saveQ = useSaveQueue()
  const savingInFlightRef = saveQ.isSavingRef
  const [confirmExit, setConfirmExit] = useState<null | (() => void)>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportPieces, setExportPieces] = useState<any[]>([])
  // Ref pro componente PsdImporter (renderizado hidden no fim do JSX) — chamado
  // via button "Importar PSD" da topbar. Componente gerencia file picker + upload
  // + redirect; aqui so disparamos importFile programaticamente.
  const psdImporterRef = useRef<PsdImporterHandle | null>(null)
  // Ref do input file da topbar — pattern simples (sem overlay).
  // User reportou botao Import PSD nao funcionar. Refactor 2026-05-27.
  const psdImportInputRef = useRef<HTMLInputElement | null>(null)
  const [layers, setLayers] = useState<any[]>([])
  const [editingLayerAssetId, setEditingLayerAssetId] = useState<string | null>(null)
  // Mask focus mode: o assetId do layer cuja mask esta sendo editada via
  // brush. Quando setado: canvas mostra overlay vermelho indicando edit
  // mode + brush ativo. Click no MaskThumb toggla.
  const [maskFocusAssetId, setMaskFocusAssetId] = useState<string | null>(null)
  const [maskBrushColor, setMaskBrushColor] = useState<"white" | "black">("white")
  const [maskBrushSize, setMaskBrushSize] = useState(20)
  // Pastas do PSD recolhidas no painel de layers. Chave = path joined por "›"
  // (ex: "Header" ou "Header›Buttons"). Quando incluido aqui, todos os layers
  // dentro daquela pasta ficam escondidos no painel ate o user expandir.
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  function toggleFolder(key: string) {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  const [zoom, setZoom] = useState(0.5)
  const zoomRef = useRef(0.5)
  const [bgColor, setBgColor] = useState("#ffffff")
  const bgColorRef = useRef("#ffffff")
  const [bgOpacity, setBgOpacity] = useState(1)
  const bgOpacityRef = useRef(1)
  // Library de cores do cliente (Client.brandColors). Renderiza no topo das
  // SWATCHES no painel BG e no painel de texto pra acesso rapido.
  const [brandColors, setBrandColors] = useState<BrandColor[]>([])
  // Ref pra acesso síncrono em handlers (resolve brand refs no load do canvas
  // antes do React ter chance de re-renderizar).
  const brandColorsRef = useRef<BrandColor[]>([])
  useEffect(() => { brandColorsRef.current = brandColors }, [brandColors])
  // Cor principal da MARCA — usada nos destaques de drag/drop (linha amarela,
  // magnify glow, indicators). Fallback: amarelo zzosy. Re-calcula quando o
  // brandColors mudar (sync com Client).
  const accentColor = (typeof brandColors[0]?.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(brandColors[0].hex))
    ? brandColors[0].hex
    : "#F5C400"
  const accentRgba = (a: number) => {
    const m = /^#([0-9a-f]{6})$/i.exec(accentColor)
    if (!m) return `rgba(245,196,0,${a})`
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  }

  // Quando brandColors muda (depois do load do client), re-sincroniza fills
  // de texto e cores de BG SOLID que tem brand ref. Renderiza + marca dirty
  // pra proximo save persistir. Cobre o cenario: editor ja aberto E user
  // mudou cores da brand em outra aba (fetched via 'zzosy:brand-updated' que
  // ja faz refetch do client em alguns lugares — mas aqui dispara o sync).
  useEffect(() => {
    if (brandColors.length === 0) return
    const fc = fabricRef.current
    if (!fc) return
    // CRITICO: brand sync NAO eh acao do user — eh efeito colateral de mudanca
    // em outra aba (edicao no /clients/[id]). Setamos isApplyingHistory.current
    // = true ANTES dos obj.set pra que listeners object:modified/added/removed
    // NAO disparem pushHistory automatico. Caso contrario, brand sync entraria
    // como "acao" no stack, e undo do user desfaria o sync junto.
    const wasApplying = isApplyingHistory.current
    isApplyingHistory.current = true
    let bgChanged = false
    let textChanged = false
    try {
      bgChanged = syncBrandRefsInBgLayers()
      textChanged = syncBrandRefsInTextObjects(fc)
    } finally {
      isApplyingHistory.current = wasApplying
    }
    if (!bgChanged && !textChanged) return
    // BUG GRAVE corrigido 2026-05-23: brand sync alterava fill de N objs
    // silenciosamente, MAS o undoStack continuava com snaps tendo as cores
    // ANTIGAS no topo. User editava 1 layer → push novo snap → undo aplica
    // snap antigo → todos os layers com __fillBrandIdx voltavam pras cores
    // velhas (sintoma: "undo de um texto reseta override de outro").
    //
    // Fix: REFAZ o snapshot do TOPO do undoStack com o estado atual (apos
    // sync). Snap top representa "estado pre-edicao" — agora reflete as
    // novas brand colors. Undo do user volta pro estado VISIVEL atual,
    // nao pra um pre-sync inexistente.
    //
    // Anteriormente o codigo zerava undoStack inteiro pra evitar isso
    // (catastrofico — perdia historia). Solucao intermediaria so re-renderia
    // (deixava o bug). Re-snap do topo eh o balanco correto.
    if (bgChanged) {
      ;(async () => {
        const fabricMod: any = await import("fabric")
        for (let i = 0; i < bgRectsRef.current.length; i++) {
          const r = bgRectsRef.current[i]
          const l = bgLayersRef.current[i]
          if (r && l) await syncBgLayerToRect(r, l, canvasWRef.current, canvasHRef.current, fabricMod)
        }
        fc.renderAll()
      })()
    } else {
      fc.renderAll()
    }
    // Atualiza snap top com o estado pos-sync (sem isso, undo reverte o sync).
    try {
      if (undoStack.current.length > 0) {
        const newTopSnap = JSON.stringify((fc as any).toObject(HISTORY_PROPS_TO_INCLUDE))
        undoStack.current[undoStack.current.length - 1] = newTopSnap
      }
    } catch { /* ignora — snap eh diagnostico, nao crítico */ }
    // Marca dirty pra que o sync persista no proximo auto-save. Sem isso, se
    // user fechar a aba sem editar nada, o sync visual nao seria salvo no DB.
    isDirtyRef.current = true
    setIsDirty(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandColors])

  // Wrappers que adapta os helpers puros (lib/editor/brandSyncHelpers.ts) com
  // as refs locais. Mantem mesma assinatura pra nao quebrar callers.
  // syncBgLayers muta a ref do bgLayers + side-effects de dirty.
  function syncBrandRefsInTextObjects(fc: any): boolean {
    return syncBrandTextHelper(fc, brandColorsRef.current)
  }
  function syncBrandRefsInBgLayers(): boolean {
    const changed = syncBrandBgHelper(bgLayersRef.current, brandColorsRef.current)
    if (changed) {
      isDirtyRef.current = true
      setIsDirty(true)
    }
    return changed
  }
  // BG-2: multiplas BG layers empilhaveis (igual Photoshop). bgLayersRef =
  // fonte da verdade dos dados; bgRectsRef = Rects no canvas (mesma ordem).
  // bgColorRef/bgOpacityRef/bgRef continuam refletindo o BG[0] (fundo) pra
  // back-compat com codigo legacy de save/export/import.
  const bgLayersRef = useRef<BgLayerData[]>([{ kind: "solid", color: "#ffffff", opacity: 1 }])
  const bgRectsRef = useRef<any[]>([])
  const [modal, setModal] = useState(false)
  // openGenerator=true vem do botao "Gerar peca" em /campaigns/[id]: depois do
  // init do canvas, abre o modal automaticamente. Polling pq isInitialized eh
  // ref (nao reativo). So aplica em modo matriz (sem pieceId).
  useEffect(() => {
    if (!openGenerator) return
    if (pieceId) return
    let cancelled = false
    const t = setInterval(() => {
      if (cancelled) return
      if (isInitialized.current) {
        clearInterval(t)
        setModal(true)
      }
    }, 100)
    return () => { cancelled = true; clearInterval(t) }
  }, [openGenerator, pieceId])
  const [saving, setSaving] = useState(false)
  const [assetId, setAssetId] = useState("")
  const assetIdRef = useRef("")
  const [canvasW, setCanvasW] = useState(DEFAULT_W)
  const [canvasH, setCanvasH] = useState(DEFAULT_H)
  const canvasWRef = useRef(DEFAULT_W)
  const canvasHRef = useRef(DEFAULT_H)
  // Fontes do PSD que NAO foram encontradas no browser apos o pre-load.
  // Cada entrada tem family (nome puro), weight (CSS numerico) e style
  // pra permitir substituicao cirurgica (so nos textos que usam ESSA variante,
  // sem alterar outras com a mesma family).
  const [missingFonts, setMissingFonts] = useState<Array<{
    family: string
    weight: number
    style: "normal" | "italic"
    label: string
  }>>([])
  // Modal estilo Adobe que lista cada fonte missing com dropdown de substituicao
  // + botao de upload. Aberto via botao no banner.
  const [fontsModalOpen, setFontsModalOpen] = useState(false)
  // Estado pendente de substituicao por variante missing — { family, weight, style }.
  // Key = mf.label. Family-only choice (sem weight setado): assume weight/style
  // da fonte original missing. Permite o user picar so a familia e ter
  // substituicao "Bold Italic → Inter Bold Italic" sem precisar tocar no peso.
  const [replacementChoices, setReplacementChoices] = useState<Record<string, { family?: string; weight?: number; style?: "normal" | "italic" }>>({})
  // Ref pro input file de upload de fonte do modal. Re-uso entre as fontes:
  // pendingFontUpload guarda a variante clicada ANTES do picker.
  const fontUploadInputRef = useRef<HTMLInputElement>(null)
  const fontUploadMultiInputRef = useRef<HTMLInputElement>(null)
  const pendingFontUpload = useRef<{ family: string; weight: number; style: "normal" | "italic"; label: string } | null>(null)
  // Labels de variantes em upload atualmente — feedback visual "Uploading…"
  // no botao. Adicionado 2026-05-28: user reportou ausencia de feedback,
  // achou que estava faltando botao "Enviar" depois do file picker.
  const [uploadingFonts, setUploadingFonts] = useState<Set<string>>(new Set())

  // Carregar campanha + peça (se for modo peça)
  useEffect(() => {
    let alive = true
    async function load() {
      const campRes = await fetch(`/api/campaigns/${campaignId}`)
      if (!alive) return
      const camp: Campaign = await campRes.json()
      if (!alive) return
      campaignRef.current = camp
      // ============================================================
      // CARREGAMENTO DE FONTES — pipeline em CAMADAS bem definidas:
      //   1. BRAND FONT (Design System): UMA estrategia por vez (custom OU
      //      Google), sem duplicar registro. Evita conflito de @font-face onde
      //      browser nao sabe qual usar.
      //   2. PSD/TEXTOS: fontes referenciadas em assets/overrides sao tentadas
      //      como Google Fonts via forceLoadFontFaces (404 silencioso se nao
      //      for Google valida). customFontFiles ja registrados em (1) cobrem
      //      a fonte da marca tb se referenciada nos textos.
      //   3. DETECTION: measureText decide se familia carregou ou nao —
      //      independente de qual origem foi (cache, Google CDN, custom file).
      // ============================================================
      try {
        const bf = (camp.client?.brandFont ?? "").trim()
        const files = camp.client?.customFontFiles
        const hasCustomFiles = Array.isArray(files) && files.length > 0
        if (bf) {
          if (hasCustomFiles) {
            // Cliente uploadou arquivos especificos pra esta fonte → fonte da
            // verdade eh o arquivo dele, nao a Google. Registra apenas
            // loadCustomFontFamily (que ja cobre family + PostScript + display
            // aliases). NAO chama loadGoogleFont — evita registro duplo no
            // mesmo nome (browser escolhia aleatoriamente entre os 2).
            loadCustomFontFamily(bf, files)
          } else {
            // Sem arquivos custom: tenta como Google Font. Se nao for Google
            // valida, link 404 silencioso e familia cai em fallback CSS no
            // render (detection avisa o user via banner).
            loadGoogleFont(bf)
          }
        }
      } catch {}
      // PSD fonts: coleta TODAS as fontes E SUAS VARIANTES (peso × estilo)
      // usadas pelos assets de texto E pelos overrides. Sem checar variantes,
      // o detection diz "Sicredi Sans OK" porque Sicredi Sans Regular esta
      // carregada — mas Sicredi Sans Bold Italic (que o titulo usa) NAO esta,
      // e o browser cai em serif italic fallback. Sintoma reportado: preview
      // raster perfeito mas titulo do editor vira serif italico.
      try {
        const fontSet = new Set<string>() // pra forceLoadFontFaces (preload geral)
        const variantSet = new Set<string>() // formato "family|weight|style" pra detection
        // Normaliza weight pra numero CSS (Sicredi/PSD pode salvar "bold", 700, "700").
        const weightToNum = (w: any): number => {
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
        const styleToCanon = (s: any): "normal" | "italic" => {
          if (typeof s === "string" && /italic|oblique/i.test(s)) return "italic"
          return "normal"
        }
        const addVariant = (family: any, weight: any, style: any) => {
          if (typeof family !== "string" || !family) return
          fontSet.add(family)
          variantSet.add(`${family}|${weightToNum(weight)}|${styleToCanon(style)}`)
        }
        for (const a of (camp.assets ?? [])) {
          if (a.type !== "TEXT") continue
          const spans: any = typeof a.content === "string" ? (() => { try { return JSON.parse(a.content as any) } catch { return [] } })() : a.content
          if (Array.isArray(spans)) {
            for (const s of spans) {
              addVariant(s?.style?.fontFamily, s?.style?.fontWeight, s?.style?.fontStyle)
            }
          }
          // lastOverride: template visual aplicado na matriz mais recente
          const lo: any = (a as any).lastOverride
          if (lo) addVariant(lo.fontFamily, lo.fontWeight, lo.fontStyle)
        }
        // Matriz layers (overrides per-instancia)
        const kvLayers: any = camp.keyVision?.layers
        const kvList = typeof kvLayers === "string" ? (() => { try { return JSON.parse(kvLayers) } catch { return [] } })() : (Array.isArray(kvLayers) ? kvLayers : [])
        for (const l of kvList) {
          const ov = l?.overrides
          if (ov) addVariant(ov.fontFamily, ov.fontWeight, ov.fontStyle)
          // Styles per-char (cada char pode ter weight/style proprio)
          const st = ov?.styles
          if (st && typeof st === "object") {
            for (const lineK of Object.keys(st)) {
              const line = st[lineK]
              if (!line || typeof line !== "object") continue
              for (const colK of Object.keys(line)) {
                const cs = line[colK]
                if (cs) addVariant(cs.fontFamily, cs.fontWeight, cs.fontStyle)
              }
            }
          }
        }
        if (fontSet.size > 0) {
          ensurePsdFontsReady(Array.from(fontSet))
          // Forca download EXPLICITO de cada @font-face (todos os pesos), pra
          // garantir que o textbox renderize com a fonte real, nao fallback.
          await forceLoadFontFaces(Array.from(fontSet), 6000)
          // Detecta variantes ausentes via measureText (font detection classica).
          // `document.fonts.check` da falso positivo em varios cenarios:
          //   - <link> 404 ainda registra a familia no CSS, check retorna true
          //   - Chrome sintetiza italic/bold a partir de Regular = check ok
          //   - Custom fonts com aliases multi-name confundem o matching
          // measureText compara a largura renderizada com a fonte custom vs com
          // fallback puro (serif). Se forem iguais, a fonte custom NAO esta
          // realmente sendo usada — caiu em fallback. Robusto e direto.
          try {
            // Aguarda CSSOM aplicar @font-face dos links injetados +
            // browser registrar todas as fontes. Sem isso, mesmo apos
            // forceLoadFontFaces resolver, o measureText do canvas podia
            // dar falso positivo de "missing" em fonts Google que carregam
            // lento (ex: Pacifico — handwriting, peso unico, raro de bater
            // antes do init terminar).
            try { await (document as any).fonts?.ready } catch {}
            const probeCanvas = document.createElement("canvas")
            const ctx = probeCanvas.getContext("2d")
            if (ctx) {
              const SAMPLE = "mwiI@#$%MNOQRS 1234567890"
              const FALLBACKS = ["serif", "sans-serif", "monospace"]
              // 1) Pra cada FAMILIA usada, await fonts.load() do Regular E
              // depois mede largura. Se a familia INTEIRA esta missing (nenhuma
              // variante carrega), reporta. Se Regular existe, browser sintetiza
              // bold/italic — visual nao eh perfeito mas eh aceitavel.
              const familyHasAnyVariant = async (family: string): Promise<boolean> => {
                const escFamily = family.replace(/"/g, '\\"')
                // Espera o <link rel=stylesheet> do CSS Google Fonts efetivamente
                // baixar antes de medir. Sem isso, fonts.load() resolvia (browser
                // promete carregar) mas o stylesheet ainda nao tinha @font-face
                // registrado -> canvas caia em fallback. Sintoma: Dancing Script
                // detectada como missing mesmo sendo a fonte do brand.
                const linkId = `gfont-${family.replace(/\s+/g, "-")}`
                const linkEl = document.getElementById(linkId) as HTMLLinkElement | null
                if (linkEl && !linkEl.sheet) {
                  await Promise.race([
                    new Promise<void>((res) => {
                      const done = () => res()
                      linkEl.addEventListener("load", done, { once: true })
                      linkEl.addEventListener("error", done, { once: true })
                    }),
                    new Promise<void>((res) => setTimeout(res, 5000)),
                  ])
                }
                // Forca download do font efetivo (depois do sheet carregado, isso
                // resolve quando a fonte esta REALMENTE disponivel pro canvas).
                try { await (document as any).fonts?.load?.(`72px "${escFamily}"`) } catch {}
                const probes: Array<{ w: number; s: "normal" | "italic" }> = [
                  { w: 400, s: "normal" }, { w: 700, s: "normal" }, { w: 400, s: "italic" },
                ]
                for (const p of probes) {
                  for (const fb of FALLBACKS) {
                    ctx.font = `${p.s} ${p.w} 72px ${fb}`
                    const baseW = ctx.measureText(SAMPLE).width
                    ctx.font = `${p.s} ${p.w} 72px "${escFamily}", ${fb}`
                    const testW = ctx.measureText(SAMPLE).width
                    if (Math.abs(testW - baseW) > 0.5) return true
                  }
                }
                return false
              }
              const familyAvailable = new Map<string, boolean>()
              const missingMap = new Map<string, { family: string; weight: number; style: "normal" | "italic"; label: string }>()
              for (const key of variantSet) {
                const [family] = key.split("|")
                let famOk = familyAvailable.get(family)
                if (famOk === undefined) {
                  famOk = await familyHasAnyVariant(family)
                  familyAvailable.set(family, famOk)
                }
                if (!famOk && !missingMap.has(family)) {
                  missingMap.set(family, { family, weight: 400, style: "normal", label: family })
                }
              }
              if (alive) {
                setMissingFonts(Array.from(missingMap.values()))
                // Marca familias missing pra que o fabricCharSpacingPatch clampe
                // tracking negativo. Sem isso, texto PSD com tracking -50/-100
                // ficava com letras colando ao cair em fallback Arial.
                try {
                  const { markFontFallback } = await import("@/lib/fabricCharSpacingPatch")
                  for (const mf of missingMap.values()) markFontFallback(mf.family)
                  // Edge case: textboxes ja podem estar renderizados (re-detect
                  // pos-init). Forca re-measure pra que tracking clampado seja
                  // aplicado retroativamente.
                  const fc = fabricRef.current
                  if (fc) {
                    fc.getObjects().forEach((o: any) => {
                      if (o.type === "textbox" || o.type === "text" || o.type === "i-text") {
                        o.initDimensions?.()
                        o.set("dirty", true)
                      }
                    })
                    fc.requestRenderAll()
                  }
                } catch (e) { editorLog("[font-fallback-mark] falha:", e) }
              }
            }
          } catch (e) { editorLog("[font-detection] falha:", e) }
        }
      } catch (e) { editorLog("[font-preload] falha:", e) }
      if (!alive) return
      if (camp.assets?.length) { assetIdRef.current = camp.assets[0].id }

      // MODO PEÇA: carrega peça PRIMEIRO, atualiza refs, depois disso seta campaign (que dispara init)
      if (pieceId) {
        const pieceRes = await fetch(`/api/pieces/${pieceId}`)
        if (!alive) return
        const p = await pieceRes.json()
        if (!alive) return
        const pdata = typeof p.data === "string" ? JSON.parse(p.data) : p.data
        const pw = pdata?.width ?? DEFAULT_W
        const ph = pdata?.height ?? DEFAULT_H
        // Piece fonts: coleta fontes dos overrides + per-char styles em TODOS
        // os steps (incluindo inativos pra que switchStep nao caia em fallback).
        // ensurePsdFontsReady eh idempotente — fontes ja carregadas via matriz
        // sao no-op.
        try {
          const pieceFonts = new Set<string>()
          const collectFromLayers = (layers: any[]) => {
            if (!Array.isArray(layers)) return
            for (const l of layers) {
              const f = l?.overrides?.fontFamily ?? l?.fontFamily
              if (typeof f === "string" && f) pieceFonts.add(f)
              const st = l?.overrides?.styles
              if (st && typeof st === "object") {
                for (const lineK of Object.keys(st)) {
                  const line = st[lineK]
                  if (!line || typeof line !== "object") continue
                  for (const colK of Object.keys(line)) {
                    const cf = line[colK]?.fontFamily
                    if (typeof cf === "string" && cf) pieceFonts.add(cf)
                  }
                }
              }
            }
          }
          collectFromLayers(pdata?.layers ?? [])
          if (Array.isArray(pdata?.steps)) {
            for (const s of pdata.steps) collectFromLayers(s?.layers ?? [])
          }
          if (pieceFonts.size > 0) {
            ensurePsdFontsReady(Array.from(pieceFonts))
            // Mesmo motivo: forca o download REAL de cada @font-face antes
            // do init criar os Textboxes — evita fallback Arial visual.
            await forceLoadFontFaces(Array.from(pieceFonts), 6000)
          }
        } catch (e) { editorLog("[piece-font-preload] falha:", e) }
        if (!alive) return
        // CRITICAL: setar refs ANTES de setCampaign para o init do canvas ter os dados certos
        pieceRef.current = p
        canvasWRef.current = pw
        canvasHRef.current = ph
        // CORE 3 (2026-05-28): bgLayers eh fonte canonica. bgColor/bgOpacity
        // legacy DERIVADOS de bgLayers[0] — sem janela de inconsistencia.
        // Migra legacy bgColor pra bgLayers solid se bgLayers ausente.
        const rawBg = pdata?.bgColor ?? camp.keyVision?.bgColor
        const bgLegacy = typeof rawBg === "string" ? rawBg : "#ffffff"
        const bopLegacy = typeof pdata?.bgOpacity === "number" ? pdata.bgOpacity : 1
        // STEPS: inicializa buffer dos steps inativos + indice ativo.
        // O save grava TODOS os steps em data.steps (incluindo o ativo). No load,
        // precisamos:
        // 1. Extrair o step ativo (steps[activeStepIndex]) — vai pro canvas via layers.
        // 2. Os outros (steps[i] onde i != activeStepIndex) viram inactiveStepsRef.
        // stepCount total = data.steps.length (NAO eh 1 + inactives).
        const savedAllSteps: any[] = Array.isArray(pdata?.steps) ? pdata.steps : []
        const savedActive: number = typeof pdata?.activeStepIndex === "number" ? pdata.activeStepIndex : 0
        // Se a URL pediu um step especifico (?stepIndex=N vindo da apresentacao),
        // usa esse no lugar do savedActive — desde que seja valido pra esta peca.
        const requestedStep = (typeof initialStepIndex === "number"
          && initialStepIndex >= 0
          && initialStepIndex < savedAllSteps.length)
          ? initialStepIndex
          : savedActive
        // bgLayersRef precisa refletir o STEP REQUISITADO, nao o ativo salvo.
        // Antes: lia pdata.bgLayers (= bg do step ativo no save). Quando URL
        // pedia stepIndex diferente, Rect do canvas era criado com cor errada
        // (o ajuste posterior so atualizava o panel, nao o Rect ja existente).
        // Bug "background dos steps confundindo" 2026-05-28.
        const stepBgRaw = (requestedStep !== savedActive && savedAllSteps[requestedStep])
          ? savedAllSteps[requestedStep]
          : pdata
        const stepBgLayersRaw: any = stepBgRaw?.bgLayers
        const stepBgColor: string = typeof stepBgRaw?.bgColor === "string" ? stepBgRaw.bgColor : bgLegacy
        const stepBgOpacity: number = typeof stepBgRaw?.bgOpacity === "number" ? stepBgRaw.bgOpacity : bopLegacy
        bgLayersRef.current = Array.isArray(stepBgLayersRaw) && stepBgLayersRaw.length > 0
          ? stepBgLayersRaw.map(migrateBgLayerJson)
          : [{ kind: "solid", color: stepBgColor, opacity: stepBgOpacity }]
        bgColorRef.current = bgLayerLegacyColor(bgLayersRef.current[0])
        bgOpacityRef.current = bgLayersRef.current[0].opacity ?? 1
        if (savedAllSteps.length >= 2) {
          // Peca multi-step: separa ativo dos inativos.
          // DEEP-CLONE forcado: sem isso, os steps inativos compartilhavam
          // refs com pdata parsed. Mutate em bgLayers/layers do step ativo
          // (via canvas init) vazava pros inativos via shared ref. Bug
          // sweep 2026-05-28.
          inactiveStepsRef.current = savedAllSteps
            .filter((_, i) => i !== requestedStep)
            .map(s => JSON.parse(JSON.stringify(s)))
          setStepCountSync(savedAllSteps.length)
          setActiveStepIndexSync(requestedStep)
        } else {
          // Peca legada / 1 step: nao mexe.
          inactiveStepsRef.current = []
          setStepCountSync(1)
          setActiveStepIndexSync(0)
        }
        // Agora seta states (dispara render + init do canvas)
        setPiece(p)
        setCanvasW(pw); setCanvasH(ph)
        // bgColor/bgOpacity state TEM que derivar de bgLayersRef[0], senao
        // Properties panel mostra valores diferentes do canvas (canvas pinta
        // a partir de bgLayers, panel mostra bgColor state). Quando
        // pdata.bgColor (legacy root) diverge de pdata.bgLayers[0] (caso
        // comum em pecas salvas antes do schema migrar), o panel mostrava
        // rosa e o canvas verde. Bug 2026-05-28 reportado em screenshot.
        // Fix: panel agora le direto do bgLayers via bgLayerLegacyColor —
        // mesmo helper que o canvas usa pra pintar.
        setBgColor(bgLayerLegacyColor(bgLayersRef.current[0]))
        setBgOpacity(bgLayersRef.current[0].opacity ?? 1)
        if (camp.assets?.length) setAssetId(camp.assets[0].id)
        setCampaign(camp)
      } else {
        // MODO MATRIZ
        const rawBg = camp.keyVision?.bgColor
        // Robustez: DB pode ter bgColor como objeto serializado (legado/bug).
        // bgColor.toLowerCase() crasha se nao for string — normaliza aqui.
        const bg = typeof rawBg === "string" ? rawBg : "#ffffff"
        const cw = camp.keyVision?.width ?? DEFAULT_W
        const ch = camp.keyVision?.height ?? DEFAULT_H
        canvasWRef.current = cw
        canvasHRef.current = ch
        setCanvasW(cw); setCanvasH(ch)
        // bgLayers da matriz vive em keyVision.data.bgLayers (novo schema).
        // Sem isso, gradient/imagem de bg da matriz vira solid no reload.
        // Bug 2026-05-28 (sweep drift bgColor/bgLayers).
        const kvData: any = camp.keyVision?.data ?? null
        const kvBgLayersRaw = kvData && Array.isArray(kvData.bgLayers) ? kvData.bgLayers : null
        bgLayersRef.current = (kvBgLayersRaw && kvBgLayersRaw.length > 0)
          ? kvBgLayersRaw.map(migrateBgLayerJson)
          : [{ kind: "solid", color: bg, opacity: 1 }]
        // Derivar bgColor/bgOpacity de bgLayers[0] — single source of truth.
        bgColorRef.current = bgLayerLegacyColor(bgLayersRef.current[0])
        bgOpacityRef.current = bgLayersRef.current[0].opacity ?? 1
        setBgColor(bgColorRef.current)
        setBgOpacity(bgOpacityRef.current)
        if (camp.assets?.length) setAssetId(camp.assets[0].id)
        setCampaign(camp)
      }
    }
    load()
    return () => { alive = false }
  }, [campaignId, pieceId])

  // Carrega a library de cores do cliente da campanha. Usado pra renderizar
  // swatches "Marca" no topo dos color pickers (BG + texto). Re-fetch
  // automatico quando o evento 'zzosy:client-brand-updated' eh disparado
  // (pra refletir mudancas no /clients/[id]/edit sem reload do editor).
  useEffect(() => {
    const clientId = campaign?.client?.id
    if (!clientId) { setBrandColors([]); return }
    let cancelled = false
    function load() {
      fetch(`/api/clients/${clientId}`, { cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .then(c => {
          if (cancelled || !c) return
          const arr: any[] = Array.isArray(c?.brandColors) ? c.brandColors : []
          const cleaned: BrandColor[] = arr
            .filter(x => typeof x?.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(x.hex))
            .map(x => ({ hex: x.hex, name: x.name ?? null, role: x.role }))
          setBrandColors(cleaned)
        })
        .catch(() => { if (!cancelled) setBrandColors([]) })
    }
    load()
    function onUpdate(e: any) {
      // Refetch so se o evento eh pro client desta campanha (ou sem detail = refetch sempre)
      const detailId = e?.detail?.clientId
      if (!detailId || detailId === clientId) load()
    }
    window.addEventListener("zzosy:client-brand-updated", onUpdate)
    return () => { cancelled = true; window.removeEventListener("zzosy:client-brand-updated", onUpdate) }
  }, [campaign?.client?.id])

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

      // TAB — toggle ambos os paineis laterais (Photoshop-style). Single key,
      // sem modificadores. Esconde Layers + Properties pra preview limpo do
      // canvas. User pedido 2026-05-23.
      if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        setPanelsHidden(prev => !prev)
        return
      }

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
          : Math.round((active.lineHeight ?? 1.0) * fs) // congela do auto (1:1 com fontSize)
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
          "__assetId", "__assetLabel", "__isBg", "leadingPt", "__maskData",
        ])
        setClipboard({
          campaignId,
          sourcePieceId: pieceId ?? null,
          json,
          copiedAt: Date.now(),
        })
        return
      }

      // Cmd+V / Cmd+Shift+V — cola da clipboard interna
      // Photoshop-style:
      //  - source == current peca: offset +20 (duplica visivel)
      //  - source != current peca (ou matriz): paste-in-place (mesma posicao)
      //  - Shift+V: sempre paste-in-place independente do source
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v" && !e.altKey) {
        const cb = getClipboard()
        if (!cb) return
        if (cb.campaignId !== campaignId) {
          alert("Asset copiado pertence a outra campanha — copy/paste so dentro da mesma campanha.")
          return
        }
        e.preventDefault()
        const currentSource = pieceId ?? null
        const sameSource = cb.sourcePieceId === currentSource
        const pasteInPlace = e.shiftKey || !sameSource
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
          // Mascara: re-aplicar a partir do __maskData (clipPath serializado e parcial)
          if (cb.json.__maskData) {
            (cloned as any).__maskData = cb.json.__maskData
            const { Image: FabImage, Path } = await import("fabric")
            ;(cloned as any).clipPath = null
            await applyMaskToFabricObject({ Image: FabImage, Path }, cloned, cb.json.__maskData)
          }
          if (!pasteInPlace) {
            cloned.set({
              left: (cloned.left ?? 0) + 20,
              top: (cloned.top ?? 0) + 20,
            })
          }
          cloned.setCoords()
          fc.add(cloned)
          fc.setActiveObject(cloned)
          fc.requestRenderAll()
          // Dispara save (via object:modified que ja escuta)
          fc.fire("object:modified", { target: cloned })
        })()
        return
      }

      // Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z OU Cmd/Ctrl+Y = redo.
      // Stack mantém 30 entradas (ver pushHistory).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault()
        redo()
        return
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
      // Cmd+Opt+G (Mac) / Ctrl+Alt+G (Win) — Create/Release Clipping Mask (Photoshop)
      // Liga/desliga clipping mask no objeto selecionado.
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === "g") {
        if (!active) return
        e.preventDefault()
        const hasMask = !!(active as any).__maskData
        if (hasMask && (active as any).__maskData.type === "clipping") {
          // Release clipping mask
          removeMaskFromObject(active)
        } else {
          addClippingMaskToSelected()
        }
      }

      // Cmd/Ctrl+J — Duplicate layer (Photoshop style).
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        if (!active || (active as any).__isBg || (active as any).__isBleedOverlay) return
        e.preventDefault()
        ;(async () => {
          try {
            // Fabric v7: clone() returns Promise<FabricObject>. Second arg is
            // propsToInclude (mantém metadata custom no clone).
            const cloned: any = await (active as any).clone([
              "__assetId", "__assetLabel", "__isImage", "__maskData",
              "__embedded", "imageDataUrl", "__hidden", "__locked",
              "__fillBrandIdx", "__psdEffects", "__psdNameSource", "__groupPath", "__isSmartObject", "__smartObjectGuid", "__smartObjectMime", "__smartObjectFilePath", "__smartObjectOriginalName", "leadingPt",
            ])
            if (!cloned || !fc) return
            cloned.set({ left: (active.left ?? 0) + 30, top: (active.top ?? 0) + 30 })
            // __assetId: mantem mesmo do original — duplicata referencia o mesmo
            // CampaignAsset (estilo "smart object linked"). Visual edits ficam
            // como overrides per-layer. NUNCA usar "_copy" suffix — quebra match
            // em assetMap no reload (audit C3).
            fc.add(cloned)
            fc.setActiveObject(cloned)
            fc.renderAll()
            pushHistory()
            refreshLayers(fc)
          } catch (err) { console.warn("[duplicate] falhou:", err) }
        })()
        return
      }

      // Cmd/Ctrl+] — Bring forward (1 step). Cmd+Shift+] — Bring to front.
      if ((e.metaKey || e.ctrlKey) && e.key === "]") {
        if (!active || !fc) return
        e.preventDefault()
        try {
          if (e.shiftKey) (fc as any).bringObjectToFront ? (fc as any).bringObjectToFront(active) : (fc as any).bringToFront(active)
          else (fc as any).bringObjectForward ? (fc as any).bringObjectForward(active) : (fc as any).bringForward(active)
          // Re-eleva bleed overlays
          const overlays = (fc as any).__bleedOverlays as any[] | undefined
          if (overlays) for (const o of overlays) { try { (fc as any).bringObjectToFront ? (fc as any).bringObjectToFront(o) : (fc as any).bringToFront(o) } catch {} }
          fc.renderAll()
          pushHistory()
          refreshLayers(fc)
        } catch {}
        return
      }

      // Cmd/Ctrl+[ — Send backward (1 step). Cmd+Shift+[ — Send to back.
      if ((e.metaKey || e.ctrlKey) && e.key === "[") {
        if (!active || !fc) return
        e.preventDefault()
        try {
          if (e.shiftKey) (fc as any).sendObjectToBack ? (fc as any).sendObjectToBack(active) : (fc as any).sendToBack(active)
          else (fc as any).sendObjectBackwards ? (fc as any).sendObjectBackwards(active) : (fc as any).sendBackwards(active)
          // BG fica no fundo absoluto sempre
          const bgRects = bgRectsRef.current
          for (let i = bgRects.length - 1; i >= 0; i--) {
            try { (fc as any).sendObjectToBack ? (fc as any).sendObjectToBack(bgRects[i]) : (fc as any).sendToBack(bgRects[i]) } catch {}
          }
          fc.renderAll()
          pushHistory()
          refreshLayers(fc)
        } catch {}
        return
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
      // CRITICO 2026-05-24: checar isEditing ANTES do preventDefault. Fabric
      // textbox em edit mode nao e um <input>/<textarea> — isTypingTarget
      // retorna false porque o target e window/canvas. Sem este guard, Space
      // era consumido por preventDefault e nunca chegava no textbox — user
      // nao conseguia digitar espaco em texto editavel.
      const activeObj = fabricRef.current?.getActiveObject() as any
      if (activeObj?.isEditing) return
      // Importante: prevent default pra Space nao scrollar pagina nem inserir em outros lugares
      e.preventDefault()
      activate()
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return
      deactivate()
    }

    // Pan via mouse handlers do Fabric, ativos so quando isSpaceDown.
    // Modo place-text intercepta ANTES — proximo click cria textbox na
    // posicao do pointer (em coords do mundo do canvas).
    function onMouseDown(opt: any) {
      if (placingTextRef.current) {
        const fc = fabricRef.current; if (!fc) return
        const pointer = fc.getPointer(opt.e)
        placeTextAtPointerRef.current?.(pointer.x, pointer.y)
        return
      }
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

  // beforeunload: avisa se ha mudancas nao salvas + best-effort flush.
  // Audit #6 (HIGH): exit paths nao chamavam flushPendingAssetPuts. Browser
  // beforeunload nao pode await async (handler eh sync), entao o flush eh
  // fire-and-forget — fetch usado dentro de flushPendingAssetPuts ja eh
  // keepalive-safe por padrao do Next (route handlers Node).
  //
  // Tambem listener em visibilitychange (tab vai pra background) e pagehide
  // (mobile Safari nao dispara beforeunload). Sao os 3 sinais reais de exit
  // que o browser nos da.
  useEffect(() => {
    function onBefore(e: BeforeUnloadEvent) {
      if (isDirtyRef.current) {
        e.preventDefault()
        e.returnValue = ""
        // Fire-and-forget flush — best effort. Promise pode nao completar
        // antes do browser fechar mas eh melhor que nao tentar.
        try { void flushPendingAssetPuts() } catch {}
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden" && isDirtyRef.current) {
        try { void flushPendingAssetPuts() } catch {}
      }
    }
    function onPageHide() {
      if (isDirtyRef.current) {
        try { void flushPendingAssetPuts() } catch {}
      }
    }
    window.addEventListener("beforeunload", onBefore)
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("pagehide", onPageHide)
    return () => {
      window.removeEventListener("beforeunload", onBefore)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("pagehide", onPageHide)
    }
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
    // Guard sincrono: previne double-init em Strict Mode quando useEffect roda 2x.
    // Setamos a flag ANTES de qualquer await, e zeramos no cleanup.
    if (isInitInProgress.current) {
      return
    }
    isInitInProgress.current = true
    let alive = true
    const cleanupFns: Array<() => void> = []

    const init = async () => {
      const { Canvas, Rect, Textbox, FabricImage } = await import("fabric")
      if (!alive || !canvasRef.current) return

      const cw = canvasWRef.current
      const ch = canvasHRef.current

      // Canvas DOM enche TODA a area visivel entre paineis (sem subtrair
      // margem). Os handles do Fabric so podem ser renderizados DENTRO do
      // canvas DOM — sem essa area total, handles fora da peca eram cortados
      // pelas bordas. Margem visual entre canvas e paineis vem do estilo do
      // container, nao do tamanho do canvas.
      const availW = window.innerWidth - layersPanelWidth - propsPanelWidth
      const availH = window.innerHeight - TH - BH
      // HANDLE_MARGIN: pixels reservados ao redor da peca para os handles de
      // selecao aparecerem (mesmo modelo Photoshop/Figma). Sem isso, peca
      // com fit zoom encosta nas bordas do canvas e os handles top/right/
      // bottom/left ficam cortados.
      const HANDLE_MARGIN = 120
      const z = Math.round(Math.min(0.8,
        Math.max(0.05, (availW - HANDLE_MARGIN * 2) / cw),
        Math.max(0.05, (availH - HANDLE_MARGIN * 2) / ch),
      ) * 100) / 100
      zoomRef.current = z
      setZoom(z)

      // CANVAS PHOTOSHOP-STYLE: o canvas DOM ocupa toda a area visivel
      // disponivel (entre painel esquerdo, painel direito, topbar e footer).
      // A "peca" (artboard) renderiza centralizada como um Rect bg de
      // dimensoes cw x ch em coords do mundo Fabric.
      //
      // Vantagens vs canvas justinho-na-peca:
      //  - Handles de selecao funcionam em qualquer lugar da area visivel,
      //    nao so dentro da peca. Mesmo modelo de Photoshop/Figma/Illustrator.
      //  - Objetos fora da peca ficam interativos (clicar, arrastar, escalar).
      //  - Overlays "passe-partout" mascaram o que esta fora da peca pra UI
      //    nao ficar poluida.
      //
      // viewportTransform[4,5] centraliza a peca no canvas. Os bleed
      // overlays cobrem TUDO fora da regiao (0,0)->(cw,ch) no mundo Fabric.
      const fullW = Math.max(1, availW)
      const fullH = Math.max(1, availH)

      const fc = new Canvas(canvasRef.current, {
        width: Math.round(fullW),
        height: Math.round(fullH),
        selection: true,
        preserveObjectStacking: true,
        // controlsAboveOverlay: garante que as alcas de selecao (handles)
        // sao desenhadas POR CIMA de qualquer overlay/object do canvas,
        // mesmo se o objeto estiver atras dos bleed overlays. Sem isso, em
        // alguns casos os handles ficavam invisiveis quando o objeto ja
        // estava no z-stack abaixo de outros.
        controlsAboveOverlay: true,
        // perPixelTargetFind: click so seleciona onde tem pixel opaco (alpha
        // > threshold). Area transparente do bbox NAO captura clicks — user
        // pediu 2026-05-26 "quando background e transparent nao quero que
        // seja clicavel". Photoshop/Figma-style. Custo: Fabric le imageData
        // pra cada hit-test, ligeiramente mais lento mas aceitavel pra UX.
        perPixelTargetFind: true,
        targetFindTolerance: 4,
      })
      fc.setZoom(z)
      // Offset pra centralizar a peca no canvas grande. Em coords do canvas DOM:
      //   peca renderiza em [(fullW - cw*z)/2, (fullH - ch*z)/2] -> [+ cw*z, + ch*z]
      const offsetX = (fullW - cw * z) / 2
      const offsetY = (fullH - ch * z) / 2
      const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
      vt[0] = z; vt[3] = z
      vt[4] = offsetX
      vt[5] = offsetY
      fc.setViewportTransform(vt)
      fabricRef.current = fc
      // Guarda dimensoes do canvas pra applyZoom/resize calcularem offset novo.
      ;(fabricRef as any).__canvasFullW = fullW
      ;(fabricRef as any).__canvasFullH = fullH

      // BG: vira layers REAIS (igual Photoshop). Cria 1 Rect por entry em
      // bgLayersRef. Idx 0 = fundo; ultimo = topo do grupo de BGs (ainda
      // abaixo de qualquer asset). bgRef.current aponta pro fundo (compat
      // com save/export legacy que assumiam 1 BG so).
      const fabricForBg: any = await import("fabric")
      const bgRects: any[] = []
      for (let i = 0; i < bgLayersRef.current.length; i++) {
        const ld = bgLayersRef.current[i]
        const r = new Rect({
          left: 0, top: 0, width: cw, height: ch,
          selectable: true, evented: true,
          hasControls: false, hasBorders: true,
          lockMovementX: true, lockMovementY: true,
          lockScalingX: true, lockScalingY: true, lockRotation: true,
          excludeFromExport: true,
        })
        await syncBgLayerToRect(r, ld, cw, ch, fabricForBg)
        ;(r as any).__isBg = true
        ;(r as any).__bgIdx = i
        ;(r as any).__assetLabel = i === 0 ? "Background" : `Background ${i + 1}`
        ;(r as any).__hidden = ld.hidden === true
        ;(r as any).__locked = ld.locked === true
        fc.add(r)
        bgRects.push(r)
      }
      bgRectsRef.current = bgRects
      bgRef.current = bgRects[0]

      // BLEED MASK dinamico: 4 overlays cobrindo tudo fora da peca dentro
      // do canvas. Tamanho deles depende do zoom e do espaco disponivel.
      createBleedOverlays(fc, Rect, cw, ch, fullW, fullH, z)

      // CRITICO: clipa o render do canvas inteiro a area da peca (0,0)-(cw,ch).
      // Sem isso, layers PSD que extrapolam a peca (ex: Pá at x=205-3016 com
      // peca cw=2160) vazam pro bleed mesmo com os overlays. Os overlays usam
      // z-order pra mascarar, mas alguns paths (object:added pos-render, etc)
      // podem deixar conteudo passar por baixo. clipPath nivel-canvas garante
      // que pixels fora da bbox da peca NAO renderizem, periodo.
      // absolutePositioned: true = coords em mundo, nao em viewport (preserva
      // o clip durante pan/zoom).
      ;(fc as any).clipPath = new Rect({
        left: 0, top: 0, width: cw, height: ch,
        absolutePositioned: true,
      })

      // pushHistory({markDirty:false}) em selection events: user pediu undo
      // "passo a passo" incluindo selecao/deselecao. markDirty=false pq isso
      // eh UI state, nao mudanca de dado — nao trigger save prompt.
      fc.on("selection:created", (e: any) => {
        if (alive) setSelected(e.selected?.[0] ?? null)
        if (isInitialized.current && !isApplyingHistory.current) pushHistory({ markDirty: false })
      })
      fc.on("selection:updated", (e: any) => {
        if (alive) setSelected(e.selected?.[0] ?? null)
        if (isInitialized.current && !isApplyingHistory.current) pushHistory({ markDirty: false })
      })
      // Salva seleção de texto via mouse:up e keyup no canvas (text:selection:changed
      // nao dispara no Fabric v7). Intervalo de polling enquanto objeto esta em edicao.
      let selPollTimer: any = null
      function pollTextSelection() {
        const active = fc.getActiveObject() as any
        if (active?.isEditing && active.selectionStart !== active.selectionEnd) {
          savedTextSelection.current = { obj: active, start: active.selectionStart, end: active.selectionEnd }
        }
      }
      fc.on("text:editing:entered", () => {
        selPollTimer = setInterval(pollTextSelection, 100)
      })
      fc.on("text:editing:exited", (e: any) => {
        clearInterval(selPollTimer)
        // Se foi um placed text (modo T), CRITICO criar CampaignAsset antes
        // de qualquer save — senao o textbox fica sem __assetId, eh filtrado
        // no save matriz (linha 5936) e cleanup orphan (linha 2740) remove
        // silenciosamente. User reportou 2026-05-30 "texto nao aparece".
        const tb = e?.target ?? fc.getActiveObject() as any
        const placedId = tb?.__placedTextId
        if (placedId && placedTextIdsRef.current.has(placedId)) {
          placedTextIdsRef.current.delete(placedId)
          ;(tb as any).__placedTextId = undefined
          setPlacingText(false)
          const txt = String(tb?.text ?? "").trim()
          if (!txt) {
            try { fc.remove(tb); fc.requestRenderAll() } catch {}
            return
          }
          // Cria CampaignAsset type=TEXT, atribui __assetId no textbox, e
          // dispara performSave pra persistir o layer na matriz. Depois (best
          // effort, background) clona pro Library do cliente pra reuso global.
          const content = [{ text: txt, style: {
            fontFamily: (tb as any).fontFamily,
            fontWeight: (tb as any).fontWeight,
            fontStyle: (tb as any).fontStyle,
            color: (tb as any).fill,
          } }]
          ;(async () => {
            try {
              const res = await fetch(`/api/campaigns/${campaignId}/assets`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "TEXT",
                  label: txt.slice(0, 50) || "Texto",
                  content,
                }),
              })
              if (!res.ok) { editorLog("[placed-text] POST campaign asset falhou:", res.status); return }
              const newAsset = await res.json()
              // Linka o textbox ao novo asset (sem isso o save filtra ele).
              ;(tb as any).__assetId = newAsset.id
              ;(tb as any).__assetLabel = newAsset.label
              // Atualiza state + ref pra outros code paths verem o asset novo.
              setCampaign(c => {
                if (!c) return c
                const updated = { ...c, assets: [...(c.assets ?? []), newAsset] }
                campaignRef.current = updated as any
                return updated as any
              })
              // Forca save da matriz pra layer persistir.
              try { await performSave() } catch (err) { editorLog("[placed-text] performSave:", err) }
              // Clona pro Library do cliente (best effort — nao bloqueia UX).
              const clientId = campaignRef.current?.client?.id
              if (clientId) {
                try {
                  await fetch(`/api/clients/${clientId}/library/assets`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      cloneFrom: { campaignId, assetId: newAsset.id },
                      name: txt.slice(0, 50) || "Texto",
                    }),
                  })
                } catch (err) { editorLog("[placed-text→library clone]", err) }
              }
            } catch (err) { editorLog("[placed-text→asset]", err) }
          })()
        }
      })
      // Limpa interval pendente no cleanup pro caso de unmount durante edicao.
      cleanupFns.push(() => { if (selPollTimer) clearInterval(selPollTimer) })
      fc.on("selection:cleared", () => {
        if (alive) setSelected(null)
        if (isInitialized.current && !isApplyingHistory.current) pushHistory({ markDirty: false })
      })
      // Photoshop-style chain mask: a raster mask anda junto com o layer
      // quando o user move/redimensiona. Sem isso, mover o layer no editor
      // deixava a mask "presa" no canvas — visualmente o layer movia com a
      // mask ja bakeada no bitmap (correto), mas no SAVE o layer.mask.raster
      // ficava nas coords originais — exportar pro PSD reposicionava a mask
      // ERRADA. Aqui detectamos o delta entre o __maskAnchor (registrado em
      // addAssetToCanvas) e a posicao atual, e propagamos pro __maskData.
      const syncMaskToObj = (obj: any) => {
        if (!obj) return
        const anchor = obj.__maskAnchor
        const maskData = obj.__maskData
        if (!anchor || !maskData) return
        const dLeft = (obj.left ?? 0) - anchor.left
        const dTop = (obj.top ?? 0) - anchor.top
        // Mask raster: ajusta posX/Y. Width/Height ficam intactos (resize do
        // layer ainda nao escala a mask — Photoshop tambem nao escala por
        // default; user precisa quebrar o chain pra editar).
        if (maskData.type === "raster" && maskData.raster && (dLeft !== 0 || dTop !== 0)) {
          maskData.raster.posX = Math.round(maskData.raster.posX + dLeft)
          maskData.raster.posY = Math.round(maskData.raster.posY + dTop)
        }
        // Vector: mesma logica no bbox do path.
        if (maskData.type === "vector" && maskData.vector && (dLeft !== 0 || dTop !== 0)) {
          maskData.vector.posX = Math.round(maskData.vector.posX + dLeft)
          maskData.vector.posY = Math.round(maskData.vector.posY + dTop)
          // Path: nao re-escrevemos string aqui (caro). PSD export recalcula
          // bbox a partir de posX/Y/W/H — suficiente pra Photoshop. Visual no
          // canvas usa clipPath via applyMaskToFabric (binario silhueta).
        }
        anchor.left = obj.left ?? 0
        anchor.top = obj.top ?? 0
      }
      fc.on("object:modified", (e: any) => {
        // Guard undo: sem isso syncMaskToObj durante restore pode reaplicar
        // delta zero (anchor ja foi resetado no restore loop) mas ainda toca
        // maskData.dirty — defensivo.
        if (isApplyingHistory.current) return
        syncMaskToObj(e?.target)
      })
      fc.on("object:modified", () => {
        if (!alive) return
        // Bloqueia save durante undo/redo — o save acontece via outro caminho
        // depois que applySnapshot termina (saveTimer.current).
        if (isApplyingHistory.current) return
        doSave()
      })
      // Clipping mask LIVE sync — Photoshop: clip sempre acompanha o base
      // em tempo real conforme user move/escala/rota. Estrategia:
      //   - object:moving/scaling/rotating (LIVE): sync APENAS transform
      //     do clipPath existente (left/top/scale/angle) — fast path sem
      //     re-clonar (clone() eh async + pesado, frame rate cai).
      //   - object:modified (COMMIT): re-clona base completo (fill/path/
      //     content podem ter mudado alem do transform).
      function syncClippingMasksAboveLive(target: any) {
        if (!target || target.__isBg || target.__isBleedOverlay || target.__isStrokeGhost) return
        const all = fc.getObjects().filter((o: any) =>
          !o.__isBg && !o.__isBleedOverlay && !o.__isStrokeGhost
        )
        const baseIdx = all.indexOf(target)
        if (baseIdx === -1) return
        for (let i = baseIdx + 1; i < all.length; i++) {
          const above: any = all[i]
          const maskData = above?.__maskData
          if (maskData?.type === "clipping" && maskData?.enabled !== false && above.clipPath) {
            above.clipPath.set({
              left: target.left, top: target.top,
              scaleX: target.scaleX, scaleY: target.scaleY,
              angle: target.angle,
            })
            above.clipPath.setCoords?.()
            above.dirty = true
          } else break
        }
      }
      fc.on("object:moving" as any, (e: any) => { if (alive) { syncClippingMasksAboveLive(e?.target); fc.requestRenderAll() } })
      fc.on("object:scaling" as any, (e: any) => { if (alive) { syncClippingMasksAboveLive(e?.target); fc.requestRenderAll() } })
      fc.on("object:rotating" as any, (e: any) => { if (alive) { syncClippingMasksAboveLive(e?.target); fc.requestRenderAll() } })
      fc.on("object:modified", async (e: any) => {
        if (!alive || !fc) return
        // Guard undo: applyClippingMaskNative async sobrescreveria clipPath
        // restaurado pelo applySnapshot durante o restore.
        if (isApplyingHistory.current) return
        const modified = e?.target
        if (!modified || modified.__isBg || modified.__isBleedOverlay || modified.__isStrokeGhost) return
        const all = fc.getObjects().filter((o: any) =>
          !o.__isBg && !o.__isBleedOverlay && !o.__isStrokeGhost
        )
        const baseIdx = all.indexOf(modified)
        if (baseIdx === -1) return
        for (let i = baseIdx + 1; i < all.length; i++) {
          const above: any = all[i]
          const maskData = above?.__maskData
          if (maskData?.type === "clipping" && maskData?.enabled !== false) {
            await applyClippingMaskNative(fc, above)
          } else break
        }
        fc.requestRenderAll()
      })
      // SAFE-AREA SNAP: ao mover texto, snap suave em padding mínimo lateral
      // (~30-50px proporcional ao canvas, escalado pelo maior eixo). Photoshop
      // smart guides. Soft snap: cede quando user "puxa" pra fora alem de
      // tolerancia ou segura Cmd/Alt — extrapolar manualmente permitido.
      // Tambem desenha guides visuais temporarias durante o move.
      const SNAP_TOL = 8 // px de tolerancia pro snap "puxar"
      const RELEASE_FORCE = 18 // px alem do snap pra liberar
      fc.on("object:moving" as any, (e: any) => {
        if (!alive) return
        const obj = e?.target
        if (!obj || (obj as any).__isBg || (obj as any).__isBleedOverlay) return
        // Permite extrapolar sem snap se user segura Alt/Cmd (modifier key)
        if ((e?.e as any)?.altKey || (e?.e as any)?.metaKey) {
          ;(fc as any).__safeAreaGuides = null
          return
        }
        const cw = canvasWRef.current
        const ch = canvasHRef.current
        // Padding proporcional: 4% do menor eixo, clamped 24..72
        const pad = Math.round(Math.max(24, Math.min(72, Math.min(cw, ch) * 0.04)))
        // Bbox do objeto (considera scale + width/height + origin)
        const oL = obj.left ?? 0
        const oT = obj.top ?? 0
        const oW = (obj.width ?? 0) * (obj.scaleX ?? 1)
        const oH = (obj.height ?? 0) * (obj.scaleY ?? 1)
        const oR = oL + oW
        const oB = oT + oH
        // Snap conditions: distancia ate borda interna (cw - pad / ch - pad)
        let newLeft = oL
        let newTop = oT
        const guides: { kind: "v" | "h"; pos: number }[] = []
        // Esquerda
        const distL = oL - pad
        if (Math.abs(distL) < SNAP_TOL) {
          newLeft = pad
          guides.push({ kind: "v", pos: pad })
        } else if (distL < 0 && distL > -RELEASE_FORCE) {
          // Dentro da safe area pela esquerda, mas nao no snap exato — soft pull
          newLeft = pad
          guides.push({ kind: "v", pos: pad })
        }
        // Direita
        const distR = (cw - pad) - oR
        if (Math.abs(distR) < SNAP_TOL) {
          newLeft = (cw - pad) - oW
          guides.push({ kind: "v", pos: cw - pad })
        } else if (distR < 0 && distR > -RELEASE_FORCE) {
          newLeft = (cw - pad) - oW
          guides.push({ kind: "v", pos: cw - pad })
        }
        // Topo
        const distT = oT - pad
        if (Math.abs(distT) < SNAP_TOL) {
          newTop = pad
          guides.push({ kind: "h", pos: pad })
        } else if (distT < 0 && distT > -RELEASE_FORCE) {
          newTop = pad
          guides.push({ kind: "h", pos: pad })
        }
        // Base
        const distB = (ch - pad) - oB
        if (Math.abs(distB) < SNAP_TOL) {
          newTop = (ch - pad) - oH
          guides.push({ kind: "h", pos: ch - pad })
        } else if (distB < 0 && distB > -RELEASE_FORCE) {
          newTop = (ch - pad) - oH
          guides.push({ kind: "h", pos: ch - pad })
        }
        if (newLeft !== oL) obj.left = newLeft
        if (newTop !== oT) obj.top = newTop
        // Armazena guides ativas pra after:render desenhar (linhas tracejadas)
        ;(fc as any).__safeAreaGuides = guides.length > 0 ? guides : null
      })
      // Guides somem 2s apos o user soltar o mouse (deselect). Antes ficavam
      // ate o proximo render — agora persistem brevemente como confirmacao
      // visual do snap, e desaparecem sozinhos. Se o user comeca outro drag,
      // o timer eh cancelado (object:moving popula guides direto, dispensa
      // clear pendente).
      const clearGuidesTimerRef = { current: null as any }
      const scheduleGuidesClear = () => {
        if (clearGuidesTimerRef.current) clearTimeout(clearGuidesTimerRef.current)
        clearGuidesTimerRef.current = setTimeout(() => {
          ;(fc as any).__safeAreaGuides = null
          fc.requestRenderAll()
        }, 2000)
      }
      fc.on("mouse:up" as any, () => {
        // NAO limpa imediato. Agenda clear pra 2s — guides ficam visiveis
        // como feedback de alinhamento.
        scheduleGuidesClear()
        fc.requestRenderAll()
      })
      // Object:moving sempre repopula __safeAreaGuides — cancela timer pendente
      // pra nao apagar guide enquanto user esta arrastando outra coisa.
      fc.on("object:moving" as any, () => {
        if (clearGuidesTimerRef.current) {
          clearTimeout(clearGuidesTimerRef.current)
          clearGuidesTimerRef.current = null
        }
      })
      cleanupFns.push(() => { if (clearGuidesTimerRef.current) clearTimeout(clearGuidesTimerRef.current) })
      // Desenha guides visuais (smart guides) sobre o canvas pos-render.
      // Usa o LOWER context (fc.getContext()) — Fabric limpa esse canvas
      // automaticamente a cada renderAll via before:render. Antes usavamos
      // contextTop, mas Fabric so limpa o top quando ha mudanca de selecao/
      // controles — quando user so arrastava sem mudar selecao, as guides
      // empilhavam em camadas ate atualizar a aba.
      fc.on("after:render" as any, () => {
        const guides = (fc as any).__safeAreaGuides as Array<{ kind: "v" | "h"; pos: number }> | null
        if (!guides || guides.length === 0) return
        const ctx = fc.getContext()
        if (!ctx) return
        const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
        ctx.save()
        // Aplica viewport transform (mesmo modo que os objetos)
        ctx.transform(vt[0], vt[1], vt[2], vt[3], vt[4], vt[5])
        ctx.strokeStyle = accentColor
        ctx.lineWidth = 1 / (vt[0] || 1) // mantem 1px visual independente do zoom
        ctx.setLineDash([6 / (vt[0] || 1), 4 / (vt[0] || 1)])
        const cw = canvasWRef.current
        const ch = canvasHRef.current
        for (const g of guides) {
          ctx.beginPath()
          if (g.kind === "v") { ctx.moveTo(g.pos, 0); ctx.lineTo(g.pos, ch) }
          else { ctx.moveTo(0, g.pos); ctx.lineTo(cw, g.pos) }
          ctx.stroke()
        }
        ctx.restore()
      })
      // Quando o usuario muda a selecao DENTRO de um textbox em modo edicao (cursor moveu,
      // selecao expandida, palavra selecionada), forca re-render do painel pra ler estilos
      // do caractere onde o cursor esta agora. Sem isso, painel mostra estado obsoleto
      // quando texto tem estilos per-char.
      // Fabric dispara mouseup/keyup nesses casos. Usamos uma checagem leve no proprio canvas.
      const onCanvasInteract = () => {
        if (!alive) return
        const active = fc.getActiveObject() as any
        if (active?.isEditing) scheduleSelectedTick()
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
        if ((obj as any).initDimensions) (obj as any).initDimensions()
        // applyLeadingPtToFabric MEDE o factor real do Fabric naquela linha
        // (em vez de assumir 1.13) — match exato baseline-to-baseline com PSD.
        if (curLeadingPt !== undefined && curLeadingPt !== null) {
          applyLeadingPtToFabric(obj, (obj as any).leadingPt)
        }
        obj.setCoords()
        scheduleSelectedTick()
      })

      // SHAPE: scaling parametric DESABILITADO (tentativas anteriores
      // bbcf965/9313ed3 introduziram regressoes — slider stroke, bg saindo
      // do canvas). Comportamento atual: Fabric.Path escala normalmente,
      // cantos distorcem em scale nao-uniforme (igual PS Path). Slider de
      // raio em Properties continua editavel manual.
      //
      // Pra Live Shape real (cantos preservados em scale), proximo passo
      // seria Fabric subclass custom com _render override — backlog.

      // Ao SOLTAR o mouse apos arrastar lateral, consolida scaleX em width pra que o save
      // grave o estado limpo (scaleX=1, width final). Sem isso, scaleX!=1 ficaria salvo e
      // ao recarregar o textbox apareceria com scale ainda aplicado.
      fc.on("object:modified" as any, (e: any) => {
        if (!alive) return
        // CRITICO: durante applySnapshot (undo/redo), initDimensions dispara
        // object:modified — esse handler "consolidaria" o scale do snap em
        // width/height permanentemente, fazendo cada undo modificar o estado
        // restaurado. User reportava "undo estraga overrides" porque o snap
        // pos-consolidacao virava diferente do snap original.
        if (isApplyingHistory.current) return
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
        // Flag "manual resize": auto-fit em text:changed nao deve mais sobrescrever
        // o width que o user setou arrastando. Sem isso, ao digitar apos um resize
        // manual, a caixa volta pra natural width e perde o wrap escolhido.
        if (Math.abs(sX - 1) > 0.0001) obj.__userResizedWidth = true
        obj.set({ width: newWidth, height: newHeight, scaleX: 1, scaleY: 1 })
        if ((obj as any).initDimensions) (obj as any).initDimensions()
        obj.setCoords()
        fc.requestRenderAll()
      })
      // Tambem captura quando teclas (Shift+Arrow etc) mudam a selecao
      const onKeyUp = (_e: KeyboardEvent) => {
        if (!alive) return
        const active = fc.getActiveObject() as any
        if (active?.isEditing) scheduleSelectedTick()
      }
      window.addEventListener("keyup", onKeyUp)
      cleanupFns.push(() => window.removeEventListener("keyup", onKeyUp))
      fc.on("text:changed", (e: any) => {
        if (!alive) return
        // Guard undo: text:changed pode disparar dentro do applySnapshot
        // (initDimensions em wraps especificos). Como o auto-fit eh debounced
        // 120ms, o timer fire APOS isApplyingHistory ja ser false e modificar
        // width permanentemente do estado restaurado. Skipa enfileiramento.
        if (isApplyingHistory.current) return
        // Coalesce Properties panel re-renders no proximo frame. Sem isso,
        // cada keystroke disparava re-render completo do painel direito (font,
        // size, color pickers, swatches) — em maquinas mais fracas, gerava
        // lag visivel na digitacao.
        scheduleSelectedTick()
        // AUTO-FIT: ajusta o width do textbox ao conteudo quando o texto muda.
        // DEBOUNCE 120ms: cada keystroke re-mede o texto inteiro via
        // initDimensions x2 + calcTextWidth, o que em textos grandes (>100
        // chars com styles per-char) e' MUITO caro. Debounce evita rodar em
        // cada tecla durante digitacao continua — auto-fit roda quando o user
        // para de digitar por 120ms (imperceptivel) e a digitacao em si volta
        // a ser instantanea. Sintoma corrigido: 'lag pra atualizar os textos'.
        const obj = e?.target
        if (!obj || obj.type !== "textbox") return
        // Photoshop/Figma paragraph-text behavior: assim que ha quebra de linha
        // ou o user redimensionou o box manualmente, width fica FIXA. Auto-fit so
        // roda em "point text" (single line, nunca redimensionado). Sem isso,
        // pressionar Enter num textbox manual-wrap colapsa pra natural width da
        // linha mais longa (UNWRAPPED) — o famoso "reset" reportado pelo user.
        const hasNewline = typeof obj.text === "string" && obj.text.includes("\n")
        const skipPointAutofit = hasNewline || obj.__userResizedWidth
        clearTimeout(autoFitTimer.current)
        autoFitTimer.current = setTimeout(() => {
          if (!alive) return
          // Validacao: pode ter mudado o objeto / saido de edicao no entremeio
          if (obj.type !== "textbox") return
          // Re-check do guard: se um undo disparou nos 120ms entre o text:changed
          // e o timer, abortar — auto-fit nao deve modificar estado restaurado.
          if (isApplyingHistory.current) return
          try {
            const nowHasNewline = typeof obj.text === "string" && obj.text.includes("\n")
            const nowUserResized = !!obj.__userResizedWidth
            const stillSkip = nowHasNewline || nowUserResized
            // POINT TEXT auto-fit: huggar largura do conteudo (measured + 8).
            // So roda em textbox single-line sem manual-resize — multi-line e
            // user-resized preservam width intencional.
            if (!skipPointAutofit && !stillSkip) {
              const oldWidth = obj.width
              obj.set("width", 5000)
              if (obj.initDimensions) obj.initDimensions()
              const measured = obj.calcTextWidth ? obj.calcTextWidth() : oldWidth
              const newWidth = Math.max(20, Math.ceil(measured) + 8)
              obj.set("width", newWidth)
              if (obj.initDimensions) obj.initDimensions()
              obj.setCoords()
            } else if (obj.initDimensions) {
              // Pra clamp poder medir linhas com width atual, garante medicao
              // fresh apos o ultimo texto digitado.
              obj.initDimensions()
            }
            // Regra ZZOSY: width <= min(longest_line * 1.30, canvas_right - left).
            // Aplica em TODOS textboxes (incluindo multi-line e user-resized) —
            // o intent eh "nao estourar a borda do canvas nem inflar muito alem
            // do texto". Single-line auto-fit acima ja deixa tight, clamp aqui
            // funciona como segundo guard pro canvas border.
            clampTextboxWidth(obj, canvasWRef.current)
            fc.requestRenderAll()
          } catch (err) { console.warn("auto-fit textbox fail:", err) }
        }, 120)
      })
      fc.on("object:added", (e: any) => {
        if (!alive) return
        // Snap angular nativo do Fabric: snapAngle define o increment (45deg)
        // e snapThreshold a janela em volta de cada multiplo onde gruda (4deg).
        // Sem isso, rotate fica completamente livre. Fabric internamente
        // calcula a posicao correta — set("angle") manual no rotating handler
        // fazia o objeto andar pela tela (pivot deriva).
        const t = e?.target
        if (t && !t.__isBleedOverlay && !t.__isBg) {
          if (t.snapAngle == null) t.snapAngle = 45
          if (t.snapThreshold == null) t.snapThreshold = 4
        }
        refreshLayers(fc)
      })
      fc.on("object:removed", () => { if (alive) refreshLayers(fc) })
      // Captura mudancas para historico de undo/redo.
      // IGNORA bleed overlays e BG: sao objetos internos da UI (cobrem area
      // fora da peca / pintam o fundo), nao representam acoes do usuario que
      // deveriam ir pro undo stack. applyZoom remove e re-cria overlays a
      // cada zoom — antes do filtro, isso poluía o stack com snapshots
      // duplicados e tambem rodava o orphan-detect com lixo transitorio.
      const isInternalOverlay = (target: any) => target?.__isBleedOverlay || target?.__isBg
      // Guard adicional !isInitialized.current — sem isso, cada addAssetToCanvas
      // durante o load inicial dispara object:added → pushHistory(), populando
      // undoStack com 20+ snapshots intermediarios capturados ANTES das fontes
      // terminarem de carregar e os textos reflowarem. Undo do user volta pra
      // esses estados ruins (textos com layout pre-font-load, sem override
      // visivel). Apos isInitialized=true, listeners voltam ao normal pra
      // capturar acoes reais do user (modify, add, remove via drag-drop/paste).
      fc.on("object:modified", (e: any) => {
        if (!isInitialized.current) return
        // CRITICO: durante applySnapshot (undo/redo), initDimensions/scale hooks
        // disparam object:modified — sem essa guarda, undo empilhava NOVO snapshot
        // baseado no estado ja restaurado, e o proximo undo "voltava" pra o mesmo
        // estado (parecia que undo nao mexia ou mexia em layer aleatorio).
        if (isApplyingHistory.current) return
        if (!isInternalOverlay(e?.target)) pushHistory()
      })
      fc.on("object:added", (e: any) => {
        if (isApplyingHistory.current) return
        if (!isInitialized.current) return
        if (isInternalOverlay(e?.target)) return
        pushHistory()
      })
      fc.on("object:removed", (e: any) => {
        if (isApplyingHistory.current) return
        if (!isInitialized.current) return
        if (isInternalOverlay(e?.target)) return
        pushHistory()
      })
      // text:changed nao chama pushHistory - text:editing:exited cobre o flush final

      // Re-eleva os overlays do bleed ao topo do z-stack sempre que objetos
      // novos sao adicionados (addAssetToCanvas, paste, etc). Sem isso, novos
      // objetos ficariam ACIMA dos overlays e voltariam a vazar pra area do
      // bleed visualmente.
      fc.on("object:added", (e: any) => {
        if (!alive) return
        // Guard undo: applySnapshot recria bleed overlays no final, n=2 a 4
        // re-elevacoes durante restore sao desperdicio (e cada bringToFront
        // marca canvas como dirty). Skipa o restore inteiro.
        if (isApplyingHistory.current) return
        const added = e?.target
        // Nao re-eleva se o objeto adicionado e um dos proprios overlays
        if (added && (added as any).__isBleedOverlay) return
        const overlays = (fc as any).__bleedOverlays as any[] | undefined
        if (!overlays) return
        for (const o of overlays) {
          try { (fc as any).bringObjectToFront ? (fc as any).bringObjectToFront(o) : (fc as any).bringToFront(o) } catch {}
        }
      })

      // Captura texto+styles ao ENTRAR em modo edicao (T0 para diff posterior)
      fc.on("text:editing:entered", (e: any) => {
        if (!alive || !e?.target) return
        // Guard undo: loadFromJSON pode disparar editing:entered se ativar
        // textbox restaurado (raro mas possivel). Skipar evita corromper o
        // baseline T0 com snapshot intermediario.
        if (isApplyingHistory.current) return
        ;(e.target as any).__editStartText = e.target.text ?? ""
        ;(e.target as any).__editStartStyles = JSON.parse(JSON.stringify(e.target.styles ?? {}))
      })

      fc.on("text:editing:exited", async (e: any) => {
        if (!alive) return
        const obj = e.target
        if (!obj) return
        // Guard undo: loadFromJSON SEMPRE limpa o canvas, fazendo Fabric sair
        // de qualquer text-edit ativo e disparar exit. Sem o guard, durante o
        // undo updateAssetContent propagava texto STALE pro asset (server) —
        // perdia override real do user. ALL state propagation skip aqui.
        if (isApplyingHistory.current) {
          delete (obj as any).__editStartText
          delete (obj as any).__editStartStyles
          return
        }

        // Sempre limpar refs de edicao
        const startText = (obj as any).__editStartText
        const startStyles = (obj as any).__editStartStyles
        delete (obj as any).__editStartText
        delete (obj as any).__editStartStyles

        // Modelo final:
        //  - PECA: edicao grava overrides locais (texto + styles per-char) no layer,
        //    nunca propaga pro asset.
        //  - MATRIZ: propaga texto cru pro asset.content (fonte da verdade) E grava
        //    estilo no asset.lastOverride (template visual aplicado em novas pecas).
        updateAssetLastOverride(obj)
        updateAssetContent(obj)
        // CRITICO: marca dirty pra o ConfirmExit aparecer caso o user clique
        // 'Voltar' antes do debounce do doSave (800ms) disparar. Sem isso o
        // user perdia a edicao silenciosamente ao sair logo apos editar texto.
        isDirtyRef.current = true
        setIsDirty(true)
        // History push explicito do estado final pos-edit. Fabric NAO dispara
        // object:modified ao sair de text editing (so dispara em set() externo),
        // entao sem esse push o undo pulava a edicao inteira. Compara contra
        // start: se nada mudou (entrou e saiu sem digitar), pula o push pra
        // nao poluir a pilha.
        try {
          const curText = (obj as any).text ?? ""
          const curStyles = (obj as any).styles ?? {}
          const textChanged = typeof startText === "string" && startText !== curText
          const stylesChanged = startStyles && JSON.stringify(startStyles) !== JSON.stringify(curStyles)
          if ((textChanged || stylesChanged) && !isApplyingHistory.current && isInitialized.current) {
            pushHistory()
          }
        } catch {}
        if (!isApplyingHistory.current) doSave()
      })

      // Zoom Photoshop/Figma-style: Ctrl+Scroll, ANCORADO NO CURSOR.
      // User pedido 2026-05-23 (PRIORIDADE): cursor eh o anchor point —
      // ponto do canvas embaixo do cursor permanece no mesmo lugar do
      // viewport apos zoom. fc.zoomToPoint faz exatamente isso quando o
      // point eh dado em coords do canvas DOM (offset relativo ao canvas).
      const wrapper = wrapperRef.current
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return
        const fc = fabricRef.current
        if (!alive || !fc) return
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.05 : 0.05
        const newZ = Math.min(16, Math.max(0.05, zoomRef.current + delta))
        // Pega coords do mouse RELATIVAS ao canvas DOM (cursor pos no canvas).
        const canvasEl = (fc as any).lowerCanvasEl
          ?? (fc as any).lower?.el
          ?? (fc as any).elements?.lower
        if (canvasEl) {
          const rect = canvasEl.getBoundingClientRect()
          const px = e.clientX - rect.left
          const py = e.clientY - rect.top
          fc.zoomToPoint({ x: px, y: py } as any, newZ)
          zoomRef.current = newZ
          setZoom(newZ)
          // Re-dimensiona bleed overlays + invalida cache de viewport extents.
          // applyZoom faz isso, mas como zoomToPoint setou vt direto, repassamos.
          try {
            fc.requestRenderAll()
          } catch {}
        } else {
          // Fallback: applyZoom (centraliza no canvas, nao no cursor).
          applyZoom(fc, newZ)
        }
      }
      if (wrapper) wrapper.addEventListener("wheel", onWheel, { passive: false })
      cleanupFns.push(() => { if (wrapper) wrapper.removeEventListener("wheel", onWheel) })

      // Resize da janela: recalcula tamanho do canvas DOM e recentraliza a peca.
      // Sem isso, se o user redimensiona a janela, a peca fica desencaixada do
      // centro e a area visivel nao cresce/diminui. Debounce de 150ms pra evitar
      // disparos durante drag de resize.
      let resizeTimer: any = null
      const onResize = () => {
        if (resizeTimer) clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          if (!alive || !fabricRef.current) return
          // Usa ref pra pegar o valor MAIS RECENTE — o useEffect [campaign] que
          // captura essa closure nao re-roda quando layersPanelWidth muda.
          // Canvas DOM = area visivel total (ver init pra contexto). Margem
          // pros handles eh reservada no zoom calc, nao no tamanho do canvas.
          // Usa effLayers/effPropsRef pra respeitar panelsHidden (canvas
          // fullscreen quando paineis estao escondidos via Tab).
          const newAvailW = window.innerWidth - effLayersRef.current - effPropsRef.current
          const newAvailH = window.innerHeight - TH - BH
          const fcRef = fabricRef.current
          ;(fabricRef as any).__canvasFullW = Math.max(1, newAvailW)
          ;(fabricRef as any).__canvasFullH = Math.max(1, newAvailH)
          fcRef.setDimensions({ width: Math.round(newAvailW), height: Math.round(newAvailH) })
          // applyZoom recalcula offset + overlays
          applyZoom(fcRef, zoomRef.current)
        }, 150)
      }
      window.addEventListener("resize", onResize)
      cleanupFns.push(() => {
        window.removeEventListener("resize", onResize)
        if (resizeTimer) clearTimeout(resizeTimer)
      })

      // Delete key remove selected + atalhos de viewport (estilo Figma)
      const onKey = (e: KeyboardEvent) => {
        if (!alive || !fabricRef.current) return
        // Guard global: nao interfere quando user esta digitando num input/textarea
        // OU editando texto dentro de um Fabric textbox (isEditing). Antes nao
        // checava o Fabric edit mode — Cmd+A com cursor dentro de textbox
        // disparava select-all global do canvas (selecionava todos os layers),
        // matando o flow de selecionar chars no texto. User pedido 2026-05-26:
        // Cmd+A em edit mode tem que ir pro Fabric (select all chars).
        const t = e.target as HTMLElement | null
        const fcActive = fabricRef.current?.getActiveObject() as any
        const inField = (!!t && (() => {
          const tag = (t.tagName || "").toUpperCase()
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
          if (t.isContentEditable) return true
          return false
        })()) || !!fcActive?.isEditing
        // Atalhos de viewport (estilo Figma):
        //   Shift+1 = Zoom to fit (centraliza peca)
        //   Shift+2 = Zoom to selection (foca objeto ativo)
        //   Shift+0 = Zoom 100%
        // So dispara se nao estiver em campo de texto E nao ha modifier conflitante.
        if (!inField && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
          if (e.key === "1" || e.code === "Digit1") {
            e.preventDefault()
            centerView()
            return
          }
          if (e.key === "2" || e.code === "Digit2") {
            e.preventDefault()
            zoomToSelection()
            return
          }
          if (e.key === "0" || e.code === "Digit0") {
            e.preventDefault()
            const fc = fabricRef.current
            applyZoom(fc, 1)
            return
          }
        }
        // ===== TOP PHOTOSHOP SHORTCUTS (user pedido 2026-05-23) =====
        const fcEd = fabricRef.current
        const activeObj = fcEd?.getActiveObject() as any
        const cmdOnly = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
        const cmdShift = (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey
        const cmdAlt = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.altKey
        // Cmd+0 — Fit to screen
        if (!inField && cmdOnly && (e.key === "0" || e.code === "Digit0")) {
          e.preventDefault(); centerView(); return
        }
        // Cmd+1 — Zoom 100%
        if (!inField && cmdOnly && (e.key === "1" || e.code === "Digit1")) {
          e.preventDefault(); if (fcEd) applyZoom(fcEd, 1); return
        }
        // Cmd+= / Cmd++ — Zoom in (Photoshop usa Cmd+=)
        if (!inField && cmdOnly && (e.key === "=" || e.key === "+")) {
          e.preventDefault(); changeZoom(+0.1); return
        }
        // Cmd+- — Zoom out
        if (!inField && cmdOnly && e.key === "-") {
          e.preventDefault(); changeZoom(-0.1); return
        }
        // Cmd+J — Duplicate active object (Photoshop: Cmd+J = New Layer via Copy)
        if (!inField && cmdOnly && (e.key === "j" || e.key === "J")) {
          if (activeObj && !activeObj.__isBg && !activeObj.isEditing && fcEd) {
            e.preventDefault()
            activeObj.clone(["__assetId","__assetLabel","__isShape","__shapeKind","__cornerRadius","__pathBbox","__maskData","__psdEffects","__groupPath","leadingPt"]).then((cloned: any) => {
              cloned.set({ left: (activeObj.left ?? 0) + 20, top: (activeObj.top ?? 0) + 20 })
              ;(cloned as any).__assetId = activeObj.__assetId
              fcEd.add(cloned)
              fcEd.setActiveObject(cloned)
              fcEd.requestRenderAll()
              if (isInitialized.current && !isApplyingHistory.current) pushHistory()
              doSave()
            }).catch((err: any) => console.warn("[cmd+j duplicate]", err))
            return
          }
        }
        // Cmd+] / Cmd+[ — Z-order forward / backward
        if (!inField && cmdOnly && (e.key === "]" || e.key === "[")) {
          if (activeObj && !activeObj.__isBg) {
            e.preventDefault()
            moveLayer(activeObj, e.key === "]" ? "up" : "down")
            return
          }
        }
        // Cmd+Shift+] / Cmd+Shift+[ — Send to front / back
        if (!inField && cmdShift && (e.key === "]" || e.key === "{" || e.key === "}" || e.key === "[")) {
          if (activeObj && !activeObj.__isBg && fcEd) {
            e.preventDefault()
            const toFront = e.key === "]" || e.key === "}"
            if (toFront) fcEd.bringObjectToFront(activeObj)
            else fcEd.sendObjectToBack(activeObj)
            const bgObj = fcEd.getObjects().find((o: any) => o.__isBg)
            if (bgObj) fcEd.sendObjectToBack(bgObj)
            fcEd.requestRenderAll()
            if (isInitialized.current && !isApplyingHistory.current) pushHistory()
            doSave()
            return
          }
        }
        // Cmd+A — Select all (multi-selection com ActiveSelection)
        if (!inField && cmdOnly && (e.key === "a" || e.key === "A")) {
          if (fcEd) {
            e.preventDefault()
            const sels = fcEd.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay && !o.__hidden && !o.__locked)
            if (sels.length > 0) {
              const fabric = require("fabric")
              const ActiveSelection = (fabric as any).ActiveSelection
              if (ActiveSelection) {
                const sel = new ActiveSelection(sels, { canvas: fcEd })
                fcEd.setActiveObject(sel)
                fcEd.requestRenderAll()
              }
            }
            return
          }
        }
        // Cmd+D — Deselect
        if (!inField && cmdOnly && (e.key === "d" || e.key === "D")) {
          if (fcEd) {
            e.preventDefault()
            fcEd.discardActiveObject()
            fcEd.requestRenderAll()
            return
          }
        }
        // Arrow keys — Nudge 1px (Shift = 10px)
        if (!inField && activeObj && !activeObj.__isBg && !activeObj.isEditing
            && !cmdOnly && !cmdShift && !cmdAlt
            && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault()
          const step = e.shiftKey ? 10 : 1
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0
          activeObj.set({ left: (activeObj.left ?? 0) + dx, top: (activeObj.top ?? 0) + dy })
          activeObj.setCoords()
          fcEd?.requestRenderAll()
          if (isInitialized.current && !isApplyingHistory.current) pushHistory()
          doSave()
          return
        }
        // ===== END PS SHORTCUTS =====

        // Delete/Backspace remove objeto selecionado
        if (e.key !== "Delete" && e.key !== "Backspace") return
        if (inField) return
        const obj = fabricRef.current.getActiveObject()
        if (obj && !(obj as any).__isBg && !(obj as any).isEditing) {
          removeLayerWithUnclipCascade(obj)
          fabricRef.current.renderAll()
          doSave()
        }
      }
      window.addEventListener("keydown", onKey)
      cleanupFns.push(() => window.removeEventListener("keydown", onKey))

      // Matriz: edicao livre (chars vao pro asset via updateAssetContent, \n
      // fica em layer.overrides.text local).
      // Peca: bloqueia digitacao mas permite Enter (quebra de linha local) +
      // navegacao/selecao. Chars na peca vem do asset — pra alterar caracteres
      // o user edita na matriz (que propaga via asset.content pra todas as pecas).
      {
        const blockKey = (e: KeyboardEvent) => {
          const fcc = fabricRef.current
          if (!fcc) return
          // Matriz: edicao livre, nao bloqueia nada.
          if (!pieceId) return
          // Primeiro checa se algum textbox esta em edicao — se sim, bloqueia
          // mesmo que o evento venha do hiddenTextarea do Fabric (que e onde
          // o Fabric captura digitacao pra escrever no canvas).
          const active = fcc.getActiveObject() as any
          const isFabricEditing = active?.isEditing
          // Se NAO esta editando texto no canvas, deixa passar pros inputs do painel.
          if (!isFabricEditing) {
            const t = e.target as HTMLElement | null
            if (t) {
              const tag = (t.tagName || "").toUpperCase()
              if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
              if (t.isContentEditable) return
            }
            return
          }
          // Peca em edicao: bloquear digitacao mas permitir teclas de
          // navegacao/selecao + Enter (quebra de linha local) + whitespace
          // (Space, Tab) que sao layout, nao conteudo lexical — mesma logica
          // de Enter: user precisa poder reorganizar visualmente sem mexer
          // nos chars do asset. Sem Space na allowlist, user nao conseguia
          // adicionar espaco entre palavras apos uma quebra de linha.
          const allowed = new Set([
            "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
            "Home", "End", "PageUp", "PageDown", "Tab", "Escape",
            "Shift", "Control", "Alt", "Meta",
            "Enter", " ",
          ])
          if (allowed.has(e.key)) return
          // Permitir Cmd/Ctrl+A, Cmd/Ctrl+C (selecionar/copiar)
          if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "c")) return
          // Backspace/Delete: SEMPRE permitido. User precisa poder
          // remover \n que adicionou + apagar espaços antes/depois pra
          // reorganizar o texto local da peça. Caracteres do asset não
          // são "perdidos" — eles continuam no asset.content; o que muda
          // é a versão LOCAL persistida em overrides.text.
          if (e.key === "Backspace" || e.key === "Delete") return
          // Bloquear o resto (digitação de chars novos, paste, etc).
          // Adicionar chars novos quebraria a regra "chars vêm do asset" —
          // user adiciona/edita chars em /campaigns/[id]/assets.
          e.preventDefault()
          e.stopPropagation()
        }
        const onPaste = (e: ClipboardEvent) => {
          const fcc = fabricRef.current
          if (!fcc) return
          // Matriz: paste livre. Peca: bloqueia paste em edicao de texto.
          if (!pieceId) return
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

        // STEPS: se a URL pediu um step especifico (?stepIndex=N) que NAO eh o
        // savedActive, precisamos carregar os layers DESSE step (que estao em
        // pdata.steps[N].layers, NAO em pdata.layers que sempre eh o savedActive).
        const savedAllSteps: any[] = Array.isArray(pdata?.steps) ? pdata.steps : []
        const savedActiveIdx = typeof pdata?.activeStepIndex === "number" ? pdata.activeStepIndex : 0
        const loadIdx = (typeof initialStepIndex === "number"
          && initialStepIndex >= 0
          && initialStepIndex < savedAllSteps.length
          && savedAllSteps.length >= 2)
          ? initialStepIndex
          : null
        const layersToLoad = (loadIdx !== null && loadIdx !== savedActiveIdx)
          ? (savedAllSteps[loadIdx]?.layers ?? [])
          : (pdata?.layers ?? [])
        const bgToLoad = (loadIdx !== null && loadIdx !== savedActiveIdx)
          ? (savedAllSteps[loadIdx]?.bgColor ?? pdata?.bgColor ?? "#ffffff")
          : (pdata?.bgColor ?? "#ffffff")
        const bgOpToLoad = (loadIdx !== null && loadIdx !== savedActiveIdx)
          ? (typeof savedAllSteps[loadIdx]?.bgOpacity === "number" ? savedAllSteps[loadIdx].bgOpacity : 1)
          : (typeof pdata?.bgOpacity === "number" ? pdata.bgOpacity : 1)
        const bgLayersToLoadRaw: any = (loadIdx !== null && loadIdx !== savedActiveIdx)
          ? savedAllSteps[loadIdx]?.bgLayers
          : pdata?.bgLayers
        const bgLayersToLoad: BgLayerData[] = Array.isArray(bgLayersToLoadRaw) && bgLayersToLoadRaw.length > 0
          ? bgLayersToLoadRaw.map(migrateBgLayerJson)
          : [{ kind: "solid", color: bgToLoad, opacity: bgOpToLoad }]
        // Atualiza bgLayersRef SEMPRE — canvas init le isso pra criar os Rects.
        // bgColorRef/bgOpacityRef sao espelhos do BG[0] pra back-compat (so faz
        // sentido pra kind=solid; gradient pega 1o stop; image pega branco).
        bgLayersRef.current = bgLayersToLoad
        bgColorRef.current = bgLayerLegacyColor(bgLayersToLoad[0])
        bgOpacityRef.current = bgLayersToLoad[0].opacity
        // SEMPRE sincronizar state com bgLayers carregado — antes era so
        // quando loadIdx !== savedActiveIdx, mas isso deixava cor divergente
        // se pdata.bgColor (legacy root) != pdata.bgLayers[0].color.
        setBgColor(bgLayerLegacyColor(bgLayersToLoad[0]))
        setBgOpacity(bgLayersToLoad[0].opacity)

        if (pdata?.version === 2 && Array.isArray(layersToLoad)) {
          // Renderiza cada layer da peca
          const sorted = [...layersToLoad].sort((a: any, b: any) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
          // DIAGNÓSTICO peça
          const matchedP = sorted.filter((l: any) => l.assetId && assetMap[l.assetId]).length
          const embeddedP = sorted.filter((l: any) => l.__embedded).length
          console.log("[LOAD-PIECE-DIAG] piece layers:", sorted.length, "assets na campanha:", c.assets.length, "matched:", matchedP, "embedded:", embeddedP, "unmatched:", sorted.length - matchedP - embeddedP)
          // OPTIMIZACAO 2026-05-26: prewarm o browser cache com TODAS as imageUrls
          // em paralelo ANTES do loop serial de addAssetToCanvas. O loop continua
          // serial (ordem zIndex importa; clipping precisa do layer abaixo no
          // canvas), mas as imagens ja estarao no cache HTTP quando addAssetToCanvas
          // criar seu proprio new Image(). Ganho real: open de KV com 10+ assets
          // de 5-10s pra ~2-3s (IO paralelizado, render serial).
          const imageUrls = Array.from(new Set(sorted
            .map((l: any) => assetMap[l.assetId])
            .filter((a: any) => a && (a.type === "IMAGE" || a.type === "SMART_OBJECT") && a.imageUrl)
            .map((a: any) => a.imageUrl as string)))
          if (imageUrls.length > 0) {
            await Promise.all(imageUrls.map(url => new Promise<void>(resolve => {
              const im = new window.Image()
              im.crossOrigin = "anonymous"
              im.onload = () => resolve()
              im.onerror = () => resolve()
              im.src = url
            })))
            // User pode ter fechado/navegado durante o await — sem alive
            // check, entramos no loop e mexemos num canvas em dispose.
            if (!alive) return
          }
          for (const layer of sorted) {
            // Layer LINKADO a um asset (peca gerada ou linkada do PSD)
            const asset = assetMap[layer.assetId] as Asset
            if (asset) {
              // DEBUG: loga o estado da mask de cada layer da peca antes de
              // criar o objeto Fabric. Permite inspecionar coords/tipo/schema
              // diretamente do console — util pra diagnosticar mask deslocada.
              if (layer.mask) {
                console.log("[piece-load-mask]", asset.label, {
                  type: layer.mask.type,
                  enabled: layer.mask.enabled,
                  schemaV: (layer.mask as any)._schemaV ?? "v1",
                  layer_pos: { x: layer.posX, y: layer.posY },
                  layer_scale: { x: layer.scaleX, y: layer.scaleY },
                  layer_size: { w: layer.width, h: layer.height },
                  mask_raster: layer.mask.raster,
                  mask_vector_summary: layer.mask.vector ? { posX: layer.mask.vector.posX, posY: layer.mask.vector.posY, w: layer.mask.vector.width, h: layer.mask.vector.height, pathLen: (layer.mask.vector.path || "").length } : null,
                })
              }
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
                if (layer.overrides.fill !== undefined) created.set("fill", layer.overrides.fill)
                if (layer.overrides.fontSize !== undefined) {
                  created.set("fontSize", clampTinyFontSize(layer.overrides.fontSize, layer.overrides.styles))
                }
                if (layer.overrides.fontFamily !== undefined) created.set("fontFamily", layer.overrides.fontFamily)
                if (layer.overrides.fontWeight !== undefined) created.set("fontWeight", layer.overrides.fontWeight)
                if (layer.overrides.fontStyle !== undefined) created.set("fontStyle", layer.overrides.fontStyle)
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
                  const migrated = migrateFlatStylesToLineIndexed(
                    (created as any).text ?? layer.text ?? "",
                    layer.overrides.styles
                  )
                  created.set("styles", migrated)
                  if (created.initDimensions) created.initDimensions()
                }
                ;(created as any).__pieceLayerIdx = sorted.indexOf(layer)
                // Em modo peca, deixa editavel pra permitir seleção de caracteres,
                // mas o key handler abaixo bloqueia digitacao real
              } else if (created) {
                ;(created as any).__pieceLayerIdx = sorted.indexOf(layer)
              }
              // Aplica mascara se o layer tiver. Acontece DEPOIS do objeto estar
              // criado e com overrides aplicados pra que a mascara use bounds
              // corretos. Async porque mascara raster precisa carregar Image.
              if (created && layer.mask) {
                const { Image: FabImage, Path } = await import("fabric")
                try {
                  await applyMaskToFabricObject({ Image: FabImage, Path }, created, layer.mask)
                  ;(created as any).dirty = true
                  // Forca renderAll APOS mascara aplicada. Sem isso, clipPath
                  // pode ficar 'mudo' ate proxima interacao (Fabric cache de
                  // render do objeto nao invalida automaticamente quando se
                  // seta clipPath programaticamente).
                  fc.requestRenderAll?.()
                } catch (e) {
                  srvLog("mask-APPLY-FAIL", { type: layer.mask?.type, label: (created as any)?.__assetLabel, err: String((e as any)?.message ?? e) })
                }
              }
              if (created) applyHiddenLockedToObject(created, layer)
              continue
            }
            // Layer EMBEDDED (peca importada PSD avulsa). Conteudo cru no proprio
            // layer.data. Cria objeto Fabric direto sem asset.
            if (layer.__embedded) {
              await addEmbeddedLayer(fc, layer)
              const objs = fc.getObjects()
              const created = objs[objs.length - 1] as any
              if (created && layer.mask) {
                const { Image: FabImage, Path } = await import("fabric")
                try {
                  await applyMaskToFabricObject({ Image: FabImage, Path }, created, layer.mask)
                  ;(created as any).dirty = true
                  // Forca renderAll APOS mascara aplicada. Sem isso, clipPath
                  // pode ficar 'mudo' ate proxima interacao (Fabric cache de
                  // render do objeto nao invalida automaticamente quando se
                  // seta clipPath programaticamente).
                  fc.requestRenderAll?.()
                } catch (e) {
                  srvLog("mask-APPLY-FAIL", { type: layer.mask?.type, label: (created as any)?.__assetLabel, err: String((e as any)?.message ?? e) })
                }
              }
              if (created) applyHiddenLockedToObject(created, layer)
              continue
            }
            // Layer orfao (nem asset valido nem embedded): pula com warning
            editorLog("[LOAD-PIECE] layer ignorado (sem asset valido nem __embedded):", layer)
          }
          fc.renderAll()
        } else if (pdata?.canvasData) {
          // LEGACY (v1): peca antiga com canvasData direto - mantem compatibilidade
          const sourceW = pdata?.sourceWidth ?? canvasWRef.current
          const sourceH = pdata?.sourceHeight ?? canvasHRef.current
          const targetW = canvasWRef.current
          const targetH = canvasHRef.current
          // Fabric v6 quirk: 2o arg eh REVIVER (per-obj), nao completion cb.
          // Aguarda apenas a Promise pra garantir todos os objetos carregados.
          await fc.loadFromJSON(pdata.canvasData)
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
          // DIAGNÓSTICO: quantos layers no KV vs quantos assets na campanha vs match
          const matched = sorted.filter((l: any) => l.assetId && assetMap[l.assetId]).length
          console.log("[LOAD-MATRIX-DIAG] KV layers:", sorted.length, "assets na campanha:", c.assets.length, "matched:", matched, "unmatched:", sorted.length - matched)
          // Prewarm cache (mesma logica do load de peca — IO paralelo).
          const kvImageUrls = Array.from(new Set(sorted
            .map((l: any) => assetMap[l.assetId])
            .filter((a: any) => a && (a.type === "IMAGE" || a.type === "SMART_OBJECT") && a.imageUrl)
            .map((a: any) => a.imageUrl as string)))
          if (kvImageUrls.length > 0) {
            await Promise.all(kvImageUrls.map(url => new Promise<void>(resolve => {
              const im = new window.Image()
              im.crossOrigin = "anonymous"
              im.onload = () => resolve()
              im.onerror = () => resolve()
              im.src = url
            })))
            if (!alive) return
          }
          for (const layer of sorted) {
            const asset = assetMap[layer.assetId] as Asset
            if (!asset) {
              skippedCount++
              if (!layer.assetId) {
                editorLog("[LOAD-MATRIX] layer com assetId vazio (campanha pode ter dados corrompidos antigos):", layer)
              } else {
                editorLog("[LOAD-MATRIX] layer aponta pra asset inexistente:", layer.assetId)
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
              if (ov.fontSize !== undefined) {
                created.set("fontSize", clampTinyFontSize(ov.fontSize, ov.styles))
              }
              if (ov.fontFamily !== undefined) created.set("fontFamily", ov.fontFamily)
              if (ov.fontWeight !== undefined) created.set("fontWeight", ov.fontWeight)
              if (ov.fontStyle !== undefined) created.set("fontStyle", ov.fontStyle)
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
            // Aplica mascara em layer da matriz tambem (estava so na peca antes).
            if (created && (layer as any).mask) {
              const { Image: FabImage, Path } = await import("fabric")
              try {
                await applyMaskToFabricObject({ Image: FabImage, Path }, created, (layer as any).mask)
                ;(created as any).dirty = true
                fc.requestRenderAll?.()
                srvLog("load-MATRIX-mask-applied", { type: (layer as any).mask?.type, label: (created as any)?.__assetLabel, maskDataPresent: !!(created as any).__maskData })
              } catch (e) {
                srvLog("mask-APPLY-FAIL-MATRIX", { type: (layer as any).mask?.type, label: (created as any)?.__assetLabel, err: String((e as any)?.message ?? e) })
              }
            } else if (created && (layer as any).mask === undefined) {
              // Sem nada a fazer — asset legitimamente sem mask.
            }
            if (created) applyHiddenLockedToObject(created, layer)
          }
        }
      }

      fc.renderAll()
      if (alive) refreshLayers(fc)
      // SAUDE: remove objetos orfaos (sem __assetId nem __embedded) que possam
      // ter vindo do banco ou de bugs antigos. Layers validos:
      //  - __assetId: linkado a um CampaignAsset (peca gerada ou linkada do PSD)
      //  - __embedded: conteudo cru gravado no piece.data (peca importada PSD avulsa)
      // Limpar aqui evita que entrem no undoStack e causem desync no undo/redo.
      const orphans = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay && !o.__assetId && !o.__embedded && !o.__isStrokeGhost)
      if (orphans.length > 0) {
        editorLog("[INIT-CLEAN]", pieceId ? "peca" : "matriz", "tinha", orphans.length, "objetos orfaos no canvas. Removendo.")
        for (const orphan of orphans) fc.remove(orphan)
        fc.renderAll()
        if (alive) refreshLayers(fc)
      }
      // Snapshot inicial (estado limpo, sem dirty)
      try {
        const snap = JSON.stringify((fc as any).toObject(HISTORY_PROPS_TO_INCLUDE))
        undoStack.current = [snap]
        redoStack.current = []
      } catch (e) {}
      isApplyingHistory.current = false
      // Marca init concluido — saves sao liberados a partir daqui. Antes disso, salvar
      // poderia gravar layers: [] (canvas ainda nao tinha objetos carregados).
      isInitialized.current = true
      // RESET dirty 2026-05-24: load/sync de brand colors durante init podia
      // marcar isDirty=true mesmo sem o user editar. Sem este reset, sair
      // logo depois de abrir o editor disparava "Save changes?" — falso
      // positivo. Apos init, estado representa "saved" ate o user editar.
      isDirtyRef.current = false
      setIsDirty(false)

      // Re-aplica clipping masks salvas (mask.type === "clipping") agora que
      // todos os objetos estao no canvas. applyMaskToFabric so anota
      // __clippingMask=true; o clipPath real depende do layer abaixo, entao
      // precisa rodar APOS todos os objects loaded (z-order completo).
      try {
        const objs = fc.getObjects().filter((o: any) =>
          (o as any).__maskData?.type === "clipping" && (o as any).__maskData?.enabled !== false
        )
        for (const o of objs) {
          await applyClippingMaskNative(fc, o)
        }
        if (objs.length > 0) fc.requestRenderAll()
      } catch (e) { console.warn("[init] re-apply clipping masks falhou:", e) }
      // RE-MEASURE textboxes se uma fonte chegou DEPOIS do init: o load pre-
      // request todas as fontes, mas se alguma demorou pra chegar no momento
      // de criar o Textbox, ele foi medido com fallback (Arial) — letras
      // ficam visualmente mais largas/compactas que o real. Quando a fonte
      // chegar via fonts.ready, re-mede tudo. Sem isso, tracking PSD
      // negativo aparece visualmente errado.
      if (typeof document !== "undefined" && (document as any).fonts?.ready) {
        ;(document as any).fonts.ready.then(() => {
          if (!alive || !isInitialized.current) return
          const objs = fc.getObjects()
          let touched = 0
          for (const o of objs) {
            if (o.type === "textbox" || o.type === "i-text") {
              if ((o as any).initDimensions) (o as any).initDimensions()
              touched++
            }
          }
          if (touched > 0) {
            fc.requestRenderAll()
            console.log("[fonts-ready] re-mediu", touched, "textboxes pos-load")
            // Reset dirty: re-medir textos pos-load nao e edit do user.
            isDirtyRef.current = false
            setIsDirty(false)
          }
        }).catch(() => {})
      }
      // Auto-gera thumbnails pra steps inativos sem preview (background).
      // Renderiza offscreen — nao mexe no canvas principal. User nao vê piscar.
      // RESET do flag pra rodar de novo nesta peca (cada init = nova oportunidade).
      autoGenDoneRef.current = false
      console.log("[init] terminou. pieceId:", pieceId, "vai chamar autoGen:", !!pieceId)
      try {
        const objs = fc.getObjects()
        const sample = objs.slice(0, 5).map((o: any) => ({
          t: o.type, vis: o.visible, op: o.opacity, hid: o.__hidden,
          l: Math.round(o.left ?? 0), tp: Math.round(o.top ?? 0),
          w: Math.round(o.width ?? 0), h: Math.round(o.height ?? 0),
          sx: o.scaleX, sy: o.scaleY,
          clip: !!o.clipPath, mask: !!o.__maskData,
        }))
        const vt = fc.viewportTransform
        console.log("[init-health] objects:", objs.length, "canvas:", fc.getWidth(), "x", fc.getHeight(), "zoom:", fc.getZoom(), "vt:", vt, "first5:", sample)
        ;(window as any).__fc = fc
      } catch (e) { console.warn("[init-health] erro:", e) }
      if (pieceId) {
        autoGenerateMissingStepThumbs().catch(e => console.warn("[auto-thumbs] erro:", e))
      }
      // AUTO-REGEN ON OPEN: SEMPRE regera o thumb 1.2s apos open (user
      // pediu 2026-05-30 "remover o if !hasThumb").
      // Razao: CLAUDE 2.2 (preview realtime) exige thumb sempre fresh. O
      // guard antigo `if (!hasThumb) skip` deixava thumbs stale acumular —
      // quando uma fonte/asset mudava em outra aba ou quando o bug do
      // forceLoadFontFaces (commit 82d5ee41) afetava render antigo, peca
      // ficava com thumb errado ATE o proximo save manual. Custo: 2-5s
      // background por abertura. Beneficio: zero stale thumb, zero fallback
      // Arial persistente. Combinado com awaitFontsReadyAndRender, todo
      // regen agora pega fonte real.
      setTimeout(() => {
        const fcc = fabricRef.current
        if (!alive || !fcc || !isInitialized.current) return
        if (pieceId) {
          uploadPieceThumb(fcc, pieceId).catch(e => editorLog("[auto-regen piece]", e))
        } else {
          uploadMatrixThumb(fcc).catch(e => editorLog("[auto-regen matrix]", e))
        }
      }, 1200)
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
      clearTimeout(autoFitTimer.current)
      // Flush dos PUTs debounceados pendentes antes do unmount — sem isso,
      // user editar e sair rapido podia perder a ultima mudanca (timer
      // cancelado, PUT nunca foi enviado).
      try {
        const p1 = lastOverridePendingPayload.current
        if (p1) {
          lastOverridePendingPayload.current = null
          fetch(`/api/campaigns/${campaignId}/assets/${p1.aid}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p1.payload), keepalive: true,
          }).catch(() => {})
        }
        const p2 = assetContentPendingPayload.current
        if (p2) {
          assetContentPendingPayload.current = null
          fetch(`/api/campaigns/${campaignId}/assets/${p2.aid}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p2.payload), keepalive: true,
          }).catch(() => {})
        }
      } catch {}
      clearTimeout(lastOverridePutTimer.current)
      clearTimeout(assetContentPutTimer.current)
      if (selectedTickRaf.current != null) { cancelAnimationFrame(selectedTickRaf.current); selectedTickRaf.current = null }
      // Revoga todos os blob URLs criados pelo SVG patcher. Em sessoes longas
      // ou com varios PSDs importados, a acumulacao chega a centenas de MB
      // (cada SVG vira um blob URL retido na memoria).
      try {
        for (const u of svgBlobUrlsRef.current) {
          try { URL.revokeObjectURL(u) } catch {}
        }
        svgBlobUrlsRef.current = []
      } catch {}
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
      isInitInProgress.current = false
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

  // SELECTION TRACKING NO UNDO (2026-05-28): user pediu que undo capture
  // "passo a passo" incluindo selecao/deselecao de layer. Cada snap embute
  // _selection = lista de identificadores estaveis dos objetos ativos. Apos
  // applySnapshot reativa via match por __assetId / __assetLabel.
  function identifyObj(o: any): string | null {
    if (!o || o.__isBleedOverlay || o.__isBg) return null
    if (o.__assetId) return `aid:${o.__assetId}`
    if (o.__assetLabel) return `lbl:${o.__assetLabel}`
    if (o.__embedded) return `emb:${Math.round(o.left ?? 0)},${Math.round(o.top ?? 0)}`
    return null
  }
  function getCurrentSelectionIds(fc: any): string[] {
    const active = fc?.getActiveObject?.()
    if (!active) return []
    const objs = active.type === "activeSelection"
      ? (typeof active.getObjects === "function" ? active.getObjects() : [])
      : [active]
    return objs.map((o: any) => identifyObj(o)).filter(Boolean) as string[]
  }
  async function restoreSelectionByIds(fc: any, ids: string[]) {
    if (!ids || ids.length === 0) {
      fc.discardActiveObject()
      fc.requestRenderAll()
      return
    }
    const objs = fc.getObjects().filter((o: any) => !o.__isBleedOverlay && !o.__isBg)
    const claimed = new Set<any>()
    const matched: any[] = []
    for (const id of ids) {
      const m = objs.find((o: any) => !claimed.has(o) && identifyObj(o) === id)
      if (m) { matched.push(m); claimed.add(m) }
    }
    if (matched.length === 0) {
      fc.discardActiveObject()
    } else if (matched.length === 1) {
      fc.setActiveObject(matched[0])
    } else {
      try {
        const { ActiveSelection } = await import("fabric")
        const sel = new ActiveSelection(matched, { canvas: fc })
        fc.setActiveObject(sel)
      } catch {
        fc.setActiveObject(matched[0])
      }
    }
    fc.requestRenderAll()
  }

  // pushHistory agora vem do hook useUndoHistory (lib/editor/useUndoHistory.ts).
  // Logica completa preservada la — incluindo ORPHAN HANDLING + DIAGNOSTICO de
  // MULTI-OBJ OVERRIDE DIFF + dedup contra topo + cap 100 entradas + redoStack
  // limpo + setHistoryTick + onMarkDirty callback.

  // Retorna true se aplicou com sucesso, false se abortou (circuit breaker).
  // Permite que undo()/redo() saibam reverter o pop quando o snap eh ruim.
  async function applySnapshot(snap: string): Promise<boolean> {
    const fc = fabricRef.current
    if (!fc) return false
    isApplyingHistory.current = true
    // Incrementa seq pra invalidar rebakes assincronos em voo (H1).
    const mySeq = ++applySnapshotSeq.current
    // Cancela qualquer save pendente IMEDIATAMENTE — antes do loadFromJSON disparar
    // eventos que poderiam re-agendar saves em estado transitorio.
    clearTimeout(saveTimer.current)
    // Import fabric uma vez pra acesso a util.stylesFromArray (converte styles
    // do formato ARRAY de serializacao pro OBJECT de runtime).
    let fabricUtil: any = null
    try { fabricUtil = (await import("fabric")).util } catch {}
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

      // CIRCUIT BREAKER: se o snap esta vazio mas o canvas atual tem objetos
      // validos, ABORTA o restore. Quase certamente o snap foi corrompido
      // (push num momento ruim) e aplica-lo apagaria todo o trabalho do user.
      // Sintoma reportado: "undo apaga tudo, vira bagunca". Melhor manter o
      // estado atual e remover o snap ruim do topo da pilha.
      const currentValidObjects = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay && (o.__assetId || o.__embedded))
      const snapValidObjects = (Array.isArray(snapData?.objects) ? snapData.objects : []).filter((s: any) => !s?.__isBg && !s?.__isBleedOverlay && (s?.__assetId || s?.__embedded))
      if (snapValidObjects.length === 0 && currentValidObjects.length > 0) {
        srvLog("undo-ABORT-empty-snap", { currentObjs: currentValidObjects.length })
        isApplyingHistory.current = false
        return false
      }

      // Fabric v6: 2o arg de loadFromJSON eh REVIVER (callback per-objeto), nao
      // callback de conclusao. Passar `() => resolve()` ali resolvia a Promise
      // no PRIMEIRO objeto desserializado, fazendo o resto do applySnapshot
      // rodar com `fc.getObjects()` ainda vazio (ou parcial). Resultado no log:
      // `[undo-RESTORE-COUNTS] restored:0, snap:4` — snapshot OK, canvas vazio.
      // Solucao: aguardar a Promise retornada (Fabric v6 sempre retorna Promise).
      await fc.loadFromJSON(snapData)

      // backgroundColor TRANSPARENT pra que a area de bleed (extra ao redor
      // da peca, pra handles ficarem clicaveis) mostre o fundo escuro do
      // editor por baixo, e nao a cor da peca. A cor real da peca e pintada
      // pelo Rect bgRef (do tamanho exato cw x ch) que adicionamos depois.
      ;(fc as any).backgroundColor = "transparent"
      ;(fc as any).backgroundImage = null
      ;(fc as any).overlayImage = null
      fc.renderAll() // render imediato com bg setado, antes de qualquer outro processamento

      // CRITICO 1: Fabric Textbox ignora `styles` no construtor. Apos loadFromJSON,
      // os textboxes restaurados perdem styles per-char. Reaplica manualmente do snapshot.
      // CRITICO 2: __assetId / __assetLabel / __embedded podem se perder na reconstrucao - garante.
      // CRITICO 3 (bug fix): filtramos BG dos restored, MAS snapObjects pode incluir o BG.
      // Isso desalinha os indices (restored[0] eh o 1o nao-BG, mas snapObjects[0] pode ser BG).
      // Solucao: filtra BG dos snapObjects tambem antes de iterar.
      const restored = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay)
      const snapObjectsNoBg = snapObjects.filter((s: any) => !s?.__isBg && !s?.__isBleedOverlay)
      // Sanidade: log detalhado pra debugar undo perdendo layers.
      srvLog("undo-RESTORE-COUNTS", {
        restored: restored.length,
        snap: snapObjectsNoBg.length,
        restoredTypes: restored.map((o: any) => `${o.type}:${o.__assetId ?? "noId"}`),
        snapTypes: snapObjectsNoBg.map((s: any) => `${s.type}:${s.__assetId ?? "noId"}`),
      })
      if (restored.length !== snapObjectsNoBg.length) {
        console.warn("[applySnapshot] mismatch: restored=", restored.length, "vs snap=", snapObjectsNoBg.length)
      }
      // ESTRATEGIA DE PAREAMENTO src↔restored — robusta contra:
      //  - reordenacao do loadFromJSON (raro mas possivel)
      //  - layers sobrepostos com type+position identicos (bug antigo: dois
      //    textos arrastados pra mesma coord colidiam no map por chave, undo
      //    pareava errado e __assetId/__maskData iam pro objeto errado —
      //    sintoma reportado pelo user: 'undo confunde layers, apaga tudo')
      // Niveis de match em ordem decrescente de confiabilidade:
      //  1. __assetId com FILA (queue por aid) — mesmo aid pode ter N copias,
      //     parea na ordem em que aparecem no snap vs no restored.
      //  2. __embedded com fila (PSD-avulso sem aid)
      //  3. Fallback POSITIONAL POR INDEX (mesma ordem do array de objects).
      // Sem mapeamento por chave colisiva.
      const buildQueues = (arr: any[]) => {
        const aidQ = new Map<string, any[]>()
        const embQ: any[] = []
        const rest: any[] = []
        for (const o of arr) {
          if (!o) continue
          if (o.__assetId) {
            const q = aidQ.get(o.__assetId) ?? []
            q.push(o)
            aidQ.set(o.__assetId, q)
          } else if (o.__embedded) {
            embQ.push(o)
          } else {
            rest.push(o)
          }
        }
        return { aidQ, embQ, rest }
      }
      const srcQ = buildQueues(snapObjectsNoBg)
      const restAidPos = new Map<string, number>() // contador per-aid pra fallback
      let embCursor = 0
      for (let i = 0; i < restored.length; i++) {
        const obj: any = restored[i]
        let src: any = null
        if (obj.__assetId) {
          const q = srcQ.aidQ.get(obj.__assetId)
          if (q && q.length > 0) {
            const idx = restAidPos.get(obj.__assetId) ?? 0
            src = q[idx]
            restAidPos.set(obj.__assetId, idx + 1)
          }
        } else if (obj.__embedded) {
          src = srcQ.embQ[embCursor++] ?? null
        }
        if (!src) {
          // Ultimo recurso: positional por index global no snap. Funciona quando
          // loadFromJSON preserva ordem (caso comum); falha graciosamente caso
          // contrario (props customizadas ficam ausentes pro objeto, save vai
          // bloquear no filtro __assetId).
          src = snapObjectsNoBg[i]
          if (!src) continue
          // Se src ja foi reclamado por __assetId acima, evita usa-lo de novo
          // (preferiu o match estavel). O proximo nao-aid pode acabar sem src,
          // o que e melhor que sobrescrever props erradas.
        }
        // CRITICO: Fabric loadFromJSON pode NÃO restaurar props customizadas
        // mesmo passando-as no toJSON. Restaurar EXPLICITAMENTE preservando
        // o valor original (mesmo se o obj atual já tem — sobrescreve com o
        // src pra garantir consistência com o snap).
        if (src.__assetId !== undefined) obj.__assetId = src.__assetId
        if (src.__assetLabel !== undefined) obj.__assetLabel = src.__assetLabel
        if (src.__isImage !== undefined) obj.__isImage = src.__isImage
        if (src.__hidden !== undefined) obj.__hidden = src.__hidden
        if (src.__locked !== undefined) obj.__locked = src.__locked
        // Layers embedded (PSD avulso importado): preserva flag + dataUrl da imagem
        if (src.__embedded) obj.__embedded = true
        if (src.imageDataUrl) obj.imageDataUrl = src.imageDataUrl
        // Brand ref do fill (texto vinculado a brand color do cliente)
        if (typeof src.__fillBrandIdx === "number") obj.__fillBrandIdx = src.__fillBrandIdx
        // PSD layer effects (dropShadow/stroke/outerGlow) — round-trip
        if (src.__psdEffects && typeof src.__psdEffects === "object") obj.__psdEffects = src.__psdEffects
        // PSD 'lnsr' (nameSource) — controla auto-rename de text layer no PS
        if (typeof src.__psdNameSource === "string") obj.__psdNameSource = src.__psdNameSource
        // groupPath: hierarquia de folders do PSD preservada
        if (Array.isArray(src.__groupPath) && src.__groupPath.length > 0) obj.__groupPath = src.__groupPath
        // Smart Object metadata preservada — re-export emite placedLayer nativo
        if (src.__isSmartObject === true) obj.__isSmartObject = true
        if (typeof src.__smartObjectGuid === "string") obj.__smartObjectGuid = src.__smartObjectGuid
        if (typeof src.__smartObjectMime === "string") obj.__smartObjectMime = src.__smartObjectMime
        if (typeof src.__smartObjectFilePath === "string") obj.__smartObjectFilePath = src.__smartObjectFilePath
        if (typeof src.__smartObjectOriginalName === "string") obj.__smartObjectOriginalName = src.__smartObjectOriginalName
        // Restaurar styles per-char em textboxes. SEMPRE restaura (mesmo se
        // src.styles for vazio) — antes pulava quando vazio, mas isso deixava
        // obj.styles com o conteudo anterior (do estado pos-loadFromJSON) em
        // vez de zerar. User reportou 2026-05-22: "undo desconfigura outro
        // layer de texto, perdendo overrides de cor".
        //
        // Fix robusto:
        //  - DEEP CLONE pra evitar reference sharing entre snap e canvas
        //  - obj.styles = direct assign (set("styles", ...) pode passar por
        //    paths internos de Fabric que normalizam/clobbam)
        //  - dirty + _styleMap=null pra invalidar cache do Textbox
        //  - initDimensions pra re-medir
        if (obj.type === "textbox" || obj.type === "i-text") {
          // FORCE-RESTORE de TODAS as props textuais do snap (single source of
          // truth). loadFromJSON deveria restaurar via construtor, mas na
          // pratica varias props somem ou voltam com default — sintoma
          // reportado pelo user 2026-05-23: "peso da fonte se perde no undo,
          // o mesmo padrao acontece com fonte/cor/entrelinhas/entreletras".
          // Solucao proativa: enumera TODAS as props que entram no snap e
          // re-seta direto na instance, sem depender do Fabric construtor.
          const TEXT_PROPS = [
            "text", "fill", "fontSize", "fontFamily", "fontWeight",
            "fontStyle", "charSpacing", "lineHeight", "textAlign",
            "underline", "overline", "linethrough",
            "stroke", "strokeWidth", "strokeUniform",
            "width", "height", "left", "top", "scaleX", "scaleY", "angle",
            "opacity", "globalCompositeOperation", "visible",
          ]
          for (const k of TEXT_PROPS) {
            if (src[k] !== undefined) (obj as any)[k] = src[k]
          }
          // styles per-char — CRITICO: Fabric serializa em ARRAY format
          // (stylesToArray: [{start,end,style}]) pro snap mas runtime usa
          // OBJECT format ({line: {col: style}}). Sem converter, assignar o
          // array direto QUEBRA per-char styles (fontWeight/fill/fontSize
          // sumiam visualmente — sintoma user "perde peso da fonte no undo").
          // util.stylesFromArray converte; handle ambos formatos (no-op se
          // ja for object).
          const srcStyles = src.styles ?? {}
          const objectStyles = fabricUtil?.stylesFromArray
            ? fabricUtil.stylesFromArray(srcStyles, src.text ?? obj.text ?? "")
            : srcStyles
          // DEEP CLONE pra evitar reference sharing entre snap e canvas
          const cloned = typeof structuredClone === "function"
            ? structuredClone(objectStyles)
            : JSON.parse(JSON.stringify(objectStyles))
          ;(obj as any).styles = cloned
          ;(obj as any).dirty = true
          if ((obj as any)._styleMap) (obj as any)._styleMap = null
          // leadingPt (custom prop) + override de instance.
          // applyLeadingPtToFabric instala overrides de INSTANCE no textbox
          // (_fontSizeMult=1.0 via Object.defineProperty + getHeightOfLineImpl
          // override). loadFromJSON cria nova instance — esses overrides somem.
          // Sem reaplicar: _fontSizeMult volta pro default 1.13, lineHeight no
          // snap eh leadingPt/ascender (~0.6), resultado: getHeightOfLine ≈
          // 1.5 × leadingPt — leading 50% maior. Re-aplicar restaura PSD.
          if (typeof src.leadingPt === "number" && src.leadingPt > 0) {
            ;(obj as any).leadingPt = src.leadingPt
          }
          if (obj.initDimensions) obj.initDimensions()
          if (obj.setCoords) obj.setCoords()
          if (typeof (obj as any).leadingPt === "number" && (obj as any).leadingPt > 0) {
            applyLeadingPtToFabric(obj, (obj as any).leadingPt)
          }
        } else if (obj.type === "path" || obj.type === "Path" || (obj as any).__isShape === true) {
          // Mesma logica pra SHAPE — force-restore das props basicas.
          // Sintoma reportado: undo "perdia" fill/stroke/cornerRadius do shape.
          const SHAPE_PROPS = [
            "fill", "stroke", "strokeWidth", "strokeUniform", "fillRule",
            "left", "top", "scaleX", "scaleY", "angle",
            "opacity", "globalCompositeOperation", "visible",
          ]
          for (const k of SHAPE_PROPS) {
            if (src[k] !== undefined) (obj as any)[k] = src[k]
          }
          // __shapeKind / __cornerRadius / __pathBbox sao customs — restaura
          // explicito (alem dos __* tratados acima)
          if (src.__shapeKind !== undefined) (obj as any).__shapeKind = src.__shapeKind
          if (typeof src.__cornerRadius === "number") (obj as any).__cornerRadius = src.__cornerRadius
          if (src.__pathBbox) (obj as any).__pathBbox = src.__pathBbox
          if (obj.setCoords) obj.setCoords()
          ;(obj as any).dirty = true
        } else {
          // IMAGE e outros: restaura props basicas de transform/visibilidade
          const BASIC_PROPS = [
            "left", "top", "scaleX", "scaleY", "angle",
            "opacity", "globalCompositeOperation", "visible",
          ]
          for (const k of BASIC_PROPS) {
            if (src[k] !== undefined) (obj as any)[k] = src[k]
          }
          if (obj.setCoords) obj.setCoords()
        }
        // Restaurar mascara: clipPath reconstruido pelo loadFromJSON pode estar
        // quebrado (e.g. Image clipPath nao re-carrega o dataUrl). Re-aplicamos
        // do __maskData original — fonte da verdade do LayerMask.
        if (src.__maskData) {
          obj.__maskData = src.__maskData
          // Recria anchor de mask-tracking. Sem isso, mover layer pos-undo
          // faria a mask "saltar" (delta calculado em relacao a anchor zerado).
          obj.__maskAnchor = {
            left: obj.left ?? 0, top: obj.top ?? 0,
            scaleX: obj.scaleX ?? 1, scaleY: obj.scaleY ?? 1,
          }
          const { Image: FabImage, Path } = await import("fabric")
          obj.clipPath = null
          // PARA IMAGES COM RASTER MASK: re-baka a mask no bitmap. Fabric v7
          // nao tem alpha-mask via clipPath (Image clipPath vira silhueta
          // solida). No load inicial fazemos via composeRasterMaskIntoImage;
          // no undo o snap serializou src=URL original (sem bake), entao
          // o bake se perde. Aqui re-bakamos pra restaurar o visual identico.
          if (obj.type === "image" && src.__maskData.type === "raster" && src.__maskData.raster?.dataUrl && src.__maskData.enabled !== false) {
            try {
              // Pega o element atual (imagem ja carregada pelo loadFromJSON)
              const el = (obj as any)._element ?? (obj as any).getElement?.()
              if (el) {
                const naturalW = (el as any).naturalWidth || (el as any).width || 1
                const naturalH = (el as any).naturalHeight || (el as any).height || 1
                const posX = obj.left ?? 0
                const posY = obj.top ?? 0
                const composed = await composeRasterMaskIntoImage(
                  el, src.__maskData.raster, posX, posY, naturalW, naturalH,
                  !!src.__maskData.inverted,
                  obj.scaleX ?? 1, obj.scaleY ?? 1,
                )
                // Aborta se outro applySnapshot disparou enquanto isto estava
                // em voo — escrever _element agora sobrescreve rebake mais novo (H1).
                if (mySeq !== applySnapshotSeq.current) {
                  srvLog("undo-MASK-REBAKE-STALE", { label: (obj as any).__assetLabel })
                } else if (composed) {
                  if (typeof (obj as any).setElement === "function") {
                    ;(obj as any).setElement(composed)
                  } else {
                    ;(obj as any)._element = composed
                    ;(obj as any)._originalElement = composed
                  }
                  ;(obj as any).dirty = true
                  srvLog("undo-MASK-REBAKE-OK", { label: (obj as any).__assetLabel, w: composed.width, h: composed.height })
                }
              }
            } catch (e) {
              srvLog("undo-MASK-REBAKE-FAIL", { label: (obj as any).__assetLabel, err: String((e as any)?.message ?? e) })
            }
          } else {
            // Vector ou clipping mask: usa o caminho clipPath padrao (alpha
            // nao eh necessario, Fabric clipPath funciona bem com paths).
            await applyMaskToFabricObject({ Image: FabImage, Path }, obj, src.__maskData)
          }
        }
      }
      // CLIPPING MASKS — segundo passe. applyMaskToFabricObject acima NAO
      // recria clipPath pra type=clipping (so seta __maskData). O clipPath
      // real eh clonado do layer ABAIXO via applyClippingMaskNative — mas
      // isso depende dos layers ja estarem no canvas na ordem correta, entao
      // roda depois do loop principal. Sem esse passe, undo de movimento em
      // layer com clipping mask removia o efeito visual (user reportou
      // 2026-05-26 "undo na posicao desfaz tambem a mascara clip layer below").
      //
      // ANTI-FALHAS 2026-05-26:
      // 1. Re-computa `all` a cada iteracao (defensivo — caso loadFromJSON
      //    reorder os objetos vs restored array).
      // 2. Valida idx > 0 && base existe ANTES de chamar (evita clipPath
      //    apontando pra null/bg quando base foi deletado pre-snap).
      // 3. Passa mySeq pro applyClippingMaskNative pra abortar se outra
      //    applySnapshot disparar durante o await base.clone() (race).
      for (let i = 0; i < restored.length; i++) {
        const obj: any = restored[i]
        const md = obj?.__maskData
        if (!(md?.type === "clipping" && md?.enabled !== false)) continue
        const allNow = fc.getObjects().filter((o: any) =>
          !o.__isBg && !o.__isBleedOverlay && !o.__isStrokeGhost
        )
        const idxNow = allNow.indexOf(obj)
        if (idxNow <= 0 || !allNow[idxNow - 1]) {
          // Sem base valida — limpa clipPath em vez de aplicar (evita estado fantasma).
          obj.clipPath = null
          obj.dirty = true
          continue
        }
        try { await applyClippingMaskNative(fc, obj, mySeq) } catch (e) {
          console.warn("[undo-restore-clipping]", e)
        }
        // Aborta loop inteiro se applySnapshot novo disparou.
        if (mySeq !== applySnapshotSeq.current) break
      }

      // DESABILITADO 2026-05-18: orphan cleanup pos-restore removia layers
      // validos depois do undo. Causa: indexacao por posicao entre
      // fc.getObjects() e snapObjectsNoBg podia divergir (ex: ordem que
      // loadFromJSON cria os objetos != ordem do snapshot), entao
      // __assetId/__embedded eram atribuidos pro objeto ERRADO; objetos com
      // __assetId virando "orfaos" pelo filtro, e a limpeza apagava-os do
      // canvas. Sintoma reportado pelo user: 'Cmd+Z faz o layer sumir'.
      // Mantemos o log de diagnostico mas NAO removemos. Objetos com problema
      // de restauracao ficam no canvas; se realmente forem fantasma serao
      // limpos no proximo save (ja tem filtro la). Continuidade do undo
      // stack tem prioridade sobre limpeza imediata.
      const orphansAfterRestore = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay && !o.__assetId && !o.__embedded && !o.__isStrokeGhost)
      if (orphansAfterRestore.length > 0) {
        srvLog("undo-RESTORE-ORPHANS", { count: orphansAfterRestore.length, types: orphansAfterRestore.map((o: any) => o.type) })
      }

      // CRITICO 3: BGs tem excludeFromExport=true, ficam fora do snapshot.
      // Re-cria todos os BG layers (idx 0 = fundo).
      const fabricMod: any = await import("fabric")
      const { Rect } = fabricMod
      const newBgRects: any[] = []
      for (let i = 0; i < bgLayersRef.current.length; i++) {
        const ld = bgLayersRef.current[i]
        const r = new Rect({
          left: 0, top: 0, width: canvasWRef.current, height: canvasHRef.current,
          selectable: true, evented: true,
          hasControls: false, hasBorders: true,
          lockMovementX: true, lockMovementY: true,
          lockScalingX: true, lockScalingY: true, lockRotation: true,
          excludeFromExport: true,
        })
        await syncBgLayerToRect(r, ld, canvasWRef.current, canvasHRef.current, fabricMod)
        ;(r as any).__isBg = true
        ;(r as any).__bgIdx = i
        ;(r as any).__assetLabel = i === 0 ? "Background" : `Background ${i + 1}`
        ;(r as any).__hidden = ld.hidden === true
        ;(r as any).__locked = ld.locked === true
        fc.add(r)
        newBgRects.push(r)
      }
      bgRectsRef.current = newBgRects
      bgRef.current = newBgRects[0]
      // sendObjectToBack manda pro fundo. Iterando do topo pro fundo, o ultimo
      // a ser enviado fica no fundo absoluto — assim idx 0 termina no fundo.
      for (let i = newBgRects.length - 1; i >= 0; i--) fc.sendObjectToBack(newBgRects[i])
      // Recria os bleed overlays — tambem ficam fora do snapshot (excludeFromExport)
      // e precisam ser re-adicionados no topo do z-stack apos restore.
      const fc2 = fc
      const fullW = (fabricRef as any).__canvasFullW ?? fc2.getWidth()
      const fullH = (fabricRef as any).__canvasFullH ?? fc2.getHeight()
      createBleedOverlays(fc, Rect, canvasWRef.current, canvasHRef.current, fullW, fullH, zoomRef.current || 1)
      // Reaplica clipPath ao canvas (loadFromJSON pode ter resetado).
      ;(fc as any).clipPath = new Rect({
        left: 0, top: 0, width: canvasWRef.current, height: canvasHRef.current,
        absolutePositioned: true,
      })

      // ANTI-FALHAS 2026-05-26: RE-SYNC clipping masks APOS BG recreation +
      // sendObjectToBack. Esses reorderings podem deslocar idx dos objetos no
      // canvas → applyClippingMaskNative do second pass (que rodou antes)
      // poderia ter pego base errada. Re-aplica usando ordem FINAL do canvas.
      // Bug recorrente: undo de movimento desfaz mask. Aqui garantimos que
      // pos-restore o clipping aponta SEMPRE pro layer correto abaixo.
      try {
        const allFinal = fc.getObjects().filter((o: any) =>
          !o.__isBg && !o.__isBleedOverlay && !o.__isStrokeGhost
        )
        for (const obj of allFinal) {
          const md = (obj as any)?.__maskData
          if (md?.type === "clipping" && md?.enabled !== false) {
            await applyClippingMaskNative(fc, obj, mySeq)
            if (mySeq !== applySnapshotSeq.current) break
          }
        }
      } catch (e) { console.warn("[undo-clipping-resync-post-bg]", e) }

      fc.renderAll()
      refreshLayers(fc)
      // BRAND RESYNC POS-UNDO: snaps antigos podem ter fills/cores DESATUALIZADOS
      // se brand color do cliente mudou entre o momento do snap e agora. Sem
      // este sync, undo "desfazia" brand changes que NAO foram acao do user —
      // sintoma: "undo na posicao de um layer reseta override de outro layer".
      // Re-aplica os fills atuais aos objetos que tem __fillBrandIdx, e cores
      // atuais aos bgLayers que tem colorBrandIdx. Continua dentro do guard
      // isApplyingHistory=true pra nao disparar push automatico.
      try {
        syncBrandRefsInBgLayers()
        syncBrandRefsInTextObjects(fc)
        fc.renderAll()
      } catch {}
      // RESTAURA SELECAO do snap. Dentro do guard isApplyingHistory pra que
      // setActiveObject/discard NAO disparem pushHistory em loop. 2026-05-28.
      try {
        const savedSel: string[] = Array.isArray(snapData?._selection) ? snapData._selection : []
        await restoreSelectionByIds(fc, savedSel)
      } catch (e) { console.warn("[applySnapshot] restore selection:", e) }
    } catch (e) {
      console.warn("applySnapshot fail:", e)
      clearTimeout(saveTimer.current)
      isApplyingHistory.current = false
      return false
    }
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
    return true
  }

  async function undo() {
    if (undoStack.current.length < 2) return
    // Re-entrancy guard: undo/redo clicados rapido em sequencia podem
    // iniciar um segundo applySnapshot enquanto o primeiro ainda esta no
    // await loadFromJSON ou mask rebake. Resultado: canvas em estado misto
    // de dois snaps, listeners de Fabric disparando em ordem imprevisivel.
    // Sintoma reportado pelo user: 'undo confunde os layers, apaga tudo'.
    if (isApplyingHistory.current) return
    const fc = fabricRef.current
    if (!fc) return
    // Topo da pilha eh o estado atual; guarda no redo e aplica o anterior
    const current = undoStack.current.pop()!
    const previous = undoStack.current[undoStack.current.length - 1]
    if (!previous) {
      undoStack.current.push(current)
      return
    }
    const ok = await applySnapshot(previous)
    if (!ok) {
      // applySnapshot abortou (snap ruim). Restaura a pilha pra estado antes
      // do undo — sem isso, redoStack ganhava um snap que nunca foi aplicado
      // e undo seguinte pulava pra um estado inconsistente.
      undoStack.current.push(current)
      return
    }
    redoStack.current.push(current)
    setSelected(null)
    setHistoryTick(t => t + 1)
  }

  async function redo() {
    if (redoStack.current.length === 0) return
    // Re-entrancy guard (mesmo motivo do undo).
    if (isApplyingHistory.current) return
    const next = redoStack.current.pop()!
    const ok = await applySnapshot(next)
    if (!ok) {
      // Mesmo tratamento do undo: snap ruim, devolve pro redoStack pra nao
      // perder o estado nem deixar a pilha incoerente.
      redoStack.current.push(next)
      return
    }
    undoStack.current.push(next)
    setSelected(null)
    setHistoryTick(t => t + 1)
  }

  function fitLayerToCanvas() {
    // FIT = encaixar a 100% (menor lado limita) E centralizar no canvas.
    // Botoes 20/40/60/80% nao centralizam (so escalam ancorado no centro do obj).
    scaleLayerToCanvas(1, true)
  }

  /**
   * Escala o layer pra que sua MAIOR dimensao ocupe N% da MENOR dimensao da peca.
   * E uma operacao ABSOLUTA: clicar 20% duas vezes da o mesmo resultado.
   * Isso evita "pulos cumulativos" e bate com o comportamento intuitivo (Photoshop:
   * o usuario quer um tamanho-alvo, nao um delta).
   *
   * percent: 0.2 = 20%, 0.4 = 40%, ..., 1.0 = 100% (caber inteiro - menor lado limita).
   * recenter: se true, centraliza no canvas. Se false (default), ancora no centro
   *           atual do objeto (so muda tamanho, posicao visual fica igual).
   */
  function scaleLayerToCanvas(percent: number, recenter: boolean = false) {
    const fc = fabricRef.current
    const obj: any = selected
    if (!fc || !obj) return
    const cw = canvasWRef.current, ch = canvasHRef.current
    const ow = obj.width ?? 100
    const oh = obj.height ?? 100
    if (!ow || !oh) return
    const isText = obj.type === "textbox" || obj.type === "i-text"

    // CALCULO ABSOLUTO: pega o tamanho fisico atual do objeto (incluindo scale),
    // descobre o tamanho-alvo, depois aplica.
    // Tamanho atual fisico:
    const curScaleX = obj.scaleX ?? 1
    const curScaleY = obj.scaleY ?? 1
    const curPhysW = ow * curScaleX
    const curPhysH = oh * curScaleY
    // Centro-alvo: se recenter, centro do canvas; senao, centro atual do objeto.
    // recenter=true (Encaixar): centraliza no canvas.
    // recenter=false (20/40/60/80): ancora no centro atual — so muda tamanho.
    const curLeft = obj.left ?? 0
    const curTop = obj.top ?? 0
    const centerX = recenter ? cw / 2 : (curLeft + curPhysW / 2)
    const centerY = recenter ? ch / 2 : (curTop + curPhysH / 2)
    // Tamanho-alvo: a maior dimensao do objeto vai ocupar `percent` da menor dimensao da peca.
    // (igual Photoshop Image Size com Constrain Proportions ligado.)
    const minCanvas = Math.min(cw, ch)
    const maxObj = Math.max(curPhysW, curPhysH)
    if (maxObj < 0.001) return
    // Fator que faz maxObj virar minCanvas * percent.
    const factor = (minCanvas * percent) / maxObj

    if (isText) {
      // Textbox: NUNCA usar scaleX/scaleY no objeto Fabric pra mudar tamanho.
      // Consolida em fontSize + width + styles per-char + leadingPt direto.
      const curFontSize = obj.fontSize ?? 48
      const newFontSize = curFontSize * factor
      const newWidth = ow * factor
      const curLeadingPt: number | undefined | null = (obj as any).leadingPt
      if (curLeadingPt !== undefined && curLeadingPt !== null) {
        ;(obj as any).leadingPt = curLeadingPt * factor
      }
      if (obj.styles && typeof obj.styles === "object") {
        for (const lineKey of Object.keys(obj.styles)) {
          const line = obj.styles[lineKey]
          for (const colKey of Object.keys(line)) {
            const cs = line[colKey]
            if (typeof cs.fontSize === "number") cs.fontSize = cs.fontSize * factor
          }
        }
      }
      obj.set({ fontSize: newFontSize, width: newWidth, scaleX: 1, scaleY: 1 })
      if (obj.initDimensions) obj.initDimensions()
      // Match exato baseline-to-baseline com PSD (mede factor real).
      if (curLeadingPt !== undefined && curLeadingPt !== null) {
        applyLeadingPtToFabric(obj, (obj as any).leadingPt)
      }
      // Re-mede e ancora no centro original (mantem posicao visual, so muda tamanho)
      const effW = (obj.width ?? newWidth)
      const effH = (obj.height ?? newFontSize)
      obj.set({ left: centerX - effW / 2, top: centerY - effH / 2 })
    } else {
      // Imagens/shapes: scaleX/scaleY legitimos. Aplica factor por cima do scale atual.
      const newScaleX = curScaleX * factor
      const newScaleY = curScaleY * factor
      const newPhysW = ow * newScaleX
      const newPhysH = oh * newScaleY
      // Ancora no centro original: mantem posicao visual, so muda tamanho.
      obj.set({ scaleX: newScaleX, scaleY: newScaleY, left: centerX - newPhysW / 2, top: centerY - newPhysH / 2 })
    }
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
    // Force re-render do LayerPanel mesmo se setLayers nao detectar mudanca
    // (defensivo): bump no selectedTick + bump no layerVersion. Sintoma 2026-05-23:
    // "rename salva no DB mas preview do editor nao muda — precisa entrar e sair".
    setSelectedTick(t => t + 1)
    setLayerVersion(v => v + 1)
    // Persiste no banco via canonical writer (CORE 2)
    try {
      const { putAsset } = await import("@/lib/assetWriter")
      await putAsset(campaignId, assetId, { label: trimmed })
      // Atualiza state da campanha em memoria
      setCampaign(prev => prev ? {
        ...prev,
        assets: prev.assets.map(a => a.id === assetId ? { ...a, label: trimmed } : a),
      } : prev)
      // Re-refresh apos campanha sync — algumas vias renderizam label a partir
      // de campaign.assets em vez de obj.__assetLabel.
      refreshLayers(fc)
      setLayerVersion(v => v + 1)
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
      // Canvas DOM mantem o tamanho fixo (toda area visivel). Mudanca de zoom
      // recentraliza a peca via viewportTransform e redimensiona overlays.
      const fullW = (fabricRef as any).__canvasFullW ?? fc.getWidth()
      const fullH = (fabricRef as any).__canvasFullH ?? fc.getHeight()
      const cw = canvasWRef.current
      const ch = canvasHRef.current
      const offsetX = (fullW - cw * z) / 2
      const offsetY = (fullH - ch * z) / 2
      const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
      vt[0] = z; vt[3] = z
      vt[4] = offsetX
      vt[5] = offsetY
      fc.setViewportTransform(vt)
      // Re-dimensiona os overlays pra cobrirem a nova area fora da peca.
      // Mais simples: remove e recria com novos parametros.
      // SYNC: usa Rect via constructor de bg/overlay existente (evita race
      // do `await import("fabric")` que deixava o canvas SEM overlays por
      // 1 frame entre o remove e o async create — visivel durante zoom alto).
      const existingOverlays = (fc as any).__bleedOverlays as any[] | undefined
      const RectCtor: any = existingOverlays?.[0]?.constructor
        ?? bgRectsRef.current?.[0]?.constructor
      if (existingOverlays) {
        for (const o of existingOverlays) fc.remove(o)
      }
      if (RectCtor) {
        createBleedOverlays(fc, RectCtor, cw, ch, fullW, fullH, z)
      } else {
        // Fallback async (so chega aqui na primeira vez antes de qualquer obj
        // ter sido criado — improvavel mas seguro).
        ;(async () => {
          const { Rect } = await import("fabric")
          createBleedOverlays(fc, Rect, cw, ch, fullW, fullH, z)
          fc.renderAll()
        })()
      }
      fc.renderAll()
    } catch (e) { console.warn("applyZoom fail:", e) }
  }

  /**
   * Cria um objeto Fabric a partir de um layer EMBEDDED (sem asset vinculado).
   * Usado em pecas importadas de PSD avulso onde o layer nao tem match com
   * nenhum CampaignAsset. Conteudo cru vem direto do proprio layer:
   *  - TEXT: text, fontFamily, fontSize, fontWeight, fill, textAlign, styles
   *  - IMAGE: imageDataUrl (base64 data URL gravado no piece.data)
   * Marca o objeto com __embedded = true pra survive ao save/load.
   */
  async function addEmbeddedLayer(fc: any, layer: any) {
    const { Textbox, FabricImage } = await import("fabric")
    const posX = layer?.posX ?? 100
    const posY = layer?.posY ?? 100
    const width = layer?.width ?? 400
    const height = layer?.height ?? 200
    const scaleX = layer?.scaleX ?? 1
    const scaleY = layer?.scaleY ?? 1

    if (layer.type === "TEXT") {
      const tb = new Textbox(layer.text ?? "", {
        left: posX, top: posY,
        width,
        fontFamily: layer.fontFamily ?? "Arial",
        fontSize: layer.fontSize ?? 48,
        fontWeight: layer.fontWeight ?? "normal",
        fill: layer.fill ?? "#111111",
        textAlign: layer.textAlign ?? "left",
        scaleX, scaleY,
        angle: layer.rotation ?? 0,
      })
      if (layer.styles && Object.keys(layer.styles).length > 0) {
        tb.set("styles", layer.styles)
        if (tb.initDimensions) tb.initDimensions()
      }
      ;(tb as any).__embedded = true
      ;(tb as any).__assetLabel = "(embedded)"
      if (Array.isArray(layer.groupPath) && layer.groupPath.length > 0) (tb as any).__groupPath = layer.groupPath
      fc.add(tb)
    } else if (layer.type === "IMAGE") {
      const dataUrl = layer.imageDataUrl
      if (!dataUrl) {
        editorLog("[addEmbeddedLayer] IMAGE sem imageDataUrl, ignorando:", layer)
        return
      }
      // Carrega via HTMLImageElement (FabricImage.fromURL pode falhar silenciosamente com base64)
      await new Promise<void>((resolve) => {
        const htmlImg = new Image()
        htmlImg.crossOrigin = "anonymous"
        htmlImg.onload = () => {
          const fabImg = new FabricImage(htmlImg, {
            left: posX, top: posY,
            scaleX, scaleY,
            angle: layer.rotation ?? 0,
          })
          // Mantem dataUrl original pra round-trip ao salvar (a FabricImage perde
          // o src embedded em algumas conversoes; gravamos a parte na prop custom).
          ;(fabImg as any).imageDataUrl = dataUrl
          ;(fabImg as any).__embedded = true
          ;(fabImg as any).__assetLabel = "(embedded)"
          if (Array.isArray(layer.groupPath) && layer.groupPath.length > 0) (fabImg as any).__groupPath = layer.groupPath
          fc.add(fabImg)
          resolve()
        }
        htmlImg.onerror = () => {
          editorLog("[addEmbeddedLayer] falha ao carregar imagem embedded")
          resolve()
        }
        htmlImg.src = dataUrl
      })
    }
  }

  // Aplica layer effects do PSD (drop shadow, stroke, outer glow) num
  // Fabric object. Drop shadow e outer glow viram shadow nativo (ZZOSY só
  // suporta UM shadow por object — drop shadow ganha precedência sobre glow).
  // Stroke vira stroke nativo do Fabric.
  // ShadowClass passada como param: Fabric v7 exige Shadow INSTANCE (não plain
  // object) — passar {color,blur,...} cru faz render virar branco silenciosamente.
  // COBERTURA VISUAL:
  //  - dropShadow, outerGlow         → Fabric shadow
  //  - stroke                        → fabric stroke/strokeWidth
  //  - colorOverlay (texto/forma)    → override do fill
  //  - gradientOverlay (texto/forma) → fill como fabric Gradient
  // PRESERVADOS NO JSON (sem render visual ainda):
  //  - innerShadow, innerGlow, bevel, satin, patternOverlay
  //  Esses exigem offscreen comp custom; ficam preservados pra round-trip ao
  //  re-exportar pro Photoshop (designer vê o efeito ao re-abrir o PSD).
  /**
   * Compose effect color with its own opacity into rgba string.
   * F12.14: cada effect tem opacity propria; precisa multiplicar com cor
   * hex pra Fabric.Shadow color aplicar visualmente. Antes "rgba(0,0,0,0.5)"
   * era hardcoded — agora respeita effect.opacity do PSD.
   */
  function effectColorWithOpacity(color: string | undefined, opacity: number | undefined, fallback: string): string {
    const op = typeof opacity === "number" ? Math.max(0, Math.min(1, opacity)) : 1
    if (!color) return fallback
    // Color hex sem alpha (#rrggbb) → adiciona alpha
    const m = /^#([0-9a-f]{6})$/i.exec(color)
    if (m) {
      const r = parseInt(m[1].slice(0, 2), 16)
      const g = parseInt(m[1].slice(2, 4), 16)
      const b = parseInt(m[1].slice(4, 6), 16)
      return `rgba(${r}, ${g}, ${b}, ${op})`
    }
    // Color rgba(...) com alpha existente → multiplica
    const rgba = /^rgba\(([^)]+)\)$/i.exec(color)
    if (rgba) {
      const parts = rgba[1].split(",").map(s => s.trim())
      if (parts.length === 4) {
        const a = parseFloat(parts[3]) * op
        return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${a})`
      }
    }
    return color
  }

  /**
   * Aplica layer effects do PSD num Fabric object.
   *
   * @param opts.overlaysOnly Quando true, aplica APENAS colorOverlay/gradientOverlay
   * e pula dropShadow/outerGlow/stroke. Usado pra Smart Objects (pixelsIncludeEffects=true)
   * onde o composite raster do ag-psd ja vem com shadow/glow/stroke baked, MAS NAO com
   * colorOverlay/gradientOverlay aplicados (Layer Styles na layer wrapper sao separados
   * do nested composite). Sem este split, logo branco via Color Overlay sumia no editor
   * apesar de aparecer perfeito no preview server-side.
   */
  function applyFabricEffects(obj: any, effects: any, ShadowClass: any, opts?: { overlaysOnly?: boolean }) {
    if (!effects) return
    const overlaysOnly = opts?.overlaysOnly === true
    // F12.14: dropShadow + outerGlow agora respeitam opacity per-effect via
    // rgba() composto. Antes hardcoded "0.5" no fallback ignorava o valor.
    if (!overlaysOnly && effects.dropShadow) {
      const d = effects.dropShadow
      // Adobe angle eh em graus: 0=direita, 90=baixo. Distance + angle viram offsetX/Y.
      const angleRad = ((d.angle ?? 120) * Math.PI) / 180
      const dist = d.distance ?? 5
      const offsetX = Math.cos(angleRad) * dist
      const offsetY = Math.sin(angleRad) * dist
      obj.set("shadow", new ShadowClass({
        color: effectColorWithOpacity(d.color, d.opacity, "rgba(0,0,0,0.5)"),
        offsetX,
        offsetY,
        blur: d.blur ?? 5,
      }))
    } else if (!overlaysOnly && effects.outerGlow) {
      const g = effects.outerGlow
      obj.set("shadow", new ShadowClass({
        color: effectColorWithOpacity(g.color, g.opacity, "rgba(255,255,255,0.5)"),
        offsetX: 0, offsetY: 0,
        blur: g.blur ?? 5,
      }))
    }
    if (!overlaysOnly && effects.stroke && effects.stroke.color) {
      // F12.14: stroke effect agora respeita opacity (se diferente de 1)
      // via rgba composto. Sem isso opacity era ignorado.
      //
      // CRITICO: SHAPE com vectorStroke proprio (PS Properties bar Stroke) +
      // Layer Style Stroke (effects.stroke) sao 2 strokes INDEPENDENTES no
      // PS. Antes, applyFabricEffects sobrescrevia obj.stroke (que tinha o
      // vectorStroke) com effects.stroke → vectorStroke perdido.
      // Fix: pra SHAPE com stroke proprio, PRESERVA vectorStroke e nao
      // aplica effects.stroke aqui (round-trip preserva via layer.effects).
      // Quando renderizar AMBOS visualmente requer outline duplo, sera
      // trabalho futuro — por ora vectorStroke ganha (eh o primario).
      const isShapeWithOwnStroke = (obj as any).__isShape === true
        && typeof obj.stroke === "string"
        && obj.stroke !== ""
        && (obj.strokeWidth ?? 0) > 0
      if (!isShapeWithOwnStroke) {
        const c = typeof effects.stroke.opacity === "number" && effects.stroke.opacity < 1
          ? effectColorWithOpacity(effects.stroke.color, effects.stroke.opacity, effects.stroke.color)
          : effects.stroke.color
        obj.set("stroke", c)
        obj.set("strokeWidth", effects.stroke.width ?? 1)
      }
    }
    // Color Overlay: substitui o fill por uma cor sólida.
    if (effects.colorOverlay && effects.colorOverlay.color) {
      const isImg = obj.type === "image"
      if (!isImg) {
        obj.set("fill", effects.colorOverlay.color)
      } else {
        // Imagem: PSDs importados pelo flow novo já tem o overlay baked no
        // bitmap (PsdImporter remove effects.colorOverlay nesse caso). Mas
        // campanhas antigas (imports pré-bake) ainda carregam o JSON com
        // colorOverlay E o PNG original — aplicamos BlendColor.tint em runtime
        // pra renderizar visualmente. Lazy-import do filter pra nao bloquear
        // o caminho de objetos sem effects.
        ;(async () => {
          try {
            const fab: any = await import("fabric")
            // Fabric v7: BlendColor exportado em filters namespace
            // (`fab.filters.BlendColor`), NAO direto em `fab.BlendColor`.
            // Antes este caminho retornava silenciosamente (BlendColor=undefined)
            // e colorOverlay sumia no editor mesmo presente no PSD (user
            // reportou 2026-05-22: "preview KV vem perfeito mas editor some").
            const BlendColor = fab.filters?.BlendColor ?? fab.BlendColor
            if (!BlendColor) {
              editorLog("[colorOverlay runtime] Fabric.BlendColor nao encontrado")
              return
            }
            const alpha = Math.max(0, Math.min(1, typeof effects.colorOverlay.opacity === "number" ? effects.colorOverlay.opacity : 1))
            obj.filters = [new BlendColor({ color: effects.colorOverlay.color, mode: "tint", alpha })]
            if (typeof obj.applyFilters === "function") obj.applyFilters()
            ;(obj as any).dirty = true
            obj.canvas?.requestRenderAll?.()
          } catch (e) { editorLog("[colorOverlay runtime] falhou:", e) }
        })()
      }
    }
    // Gradient Overlay: aplica gradiente como fill. Mesma restrição (texto/forma).
    if (effects.gradientOverlay && Array.isArray(effects.gradientOverlay.stops) && effects.gradientOverlay.stops.length > 0) {
      const isImg = obj.type === "image"
      if (!isImg) {
        // Converte angle PSD (0=cima, sentido horário) pros coords do Fabric Gradient.
        // Linear: usa coords relativas ao bbox do objeto via coordsType:"percentage".
        const go = effects.gradientOverlay
        const angleRad = ((go.angle ?? 90) * Math.PI) / 180
        // Eixo do gradiente: vector unitário no angle dado. Multiplica por raio que
        // garante cobertura total da diagonal do bbox (0.5 * √2 ≈ 0.707).
        const r = 0.707
        const cx = 0.5, cy = 0.5
        const dx = Math.cos(angleRad) * r
        const dy = Math.sin(angleRad) * r
        // ag-psd gradient.colorStops: location 0..1
        const stops = go.reverse
          ? go.stops.map((s: any) => ({ offset: 1 - (s.offset ?? 0), color: s.color }))
          : go.stops.map((s: any) => ({ offset: s.offset ?? 0, color: s.color }))
        // Fabric Gradient: importa lazy. Setar fill via gradiente requer instância.
        try {
          // Import síncrono não disponível aqui; criamos a config — Fabric aceita
          // gradiente como objeto literal via set("fill", literal) em v7.
          obj.set("fill", {
            type: go.type === "radial" ? "radial" : "linear",
            coords: go.type === "radial"
              ? { x1: cx, y1: cy, x2: cx, y2: cy, r1: 0, r2: r }
              : { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy },
            colorStops: stops,
            gradientUnits: "percentage",
          } as any)
        } catch (e) {
          console.warn("[applyFabricEffects] gradientOverlay falhou:", e)
        }
      }
    }
  }

  async function addAssetToCanvas(fc: any, asset: Asset, layer: any) {
    const fabricMod = await import("fabric")
    const { Rect, Textbox, FabricImage, Shadow, Path } = fabricMod as any
    const posX = layer?.posX ?? 100
    const posY = layer?.posY ?? 100
    const width = layer?.width ?? 400
    const scaleX = layer?.scaleX ?? 1
    const scaleY = layer?.scaleY ?? 1
    const angle = layer?.rotation ?? 0
    // Skew: Fabric suporta skewX/skewY em todos os obj types. Salvo no layer
    // ao sair editor — sem load aqui, skew aplicado em runtime perderia ao
    // recarregar. Sintoma reportado 2026-05-23: "aplico skew e nao salva".
    const skewX = typeof layer?.skewX === "number" ? layer.skewX : 0
    const skewY = typeof layer?.skewY === "number" ? layer.skewY : 0
    // PSD opacity/blendMode (extraídos no import) preservados como props do
    // Fabric object. Só repassa quando há valor explícito (não-default) —
    // setar `opacity: 1` ou `globalCompositeOperation: "source-over"` no
    // Canvas interativo pode trigerar render anômalo (canvas em branco)
    // mesmo sendo equivalente aos defaults.
    const psdExtraProps: any = {}
    // Sanity: opacity exatamente 1/255 (≈ 0.0039) ou < 0.01 = bug do importer
    // antigo (dividia opacity 2x por 255). Descarta o valor, trata como visível.
    // Re-importe o PSD pra grudar opacities reais corretamente.
    if (typeof layer?.opacity === "number" && layer.opacity < 1 && layer.opacity >= 0.01) {
      psdExtraProps.opacity = layer.opacity
    }
    if (typeof layer?.blendMode === "string" && layer.blendMode && layer.blendMode !== "source-over") {
      psdExtraProps.globalCompositeOperation = layer.blendMode
    }
    const psdEffects = (layer?.effects && typeof layer.effects === "object") ? layer.effects : null
    // groupPath: hierarquia de folders do PSD preservada no Fabric object pra
    // re-exportar com a mesma estrutura de groups. Array de nomes raiz → pai.
    const psdGroupPath = Array.isArray(layer?.groupPath) && layer.groupPath.length > 0 ? layer.groupPath as string[] : null

    // SHAPE assets — Fabric.Path com fill/stroke editaveis via Properties.
    // Tentamos antes (commits bbcf965/9313ed3) usar Fabric.Rect/Ellipse pra
    // Live Shape behavior, mas introduziu varias regressoes: slider de
    // stroke nao funcionava, stroke crescia com scale (strokeUniform nao
    // propagava), bg saia do canvas (cache invalidation agressivo).
    // Voltei pra Fabric.Path estavel. Cantos distorcem em scale nao-uniforme
    // (mesmo comportamento que PS Path) — slider de raio em Properties
    // continua funcionando pra ajustar raio absoluto manualmente.
    if (asset.type === "SHAPE") {
      try {
        // Fallback chain (2026-05-24): asset.content (formato V2 persistido) →
        // asset.shape (legacy direto do importer, antes do persist transferir
        // pra content). Sem isso, shapes recem-importados via /api/pieces/
        // import-psd que ainda nao moveram dados pro content sumiam do editor.
        const rawShape = (asset as any).content ?? (asset as any).shape ?? null
        const parsedShape = typeof rawShape === "string" ? JSON.parse(rawShape) : rawShape
        if (!parsedShape?.path) {
          console.warn("[shape] asset sem path data:", {
            label: asset.label,
            contentType: typeof (asset as any).content,
            contentLen: typeof (asset as any).content === "string" ? (asset as any).content.length : null,
            hasShape: !!(asset as any).shape,
            parsedKeys: parsedShape ? Object.keys(parsedShape) : null,
            rawSample: typeof rawShape === "string" ? rawShape.slice(0, 200) : JSON.stringify(rawShape ?? null).slice(0, 200),
          })
          return
        }
        const layerOv = layer?.overrides ?? {}
        const baseFill = parsedShape.fill?.kind === "solid"
          ? parsedShape.fill.color
          : "transparent"
        const baseStroke = parsedShape.stroke?.color ?? undefined
        const baseStrokeW = parsedShape.stroke?.width ?? 0
        const fillProp = layerOv.fill !== undefined ? layerOv.fill : baseFill
        const strokeProp = layerOv.stroke !== undefined ? layerOv.stroke : baseStroke
        const strokeWidth = layerOv.strokeWidth !== undefined ? layerOv.strokeWidth : baseStrokeW
        // Effective bbox W/H — pra parametric, MULTIPLICA pelo layer.scaleX/Y
        // a menos que ja exista override explicito. Sem isso, shape salvo com
        // scale != 1 reabria com path no tamanho original e scale aplicado
        // visualmente — assimetrico (path internal 400 mas visible 800), que
        // depois confundia o export PSD (3x menor que editor).
        // Parametric: asset.content.kind define (Rectangle/RoundedRect/Ellipse).
        // PROMOCAO: PSD shapes nao parametricos viram parametricos quando o user
        // edita cornerRadius via Properties Panel (setCornerRadius promove pra
        // "roundedRect"). Esse caso fica detectavel pela presenca de cornerRadius
        // > 0 + bboxW/bboxH nos overrides. Sem essa promocao no LOAD, cornerRadius
        // salvo no DB era ignorado e shape voltava retangular ao reabrir.
        // Sintoma 2026-05-23: "mudei corner radius, salvei, abri de novo, perdeu".
        const userPromotedToRounded = !parsedShape.kind
          && typeof layerOv.cornerRadius === "number" && layerOv.cornerRadius > 0
          && typeof layerOv.bboxW === "number" && layerOv.bboxW > 0
          && typeof layerOv.bboxH === "number" && layerOv.bboxH > 0
        const effKind: ShapeKind | undefined = parsedShape.kind ?? (userPromotedToRounded ? "roundedRect" : undefined)
        const isParametric = !!effKind
        let effBboxW = 0, effBboxH = 0
        if (parsedShape.pathBbox) {
          effBboxW = (parsedShape.pathBbox.right ?? 400) - (parsedShape.pathBbox.left ?? 0)
          effBboxH = (parsedShape.pathBbox.bottom ?? 300) - (parsedShape.pathBbox.top ?? 0)
        }
        if (typeof layerOv.bboxW === "number" && layerOv.bboxW > 0) {
          effBboxW = layerOv.bboxW  // override absoluto do scaling hook
        } else if (isParametric) {
          effBboxW = effBboxW * scaleX  // bake scale no path
        }
        if (typeof layerOv.bboxH === "number" && layerOv.bboxH > 0) {
          effBboxH = layerOv.bboxH
        } else if (isParametric) {
          effBboxH = effBboxH * scaleY
        }
        const effCornerR_load = typeof layerOv.cornerRadius === "number"
          ? layerOv.cornerRadius
          : (typeof parsedShape.cornerRadius === "number" ? parsedShape.cornerRadius : 0)
        const isParametricFinal = isParametric && effBboxW > 0 && effBboxH > 0
        // Recomputa path com cornerRadius override se shape eh parametric
        // (incluindo promocao do user).
        const pathStr: string = isParametricFinal && effKind
          ? buildShapePath(effKind, effBboxW, effBboxH, effCornerR_load)
          : parsedShape.path
        const p = new Path(pathStr, {
          left: posX, top: posY,
          // Path parametric ja tem dims absolutos (bake do scale acima),
          // entao scaleX/scaleY = 1. Path nao-parametric mantem scale cru.
          scaleX: isParametricFinal ? 1 : scaleX,
          scaleY: isParametricFinal ? 1 : scaleY,
          angle,
          fill: fillProp,
          stroke: strokeProp,
          strokeWidth,
          strokeUniform: true,
          fillRule: parsedShape.fillRule ?? "nonzero",
          ...psdExtraProps,
        })
        ;(p as any).__assetId = asset.id
        ;(p as any).__assetLabel = asset.label
        ;(p as any).__isShape = true
        // strokePosition: override > parsedShape > default 'center' (PS default)
        const strokePos: "inside" | "center" | "outside" =
          (layerOv.strokePosition === "inside" || layerOv.strokePosition === "outside" || layerOv.strokePosition === "center")
            ? layerOv.strokePosition
            : (parsedShape.stroke?.position ?? "center")
        ;(p as any).__strokePosition = strokePos
        // Visual: Fabric so renderiza stroke 'center' nativo. Pra inside/outside
        // aplicamos clipPath dobrado (2x width) + clip da silhueta do path.
        applyStrokePositionVisual(p, strokePos, Path)
        // Prefere effKind (inclui promocao user) sobre parsedShape.kind cru.
        // Sem isso, ao recarregar shape promovido, __shapeKind ficava undefined
        // e save subsequente nao gravava bboxW/bboxH → corner radius perdido.
        if (effKind) (p as any).__shapeKind = effKind
        if (effCornerR_load !== undefined) (p as any).__cornerRadius = effCornerR_load
        if (isParametricFinal) {
          ;(p as any).__pathBbox = { left: 0, top: 0, right: effBboxW, bottom: effBboxH }
        } else if (parsedShape.pathBbox) {
          ;(p as any).__pathBbox = parsedShape.pathBbox
        }
        if (psdEffects) (p as any).__psdEffects = psdEffects
        if (psdGroupPath) (p as any).__groupPath = psdGroupPath
        applyFabricEffects(p, psdEffects, Shadow)

        // Render dual stroke: vectorStroke (no main p) + effects.stroke (ghost
        // path atras). PS desenha os 2 simultaneos. Ghost = mesmo path, sem
        // fill, com strokeWidth = main_stroke + effects_stroke.
        const effStroke = psdEffects?.stroke
        const hasMainStroke = typeof p.stroke === "string" && p.stroke !== "" && (p.strokeWidth ?? 0) > 0
        if (hasMainStroke && effStroke?.color && (effStroke.width ?? 0) > 0) {
          // strokeWidth do ghost = main_strokeWidth + 2 * effect_strokeWidth.
          // Como Fabric centraliza stroke no path, o ghost mais largo deixa
          // exatamente effect_strokeWidth aparente alem do main (de cada lado).
          // Posicionado ANTES do main no fc → renderiza atras → so o "anel"
          // externo aparece (parte interna fica coberta pelo main com fill).
          const ghostW = (p.strokeWidth ?? 1) + 2 * (effStroke.width ?? 1)
          const ghost = new Path(pathStr, {
            left: posX, top: posY,
            scaleX, scaleY, angle,
            fill: "",
            stroke: effStroke.color,
            strokeWidth: ghostW,
            strokeUniform: true,
            fillRule: parsedShape.fillRule ?? "nonzero",
            // NAO selecionavel — ghost segue o main via __assetId.
            selectable: false,
            evented: false,
            excludeFromExport: true,
          } as any)
          ;(ghost as any).__assetId = asset.id
          ;(ghost as any).__isStrokeGhost = true
          fc.add(ghost)
        }
        fc.add(p)
        if (skewX !== 0 || skewY !== 0) { (p as any).set({ skewX, skewY }) }
        // setCoords() incondicional (user 2026-05-30: "bug ao transformar
        // um layer"). Sem isso, bbox/aCoords ficam stale apos add e o handle
        // de transform renderiza em posicao diferente da imagem visual.
        ;(p as any).setCoords()
        fc.requestRenderAll()
        return
      } catch (e) {
        console.error("[shape] render falhou:", asset.label, e)
      }
    }
    // SMART_OBJECT renderiza pelo mesmo path de IMAGE — composite raster em
    // asset.imageUrl. Bytes originais do PSD ficam em SmartObjectFile pra
    // round-trip. Edicao interna da SO (Fase 2) substitui o composite mas
    // mantem a layer no canvas igual.
    if (asset.type === "IMAGE" || asset.type === "SMART_OBJECT") {
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
                svgBlobUrlsRef.current.push(imgSrc)
              }
            } catch (e) { console.warn("[SVG] falha lendo dimensoes:", e) }
          }

          const img = await new Promise<any>((resolve, reject) => {
            const el = new window.Image()
            el.crossOrigin = "anonymous"
            el.onload = async () => {
              const naturalW = el.naturalWidth || el.width || 1
              const naturalH = el.naturalHeight || el.height || 1
              let sx: number, sy: number
              if (scaleX !== 1 || scaleY !== 1) {
                // Scale ja vem do layer (peca/matriz carregada): usa direto
                sx = scaleX; sy = scaleY
              } else if (layer?.height != null) {
                // Tem width E height explicitos: pode distorcer (matriz com tamanho custom)
                sx = width / naturalW
                sy = layer.height / naturalH
              } else {
                // Tem so width (botao "+ Adicionar ao canvas"): mantem proporcao
                // pra nao distorcer. Usa ratio uniforme baseado no width alvo.
                const ratio = width / naturalW
                sx = ratio; sy = ratio
              }
              // Bake raster mask no bitmap. Fabric v6 renderiza Image clipPath
              // como silhueta solida (ignora alpha do PNG da mask) — o jeito
              // de obter alpha-mask real eh pre-compor a mascara DENTRO do
              // bitmap antes de criar a FabricImage. So aplicamos pra mask
              // type=raster; vector/clipping continuam usando clipPath
              // (que respeitam geometric shape no Fabric).
              let sourceForFabric: HTMLImageElement | HTMLCanvasElement = el
              if (layer?.mask?.type === "raster" && layer.mask.enabled !== false && layer.mask.raster?.dataUrl) {
                srvLog("mask-BAKE-START", { label: asset.label, posX, posY, naturalW, naturalH, maskPos: { x: layer.mask.raster.posX, y: layer.mask.raster.posY }, maskSize: { w: layer.mask.raster.width, h: layer.mask.raster.height } })
                // Console debug: deixa o user inspecionar sem precisar abrir
                // /api/debug. Roda 1x por layer no load — barato.
                console.log("[mask-bake-debug]", asset.label, {
                  layer_pos: { x: posX, y: posY },
                  layer_scale: { x: sx, y: sy },
                  image_natural: { w: naturalW, h: naturalH },
                  layer_size_canvas: { w: naturalW * sx, h: naturalH * sy },
                  mask: layer.mask.raster,
                  mask_schemaV: (layer.mask as any)._schemaV ?? "v1-pre-scaleLayerMask",
                  computed_ratio: { x: 1/sx, y: 1/sy },
                  computed_offset_natural: { x: (layer.mask.raster.posX - posX) / sx, y: (layer.mask.raster.posY - posY) / sy },
                  computed_size_natural: { w: layer.mask.raster.width / sx, h: layer.mask.raster.height / sy },
                })
                try {
                  // sx/sy: scale do layer no canvas atual. Mask coords sao em
                  // canvas-space, sourceImg em image-natural-space — passamos
                  // o scale pra conversao acontecer dentro de composeRaster*.
                  const composed = await composeRasterMaskIntoImage(el, layer.mask.raster, posX, posY, naturalW, naturalH, !!layer.mask.inverted, sx, sy)
                  if (composed) {
                    sourceForFabric = composed
                    srvLog("mask-BAKE-OK", { label: asset.label, canvasW: composed.width, canvasH: composed.height })
                    console.log("[mask-bake-result]", asset.label, "composed canvas:", composed.width, "x", composed.height)
                  } else {
                    srvLog("mask-BAKE-NULL", { label: asset.label, reason: "composeRasterMaskIntoImage returned null" })
                  }
                } catch (e) { srvLog("mask-BAKE-FAIL", { label: asset.label, err: String((e as any)?.message ?? e) }) }
              }
              resolve(new FabricImage(sourceForFabric, { left: posX, top: posY, scaleX: sx, scaleY: sy, angle, ...psdExtraProps }))
            }
            el.onerror = reject
            el.src = imgSrc
          })
          // Nota: nao revogamos o Blob URL aqui porque Fabric pode reler a fonte
          // em re-renders/exports. Browser libera o blob no GC quando nada mais usa.
          ;(img as any).__assetId = asset.id
          ;(img as any).__assetLabel = asset.label
          // Smart Object preservado do PSD original: marcamos pra render
          // distinto (badge SO no Properties Panel) e pra GARANTIR que o
          // re-export emita placedLayer nativo (nao rasterizado). Sem essa
          // flag, asset.smartObject podia ser perdido em algum save→reload
          // e o re-export caia em image raster.
          if (asset.smartObject) {
            ;(img as any).__isSmartObject = true
            ;(img as any).__smartObjectGuid = asset.smartObject.guid
            ;(img as any).__smartObjectMime = asset.smartObject.mime
            ;(img as any).__smartObjectFilePath = asset.smartObject.filePath
            ;(img as any).__smartObjectOriginalName = asset.smartObject.originalName
          }
          if (psdEffects) (img as any).__psdEffects = psdEffects
          if (psdGroupPath) (img as any).__groupPath = psdGroupPath
          // Mask metadata: anota __maskData direto, sem depender de
          // applyMaskToFabricObject. Para imagens com raster mask, o bake ja
          // foi feito acima (composeRasterMaskIntoImage), mas precisamos da
          // anotacao pra que saveNow consiga gravar layer.mask no proximo save.
          // Sem isso, swap de asset / re-render perdia a mascara silenciosamente.
          if (layer?.mask) {
            ;(img as any).__maskData = layer.mask
            // Anchor pra tracking de movimento. Quando o user arrasta o layer,
            // object:modified detecta delta entre __maskAnchor.{left,top} e
            // obj.{left,top}, e propaga pro __maskData.raster.posX/Y. Sem isso,
            // mover o layer no editor deixava a mascara presa nas coords
            // originais (Photoshop liga mask ao layer por default — chain icon).
            ;(img as any).__maskAnchor = {
              left: posX, top: posY,
              scaleX: img.scaleX ?? 1, scaleY: img.scaleY ?? 1,
            }
          }
          // F12: pixelsIncludeEffects=true (Smart Objects) → shadow/glow/stroke
          // ja estao baked no composite raster pelo PS, NAO aplicar de novo (dobra).
          // PORÉM colorOverlay/gradientOverlay sao Layer Styles APLICADOS NA LAYER
          // wrapper do SO, e ag-psd NAO os incorpora ao composite nested — entao
          // devem ser aplicados aqui (via BlendColor.tint pra image), senao
          // logo branco via Color Overlay nunca aparece no editor.
          const pixelsBaked = (asset as any).pixelsIncludeEffects === true
          applyFabricEffects(img, psdEffects, Shadow, pixelsBaked ? { overlaysOnly: true } : undefined)
          fc.add(img)
          if (skewX !== 0 || skewY !== 0) { (img as any).set({ skewX, skewY }); (img as any).setCoords() }
          fc.requestRenderAll()
          return
        } catch (e) { console.error("Image load failed:", e) }
      }
      const r = new Rect({
        left: posX, top: posY, width, height: layer?.height ?? 300,
        fill: "#d0d0d0", stroke: "#999", strokeWidth: 1,
        scaleX, scaleY, angle,
        ...psdExtraProps,
      })
      ;(r as any).__assetId = asset.id
      ;(r as any).__assetLabel = asset.label
      if (psdGroupPath) (r as any).__groupPath = psdGroupPath
      // Preserva mask metadata mesmo no fallback (imagem falhou ao carregar).
      // Sem isso, o proximo save grava layer sem mask e a mascara some
      // permanentemente — mesmo quando a URL da imagem voltar a funcionar.
      if (layer?.mask) {
        ;(r as any).__maskData = layer.mask
        ;(r as any).__maskAnchor = { left: posX, top: posY, scaleX: scaleX ?? 1, scaleY: scaleY ?? 1 }
      }
      fc.add(r)
    } else {
      const spans = getSpans(asset)
      const data = spansToTextboxData(spans)
      const def = data.defaultStyle
      // Texto: MERGE entre assetTpl (lastOverride - template do asset) e layerOv
      // (override per-instancia na peca/matriz). Layer prevalece quando ambos
      // setam o mesmo campo. Sem o merge, layer parcial (so com fontSize)
      // bloqueava acesso ao asset.lastOverride.leadingPt — leading caia em
      // default Fabric (1.0). Sintoma: "entrelinhas vem alterada".
      const layerOv = layer?.overrides
      const assetTpl: any = ((asset as any).lastOverride && typeof (asset as any).lastOverride === "object")
        ? (asset as any).lastOverride
        : null
      const ov: any = (layerOv || assetTpl)
        ? { ...(assetTpl ?? {}), ...(layerOv ?? {}) }
        : null
      // Texto: PECA pode ter override per-instancia (layer.overrides.text), usado
      // pra preservar quebras de linha inseridas localmente sem propagar pra matriz.
      // Se nao houver override, texto vem do asset.content (data.text) — fonte da
      // verdade dos caracteres. Matriz sempre cai no asset (matriz NAO grava
      // overrides.text; edicoes propagam pra asset.content via updateAssetContent).
      const initialText = (layerOv && typeof layerOv.text === "string") ? layerOv.text : data.text

      // Back-compat: pecas antigas geradas com scaleX!=1 (antes do fix da geracao). Consolida
      // scale no fontSize/width na hora de criar pra evitar que Fabric "salte" o tamanho ao
      // clicar. Apos consolidar, scaleX/scaleY = 1 (Photoshop-style). NAO mexe em imagens.
      let effScaleX = scaleX
      let effScaleY = scaleY
      let effWidth = width
      let effFontSize = (ov?.fontSize ?? def.fontSize ?? 80)
      let effLeadingPt = ov?.leadingPt
      let effStyles = ov?.styles
      // Edge case: overrides.fontSize quase-zero (PSD import com leading mixed
      // pode salvar fontSize box-level ~= 0 mas per-char styles tem o real).
      // Sem isso, shrink-to-content abaixo lê fontSize 0, calc expectedLines
      // explode (height/0.19 = milhares de linhas), shrink nao dispara,
      // textbox fica com width=99999. Detecta via max styleRuns.fontSize.
      // Sintoma: textbox renderiza atravessando canvas inteiro.
      effFontSize = clampTinyFontSize(effFontSize, effStyles)
      const needsConsolidation = Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001
      if (needsConsolidation) {
        const sY = scaleY
        const sX = scaleX
        effFontSize = effFontSize * sY
        effWidth = (width ?? 400) * sX
        if (typeof effLeadingPt === "number") effLeadingPt = effLeadingPt * sY
        if (effStyles && typeof effStyles === "object") {
          const newStyles: any = {}
          for (const lineKey of Object.keys(effStyles)) {
            newStyles[lineKey] = {}
            for (const colKey of Object.keys(effStyles[lineKey])) {
              const cs = { ...effStyles[lineKey][colKey] }
              if (typeof cs.fontSize === "number") cs.fontSize = cs.fontSize * sY
              newStyles[lineKey][colKey] = cs
            }
          }
          effStyles = newStyles
        }
        effScaleX = 1
        effScaleY = 1
      }

      // Brand ref: se override aponta pra um brand color via fillBrandIdx e
      // brandColors[idx].hex difere do que esta salvo (brand mudou desde o
      // ultimo save), prefere a cor LIVE da marca. Marca dirty pra proximo
      // auto-save persistir o novo hex no overrides.fill.
      let effFill: string = (ov?.fill ?? def.color ?? "#111111")
      const fillBrandIdx = ov?.fillBrandIdx
      if (typeof fillBrandIdx === "number" && brandColorsRef.current[fillBrandIdx]) {
        const liveHex = brandColorsRef.current[fillBrandIdx].hex
        if (typeof liveHex === "string" && /^#[0-9a-fA-F]{6}$/.test(liveHex)) {
          if (liveHex.toLowerCase() !== String(effFill).toLowerCase()) {
            effFill = liveHex
            // GUARD load-time: brand re-sync durante init NAO deve marcar
            // dirty — usuario nao fez nada, nao mostrar prompt de save.
            // Next save eventual (quando user interagir) inclui sync.
            if (isInitialized.current) {
              isDirtyRef.current = true
              setIsDirty(true)
            }
          }
        }
      }
      // Brand refs PER-CHAR + PRUNE de entradas alem do texto.
      //
      // PRUNE: ao editar texto via /assets ou no editor, o numero de chars
      // pode encolher. styles[line][col] com col >= line length viram lixo
      // que confunde Fabric (renderiza chars fantasmas / overlap visivel).
      // Sintoma reportado: 'texto da umas encavaladas conforme abre/fecha'.
      //
      // BRAND REFS: itera styles[line][col].fillBrandIdx e re-resolve contra
      // brandColors atual. Sem isso, chars pintados via swatch Marca com
      // selecao parcial mantem cor velha apos mudanca de brand.
      if (effStyles && typeof effStyles === "object") {
        // Lines reais do textbox = split por \n. So mantem entradas validas.
        const textLines = (initialText ?? "").split("\n")
        const newPerCharStyles: any = {}
        let perCharChanged = false
        for (const lineKey of Object.keys(effStyles)) {
          const lineIdx = Number(lineKey)
          if (!Number.isFinite(lineIdx) || lineIdx < 0 || lineIdx >= textLines.length) {
            // Linha alem do texto — descarta.
            perCharChanged = true
            continue
          }
          const lineLen = textLines[lineIdx].length
          newPerCharStyles[lineKey] = {}
          for (const colKey of Object.keys(effStyles[lineKey])) {
            const colIdx = Number(colKey)
            if (!Number.isFinite(colIdx) || colIdx < 0 || colIdx >= lineLen) {
              // Col alem da linha — descarta.
              perCharChanged = true
              continue
            }
            const cs = { ...effStyles[lineKey][colKey] }
            if (typeof cs.fillBrandIdx === "number" && brandColorsRef.current[cs.fillBrandIdx]) {
              const charLive = brandColorsRef.current[cs.fillBrandIdx].hex
              if (typeof charLive === "string" && /^#[0-9a-fA-F]{6}$/.test(charLive)
                  && charLive.toLowerCase() !== String(cs.fill ?? "").toLowerCase()) {
                cs.fill = charLive
                perCharChanged = true
              }
            }
            newPerCharStyles[lineKey][colKey] = cs
          }
          // Linha sem nenhuma entrada valida — limpa.
          if (Object.keys(newPerCharStyles[lineKey]).length === 0) {
            delete newPerCharStyles[lineKey]
          }
        }
        if (perCharChanged) {
          effStyles = newPerCharStyles
          // GUARD load-time: prune + brand re-sync during init nao deve
          // marcar dirty — usuario nao fez nada.
          if (isInitialized.current) {
            isDirtyRef.current = true
            setIsDirty(true)
          }
        }
      }

      // Initial lineHeight Adobe-style. effLeadingPt eh absoluto em pt; lineHeight
      // do Fabric eh multiplicador. Conversao: lh = leadingPt / fontSize.
      //
      // NAO inflamos lineHeight pra acomodar fontSize variavel per-char (chars
      // maiores que o default). Inflar aumenta a altura TOTAL do textbox e faz
      // ele sobrepor textboxes posicionados logo abaixo (titulo cobrindo o
      // subtitulo, p.ex.). PS aplica leading per-linha — Fabric nao tem isso —
      // entao linha com glyph maior pode overflow visualmente dentro do textbox,
      // mas a altura TOTAL bate com o PSD e textboxes vizinhos nao colidem.
      const initialLineHeight = (typeof effLeadingPt === "number" && effFontSize > 0)
        ? leadingPtToFabricLineHeight(effLeadingPt, effFontSize)
        : (typeof ov?.lineHeight === "number" ? ov.lineHeight : 1.2)
      // PSD POINT TEXT detection: lastOverride.__psdShapeType === "point" significa
      // que o texto no PSD nao wrappa (so quebra em \n explicito). Fabric textbox
      // sempre wrappa pelo width — se passamos width=bbox.width e font cai em
      // fallback, mede mais largo e wrappa onde nao deveria.
      // Solucao: pra point text, criar com width ENORME (sem wrap), depois o
      // shrink-to-content abaixo encolhe pro tamanho real do texto renderizado.
      const psdShapeType = (asset as any).lastOverride?.__psdShapeType
      // userResizedWidth: layer salvou width explicito (user redimensionou OU
      // veio de PSD box text). Trata como box mesmo que asset diga "point" —
      // overrides per-instancia sobrepoem o default do asset. Width fica fixa
      // e auto-fit text:changed nao roda nesse textbox (preserva wrap).
      const layerWidthSaved = (layerOv as any)?.userResizedWidth === true
        || (typeof (layerOv as any)?.width === "number" && (layerOv as any).width < 50000 && (layerOv as any).width > 0)
      const isPointText = !layerWidthSaved && (psdShapeType === "point" || psdShapeType === undefined)
      // Quando layer salvou width, usa o width salvo direto (ignora effWidth
      // que vem da bbox antiga do asset). Caso contrario: 99999 (point) ou
      // bbox do asset (box).
      const explicitSavedWidth = typeof (layerOv as any)?.width === "number" ? (layerOv as any).width : null
      const initialWidth = isPointText
        ? 99999
        : (explicitSavedWidth != null ? Math.max(explicitSavedWidth, 50) : Math.max(effWidth, 200))
      const t = new Textbox(initialText, {
        left: posX, top: posY,
        width: initialWidth,
        fontSize: effFontSize,
        fontFamily: (ov?.fontFamily ?? def.fontFamily ?? "Arial"),
        fontWeight: (ov?.fontWeight ?? def.fontWeight ?? "normal"),
        fontStyle: (ov?.fontStyle ?? (def as any).fontStyle ?? "normal"),
        fill: effFill,
        lineHeight: initialLineHeight,
        // editable: true permite duplo-clique pra SELECIONAR caracteres (necessario
        // pra aplicar styles per-char no painel direito). Mas digitar/apagar e
        // bloqueado por listener separado abaixo, porque caracteres so podem ser
        // alterados via /assets.
        editable: true,
        scaleX: effScaleX, scaleY: effScaleY, angle,
        ...psdExtraProps,
      })
      // Marca como point/box pra round-trip e UI futura. Round-trip: writer le
      // pra recriar Point/Paragraph Text correto no PSD.
      ;(t as any).__psdShapeType = isPointText ? "point" : "box"
      // Restaura flag de user-resized (persistida no save). Sem isso, qualquer
      // edit de texto dispara auto-fit text:changed e colapsa o width fixo,
      // perdendo o wrap escolhido pelo user (ou herdado do PSD box).
      if (layerWidthSaved) (t as any).__userResizedWidth = true
      if ((asset as any).lastOverride?.__psdBoxBounds) {
        ;(t as any).__psdBoxBounds = (asset as any).lastOverride.__psdBoxBounds
      }
      // PSD paragraph spaceAfter — gap entre paragrafos. Convertido de pts
      // pra pixels canvas (fontSize ja vem em px no Fabric). Fabric patch
      // intercepta getHeightOfLine pra adicionar esse extra apos linhas de
      // paragrafo. Sem isso, paragrafos colam no editor (PSD do Sicredi tem
      // spaceAfter=15.59pt no titulo, gerando ~23px de gap visivel).
      const psdSpaceAfter = (asset as any).lastOverride?.__psdParagraphSpaceAfter
      if (typeof psdSpaceAfter === "number" && psdSpaceAfter > 0) {
        // PSD pt = pixel em 72dpi. Canvas opera em px direto. Scale ja foi
        // aplicado nos fontSize/leading no toCampaign — spaceAfter NAO escala
        // (eh medida do paragrafo, nao do texto). Multiplica por scale local
        // do textbox pra compensar Fabric scale.
        ;(t as any).__paragraphSpaceAfter = psdSpaceAfter * effScaleY
        ;(t as any).__psdParagraphSpaceAfter = psdSpaceAfter
      }
      // Aplica overrides do layer (estilos editados pelo usuário no editor)
      if (ov) {
        if (ov.charSpacing !== undefined) t.set("charSpacing", ov.charSpacing)
        if (ov.lineHeight !== undefined) t.set("lineHeight", ov.lineHeight)
        if (ov.textAlign !== undefined) t.set("textAlign", ov.textAlign)
        if (effLeadingPt !== undefined && effLeadingPt !== null) {
          ;(t as any).leadingPt = effLeadingPt
          syncLineHeightFromLeading(t)
        }
        // Styles per-char (eventualmente ja consolidados acima por needsConsolidation)
        if (effStyles && Object.keys(effStyles).length > 0) {
          t.set("styles", effStyles)
        }
      }
      if ((t as any).initDimensions) (t as any).initDimensions()
      // Anti-overwrap: PSD mede o text box com sub-pixel precision do Photoshop.
      // Browsers/Fabric usam font metrics que podem variar em centesimos de
      // pixel, fazendo um texto que cabia em N linhas no PSD quebrar pra N+1 no
      // canvas. Detectamos pelo numero de "\n" explicitos vs textLines reais
      // do Textbox apos initDimensions, e expandimos o width incrementalmente
      // ate que o wrap volte a respeitar o layout original (max 3 tentativas
      // pra evitar loop em casos patologicos).
      try {
        // expectedLines: prioridade 1 = altura do bbox PSD / leading (PSD ja
        // sabe quantas linhas o designer quis). Prioridade 2 = \n explicitos
        // + 1 (text sintetico do editor). Sem isso, textos PSD com wrap
        // intencional (ex: "Incentivo para investimentos" em 3 linhas no
        // box estreito) eram tratados como 1 linha e o autofit expandia o
        // width pra "consertar", invadindo textos vizinhos.
        const psdHeight = typeof ov?.height === "number" ? ov.height : null
        const leadingForCalc = (typeof effLeadingPt === "number" && effLeadingPt > 0)
          ? effLeadingPt
          : (effFontSize > 0 ? effFontSize * 1.2 : 24)
        const explicitLines = (initialText.match(/\n/g)?.length ?? 0) + 1
        const psdLines = psdHeight ? Math.max(1, Math.round(psdHeight / leadingForCalc)) : 0
        const expectedLines = Math.max(explicitLines, psdLines)
        let attempts = 0
        // _textLines eh propriedade interna do Fabric Textbox pos initDimensions.
        // Skip expand-to-fit quando layer salvou width — width fixa nao deve
        // ser inflada pra reduzir linhas (user escolheu wrappar).
        if (!layerWidthSaved) {
          while (((t as any)._textLines?.length ?? 0) > expectedLines && attempts < 3) {
            const currentWidth = (t as any).width ?? Math.max(effWidth, 200)
            ;(t as any).set("width", Math.ceil(currentWidth * 1.05))
            if ((t as any).initDimensions) (t as any).initDimensions()
            attempts++
          }
          if (attempts > 0) {
            editorLog("[autofit-text]", asset.label, `expanded ${attempts}x to fit ${expectedLines} lines (psd=${psdLines}, explicit=${explicitLines})`)
          }
        }
        // SHRINK-TO-CONTENT: depois de garantir que o text wrapping respeita
        // expectedLines, encolhe o width pra HUGGAR o conteudo. Sem isso, um
        // textbox importado do PSD com bbox de 1200px continua com 1200px de
        // largura mesmo se o texto so usa 600px — handles ficam la longe,
        // edicao no canvas vira pesadelo. Pattern Adobe/Figma: "Point Type"
        // texto-tem-largura-do-conteudo.
        //
        // EXCETO se layer salvou width explicito (user redimensionou ou box
        // text). Nesse caso o width eh INTENCIONAL e shrink desfaz o wrap
        // escolhido. Sintoma do bug user reportou: pecas geradas perdem o
        // width do textbox apos reload — shrink-to-content estava colapsando.
        try { if (layerWidthSaved) { /* skip shrink */ } else {
          const lineCount = (t as any)._textLines?.length ?? 0
          // Condicao relaxada (era `=== expectedLines`): shrink quando lineCount
          // <= expectedLines. Caso problematico: PSD com bbox 2 linhas mas texto
          // cabe em 1 (overrides editaram fontSize ou texto encurtou). Antes
          // ficava com width=99999 porque 1 !== 2. Agora hugga 1-linha mesmo
          // quando psd esperava mais.
          if (lineCount > 0 && lineCount <= expectedLines) {
            let maxLineW = 0
            for (let i = 0; i < lineCount; i++) {
              const lw = typeof (t as any).getLineWidth === "function"
                ? (t as any).getLineWidth(i)
                : 0
              if (lw > maxLineW) maxLineW = lw
            }
            // Padding 8px pra cursor de edicao caber + arredondamento Photoshop.
            // MIN 100 pra textboxes muito curtos (1-2 chars) nao virarem clickable
            // alvo minusculo.
            const targetW = Math.max(100, Math.ceil(maxLineW + 8))
            const currentW = (t as any).width ?? 0
            // So encolhe — nunca expande aqui (a expansao foi cuidada acima).
            if (targetW < currentW * 0.95) {
              ;(t as any).set("width", targetW)
              if ((t as any).initDimensions) (t as any).initDimensions()
              editorLog("[autofit-text]", asset.label, `shrunk ${currentW}→${targetW} pra hugger conteudo`)
            }
          }
        } } catch (e) { editorLog("[autofit-text-shrink] erro:", e) }
      } catch (e) { editorLog("[autofit-text] erro:", e) }
      // Regra global ZZOSY: width <= min(longest_line * 1.30, canvas_right - left).
      // Aplicado DEPOIS do expand/shrink anterior pra que cubra tambem casos
      // que esses pulam (layerWidthSaved, lineCount > expectedLines, etc).
      // Sem isso, textboxes saved com width muito > conteudo (ex: PSD bbox
      // largo, manual resize antigo) carregavam estouradas alem da borda da
      // peca, com handles longe e area clicavel inflada.
      try { clampTextboxWidth(t, canvasWRef.current) } catch (e) { editorLog("[clamp-textbox-load] erro:", e) }
      ;(t as any).__assetId = asset.id
      ;(t as any).__assetLabel = asset.label
      if (typeof fillBrandIdx === "number") (t as any).__fillBrandIdx = fillBrandIdx
      if (psdEffects) (t as any).__psdEffects = psdEffects
      if (psdGroupPath) (t as any).__groupPath = psdGroupPath
      // DS link tracking: textbox vinculado ao preset do Design System tem
      // bolinha verde no painel de layers. Layer customizado pelo user via
      // Properties Panel quebra o vinculo (vermelho). Flag persistida no
      // override do layer pra round-trip — se vier false do save, mantem;
      // senao default true pra layers de asset com brandPresetKey.
      const assetHasBrandPreset = !!(asset as any)?.lastOverride?.brandPresetKey
      const savedDsLinked = (layerOv as any)?.dsLinked
      if (assetHasBrandPreset) {
        ;(t as any).__dsLinked = savedDsLinked !== false // default true; salva false explicito mantem
      }
      // Mask metadata: anotacao garantida pra que saveNow consiga gravar
      // layer.mask. Independente de applyMaskToFabricObject rodar depois.
      if (layer?.mask) {
        ;(t as any).__maskData = layer.mask
        ;(t as any).__maskAnchor = {
          left: posX, top: posY,
          scaleX: t.scaleX ?? 1, scaleY: t.scaleY ?? 1,
        }
      }
      applyFabricEffects(t, psdEffects, Shadow)
      fc.add(t)
      // Re-aplica leadingPt MEDINDO o factor real do Fabric depois que o
      // textbox esta totalmente construido (styles, font, dimensions). Sem
      // isso, o lineHeight inicial (fast path com 1.13 hardcoded) podia
      // ficar off ate o user mexer no scaling. User reportou 2026-05-23:
      // continuava errado mesmo apos applyLeadingPtToFabric nos sites de
      // scaling — load inicial ainda usava fast path.
      if (typeof effLeadingPt === "number" && effFontSize > 0) {
        applyLeadingPtToFabric(t, effLeadingPt)
      }
    }
    // SKEW post-construct (fallback pra branches sem return: textbox/embedded).
    // Branches IMAGE e SHAPE aplicam inline antes do return delas. Sweep.
    if (skewX !== 0 || skewY !== 0) {
      const objs = fc.getObjects()
      const last = objs[objs.length - 1]
      if (last) {
        last.set({ skewX, skewY })
        last.setCoords()
      }
    }
  }

  function refreshLayers(fc: any) {
    // Igual Photoshop: layers visiveis aparecem no painel, BG sempre embaixo
    // (no fim da lista — UI renderiza top→bottom matching o z-stack do canvas).
    // Placeholders de folder vazio sao incluidos (pra `__groupPath` deles
    // fazer o folder aparecer nos headers), mas marcados como isPlaceholder
    // pra UI esconder a row em si.
    const objs = fc.getObjects().filter((o: any) => !o.__isBleedOverlay)
    setLayers(
      objs.map((o: any, i: number) => ({
          id: i,
          label: o.__assetLabel ?? o.type,
          type: o.type,
          obj: o,
          hidden: o.__hidden === true,
          locked: o.__locked === true,
          isBg: o.__isBg === true,
          // groupPath: array de folders ancestrais do PSD ("Header", "Header > Logo").
          // Painel usa pra renderizar hierarquia indentada com headers de folder
          // entre layers (igual Photoshop).
          groupPath: Array.isArray(o.__groupPath) ? o.__groupPath : [],
          // Placeholder de folder vazio: o painel renderiza o header do folder
          // mas pula a row do layer em si.
          isPlaceholder: o.__folderPlaceholder === true,
        }))
        .reverse()
    )
  }

  function moveLayer(obj: any, direction: "up" | "down") {
    const fc = fabricRef.current
    if (!fc || !obj) return
    if ((obj as any).__isBg) return // BG fica sempre embaixo (igual Photoshop)
    if (direction === "up") fc.bringObjectForward(obj)
    else fc.sendObjectBackwards(obj)
    // BG sempre no fundo apos qualquer reorder
    const bgObj = fc.getObjects().find((o: any) => o.__isBg)
    if (bgObj) fc.sendObjectToBack(bgObj)
    fc.renderAll()
    refreshLayers(fc)
    // History: Fabric NAO dispara object:modified em bring/send. Sem este
    // push, reorder via botoes ou teclado nao entra no undo stack.
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  // Reordena layer absolutamente: pega o objeto e coloca em targetVisualIndex
  // (indice visual no painel, contando de cima pra baixo). Topo da lista = topo
  // do canvas (mais a frente). targetVisualIndex 0 = mais a frente.
  function reorderLayer(obj: any, targetVisualIndex: number, targetGroupPath?: string[]) {
    const fc = fabricRef.current
    if (!fc || !obj) return
    if ((obj as any).__isBg) return // BG nao se move (igual Photoshop)
    // Se um path explicito foi passado, atualiza groupPath do objeto. Permite
    // entrar/sair de folders ao arrastar (Photoshop-style). Quando undefined,
    // preserva o groupPath atual (apenas reordering z-stack).
    if (targetGroupPath !== undefined) {
      if (targetGroupPath.length === 0) delete (obj as any).__groupPath
      else (obj as any).__groupPath = targetGroupPath
      // Limpa placeholder do folder destino se ele virou "ocupado" — agora
      // tem layer real dentro, o placeholder eh redundante.
      const targetKey = targetGroupPath.join("›")
      const placeholders = fc.getObjects().filter((o: any) => o.__folderPlaceholder
        && Array.isArray(o.__groupPath)
        && o.__groupPath.join("›") === targetKey)
      for (const p of placeholders) fc.remove(p)
    }
    // Painel mostra os objetos invertidos (topo painel = topo canvas), entao o
    // indice "real" na lista de objects (de tras pra frente) eh: (total-1) - visualIdx
    const objects = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay)
    const total = objects.length
    const targetCanvasIndex = Math.max(0, Math.min(total - 1, total - 1 - targetVisualIndex))
    // Fabric API: moveObjectTo(obj, idx). Mas precisamos contar todos os obj
    // (incluindo bg/overlays) pra acertar o index. O moveObjectTo do Fabric usa
    // o array completo. Encontramos o idx do alvo no array completo.
    const allObjs = fc.getObjects()
    // Filtra apenas reais e pega o targetCanvasIndex-esimo
    const realObjs = allObjs.filter((o: any) => !o.__isBg && !o.__isBleedOverlay)
    const targetObj = realObjs[targetCanvasIndex]
    if (!targetObj) return
    const targetIndexInAll = allObjs.indexOf(targetObj)
    fc.moveObjectTo(obj, targetIndexInAll)
    // BG sempre embaixo apos reorder
    const bgObj = fc.getObjects().find((o: any) => o.__isBg)
    if (bgObj) fc.sendObjectToBack(bgObj)
    fc.renderAll()
    refreshLayers(fc)
    // History: Fabric NAO dispara object:modified em moveObjectTo. Sem este
    // push, drag-drop pra reordenar layers / mover entre folders nao entra
    // no undo stack — Cmd+Z nao desfaz reorders.
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  function toggleLayerVisibility(obj: any) {
    const fc = fabricRef.current
    if (!fc || !obj) return
    const hidden = !(obj.__hidden === true)
    obj.__hidden = hidden
    obj.set("visible", !hidden)
    fc.renderAll()
    refreshLayers(fc)
    // History: set('visible') nao dispara object:modified. Sem push, toggle
    // do olho/cadeado fica fora do undo stack.
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    // Save sem debounce: acao deliberada do user, nao pode ser perdida se ele
    // sair da pagina logo apos clicar (cleanup do useEffect cancelaria o timer).
    doSaveNow()
  }

  /**
   * Aplica visibilidade/lock em TODOS os layers cujo __groupPath comeca com
   * folderPath (i.e. o layer esta dentro daquela pasta ou sub-pasta).
   * Operacao em massa Photoshop-style: olho/cadeado no folder afeta filhos.
   * value=true significa hidden/locked; false significa visible/unlocked.
   */
  function setGroupAttribute(folderPath: string[], attr: "__hidden" | "__locked", value: boolean) {
    const fc = fabricRef.current
    if (!fc) return
    const allObjs = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay)
    let changed = 0
    for (const o of allObjs) {
      const op: string[] = Array.isArray((o as any).__groupPath) ? (o as any).__groupPath : []
      if (op.length < folderPath.length) continue
      let inside = true
      for (let i = 0; i < folderPath.length; i++) {
        if (op[i] !== folderPath[i]) { inside = false; break }
      }
      if (!inside) continue
      ;(o as any)[attr] = value
      if (attr === "__hidden") (o as any).set("visible", !value)
      changed++
    }
    if (changed > 0) {
      fc.renderAll()
      refreshLayers(fc)
      // History: toggle massivo de visibility/lock em folder nao dispara
      // object:modified (set('visible') eh setter direto). Push pra entrar
      // no undo stack.
      if (isInitialized.current && !isApplyingHistory.current) pushHistory()
      doSaveNow()
    }
  }
  function isGroupHidden(folderPath: string[]): boolean {
    // Folder eh considerado "hidden" se TODOS os filhos diretos+indiretos estao hidden.
    const fc = fabricRef.current
    if (!fc) return false
    const children = fc.getObjects().filter((o: any) => {
      if (o.__isBg || o.__isBleedOverlay) return false
      const op: string[] = Array.isArray(o.__groupPath) ? o.__groupPath : []
      if (op.length < folderPath.length) return false
      for (let i = 0; i < folderPath.length; i++) if (op[i] !== folderPath[i]) return false
      return true
    })
    if (children.length === 0) return false
    return children.every((o: any) => o.__hidden === true)
  }
  function isGroupLocked(folderPath: string[]): boolean {
    const fc = fabricRef.current
    if (!fc) return false
    const children = fc.getObjects().filter((o: any) => {
      if (o.__isBg || o.__isBleedOverlay) return false
      const op: string[] = Array.isArray(o.__groupPath) ? o.__groupPath : []
      if (op.length < folderPath.length) return false
      for (let i = 0; i < folderPath.length; i++) if (op[i] !== folderPath[i]) return false
      return true
    })
    if (children.length === 0) return false
    return children.every((o: any) => o.__locked === true)
  }

  // === FOLDER MANAGEMENT (Photoshop-style groups) ===
  // Folders sao derivados de __groupPath nos Fabric objects. Pra criar/mover/
  // renomear/deletar folders, basta mexer no __groupPath dos filhos.

  // Coleta todos os layers cujo __groupPath comeca por folderPath (descendentes
  // recursivos do folder, incluindo subfolders). Usado por moveFolder, rename,
  // delete pra atuar no folder inteiro de uma vez.
  function getFolderDescendants(folderPath: string[]): any[] {
    const fc = fabricRef.current
    if (!fc) return []
    return fc.getObjects().filter((o: any) => {
      if (o.__isBg || o.__isBleedOverlay) return false
      const op: string[] = Array.isArray(o.__groupPath) ? o.__groupPath : []
      if (op.length < folderPath.length) return false
      for (let i = 0; i < folderPath.length; i++) if (op[i] !== folderPath[i]) return false
      return true
    })
  }

  /**
   * Seleciona TODOS os layers de um folder (incluso sub-folders) no canvas.
   * Photoshop-style: clicar no folder no painel = manipular composite do grupo.
   * Fabric ActiveSelection move/escala/rotaciona como grupo preservando posicoes
   * relativas. Pula layers locked (Fabric ActiveSelection bug: objeto locked
   * dentro de selecao impede o resto de se mover).
   */
  async function selectFolderInCanvas(folderPath: string[]): Promise<void> {
    const fc = fabricRef.current
    if (!fc) return
    const objects = getFolderDescendants(folderPath).filter((o: any) => !o.__locked && o.selectable !== false)
    if (objects.length === 0) {
      // Folder so com layers locked/hidden — desativa selecao atual e sai.
      fc.discardActiveObject()
      fc.requestRenderAll()
      return
    }
    fc.discardActiveObject()
    if (objects.length === 1) {
      fc.setActiveObject(objects[0])
    } else {
      // Fabric v6: ActiveSelection eh a forma canonica de "multi-select".
      // Suporta move/scale/rotate como grupo, e os children mantem coords
      // relativas ao centro do bbox da selecao.
      const { ActiveSelection } = await import("fabric")
      const sel = new (ActiveSelection as any)(objects, { canvas: fc })
      fc.setActiveObject(sel)
    }
    fc.requestRenderAll()
  }

  // Coleta todos os paths de folders existentes (derivados dos groupPaths dos
  // layers — folder existe se PELO MENOS um layer aponta pra ele). Usado pra
  // detectar conflito de nome ao criar/renomear.
  function getAllFolderPaths(): Set<string> {
    const fc = fabricRef.current
    if (!fc) return new Set()
    const out = new Set<string>()
    for (const o of fc.getObjects()) {
      if ((o as any).__isBg || (o as any).__isBleedOverlay) continue
      const op: string[] = Array.isArray((o as any).__groupPath) ? (o as any).__groupPath : []
      // Adiciona TODOS os prefixos (folder pai + ancestrais)
      for (let i = 1; i <= op.length; i++) {
        out.add(op.slice(0, i).join("›"))
      }
    }
    return out
  }

  // Cria um folder novo. Se ha selecao no canvas (selected ou ActiveSelection
  // multi), move OS layers selecionados pra dentro do folder. Senao, cria
  // folder vazio com placeholder — mas como o painel deriva folders de layers
  // reais, folder vazio nao apareceria. Por isso na ausencia de selecao,
  // alertamos o user.
  // parentPath: se passado, o novo folder eh subfolder dessa pasta.
  /**
   * Cria um folder novo. Comportamento Adobe-style:
   *  - `moveSelection=false` (default do botao "+ Folder"): cria folder VAZIO.
   *    Adiciona placeholder Rect 1x1 invisivel pra o painel renderizar o folder.
   *    User arrasta layers pra dentro manualmente.
   *  - `moveSelection=true`: pega selecao ativa e move pra dentro (Cmd+G no PS).
   *
   * Antes: o botao "+ Folder" SEMPRE movia a selecao ativa. Combinado com a
   * feature recente de `selectFolderInCanvas` (clicar no header do folder seleciona
   * todos os children via ActiveSelection), clicar "+ Folder" depois de clicar
   * num folder existente MOVIA TUDO pra dentro do novo folder. Bug visivel:
   * "perde os outros layers" do folder de origem.
   */
  async function createFolder(name: string, parentPath: string[] = [], moveSelection = false) {
    const fc = fabricRef.current
    if (!fc || !name?.trim()) return
    const cleanName = name.trim()
    const newPath = [...parentPath, cleanName]
    const key = newPath.join("›")
    const existing = getAllFolderPaths()
    if (existing.has(key)) {
      alert(`Folder "${cleanName}" already exists at this level.`)
      return
    }
    if (moveSelection) {
      // Cmd+G style: move selecao ativa pra dentro.
      const active = fc.getActiveObject() as any
      let targets: any[] = []
      if (active) {
        const inner = Array.isArray(active._objects) ? active._objects : null
        targets = inner ?? [active]
        targets = targets.filter((o: any) => !o.__isBg && !o.__isBleedOverlay)
      }
      if (targets.length === 0) {
        alert("Select one or more layers on the canvas to move into the folder.")
        return
      }
      for (const o of targets) {
        ;(o as any).__groupPath = newPath
      }
    } else {
      // Folder vazio: cria placeholder invisivel pra o painel renderizar.
      // Rect 1x1 com excludeFromExport=true (nao sai no PNG/PSD export) e
      // __folderPlaceholder=true (marker pra deletar quando user arrasta layer
      // real pra dentro). NAO mexe na selecao atual.
      const { Rect } = await import("fabric")
      const ph = new (Rect as any)({
        left: 0, top: 0, width: 1, height: 1,
        fill: "rgba(0,0,0,0)", stroke: "rgba(0,0,0,0)",
        selectable: false, evented: false, excludeFromExport: true, visible: false,
      })
      ;(ph as any).__folderPlaceholder = true
      ;(ph as any).__groupPath = newPath
      ;(ph as any).__assetLabel = "(folder placeholder)"
      fc.add(ph)
      // User pedido 2026-05-23: 'criar folder abaixo do layer selecionado'.
      // Se ha layer ativo, posiciona o placeholder logo ABAIXO dele no z-stack
      // (painel mostra top→bottom = front→back, entao abaixo do selecionado
      // significa atras no canvas). Sem isso, o placeholder cai no topo (front),
      // longe da selecao do user.
      const active = fc.getActiveObject() as any
      if (active && !active.__isBg && !active.__isBleedOverlay) {
        const all = fc.getObjects()
        const activeIdx = all.indexOf(active)
        if (activeIdx >= 0) {
          // moveObjectTo coloca ph no index dado. Pra ficar ABAIXO de active no
          // painel (= um z-step atras na lista do Fabric), insere em activeIdx.
          // Fabric shifta active pra cima automaticamente.
          fc.moveObjectTo(ph, activeIdx)
        }
        // BG sempre embaixo apos qualquer reorder
        const bgObj = all.find((o: any) => o.__isBg)
        if (bgObj) fc.sendObjectToBack(bgObj)
      }
    }
    fc.renderAll()
    refreshLayers(fc)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  // Renomeia um folder existente: muda o segmento `folderPath[depth]` em todos
  // os descendentes pro novo nome. Subfolders e layers preservam a hierarquia.
  function renameFolder(folderPath: string[], newName: string) {
    const fc = fabricRef.current
    if (!fc || !newName?.trim() || folderPath.length === 0) return
    const cleanName = newName.trim()
    // Conflito: se ja existe folder com mesmo path renomeado, aborta
    const newPath = [...folderPath.slice(0, -1), cleanName]
    const newKey = newPath.join("›")
    const existing = getAllFolderPaths()
    if (existing.has(newKey) && newKey !== folderPath.join("›")) {
      alert(`Folder "${cleanName}" already exists at this level.`)
      return
    }
    const depth = folderPath.length - 1
    const descs = getFolderDescendants(folderPath)
    for (const o of descs) {
      const op: string[] = [...((o as any).__groupPath ?? [])]
      op[depth] = cleanName
      ;(o as any).__groupPath = op
    }
    fc.renderAll()
    refreshLayers(fc)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  // Move um folder INTEIRO (com subfolders e layers) pra um novo parentPath.
  // Ex: mover ["LOGO","Subfolder"] pra parent ["CODEZIN"] → vira ["CODEZIN","Subfolder"].
  // Pra mover pra raiz, passa parentPath = [].
  function moveFolderTo(folderPath: string[], newParentPath: string[]) {
    const fc = fabricRef.current
    if (!fc || folderPath.length === 0) return
    // Sanity: nao pode mover folder pra dentro de si mesmo (ou descendente).
    // newParentPath nao pode comecar com folderPath.
    if (newParentPath.length >= folderPath.length) {
      let isDescendant = true
      for (let i = 0; i < folderPath.length; i++) {
        if (newParentPath[i] !== folderPath[i]) { isDescendant = false; break }
      }
      if (isDescendant) return // mover pra dentro de si mesmo: ignora
    }
    const folderName = folderPath[folderPath.length - 1]
    const newFolderPath = [...newParentPath, folderName]
    // Conflito de nome no destino
    const existing = getAllFolderPaths()
    if (newFolderPath.join("›") !== folderPath.join("›") && existing.has(newFolderPath.join("›"))) {
      alert(`A folder "${folderName}" already exists at the destination.`)
      return
    }
    const descs = getFolderDescendants(folderPath)
    for (const o of descs) {
      const op: string[] = [...((o as any).__groupPath ?? [])]
      // Substitui o prefixo folderPath por newFolderPath
      const tail = op.slice(folderPath.length)
      ;(o as any).__groupPath = [...newFolderPath, ...tail]
    }
    // Limpa placeholder do PARENT destino (se folder destino era vazio antes,
    // agora tem conteudo real — placeholder vira lixo). Aceita apenas placeholders
    // cujo groupPath bate EXATO com newParentPath.
    const parentKey = newParentPath.join("›")
    if (parentKey) {
      const placeholders = fc.getObjects().filter((o: any) => o.__folderPlaceholder
        && Array.isArray(o.__groupPath)
        && o.__groupPath.join("›") === parentKey)
      for (const p of placeholders) fc.remove(p)
    }
    // Reposiciona descendentes do folder movido pra ficarem contiguos no z-stack
    // (Fabric usa ordem do array). Sem isso, layers do folder movido podem ficar
    // intercalados com layers de outros folders no painel, e a renderizacao de
    // headers/indentacao parece "fora do folder destino" mesmo o __groupPath
    // estando correto.
    if (descs.length > 0) {
      const allObjs = fc.getObjects()
      // Acha o ultimo layer (no z-stack) do PARENT destino que NAO eh dos descs movidos
      const parentSiblings = allObjs.filter((o: any) => {
        const op: string[] = Array.isArray(o.__groupPath) ? o.__groupPath : []
        if (op.join("›") !== parentKey) return false
        return !descs.includes(o)
      })
      // Se ha algum sibling, posiciona descs logo APOS o ultimo sibling no
      // z-stack (= visualmente CONTIGUO com o folder destino no painel).
      // Se nao ha sibling (parent eh raiz vazia / so o placeholder), envia
      // descs pro topo do z-stack (apareceram na ordem natural).
      let insertAfter = parentSiblings.length > 0
        ? allObjs.indexOf(parentSiblings[parentSiblings.length - 1])
        : -1
      for (const d of descs) {
        const currentIdx = allObjs.indexOf(d)
        if (currentIdx < 0) continue
        // moveObjectTo posiciona objeto no index dado. Apos cada move,
        // recalcula posicao (Fabric mantem o array atualizado).
        insertAfter = Math.min(insertAfter + 1, fc.getObjects().length - 1)
        fc.moveObjectTo(d, insertAfter)
      }
    }
    // BG sempre no fundo
    const bgObj = fc.getObjects().find((o: any) => o.__isBg)
    if (bgObj) fc.sendObjectToBack(bgObj)
    fc.renderAll()
    refreshLayers(fc)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  // Deleta um folder. Por padrao, MOVE os filhos pra pasta pai (ou raiz se folder
  // era topo). Se deleteContents=true, remove os filhos do canvas tambem.
  function deleteFolder(folderPath: string[], deleteContents: boolean = false) {
    const fc = fabricRef.current
    if (!fc || folderPath.length === 0) return
    const descs = getFolderDescendants(folderPath)
    if (deleteContents) {
      for (const o of descs) fc.remove(o)
    } else {
      // Move filhos pra parent path (1 nivel acima)
      const parentPath = folderPath.slice(0, -1)
      for (const o of descs) {
        const op: string[] = [...((o as any).__groupPath ?? [])]
        const tail = op.slice(folderPath.length)
        if (parentPath.length === 0 && tail.length === 0) {
          delete (o as any).__groupPath
        } else {
          ;(o as any).__groupPath = [...parentPath, ...tail]
        }
      }
    }
    fc.renderAll()
    refreshLayers(fc)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  function toggleLayerLock(obj: any) {
    const fc = fabricRef.current
    if (!fc || !obj) return
    const locked = !(obj.__locked === true)
    obj.__locked = locked
    console.log("[TOGGLE-LOCK] novo estado:", locked, "label:", obj?.__assetLabel)
    // Lock = nao move, nao redimensiona, nao rotaciona, nao seleciona via clique
    obj.set({
      selectable: !locked,
      evented: !locked,
      lockMovementX: locked,
      lockMovementY: locked,
      lockScalingX: locked,
      lockScalingY: locked,
      lockRotation: locked,
    })
    if (locked && fc.getActiveObject() === obj) fc.discardActiveObject()
    fc.renderAll()
    refreshLayers(fc)
    // History: obj.set({selectable, evented, lock*}) nao dispara modified.
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    // Save sem debounce: acao deliberada do user, nao pode ser perdida se ele
    // sair da pagina logo apos clicar (cleanup do useEffect cancelaria o timer).
    doSaveNow()
  }

  // Aplica flags __hidden/__locked vindas do JSON salvo no objeto Fabric criado.
  // Chamado depois de addAssetToCanvas/addEmbeddedLayer pra restaurar estado.
  function applyHiddenLockedToObject(obj: any, layer: any) {
    // DEBUG: envia trace pro servidor pra Giovanni inspecionar via curl
    try {
      fetch("/api/debug/load-trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "applyHiddenLockedToObject",
          layer_hidden: layer?.hidden,
          layer_locked: layer?.locked,
          obj_label: obj?.__assetLabel,
          obj_type: obj?.type,
          had_hidden_before: obj?.__hidden,
          had_locked_before: obj?.__locked,
        }),
      })
    } catch {}
    if (layer?.hidden === true) {
      obj.__hidden = true
      obj.set("visible", false)
    }
    if (layer?.locked === true) {
      obj.__locked = true
      obj.set({
        selectable: false,
        evented: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
      })
    }
  }

  // ============= MASK HELPERS =============
  // Adiciona/remove/inverte/toggle mascara no objeto Fabric selecionado.
  // Os 3 tipos suportados: raster, vector (path SVG), clipping (recorta layer abaixo).

  /**
   * Remove uma layer com unclip CASCADE acima.
   *
   * Photoshop clipping mask: layer A clipa pela layer B (imediatamente abaixo).
   * Se cadeia: A → B → C (todos clipping), removendo C tem que limpar A E B.
   *
   * Quando user apaga uma layer, qualquer layer ACIMA dela com clipping mask
   * que dependia desta base precisa ter o clip removido (sem isso, fica
   * "fantasma" — clipPath ainda referencia o objeto removido).
   *
   * Loop break: a primeira layer SEM clipping quebra a cadeia (above stops).
   *
   * Reportado 2026-05-26: "apago a mascara o layer de baixo e ele continua
   * com a mascara — deveria imediatamente perder a mascara".
   */
  function removeLayerWithUnclipCascade(obj: any) {
    const fc = fabricRef.current
    if (!fc || !obj) return
    const all = fc.getObjects()
    const baseIdx = all.indexOf(obj)
    if (baseIdx >= 0) {
      for (let i = baseIdx + 1; i < all.length; i++) {
        const above: any = all[i]
        const md = above?.__maskData
        if (md?.type === "clipping" && md?.enabled !== false) {
          above.__maskData = undefined
          delete above.__clippingMask
          above.clipPath = null
          try { above.setCoords?.() } catch {}
          above.dirty = true
        } else break  // primeira layer sem clipping quebra a cadeia
      }
    }
    fc.remove(obj)
  }

  async function applyMaskAndPersist(obj: any, mask: any) {
    const fc = fabricRef.current
    if (!fc) return
    ;(obj as any).__maskData = mask
    if (mask) {
      const { Image: FabImage, Path } = await import("fabric")
      await applyMaskToFabricObject({ Image: FabImage, Path }, obj, mask)
    } else {
      obj.clipPath = null
      delete (obj as any).__clippingMask
      obj.dirty = true
    }
    fc.requestRenderAll()
    refreshLayers(fc)
    doSave()
  }

  async function addClippingMaskToSelected() {
    const fc = fabricRef.current
    const obj = fc?.getActiveObject()
    if (!fc || !obj) return
    await applyMaskAndPersist(obj, { type: "clipping", enabled: true, clipping: true })
    // Aplica o clip de fato: o layer ABAIXO (Photoshop clipping mask = clipa
    // pelo layer imediatamente abaixo). applyMaskToFabric.ts so anota
    // __clippingMask = true (sem render); aqui resolvemos visualmente.
    await applyClippingMaskNative(fc, obj)
    fc.requestRenderAll()
    isDirtyRef.current = true
    setIsDirty(true)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  /**
   * Aplica clipPath nativo de Fabric usando o silhouette do layer ABAIXO
   * (PSD clipping mask). Detecta base via fc.getObjects() — proximo layer
   * com __assetId (skipa bg/bleed overlay) anterior ao obj atual.
   *
   * Pra que o clip mostre apenas onde o base tem pixels:
   *   - SHAPE base: clona Fabric.Path (mesmo path/fill/stroke)
   *   - IMAGE base: clona Fabric.Image absolutePositioned
   *   - TEXT base: clona Textbox
   * Cria clone com absolutePositioned: true. Fabric clipPath assim renderiza
   * em coords absolutas do canvas (mesma posicao do base original).
   */
  /**
   * Aplica clipPath nativo de Fabric usando o silhouette do layer ABAIXO.
   *
   * ANTI-RACE 2026-05-26: aceita `expectedSeq` opcional. Se `applySnapshotSeq`
   * mudou entre a chamada e o await base.clone() (= outro undo/redo disparou),
   * aborta — sem isso o clone do undo antigo sobrescrevia clipPath restaurado
   * pelo undo mais novo, deixando mask "fantasma" apontando pra base errada.
   */
  async function applyClippingMaskNative(fc: any, obj: any, expectedSeq?: number) {
    const all = fc.getObjects().filter((o: any) =>
      !o.__isBg && !o.__isBleedOverlay && !o.__isStrokeGhost
    )
    const idx = all.indexOf(obj)
    if (idx <= 0) {
      // Sem layer abaixo — nada pra clipar. Remove clipPath previo.
      obj.clipPath = null
      return
    }
    const base = all[idx - 1]
    if (!base) { obj.clipPath = null; return }
    try {
      // Clone Fabric do base — mantem mesma geometria pra usar como clipPath.
      // clone() eh assincrono em Fabric v7 (retorna Promise).
      const baseClone = await base.clone()
      // Stale check pos-await — outra applySnapshot pode ter disparado.
      if (expectedSeq !== undefined && expectedSeq !== applySnapshotSeq.current) {
        return
      }
      ;(baseClone as any).absolutePositioned = true
      // ClipPath nao precisa de fill/stroke pra clipar — so a silhouette
      // (alpha) eh usada. Mas se for IMAGE/TEXT, mantemos como esta —
      // Fabric usa o alpha do bitmap.
      obj.clipPath = baseClone
      obj.dirty = true
    } catch (e) {
      console.warn("[clipping-mask] falha ao clonar base:", e)
      obj.clipPath = null
    }
  }

  // Cria vector mask retangular (Reveal All do Photoshop: caixa = todo bounding box,
  // texto/imagem visivel inteiro). Reveal Selection seria menor.
  async function addRectVectorMaskToSelected(revealAll: boolean = true) {
    const fc = fabricRef.current
    const obj = fc?.getActiveObject()
    if (!fc || !obj) return
    const x = obj.left ?? 0
    const y = obj.top ?? 0
    const w = (obj.width ?? 200) * (obj.scaleX ?? 1)
    const h = (obj.height ?? 200) * (obj.scaleY ?? 1)
    // Reveal All: mascara cobre tudo. Hide All: mascara invertida (esconde tudo).
    const path = `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`
    const mask = {
      type: "vector" as const,
      enabled: true,
      inverted: !revealAll,
      vector: { path, posX: x, posY: y, width: w, height: h },
    }
    await applyMaskAndPersist(obj, mask)
  }

  // Cria vector mask eliptica no bounding box do objeto.
  async function addEllipseVectorMaskToSelected(revealAll: boolean = true) {
    const fc = fabricRef.current
    const obj = fc?.getActiveObject()
    if (!fc || !obj) return
    const x = obj.left ?? 0
    const y = obj.top ?? 0
    const w = (obj.width ?? 200) * (obj.scaleX ?? 1)
    const h = (obj.height ?? 200) * (obj.scaleY ?? 1)
    const cx = x + w / 2
    const cy = y + h / 2
    const rx = w / 2
    const ry = h / 2
    // SVG path eliptico usando 2 arcos.
    const path = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
    const mask = {
      type: "vector" as const,
      enabled: true,
      inverted: !revealAll,
      vector: { path, posX: x, posY: y, width: w, height: h },
    }
    await applyMaskAndPersist(obj, mask)
  }

  // Toggle: mascara enabled/disabled (Shift+clique no Photoshop).
  async function toggleMaskEnabled(obj: any) {
    if (!obj?.__maskData) return
    const mask = { ...(obj as any).__maskData, enabled: !(obj as any).__maskData.enabled }
    await applyMaskAndPersist(obj, mask)
    // Clipping mask: applyMaskToFabricObject so trata raster/vector enabled.
    // Clipping eh feito pelo applyClippingMaskNative (depende do layer abaixo).
    // Aqui precisa sincronizar: enabled=true → re-aplica; false → remove clipPath
    // mas preserva __maskData pra round-trip.
    if (mask.type === "clipping") {
      const fc = fabricRef.current
      if (!fc) return
      if (mask.enabled === false) {
        obj.clipPath = null
        obj.dirty = true
      } else {
        await applyClippingMaskNative(fc, obj)
      }
      fc.requestRenderAll()
    }
  }

  async function toggleMaskInverted(obj: any) {
    if (!obj?.__maskData) return
    const mask = { ...(obj as any).__maskData, inverted: !(obj as any).__maskData.inverted }
    await applyMaskAndPersist(obj, mask)
  }

  async function removeMaskFromObject(obj: any) {
    if (!obj?.__maskData) return
    delete (obj as any).__maskData
    await applyMaskAndPersist(obj, null)
  }

  function getMaskOfSelected(): any | null {
    const fc = fabricRef.current
    const obj = fc?.getActiveObject()
    return (obj as any)?.__maskData ?? null
  }

  // Renderiza um step OFFSCREEN (sem mexer no canvas principal) e retorna o blob.
  // Usado pra gerar thumbnails de steps inativos automaticamente quando a peca
  // abre. Sem isso, o user teria que ativar cada step manualmente.
  async function renderStepOffscreenToBlob(
    step: { layers: any[]; bgColor: string; bgOpacity?: number; bgLayers?: BgLayerData[] }
  ): Promise<Blob | null> {
    const camp = campaignRef.current
    if (!camp) return null
    try {
      const w = canvasWRef.current
      const h = canvasHRef.current
      const TARGET = 2400
      const scale = Math.min(TARGET / w, TARGET / h, 1)
      const tw = Math.round(w * scale)
      const th = Math.round(h * scale)
      const fabricMod = await import("fabric") as any
      const { StaticCanvas, FabricImage, Path, Textbox, Rect } = fabricMod
      const canvasEl = document.createElement("canvas")
      canvasEl.width = tw; canvasEl.height = th
      const sfc = new StaticCanvas(canvasEl, {
        width: tw, height: th,
        enableRetinaScaling: false,
      })
      // BG layers: aplica via mesma logica do canvas principal pra suportar
      // multi-BG / gradient / image. Fallback pra step.bgColor (legacy).
      const stepBgLayers: BgLayerData[] = Array.isArray(step.bgLayers) && step.bgLayers.length > 0
        ? step.bgLayers.map(migrateBgLayerJson)
        : [{ kind: "solid", color: step.bgColor, opacity: typeof step.bgOpacity === "number" ? step.bgOpacity : 1 }]
      for (const ld of stepBgLayers) {
        if (ld.hidden) continue
        const r = new Rect({
          left: 0, top: 0, width: tw, height: th,
          selectable: false, evented: false,
        })
        await syncBgLayerToRect(r, ld, tw, th, fabricMod)
        sfc.add(r)
      }
      // Re-cria cada layer manualmente. Replica a logica de addAssetToCanvas
      // de forma minima — soh o que precisamos pra render visual.
      for (const layer of step.layers) {
        if (layer.embedded) continue
        if (!layer.assetId) continue
        const asset = camp.assets.find((a: Asset) => a.id === layer.assetId)
        if (!asset) continue
        const left = (layer.posX ?? 0) * scale
        const top = (layer.posY ?? 0) * scale
        const sx = (layer.scaleX ?? 1) * scale
        const sy = (layer.scaleY ?? 1) * scale
        const angle = layer.rotation ?? 0
        const overrides = layer.overrides ?? {}
        // PSD blend/opacity preservados no thumb. Sem isso, step thumbs (auto-gen
        // ou export) renderizam multiply/screen como "source-over" — preview
        // diferente do editor que respeita esses.
        const psdProps: any = {}
        if (typeof layer.opacity === "number" && layer.opacity < 1 && layer.opacity >= 0.01) {
          psdProps.opacity = layer.opacity
        }
        if (typeof layer.blendMode === "string" && layer.blendMode && layer.blendMode !== "source-over") {
          psdProps.globalCompositeOperation = layer.blendMode
        }
        if (asset.type === "IMAGE" || asset.type === "SMART_OBJECT") {
          if (!asset.imageUrl) continue
          try {
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
              const el = new Image()
              el.crossOrigin = "anonymous"
              el.onload = () => resolve(el)
              el.onerror = () => reject(new Error("img load"))
              el.src = asset.imageUrl!
            })
            const fimg = new FabricImage(img, {
              left, top, scaleX: sx, scaleY: sy, angle,
              ...psdProps,
            })
            sfc.add(fimg)
          } catch (e) { /* skip */ }
        } else if (asset.type === "TEXT") {
          // Reconstroi text a partir do content + overrides.
          // CRITICO: aplica TODOS os overrides (fontWeight, lineHeight, leadingPt,
          // charSpacing, styles per-char) pra que o thumb reflita o que o user vê
          // no editor. Antes faltava esses — thumb exportado pro PPT saia sem
          // formatacao, mesmo com a peca formatada no editor.
          const content = typeof asset.content === "string" ? JSON.parse(asset.content) : asset.content
          const spans = Array.isArray(content) ? content : []
          const text = (typeof overrides.text === "string" ? overrides.text : spans.map((s: any) => s.text ?? "").join(""))
          const firstStyle = spans[0]?.style ?? {}
          // Width DO TEXTO precisa ser escalada pelo mesmo 'scale' do canvas
          // offscreen. fontSize idem.
          const baseFontSize = overrides.fontSize ?? firstStyle.fontSize ?? 80
          const tb = new Textbox(text || asset.label, {
            left, top, angle,
            fontFamily: overrides.fontFamily ?? firstStyle.fontFamily ?? "Arial",
            fontSize: baseFontSize * scale,
            fontWeight: overrides.fontWeight ?? firstStyle.fontWeight ?? "normal",
            fill: overrides.fill ?? firstStyle.color ?? "#111111",
            width: (layer.width ?? 400) * scale,
            textAlign: overrides.textAlign ?? "left",
            lineHeight: overrides.lineHeight ?? 1.0,
            charSpacing: overrides.charSpacing ?? 0,
            ...psdProps,
          })
          if (overrides.styles) {
            // Migra legacy flat → line-indexed (audit H10) antes de escalar.
            const migratedStyles = migrateFlatStylesToLineIndexed(text || asset.label, overrides.styles)
            // styles per-char tem fontSize na escala da peca; precisa re-escalar
            // pelo offscreen scale antes de aplicar.
            const scaledStyles: any = {}
            for (const lineKey of Object.keys(migratedStyles)) {
              scaledStyles[lineKey] = {}
              for (const colKey of Object.keys(migratedStyles[lineKey])) {
                const cs = { ...migratedStyles[lineKey][colKey] }
                if (typeof cs.fontSize === "number") cs.fontSize = cs.fontSize * scale
                scaledStyles[lineKey][colKey] = cs
              }
            }
            tb.set("styles", scaledStyles)
          }
          // leadingPt (entrelinhas em pontos) — match exato baseline-to-baseline
          // com PSD via medicao runtime do factor real do Fabric.
          if ((tb as any).initDimensions) (tb as any).initDimensions()
          sfc.add(tb)
          if (typeof overrides.leadingPt === "number" && overrides.leadingPt > 0) {
            const scaledLeading = overrides.leadingPt * scale
            applyLeadingPtToFabric(tb, scaledLeading)
          }
        }
      }
      sfc.renderAll()
      await new Promise(r => setTimeout(r, 100))
      // Guard fonts antes do toDataURL (sweep 2026-05-30).
      const { awaitFontsReadyAndRender } = await import("@/lib/awaitFontsReady")
      await awaitFontsReadyAndRender(sfc as any)
      // JPEG quality 0.82 — peca tem bg solido, alpha PNG era luxo nao usado.
      // ~60% reducao vs PNG (2026-05-26 sweep).
      const dataUrl = sfc.toDataURL({ format: "jpeg", quality: 0.82, multiplier: 1 })
      sfc.dispose()
      return await (await fetch(dataUrl)).blob()
    } catch (e) {
      console.warn("[renderStepOffscreen] fail:", e)
      return null
    }
  }

  // Detecta steps sem thumbnail no piece.data e os gera offscreen.
  // Chamado ao abrir uma peca multi-step no editor. Roda em background
  // — nao trava o user.
  // Flag de controle: autoGenerate so roda uma vez por carregamento.
  const autoGenDoneRef = useRef(false)
  async function autoGenerateMissingStepThumbs() {
    if (autoGenDoneRef.current) return
    autoGenDoneRef.current = true
    if (!pieceId) return
    const p = pieceRef.current
    if (!p) return
    const pdata = typeof p.data === "string" ? JSON.parse(p.data) : (p.data ?? {})
    const allSteps: any[] = Array.isArray(pdata.steps) ? pdata.steps : []
    console.log("[autoGen] iniciando. stepCount:", allSteps.length, "isDirty:", isDirtyRef.current)
    if (allSteps.length < 2) return
    const activeIdx = pdata.activeStepIndex ?? 0
    for (let i = 0; i < allSteps.length; i++) {
      const step = allSteps[i]
      // Soh gera quem nao tem thumb. Steps que ja tem ficam quietos.
      if (step?.imageUrl) {
        console.log("[autoGen] step", i, "ja tem thumb")
        continue
      }
      // Renderiza offscreen pra todos os steps sem thumb (inclusive o ativo).
      // Antes usavamos uploadPieceThumb pro ativo, mas isso le do canvas que
      // pode estar vazio durante o init.
      console.log("[autoGen] gerando thumb pro step", i, i === activeIdx ? "(ATIVO)" : "")
      const blob = await renderStepOffscreenToBlob({
        layers: step.layers ?? [],
        bgColor: step.bgColor ?? bgColorRef.current,
      })
      if (!blob) {
        console.log("[autoGen] blob vazio pro step", i)
        continue
      }
      // CRITICO: re-busca o estado atual do banco JUSTAMENTE antes do upload.
      // Outro save (do user) pode ter gerado um thumb melhor pra este step.
      // Se ja tem imageUrl agora, NAO sobrescreve.
      try {
        const freshRes = await fetch(`/api/pieces/${pieceId}`, { cache: "no-store" })
        const freshPiece = await freshRes.json()
        const freshData = typeof freshPiece.data === "string" ? JSON.parse(freshPiece.data) : (freshPiece.data ?? {})
        const freshStep = Array.isArray(freshData.steps) ? freshData.steps[i] : null
        if (freshStep?.imageUrl) {
          console.log("[autoGen] step", i, "ja tem thumb no banco (gerado por outro save) — pulando")
          continue
        }
      } catch (e) { /* segue mesmo se a checagem falhar */ }
      const fd = new FormData()
      fd.append("thumbnail", blob, `step${i}.png`)
      try {
        await fetch(`/api/pieces/${pieceId}/step-thumbnail?index=${i}`, { method: "POST", body: fd })
        console.log("[autoGen] thumb upload OK step", i)
      } catch (e) { console.warn("[auto thumb] upload fail step", i, e) }
    }
  }

  // Gera o blob de thumbnail do canvas atual (PNG 2400px max).
  // Separado de uploadPieceThumb pra reuso (upload de step thumb tambem).
  async function generateCurrentThumbBlob(fc: any): Promise<Blob | null> {
    try {
      const w = canvasWRef.current
      const h = canvasHRef.current
      // TARGET 2400 -> 1440 -> 960 (2026-05-26 user pediu mais perf).
      // 960px cobre display max ~600-900px em apresentacao com folga. PPTX
      // export ainda usa esse thumb mas slide widescreen mostra a 720-900px.
      // Reducao final: ~9x area vs original 2400, ~2.3x vs intermediario 1440.
      const TARGET = 960
      const thumbScale = Math.min(TARGET / w, TARGET / h, 1)

      // O canvas Fabric do editor eh GRANDE (fullW x fullH ~ painel do editor)
      // com a peca centralizada via viewportTransform. Sem bounds explicitos,
      // toDataURL capturava o canvas inteiro -> thumb saia com area de bleed
      // ao redor da peca + objetos perto da borda saindo cortados.
      //
      // Fix: calcular regiao da peca em coords do canvas DOM:
      //   mundo Fabric (0,0,w,h) -> canvas DOM (vt[4], vt[5], w*z, h*z)
      // onde z = vt[0] (zoom atual).
      const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
      const z = vt[0] ?? 1
      const offsetX = vt[4] ?? 0
      const offsetY = vt[5] ?? 0

      // Esconde temporariamente o bleed overlay + smart guides (after:render
      // pinta dashed lines no lower context — se autosave dispara mid-drag
      // com __safeAreaGuides setado, as linhas entram no PNG do thumb).
      const bleedOverlays = fc.getObjects().filter((o: any) => o.__isBleedOverlay)
      bleedOverlays.forEach((o: any) => { o.visible = false })
      const savedGuides = (fc as any).__safeAreaGuides
      ;(fc as any).__safeAreaGuides = null
      try {
        // Guard fonts antes do toDataURL (sweep 2026-05-30).
        const { awaitFontsReadyAndRender } = await import("@/lib/awaitFontsReady")
        await awaitFontsReadyAndRender(fc)
        const dataUrl = fc.toDataURL({
          // JPEG quality 0.82 — pecas tem bg solido sempre, transparencia
          // verdadeira so em SVGs/logos isolados. Quality 0.82 sweet spot
          // sem artifacts. ~60% reducao vs PNG. (2026-05-26 user pediu mais
          // perf no preview.)
          format: "jpeg",
          quality: 0.82,
          // multiplier dividido por z compensa o zoom — resultado: JPEG com
          // exatamente w*thumbScale x h*thumbScale (proporcao da peca).
          multiplier: thumbScale / z,
          enableRetinaScaling: false,
          left: offsetX,
          top: offsetY,
          width: w * z,
          height: h * z,
        })
        const blob = await (await fetch(dataUrl)).blob()
        console.log("[thumb] gerado", blob.size, "bytes", `${Math.round(w * thumbScale)}x${Math.round(h * thumbScale)}`)
        srvLog("thumb-GENERATED", { bytes: blob.size, w: Math.round(w * thumbScale), h: Math.round(h * thumbScale), objects: fc.getObjects().length })
        return blob
      } finally {
        bleedOverlays.forEach((o: any) => { o.visible = true })
        ;(fc as any).__safeAreaGuides = savedGuides
        fc.requestRenderAll()
      }
    } catch (e: any) {
      console.error("[generateCurrentThumbBlob] FALHOU:", e)
      srvLog("thumb-FAILED", { error: String(e?.message ?? e), stack: e?.stack?.split("\n").slice(0, 4).join(" | ") })
      return null
    }
  }

  // Regenera + sobe o thumbnail do KV (matriz) sem persistir layers. Usado no
  // auto-regen-on-open: garante preview da apresentacao/cards sempre atualizado
  // mesmo se o usuario nao editou nada nesta sessao.
  async function uploadMatrixThumb(fc: any) {
    try {
      // 1440 → 960 (2026-05-26 perf). KV thumb mostra em cards/list, max 200-400px.
      const thumbScale = Math.min(960 / canvasWRef.current, 960 / canvasHRef.current, 1)
      const z = zoomRef.current || 1
      const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
      const offsetX = vt[4] ?? 0
      const offsetY = vt[5] ?? 0
      // Guard fonts antes do toDataURL (sweep 2026-05-30).
      const { awaitFontsReadyAndRender } = await import("@/lib/awaitFontsReady")
      await awaitFontsReadyAndRender(fc)
      const dataUrl = fc.toDataURL({
        // JPEG quality 0.82 — pecas tem bg solido. ~60% reducao vs PNG.
        // Hist: PNG era pra preservar alpha mas quase nunca usado em pratica.
        // Sweet spot 2026-05-26.
        format: "jpeg",
        quality: 0.82,
        multiplier: thumbScale / z,
        left: offsetX, top: offsetY,
        width: canvasWRef.current * z,
        height: canvasHRef.current * z,
      })
      const blob = await (await fetch(dataUrl)).blob()
      const fd = new FormData()
      fd.append("thumbnail", blob, "kv-thumb.jpg")
      await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: fd })
      // Broadcast cross-tab pra preview em outras paginas (campanhas list,
      // dashboard) refetch o KV thumb atualizado.
      try {
        if (typeof BroadcastChannel !== "undefined") {
          const bc = new BroadcastChannel("zzosy:campaigns")
          bc.postMessage({ type: "kv-updated", campaignId, ts: Date.now() })
          bc.close()
        }
      } catch {}
      // localStorage backup pro caso de BroadcastChannel falhar (SPA same-tab,
      // etc). presentation listener escuta zzosy:lastKvSave.
      try {
        if (typeof localStorage !== "undefined" && campaignId) {
          localStorage.setItem(`zzosy:lastKvSave:${campaignId}`, String(Date.now()))
        }
      } catch {}
    } catch (e) { console.warn("[uploadMatrixThumb] fail:", e) }
  }

  async function uploadPieceThumb(fc: any, pId: string) {
    console.log("[uploadPieceThumb] inicio pra", pId)
    srvLog("uploadPieceThumb-START", { pieceId: pId, stepCount: stepCountRef.current, activeStep: activeStepIndexRef.current })
    const blob = await generateCurrentThumbBlob(fc)
    if (!blob) {
      console.error("[uploadPieceThumb] ABORTADO — blob veio null!")
      srvLog("uploadPieceThumb-ABORTED", "blob veio null")
      return
    }
    console.log("[uploadPieceThumb] blob ok,", blob.size, "bytes. Subindo...")
    srvLog("uploadPieceThumb-BLOB-OK", { bytes: blob.size })
    const fd = new FormData()
    fd.append("thumbnail", blob, "thumb.png")
    try {
      // SEM keepalive: o navegador limita body de keepalive em ~64KB.
      // Thumbs costumam passar disso (70+ KB). Sem keepalive precisamos
      // garantir que await termina antes de window.location.href navegar
      // (responsabilidade do caller — Voltar handler ja faz isso).
      const r = await fetch(`/api/pieces/${pId}/thumbnail`, { method: "POST", body: fd })
      console.log("[uploadPieceThumb] thumb principal status:", r.status)
      srvLog("uploadPieceThumb-MAIN-STATUS", { status: r.status })
    } catch (e: any) {
      console.warn("[uploadPieceThumb] main thumb failed:", e)
      srvLog("uploadPieceThumb-MAIN-FAIL", { error: String(e?.message ?? e) })
    }
    // STEPS: se a peca tem multiplos steps, atualiza tambem o thumb do step ativo.
    if (stepCountRef.current > 1) {
      const fd2 = new FormData()
      fd2.append("thumbnail", blob, `step${activeStepIndexRef.current}.png`)
      try {
        const r2 = await fetch(`/api/pieces/${pId}/step-thumbnail?index=${activeStepIndexRef.current}`, {
          method: "POST", body: fd2,
        })
        srvLog("uploadPieceThumb-STEP-STATUS", { index: activeStepIndexRef.current, status: r2.status })
      } catch (e: any) {
        console.warn("[uploadPieceThumb] step thumb failed:", e)
        srvLog("uploadPieceThumb-STEP-FAIL", { error: String(e?.message ?? e) })
      }
    }
    // Broadcast pra OUTRAS ABAS (lista de pecas, apresentacao) atualizarem
    // preview em tempo real. BroadcastChannel funciona same-origin entre tabs
    // sem precisar de server push. Listener em /pieces refetch imediato.
    try {
      if (typeof BroadcastChannel !== "undefined") {
        const bc = new BroadcastChannel("zzosy:pieces")
        bc.postMessage({ type: "piece-updated", pieceId: pId, campaignId, ts: Date.now() })
        bc.close()
      }
    } catch {}
    // localStorage backup: BroadcastChannel as vezes nao dispara (SPA same-tab
    // navegation, ou browsers com BC bloqueado). Escrever em zzosy:lastSave
    // ativa o storage event nas outras abas que tem listener (presentation
    // page). User reportou 2026-05-26 "preview da apresentacao ficando
    // desatualizado" — esse eh o backup.
    try {
      if (typeof localStorage !== "undefined" && campaignId) {
        localStorage.setItem(`zzosy:lastSave:${campaignId}`, String(Date.now()))
      }
    } catch {}
  }

  // Helper: envia log do client pro terminal do servidor (pra debug fica
  // visivel sem F12). Best-effort: nao espera resposta, nao quebra se falhar.
  function srvLog(tag: string, data: any) {
    try {
      fetch("/api/debug/client-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, data }),
        keepalive: true,
      }).catch(() => {})
    } catch {}
  }

  async function saveNow() {
    clearTimeout(saveTimer.current)
    srvLog("saveNow-CALLED", { pieceId, isDirty: isDirtyRef.current, savingInFlight: savingInFlightRef.current })
    // Guards: nao salva durante apply de historico, nem antes do init terminar.
    // Sem isso, fechar a aba durante remount podia gravar layers em estado
    // transitorio (sem __assetId restaurados) -> KV vazia/quebrada.
    if (isApplyingHistory.current) {
      editorLog("[saveNow] abortado — undo/redo em andamento")
      srvLog("saveNow-SKIPPED", "applying history")
      return
    }
    if (!isInitialized.current) {
      editorLog("[saveNow] abortado — init nao terminou")
      srvLog("saveNow-SKIPPED", "init nao terminou")
      return
    }
    // Serializacao via saveQ.runExclusive (audit #6 — substituiu busy-wait +
    // flag manual que tinha race entre callers paralelos). Coalesce callers
    // redundantes: se houver save enfileirado, novos chamadores compartilham
    // a mesma promise — quando ela rodar, le canvas atual (que eh o que todos
    // queriam salvar). Inflight state propaga via saveQ.isSavingRef.
    await saveQ.runExclusive(async () => {
    setSaving(true)
    try {
    // Flush sincrono de PUTs de asset pendentes ANTES de gravar peca/KV.
    // Sem isso, layer.overrides poderia referenciar template antigo do asset
    // (lastOverride debounceado nao subiu ainda) — proxima peca gerada herda
    // o estado errado.
    try { await flushPendingAssetPuts() } catch {}
    // Snapshot dos refs ALVO desta operacao. Se o user navegar pra outra peca
    // no meio, este save ainda persistira a peca onde a edicao foi feita
    // (em vez de gravar dados antigos sobre a peca nova).
    const targetPieceId = pieceId
    const targetPiece = pieceRef.current
    const fc = fabricRef.current
    if (!fc) return
    if (targetPieceId && targetPiece) {
      const p = targetPiece
      const oldData = typeof p.data === "string" ? JSON.parse(p.data) : (p.data ?? {})
      const newLayers = fc.getObjects()
        .filter((o: any) => {
          if (o.__isBg) return false
          if ((o as any).__isStrokeGhost === true) return false
          if ((o as any).__isBleedOverlay === true) return false
          if (!o.__assetId) {
            editorLog("[PIECE-SAVE-NOW] objeto sem __assetId BLOQUEADO:", {
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
            ...(o.skewX ? { skewX: o.skewX } : {}),
            ...(o.skewY ? { skewY: o.skewY } : {}),
            rotation: o.angle ?? 0, zIndex: i,
            width: Math.round(o.width ?? 400), height: Math.round(o.height ?? 100),
            overrides: {},
          }
          // Metadados PSD (mask/hidden/locked/opacity/blendMode/effects/
          // nameSource/groupPath) via helper centralizado. Era duplicado em
          // 4 sites — qualquer novo metadato PSD entra so no helper agora.
          applyPsdLayerMetadata(o, layer)
          if (o.type === "textbox" || o.type === "i-text") {
            // PECA: caracteres (asset.content) continuam vindo do asset, MAS quebras
            // de linha (\n) e edicoes locais ficam em overrides per-instancia.
            // serializeTextboxOverrides eh a fonte unica de verdade — qualquer prop
            // nova adicionada la propaga automaticamente pros 6 sites.
            Object.assign(layer.overrides, serializeTextboxOverrides(o, { preserveExplicitNewlinesOnly: true }))
          } else if ((o as any).__isShape === true || o.type === "path" || o.type === "Path") {
            // SHAPE override via helper centralizado.
            Object.assign(layer.overrides, serializeShapeOverrides(o))
          }
          return layer
        })
      // ANTI-FALHAS 2026-05-26: GUARD CRITICO. Se newLayers virou vazio mas
      // oldData.layers tinha conteudo, ABORTA o save. Sinaliza bug grave
      // (objetos perderam __assetId em massa, e.g. undo bug, init falhou,
      // race condition). Sobrescrever com vazio = perda permanente de dados.
      // User reportou 2026-05-26 (Image #59): peca abriu vazia (so BG) no
      // editor — todos os layers haviam sumido. Esse guard previne salvar
      // estado fantasma sobre o estado bom existente no DB.
      const oldLayerCount = Array.isArray(oldData?.layers) ? oldData.layers.length : 0
      const oldStepsHasLayers = Array.isArray(oldData?.steps) && oldData.steps.some((s: any) => Array.isArray(s?.layers) && s.layers.length > 0)
      if (newLayers.length === 0 && (oldLayerCount > 0 || oldStepsHasLayers)) {
        console.error("[SAVE-NOW] ABORTADO: newLayers vazio mas oldData tinha", oldLayerCount, "layers. Anti-falhas — nao gravar estado fantasma.")
        srvLog("saveNow-ABORTED-EMPTY", { oldLayerCount, oldStepsHasLayers, fcObjects: fc.getObjects().length })
        return
      }
      // bgColor/bgOpacity DERIVADOS de bgLayers[0] no save — single source of
      // truth. Sem isso, bgColorRef podia divergir de bgLayers e o save
      // perpetuava drift (panel mostrava cor X, canvas pintava Y).
      const __saveBgColor = bgLayerLegacyColor(bgLayersRef.current[0])
      const __saveBgOpacity = bgLayersRef.current[0]?.opacity ?? 1
      const newData: any = { ...oldData, version: 2, width: canvasWRef.current, height: canvasHRef.current, bgColor: __saveBgColor, bgOpacity: __saveBgOpacity, bgLayers: bgLayersRef.current, layers: newLayers }
      // (bgOpacity acima persiste a opacidade do BG no piece.data — back-compat:
      // peças antigas sem o campo são tratadas como 1.0 no load)
      // STEPS: mesmo tratamento do performSave. Sem isso, "Salvar e sair"
      // gravaria a peca SEM o campo steps, destruindo todos os steps inativos.
      if (stepCountRef.current > 1) {
        const fullSteps: any[] = []
        let inactiveCursor = 0
        // Le oldData.steps pra preservar imageUrl do step ativo no save.
        // Sem isso, toda vez que o user salva, o imageUrl do step ativo
        // some (o save sobrescreve com {layers, bgColor} sem imageUrl).
        const oldSteps: any[] = Array.isArray(oldData.steps) ? oldData.steps : []
        // Fallback: peca era single-step (sem data.steps), thumb esta em piece.imageUrl.
        const pieceImgFallback = (!oldSteps.length) ? ((pieceRef.current as any)?.imageUrl ?? null) : null
        for (let i = 0; i < stepCountRef.current; i++) {
          if (i === activeStepIndexRef.current) {
            const oldActive = oldSteps[i] ?? {}
            // DEEP CLONE bgLayers — sem isso, snapshot compartilha referencia
            // do array bgLayersRef. updateCurrentBg muta por indice e os
            // snapshots de outros steps veem a nova cor. User reportou:
            // 'a porra dos steps esta salvando o mesmo background nos 2 steps'.
            const bgClone = bgLayersRef.current.map(l => ({ ...l, stops: (l as any).stops ? (l as any).stops.map((s: any) => ({ ...s })) : undefined }))
            fullSteps.push({
              layers: newLayers,
              bgColor: __saveBgColor, bgOpacity: __saveBgOpacity, bgLayers: bgClone,
              imageUrl: oldActive.imageUrl ?? (i === 0 ? pieceImgFallback : null),
              thumbnailUrl: oldActive.thumbnailUrl ?? (i === 0 ? pieceImgFallback : null),
            })
          } else {
            fullSteps.push(inactiveStepsRef.current[inactiveCursor] ?? { layers: [], bgColor: "#ffffff" })
            inactiveCursor++
          }
        }
        newData.steps = fullSteps
        newData.activeStepIndex = activeStepIndexRef.current
      } else {
        delete newData.steps
        delete newData.activeStepIndex
      }
      try {
        // Fix #12: marca isDirty=false APENAS apos o PATCH ter sucesso. Se o usuario
        // fechar a aba durante o upload, ainda mostra "salvando" e nao perde o
        // estado "dirty" silenciosamente.
        await fetch(`/api/pieces/${targetPieceId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: JSON.stringify(newData) }) })
        // CRITICO: atualiza pieceRef.current.data pra refletir o save. Sem isso,
        // serializeCurrentStep continua lendo data antigo do banco e pode perder
        // imageUrl que ja foi gravado no banco mas nao no ref local.
        if (pieceRef.current) {
          pieceRef.current = { ...pieceRef.current, data: JSON.stringify(newData) } as any
        }
        // Upload do thumb e best-effort; falha nao deve marcar como dirty de novo
        // mas o save da peca em si ja persistiu.
        try {
          srvLog("saveNow-PRE-UPLOAD", { pieceId: targetPieceId, isDirty: isDirtyRef.current })
          await uploadPieceThumb(fc, targetPieceId)
          srvLog("saveNow-POST-UPLOAD", { pieceId: targetPieceId })
          // Re-fetch pieceRef pra pegar o imageUrl novo dos steps (gravado por
          // uploadPieceThumb). Sem isso, switchToStep posterior usa imageUrl
          // null e perde o thumb que acabou de ser gerado.
          try {
            const r = await fetch(`/api/pieces/${targetPieceId}`, { cache: "no-store" })
            if (r.ok) {
              const fresh = await r.json()
              if (pieceRef.current) pieceRef.current = fresh
            }
          } catch (e) { /* nao critico */ }
        } catch (e) { console.warn("thumb fail:", e) }
        isDirtyRef.current = false
        setIsDirty(false)
      } catch (e) {
        console.warn("[saveNow PECA] falha no PATCH:", e)
        // Mantem isDirty=true pro user saber que nao salvou
      }
    } else {
      const layersToSave: Layer[] = fc.getObjects()
        .filter((o: any) => {
          if (o.__isBg) return false
          if ((o as any).__isStrokeGhost === true) return false
          if ((o as any).__isBleedOverlay === true) return false
          // Bloqueia save de objetos sem __assetId — antes salvava com "" e o load
          // descartava silenciosamente, fazendo o canvas voltar vazio (bug grave de
          // perda de conteudo). Se acontecer, logamos pra detectar a causa-raiz.
          // Bleed overlays JA filtrados acima — log so dispara em caso real.
          if (!o.__assetId) {
            editorLog("[SAVE-MATRIX] objeto sem __assetId ignorado no save:", o.type, { left: o.left, top: o.top, text: (o as any).text })
            return false
          }
          return true
        })
        .map((o: any, i: number) => {
          const layer: any = {
            assetId: o.__assetId,
            posX: Math.round(o.left ?? 0), posY: Math.round(o.top ?? 0),
            scaleX: o.scaleX ?? 1, scaleY: o.scaleY ?? 1,
            ...(o.skewX ? { skewX: o.skewX } : {}),
            ...(o.skewY ? { skewY: o.skewY } : {}),
            rotation: o.angle ?? 0, zIndex: i,
            width: Math.round(o.width ?? 400),
            height: Math.round((o.height ?? 300) * (o.scaleY ?? 1)),
            overrides: {},
          }
          // Metadados PSD via helper centralizado. MATRIZ tambem loga warning
          // quando mask vem ausente (era o bug do auto-save apagando masks
          // do PSD logo apos import).
          if (!(o as any).__maskData) {
            srvLog("save-MATRIX-no-mask", {
              assetLabel: (o as any).__assetLabel ?? "?",
              type: o.type,
              hasClipPath: !!o.clipPath,
            })
          }
          applyPsdLayerMetadata(o, layer)
          // editorLog (so em dev) — antes era console.log direto, poluia prod
          editorLog("[SAVE-MATRIX] layer", i, "type:", o.type, "label:", o.__assetLabel, "fill:", o.fill, "stroke:", o.stroke, "strokeWidth:", o.strokeWidth, "psdEffects:", o.__psdEffects, "__hidden:", o.__hidden, "__locked:", o.__locked)
          // Espelha a logica do modo PECA: salva overrides per-instancia (fill,
          // fontSize, styles per-char, leadingPt, etc) pra preservar formatacao
          // ao alternar entre KV/Assets/Campanha. Sem isso, recarregar o KV
          // perdia mudancas de estilo (estilos sao salvos no asset.content e
          // sobrescritos por overrides do layer).
          if (o.type === "textbox" || o.type === "i-text") {
            // MATRIZ: caracteres vem do asset (updateAssetContent propaga). \n
            // local em overrides.text preserva quebra entre reloads sem vazar
            // pro asset. Toda outra prop via helper centralizado.
            Object.assign(layer.overrides, serializeTextboxOverrides(o, { preserveExplicitNewlinesOnly: true }))
          } else if ((o as any).__isShape === true || o.type === "path" || o.type === "Path") {
            // SHAPE override (matriz) via helper centralizado.
            Object.assign(layer.overrides, serializeShapeOverrides(o))
          }
          return layer
        })
      // Circuit breaker (mesma logica do doSave): nao grava matriz vazia sobre KV que tinha layers
      if (layersToSave.length === 0) {
        const previousLayers = (campaignRef.current?.keyVision?.layers as any) ?? []
        const hadLayers = Array.isArray(previousLayers) && previousLayers.length > 0
        if (hadLayers) {
          editorLog("[saveNow MATRIX] abortado — tentaria gravar layers:[] sobre KV que tinha", previousLayers.length, "layers. Provavel race condition.")
          isDirtyRef.current = false
          setIsDirty(false)
          return
        }
      }
      await fetch(`/api/campaigns/${campaignId}/key-vision`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bgColor: bgLayerLegacyColor(bgLayersRef.current[0]), bgOpacity: bgLayersRef.current[0]?.opacity ?? 1, bgLayers: bgLayersRef.current, layers: layersToSave, width: canvasWRef.current, height: canvasHRef.current }) })
      try {
        // Thumb HIGH-RES (1920px max, JPEG 0.92). 480/0.85 ficava pixelado no
        // preview de apresentacao e PPTX (slide widescreen tem 960px de largura
        // a 72 DPI; pptxgenjs escala thumb pra 8-12" -> ampliacao 8x).
        // 1440 → 960 + JPEG quality 0.82 (2026-05-26 perf sweep — peca tem
        // bg solido, alpha era luxo nao usado).
        const thumbScale = Math.min(960 / canvasWRef.current, 960 / canvasHRef.current, 1)
        // CROP da area da peca. toDataURL aceita left/top/width/height em
        // coords do CANVAS DOM (px do canvas HTML). A peca renderiza
        // centralizada via viewportTransform[4,5] (offset). Le o offset real
        // pra cortar exatamente a regiao da peca.
        const z = zoomRef.current || 1
        const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
        const offsetX = vt[4] ?? 0
        const offsetY = vt[5] ?? 0
        // Guard fonts antes do toDataURL (sweep 2026-05-30).
        const { awaitFontsReadyAndRender } = await import("@/lib/awaitFontsReady")
        await awaitFontsReadyAndRender(fc)
        const dataUrl = fc.toDataURL({
          format: "jpeg",
          quality: 0.82,
          multiplier: thumbScale / z,
          left: offsetX,
          top: offsetY,
          width: canvasWRef.current * z,
          height: canvasHRef.current * z,
        })
        const blob = await (await fetch(dataUrl)).blob()
        const fd = new FormData()
        fd.append("thumbnail", blob, "kv-thumb.jpg")
        await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: fd })
        // Broadcast pro /presentation e /pieces refrescarem sem esperar polling
        // de 6s (audit H7). saveNow inlinava o upload sem chamar uploadMatrixThumb
        // — listeners ficavam stale.
        try {
          if (typeof BroadcastChannel !== "undefined") {
            const bc = new BroadcastChannel("zzosy:campaigns")
            bc.postMessage({ type: "kv-updated", campaignId, ts: Date.now() })
            bc.close()
          }
        } catch {}
      } catch (e) { console.warn("KV thumb upload failed:", e) }
    }
    isDirtyRef.current = false
    setIsDirty(false)
    } finally {
      // setSaving sempre cai pra false (sucesso, erro, ou early return). UI
      // nao trava em "Salvando..." se algo lancar no meio do save.
      setSaving(false)
    }
    })
  }

  // ============================================================
  // STEPS MANAGEMENT — carrosseis, sequencias, posts de varios cards
  // ============================================================

  // Serializa o canvas ATUAL no formato {layers, bgColor} pra salvar como
  // snapshot em inactiveStepsRef. Replica a logica do performSave modo peca.
  function serializeCurrentStep(): { layers: any[]; bgColor: string; bgOpacity: number; bgLayers: BgLayerData[]; imageUrl?: string | null; thumbnailUrl?: string | null } {
    const fc = fabricRef.current
    // bgColor/bgOpacity DERIVADOS de bgLayers[0] — single source of truth.
    // Antes vinham de bgColorRef/bgOpacityRef separadamente, criando drift
    // potencial (bug 2026-05-28). Helper bgLayerLegacyColor cobre solid/
    // gradient/image (pega 1o stop / branco).
    const derivedBgColor = bgLayerLegacyColor(bgLayersRef.current[0])
    const derivedBgOpacity = bgLayersRef.current[0]?.opacity ?? 1
    if (!fc) return { layers: [], bgColor: derivedBgColor, bgOpacity: derivedBgOpacity, bgLayers: bgLayersRef.current }
    const layers = fc.getObjects()
      .filter((o: any) => {
        if (o.__isBg) return false
          if ((o as any).__isStrokeGhost === true) return false
        if (o.__isBleedOverlay) return false
        if (!o.__assetId && !o.__embedded) return false
        return true
      })
      .map((o: any, i: number) => {
        const layer: any = {
          posX: Math.round(o.left ?? 0),
          posY: Math.round(o.top ?? 0),
          scaleX: o.scaleX ?? 1,
          scaleY: o.scaleY ?? 1,
          ...(o.skewX ? { skewX: o.skewX } : {}),
          ...(o.skewY ? { skewY: o.skewY } : {}),
          rotation: o.angle ?? 0,
          zIndex: i,
          width: Math.round(o.width ?? 400),
          height: Math.round(o.height ?? 100),
          overrides: {},
        }
        if (o.__assetId) layer.assetId = o.__assetId
        if (o.__hidden === true) layer.hidden = true
        if (o.__locked === true) layer.locked = true
        if (o.__embedded) {
          layer.embedded = true
          layer.embeddedData = o.__embeddedData ?? null
        }
        // Overrides per-step: helper centralizado captura tudo.
        if (o.type === "textbox" || o.type === "i-text") {
          Object.assign(layer.overrides, serializeTextboxOverrides(o, { preserveExplicitNewlinesOnly: true }))
        }
        if (o.__mask) layer.mask = o.__mask
        return layer
      })
    // CRITICO: preserva imageUrl/thumbnailUrl do banco pro step ATIVO. Sem isso,
    // toda vez que o user troca de step, o snapshot do step que era ativo
    // entra no buffer dos inativos SEM imageUrl. O save depois persiste null
    // -> preview some na apresentacao.
    const p = pieceRef.current as any
    const pdata = p?.data ? (typeof p.data === "string" ? JSON.parse(p.data) : p.data) : {}
    const oldSteps: any[] = Array.isArray(pdata.steps) ? pdata.steps : []
    const oldActive = oldSteps[activeStepIndexRef.current] ?? {}
    // Fallback: se a peca era SINGLE-STEP (sem data.steps no banco), o thumb
    // ja gerado esta em piece.imageUrl. Usar isso como imageUrl do step ativo
    // quando transitamos pra multi-step pela primeira vez (ex: addStep).
    const fallbackImg = (!oldSteps.length && activeStepIndexRef.current === 0) ? (p?.imageUrl ?? null) : null
    // CRITICO 2026-05-27: DEEP CLONE de bgLayers E layers. Snapshots em
    // inactiveStepsRef compartilhavam referencias com bgLayersRef e com
    // os objetos Fabric (via layer.overrides.styles = o.styles by ref).
    // Mutacoes posteriores (mudar bg/per-char no step ativo) afetavam
    // os snapshots dos OUTROS steps → save persistia mesmo state pra
    // todos. User reportou: 'a porra dos steps esta salvando o mesmo
    // background nos 2 steps'. Mesmo problema vale pra per-char styles
    // (obj.styles mutado por applyStyle).
    //
    // JSON parse/stringify clona TUDO (mais seguro que spread shallow
    // pra objetos profundos como styles[lineKey][colKey]).
    const bgClone = JSON.parse(JSON.stringify(bgLayersRef.current))
    const layersClone = JSON.parse(JSON.stringify(layers))
    return {
      layers: layersClone,
      bgColor: derivedBgColor, bgOpacity: derivedBgOpacity, bgLayers: bgClone as BgLayerData[],
      imageUrl: oldActive.imageUrl ?? fallbackImg,
      thumbnailUrl: oldActive.thumbnailUrl ?? fallbackImg,
    }
  }

  // Aplica um step {layers, bgColor} no canvas: limpa tudo e re-cria.
  async function loadStepIntoCanvas(step: { layers: any[]; bgColor: string; bgOpacity?: number; bgLayers?: BgLayerData[] }) {
    const fc = fabricRef.current
    const camp = campaignRef.current
    if (!fc || !camp) return
    // Marca que esta aplicando para guards nao salvarem durante load
    isApplyingHistory.current = true
    try {
      // Limpa TODOS os objetos (inclusive BGs) exceto bleed overlay — vamos
      // recriar os BGs do step abaixo.
      const toRemove = fc.getObjects().filter((o: any) => !o.__isBleedOverlay)
      toRemove.forEach((o: any) => fc.remove(o))
      // Migra legacy → bgLayers (preserva kind: solid/gradient/image)
      const stepBgLayers: BgLayerData[] = Array.isArray(step.bgLayers) && step.bgLayers.length > 0
        ? step.bgLayers.map(migrateBgLayerJson)
        : [{ kind: "solid", color: step.bgColor, opacity: typeof step.bgOpacity === "number" ? step.bgOpacity : 1 }]
      bgLayersRef.current = stepBgLayers
      // Atualiza espelhos legacy (BG[0]) — bgColor representativo so faz sentido pra solid
      bgColorRef.current = bgLayerLegacyColor(stepBgLayers[0])
      setBgColor(bgLayerLegacyColor(stepBgLayers[0]))
      bgOpacityRef.current = stepBgLayers[0].opacity
      setBgOpacity(stepBgLayers[0].opacity)
      // Re-cria todos os Rects BG
      const fabricMod: any = await import("fabric")
      const { Rect } = fabricMod
      const newBgRects: any[] = []
      for (let i = 0; i < stepBgLayers.length; i++) {
        const ld = stepBgLayers[i]
        const r = new Rect({
          left: 0, top: 0, width: canvasWRef.current, height: canvasHRef.current,
          selectable: true, evented: true,
          hasControls: false, hasBorders: true,
          lockMovementX: true, lockMovementY: true,
          lockScalingX: true, lockScalingY: true, lockRotation: true,
          excludeFromExport: true,
        })
        await syncBgLayerToRect(r, ld, canvasWRef.current, canvasHRef.current, fabricMod)
        ;(r as any).__isBg = true
        ;(r as any).__bgIdx = i
        ;(r as any).__assetLabel = i === 0 ? "Background" : `Background ${i + 1}`
        ;(r as any).__hidden = ld.hidden === true
        ;(r as any).__locked = ld.locked === true
        fc.add(r)
        newBgRects.push(r)
      }
      bgRectsRef.current = newBgRects
      bgRef.current = newBgRects[0]
      for (let i = newBgRects.length - 1; i >= 0; i--) fc.sendObjectToBack(newBgRects[i])
      // Re-cria layers.
      for (const layer of step.layers) {
        if (layer.embedded) {
          // Embedded: cria o objeto cru a partir de embeddedData.
          // Pra simplicidade, pula no minimo viavel — depois melhoramos.
          continue
        }
        if (!layer.assetId) continue
        const asset = camp.assets.find((a: Asset) => a.id === layer.assetId)
        if (!asset) continue
        await addAssetToCanvas(fc, asset, layer)
        const created = fc.getObjects()[fc.getObjects().length - 1]
        if (created) applyHiddenLockedToObject(created, layer)
      }
      fc.renderAll()
      refreshLayers(fc)
    } finally {
      isApplyingHistory.current = false
    }
  }

  async function switchToStep(newIndex: number) {
    if (newIndex < 0 || newIndex >= stepCountRef.current) return
    if (newIndex === activeStepIndexRef.current) return
    // 1. Serializa step atual no inactiveStepsRef na posicao certa.
    const currentSnapshot = serializeCurrentStep()
    // Reconstroi o array completo de steps incluindo o atual.
    const fullSteps: any[] = []
    let cursor = 0
    for (let i = 0; i < stepCountRef.current; i++) {
      if (i === activeStepIndexRef.current) fullSteps.push(currentSnapshot)
      else { fullSteps.push(inactiveStepsRef.current[cursor]); cursor++ }
    }
    // 2. Carrega o novo step.
    await loadStepIntoCanvas(fullSteps[newIndex])
    // 3. Atualiza o buffer: remove o novo step (agora ativo) e mantem os outros.
    const newInactive = fullSteps.filter((_, i) => i !== newIndex)
    inactiveStepsRef.current = newInactive
    setActiveStepIndexSync(newIndex)
    isDirtyRef.current = true
    await doSaveNow()
  }

  async function addStep() {
    // Adiciona novo step no fim, copiando o conteudo do ATIVO atual,
    // e ATIVA o novo step automaticamente (user vai ver/editar ele direto).
    const newStepIndex = stepCountRef.current // 0-indexed; novo step ocupa esse indice
    console.log("[addStep] inicio. stepCount:", stepCountRef.current, "newStepIndex:", newStepIndex)
    // Gera thumb do canvas atual (sera o thumb inicial do novo step E
    // do step que era ativo, ja que sao copias visuais identicas no momento).
    const fc = fabricRef.current
    let currentBlob: Blob | null = null
    if (fc) {
      currentBlob = await generateCurrentThumbBlob(fc)
    }
    // Snapshot do step que era ATIVO (sera empurrado pro buffer).
    const previousActiveSnapshot = serializeCurrentStep()
    // Inclui no buffer o step antigo na posicao do activeIndex atual.
    // (Antes ele estava "fora" do buffer porque era o ativo).
    const previousActiveIndex = activeStepIndexRef.current
    const newBuffer = [...inactiveStepsRef.current]
    newBuffer.splice(previousActiveIndex, 0, previousActiveSnapshot)
    inactiveStepsRef.current = newBuffer
    // Aumenta count e troca ativo pro novo (que ainda nao foi adicionado ao
    // buffer porque agora ELE eh o ativo no canvas).
    setStepCountSync(c => c + 1)
    setActiveStepIndexSync(newStepIndex)
    isDirtyRef.current = true
    // O canvas NAO precisa ser recarregado — eh o mesmo conteudo (cópia).
    await doSaveNow()
    console.log("[addStep] save terminou. Step novo agora eh o ativo:", newStepIndex)
    // Sobe thumb pro novo step (que agora eh ativo).
    if (currentBlob && pieceId) {
      const fd = new FormData()
      fd.append("thumbnail", currentBlob, `step${newStepIndex}.png`)
      try {
        const r = await fetch(`/api/pieces/${pieceId}/step-thumbnail?index=${newStepIndex}`, {
          method: "POST", body: fd, keepalive: true,
        })
        console.log("[addStep] thumb upload status:", r.status)
      } catch (e) { console.warn("[addStep] thumb upload falhou:", e) }
      // Re-fetch pieceRef
      try {
        const r = await fetch(`/api/pieces/${pieceId}`, { cache: "no-store" })
        if (r.ok) {
          const fresh = await r.json()
          if (pieceRef.current) pieceRef.current = fresh
        }
      } catch (e) {}
    }
  }

  // Substitui o conteudo do step ATIVO por um PSD. Cada layer do PSD com nome
  // que bater (case-insensitive) com asset.label dum CampaignAsset existente
  // vira um layer linkado ao asset (mesma logica do PsdImporter da matriz).
  //
  // Filosofia: import PSD = OVERRIDE TOTAL da peca.
  //  - BG: extraido do PSD (cor solida do layer "Background" top-level; fallback
  //    pixel central do composite).
  //  - Layers matched: posicao, dimensoes, fonte, peso, tamanho e cor vem do PSD
  //    (vao pra layer.overrides). O texto CRU continua vindo do asset.content[]
  //    (essa eh a UNICA excecao — assets sao fonte da verdade pro conteudo
  //    textual; PSD so determina onde/como aparece).
  //  - Layers sem match: IGNORADAS (precisam virar asset em /assets antes).

  // Persistência do handle da pasta raiz pra organizar PSDs externos em
  // hierarquia (cliente/campanha/veiculo/midia/peca.psd). User escolhe a
  // pasta raiz UMA vez (showDirectoryPicker) — handle persistido em
  // IndexedDB. Próximas chamadas reusam a mesma pasta.
  async function idbGet(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("zzosy-handles", 1)
      req.onupgradeneeded = () => req.result.createObjectStore("h")
      req.onsuccess = () => {
        try {
          const db = req.result
          const tx = db.transaction("h", "readonly")
          const g = tx.objectStore("h").get(key)
          g.onsuccess = () => resolve(g.result)
          g.onerror = () => reject(g.error)
        } catch (e) { reject(e) }
      }
      req.onerror = () => reject(req.error)
    })
  }
  async function idbSet(key: string, value: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("zzosy-handles", 1)
      req.onupgradeneeded = () => req.result.createObjectStore("h")
      req.onsuccess = () => {
        try {
          const db = req.result
          const tx = db.transaction("h", "readwrite")
          tx.objectStore("h").put(value, key)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        } catch (e) { reject(e) }
      }
      req.onerror = () => reject(req.error)
    })
  }

  async function ensurePsdRootDir(force = false): Promise<any | null> {
    if (!force) {
      let cached: any = null
      try { cached = await idbGet("psd-root-dir") } catch {}
      if (cached) {
        try {
          const p = await cached.queryPermission({ mode: "readwrite" })
          if (p === "granted") return cached
          const r = await cached.requestPermission({ mode: "readwrite" })
          if (r === "granted") return cached
        } catch {}
      }
    }
    try {
      const h = await (window as any).showDirectoryPicker({
        mode: "readwrite",
        startIn: "documents",
      })
      await idbSet("psd-root-dir", h)
      return h
    } catch { return null }
  }

  // Editar externamente: exporta o PSD da peça pro disco do user, criando
  // a hierarquia cliente/campanha/veiculo/midia/peca.psd automaticamente.
  // Browsers em sandbox não podem ABRIR Photoshop — user tem que abrir
  // manualmente. Sync depois via re-leitura do file handle persistido.
  async function openInExternalApp(forceNewRoot = false) {
    if (!pieceId || !pieceRef.current) {
      alert("Available only for generated pieces (not for the matrix)")
      return
    }
    const piece = pieceRef.current
    const camp = campaignRef.current
    try {
      // Sanitiza nomes pra filesystem (remove chars proibidos em paths)
      const safe = (s: string | undefined | null) =>
        (s ?? "").replace(/[\\/:*?"<>|]/g, "-").trim() || "untitled"
      // Busca info de MediaFormat (vehicle/media) — não vem direto no piece
      let vehicle = "No vehicle"
      let media = "No media"
      const mfId = (piece as any).mediaFormatId
      if (mfId) {
        try {
          const r = await fetch("/api/medias", { cache: "no-store" })
          if (r.ok) {
            const all = await r.json()
            const mf = Array.isArray(all) ? all.find((m: any) => m.id === mfId) : null
            if (mf) {
              vehicle = mf.vehicle || vehicle
              media = mf.media || media
            }
          }
        } catch (e) { console.warn("[external-edit] fetch medias falhou:", e) }
      }
      const { exportPSDBlob } = await import("@/lib/exportPiece")
      const data = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
      const blob = await exportPSDBlob({
        id: piece.id, name: piece.name ?? "Piece",
        data,
        width: canvasWRef.current, height: canvasHRef.current,
      })
      const fileName = `${safe(piece.name)}.psd`
      const supportsFSA = typeof window !== "undefined" && "showDirectoryPicker" in window
      if (supportsFSA) {
        const root = await ensurePsdRootDir(forceNewRoot)
        if (!root) { return /* user cancelou */ }
        // Cria subfolders: client / campanha / veiculo / midia
        const clientName = safe(camp?.client?.name ?? "Client")
        const campName = safe(camp?.name ?? "Campaign")
        const vehName = safe(vehicle)
        const mediaName = safe(media)
        const clientDir = await root.getDirectoryHandle(clientName, { create: true })
        const campDir = await clientDir.getDirectoryHandle(campName, { create: true })
        const vehDir = await campDir.getDirectoryHandle(vehName, { create: true })
        const mediaDir = await vehDir.getDirectoryHandle(mediaName, { create: true })
        const fileHandle = await mediaDir.getFileHandle(fileName, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()
        externalPsdHandle.current = fileHandle
        setExternalPsdName(fileName)
        const path = `${clientName} / ${campName} / ${vehName} / ${mediaName} / ${fileName}`
        alert(`PSD saved at:\n${path}\n\n1. Open the file in Photoshop\n2. Edit + save (Cmd+S)\n3. Come back and click Sync`)
      } else {
        // Fallback: download
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url; a.download = fileName
        document.body.appendChild(a); a.click()
        setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 100)
        alert(`PSD downloaded: ${fileName}\n\nYour browser does not support automatic sync (use Chrome or Edge).\nAfter editing in Photoshop, re-import the file via "PSD".`)
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return
      console.error("[external-edit] falha:", e)
      alert("Error exporting PSD: " + (e?.message ?? e))
    }
  }

  // Sync: re-lê o PSD vinculado e re-importa pra dentro da peça atual.
  // Requer permission de leitura (concedida no salvar inicial; pode pedir
  // de novo se o browser invalidou).
  async function syncFromExternalApp() {
    const handle = externalPsdHandle.current
    if (!handle) {
      alert("No external PSD linked. Use 'External edit' first.")
      return
    }
    try {
      const perm = await handle.queryPermission({ mode: "read" })
      if (perm !== "granted") {
        const req = await handle.requestPermission({ mode: "read" })
        if (req !== "granted") {
          alert("Read permission denied — cannot sync")
          return
        }
      }
      const file = await handle.getFile()
      const mtime = file.lastModified ? new Date(file.lastModified).toLocaleTimeString() : "?"
      if (!confirm(`Sync with "${file.name}" (modified at ${mtime})?\n\nThe active Step content will be replaced by the PSD layers.`)) return
      await replaceStepFromPsd(file)
    } catch (e: any) {
      console.error("[external-sync] falha:", e)
      alert("Failed to sync: " + (e?.message ?? e))
    }
  }

  async function replaceStepFromPsd(file: File) {
    const fc = fabricRef.current
    if (!fc) return
    const camp = campaignRef.current
    if (!camp) return
    try {
      setSaving(true)
      const agPsd: any = await import("ag-psd")
      if (agPsd.initializeCanvas) {
        agPsd.initializeCanvas(
          (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c },
          (c: any) => (c as HTMLCanvasElement).getContext("2d")
        )
      }
      const buffer = await file.arrayBuffer()
      // skipLayerImageData/skipCompositeImageData: false — precisamos do canvas
      // pra amostrar a cor do BG (layer "Background" top-level OU composite).
      const psd: any = (agPsd as any).readPsd(buffer, { skipLayerImageData: false, skipCompositeImageData: false, skipThumbnail: true })

      // Recolhe folhas (layers leaf) visiveis. Folders intermediarios sao
      // transparentes pra esse fluxo (so leaves tem posicao concreta).
      function collectLeaves(layers: any[], parentHidden = false): any[] {
        const out: any[] = []
        for (const l of layers ?? []) {
          const hidden = parentHidden || l.hidden === true
          if (hidden) continue
          if (l.children?.length) out.push(...collectLeaves(l.children, hidden))
          else out.push(l)
        }
        return out
      }
      const leaves = collectLeaves(psd.children ?? [])

      // === BG: extrai BG layer (BgLayerData) do PSD igual Photoshop ===
      // Ordem de tentativa (do mais confiavel pro fallback):
      //  1. Layer "Background" top-level (nao-SO): pode ser Solid Color FILL,
      //     Gradient FILL ou raster — extractPsdBgLayer escolhe o tipo certo
      //  2. PRIMEIRO layer top-level que cobre o canvas inteiro
      //  3. Pixel central do composite (cor solida fallback)
      // Suporta SOLID, GRADIENT e raster→solid amostrado. Image fica pra V2
      // (geraria piece.data inchada com base64 do raster gigante do PSD).
      const psdW = psd.width || canvasWRef.current
      const psdH = psd.height || canvasHRef.current
      function layerCoversCanvas(l: any): boolean {
        if (l?.vectorFill?.type === "color" || l?.vectorFill?.type === "solid") return true
        const lw = (l?.right ?? 0) - (l?.left ?? 0)
        const lh = (l?.bottom ?? 0) - (l?.top ?? 0)
        const tol = 0.02
        return lw >= psdW * (1 - tol) && lh >= psdH * (1 - tol)
      }
      let psdBg: BgLayerData | null = null
      // 1: layer "Background" top-level
      for (const l of (psd.children ?? [])) {
        const isSO = !!(l as any).placedLayer
        if (l.name === "Background" && !isSO) {
          psdBg = extractPsdBgLayer(l, psdW, psdH)
          if (psdBg) break
        }
      }
      // 2: PRIMEIRO layer top-level que cobre canvas
      if (!psdBg) {
        for (const l of (psd.children ?? [])) {
          const isSO = !!(l as any).placedLayer
          if (isSO || l.hidden === true || l.children?.length) continue
          if (!layerCoversCanvas(l)) continue
          psdBg = extractPsdBgLayer(l, psdW, psdH)
          if (psdBg) break
        }
      }
      // 3: composite fallback
      if (!psdBg && psd.canvas) {
        const cc = psd.canvas as HTMLCanvasElement
        const c = sampleHexAt(cc, cc.width / 2, cc.height / 2) || sampleHexAt(cc, 0, 0)
        if (c) psdBg = { kind: "solid", color: c, opacity: 1 }
      }

      // Index de assets por nome normalizado pra match rapido. Usa normalizeName
      // (mesma logica do PsdPieceImporter + import-psd endpoint) — remove acentos
      // e espacos internos, garantindo match consistente em todos os caminhos.
      const assetsByName = new Map<string, any>()
      for (const a of (camp.assets ?? [])) {
        const k = normalizeName(a.label ?? "")
        if (k) assetsByName.set(k, a)
      }

      const pieceW = canvasWRef.current
      const pieceH = canvasHRef.current
      const scale = Math.min(pieceW / psdW, pieceH / psdH)
      const offX = (pieceW - psdW * scale) / 2
      const offY = (pieceH - psdH * scale) / 2

      // Limpa canvas: remove tudo exceto BG e bleed overlay
      const toRemove = fc.getObjects().filter((o: any) => !o.__isBg && !o.__isBleedOverlay)
      for (const obj of toRemove) fc.remove(obj)

      // Aplica BG do PSD via replaceBgLayers (cria novo BG layer real,
      // suporta solid/gradient/etc). Se nada foi extraido, mantem o BG atual.
      if (psdBg) {
        await replaceBgLayers([psdBg])
      }

      let matched = 0, ignored = 0
      const missingNames: string[] = []
      for (const layer of leaves) {
        const name = (layer.name ?? "").trim()
        if (!name || name === "Background") { ignored++; continue }
        const asset = assetsByName.get(normalizeName(name))
        if (!asset) {
          ignored++
          missingNames.push(name)
          console.log("[psd-step] sem match no asset, ignorando:", name)
          continue
        }
        const left = layer.left ?? 0
        let top = layer.top ?? 0
        const w = Math.max((layer.right ?? left + 200) - left, 10)
        const h = Math.max((layer.bottom ?? top + 50) - top, 10)
        // Pra TEXTO: quando o PSD tem text.transform com translateY (caso
        // típico de PSDs gerados pelo ZZOSY que usam baseline anchor com
        // translateY = top + fontSize), `layer.top` pode incluir o offset
        // do baseline — texto cairia ~fontSize px abaixo do esperado.
        // Compensa usando transform[5] - fontSize quando disponível.
        if (asset.type === "TEXT" && layer.text) {
          const tform: number[] | undefined = layer.text.transform
          const fontSize = layer.text.style?.fontSize ?? 0
          if (Array.isArray(tform) && tform.length >= 6 && typeof tform[5] === "number" && fontSize > 0) {
            const visualTop = tform[5] - fontSize
            // Só compensa se a diferença bate (~fontSize). Sem isso, PSDs
            // de outras fontes (Photoshop original) que tem transform[5]
            // SEMANTIC diferente não seriam afetados.
            if (Math.abs(visualTop - top) > fontSize * 0.3) {
              top = visualTop
            }
          }
        }
        const layerObj: any = {
          assetId: asset.id,
          posX: Math.round(left * scale + offX),
          posY: Math.round(top * scale + offY),
          scaleX: 1, scaleY: 1, rotation: 0,
          width: Math.round(w * scale),
          height: Math.round(h * scale),
          overrides: {},
        }
        // TEXTO: extrai estilo do PSD (fonte/peso/tamanho/cor + styles per-char
        // quando ha multiplas cores) pra overrides. NAO setamos overrides.text
        // — addAssetToCanvas usa asset.content como fonte da verdade do texto
        // cru. styles per-char sao distribuidos PROPORCIONALMENTE no texto do
        // asset (asset pode ter length diferente do PSD).
        if (asset.type === "TEXT" && layer.text) {
          const assetText = getSpans(asset).map(s => s.text).join("")
          const ov = psdTextLayerToOverride(layer, scale, layerObj.width, layerObj.height, assetText)
          if (ov) layerObj.overrides = ov
        }
        try {
          await addAssetToCanvas(fc, asset, layerObj)
          matched++
        } catch (e) {
          console.warn("[psd-step] falha addAssetToCanvas pra", name, e)
          ignored++
        }
      }

      fc.renderAll()
      refreshLayers(fc)
      isDirtyRef.current = true
      setIsDirty(true)
      // Save now pra persistir o step substituido + regenerar thumb
      await doSaveNow()

      const msg = `Step replaced: ${matched} layer(s) linked, ${ignored} ignored.`
      const detail = missingNames.length > 0
        ? `\n\nNo asset match (name the assets in /assets to reuse):\n• ${missingNames.slice(0, 10).join("\n• ")}${missingNames.length > 10 ? `\n…+${missingNames.length - 10}` : ""}`
        : ""
      alert(msg + detail)
    } catch (e: any) {
      console.error("[replaceStepFromPsd] erro:", e)
      alert(`Error processing PSD: ${e?.message ?? e}`)
    } finally {
      setSaving(false)
    }
  }

  async function removeStep(indexToRemove: number, skipConfirm = false) {
    if (stepCountRef.current <= 1) return // nao deixa apagar o ultimo
    if (!skipConfirm && !window.confirm(`Delete Step ${indexToRemove + 1}? The following steps will be renumbered.`)) return
    // Caso A: apaga step ativo. Precisa carregar outro no canvas primeiro.
    if (indexToRemove === activeStepIndexRef.current) {
      // Escolhe vizinho: anterior se houver, senao proximo.
      const fallbackIndex = indexToRemove === 0 ? 1 : indexToRemove - 1
      // Pega o step de fallback do buffer (sem incluir o ativo).
      // Mapeia: se fallbackIndex < activeStepIndex, eh posicao fallbackIndex no buffer.
      //         se fallbackIndex > activeStepIndex, eh posicao fallbackIndex-1.
      const bufferIdx = fallbackIndex < activeStepIndexRef.current ? fallbackIndex : fallbackIndex - 1
      const fallbackStep = inactiveStepsRef.current[bufferIdx]
      if (fallbackStep) {
        await loadStepIntoCanvas(fallbackStep)
        // Remove fallback do buffer (agora eh ativo).
        const newBuffer = inactiveStepsRef.current.filter((_, i) => i !== bufferIdx)
        inactiveStepsRef.current = newBuffer
        // Novo activeStepIndex: o fallback ocupa a posicao do removido.
        // Se fallback era anterior, novo activeIndex eh fallbackIndex.
        // Se era posterior, depois do shift de remocao, eh fallbackIndex - 1.
        setActiveStepIndexSync(fallbackIndex < indexToRemove ? fallbackIndex : fallbackIndex - 1)
      }
    } else {
      // Caso B: apaga step inativo. Soh remove do buffer.
      const bufferIdx = indexToRemove < activeStepIndexRef.current ? indexToRemove : indexToRemove - 1
      inactiveStepsRef.current = inactiveStepsRef.current.filter((_, i) => i !== bufferIdx)
      // Se o removido vinha ANTES do ativo, o indice do ativo diminui em 1.
      if (indexToRemove < activeStepIndexRef.current) setActiveStepIndexSync(activeStepIndexRef.current - 1)
    }
    setStepCountSync(c => c - 1)
    // CRITICO: apagar um step renumera todos depois dele. Os imageUrl ficam
    // apontando pros thumbs ANTIGOS (do indice errado agora). Limpa todos os
    // imageUrl/thumbnailUrl dos steps no buffer pra forcar autoGen rodar.
    inactiveStepsRef.current = inactiveStepsRef.current.map(s => ({
      layers: s.layers,
      bgColor: s.bgColor,
      // remove imageUrl e thumbnailUrl
    }))
    isDirtyRef.current = true
    await doSaveNow()
    // Re-dispara autoGen pra gerar novos thumbs com os indices corretos.
    // AWAIT crítico: se o user fechar o editor antes do autoGen terminar,
    // alguns steps ficam sem preview. Esperar garante consistencia.
    autoGenDoneRef.current = false
    try {
      await autoGenerateMissingStepThumbs()
    } catch (e) { console.warn("[removeStep] autoGen erro:", e) }
  }

  // Percorre todos os steps gerando thumbnail individual pra cada um.
  // Util pra pecas multi-step antigas que tem steps sem preview (criados
  // antes do fix de auto-thumb-on-add). Visualmente eh ruim — pisca entre
  // os steps — mas eh a forma confiavel sem render server-side.
  const [regeneratingThumbs, setRegeneratingThumbs] = useState(false)
  async function regenerateAllStepThumbs() {
    if (!pieceId) return
    if (stepCountRef.current <= 1) return
    setRegeneratingThumbs(true)
    const originalActive = activeStepIndexRef.current
    try {
      for (let i = 0; i < stepCountRef.current; i++) {
        if (i !== activeStepIndexRef.current) {
          await switchToStep(i)  // ja faz upload do thumb via doSaveNow
        }
      }
      // Volta pro step original que o user estava editando.
      if (originalActive !== activeStepIndexRef.current) {
        await switchToStep(originalActive)
      }
    } finally {
      setRegeneratingThumbs(false)
    }
  }

  // ============================================================
  // FIM STEPS MANAGEMENT
  // ============================================================

  function doSave() {
    // MODO MANUAL: NAO faz auto-save mais. Apenas marca dirty pra que o
    // botao "Salvar" no header e o confirm-exit ao fechar saibam que ha
    // mudancas pendentes. User precisa clicar Salvar explicitamente — UX
    // pedido pelo user: "nao e para o editor salvar automatico".
    isDirtyRef.current = true
    setIsDirty(true)
  }

  function doSaveNow(): Promise<void> {
    // Manual mode: doSaveNow tb so marca dirty agora. Operacoes que precisam
    // de sync REAL com banco (add step, undo/redo que pre-popula thumb)
    // chamam performSave() diretamente.
    isDirtyRef.current = true
    setIsDirty(true)
    return Promise.resolve()
  }

  /**
   * Flush sincrono dos PUTs debounceados pendentes de asset (lastOverride +
   * content). Necessario antes de qualquer save manual/automatico pra que o
   * banco esteja com o template/content mais recente antes do PATCH da peca/KV
   * persistir layers. Sem isso, race: PATCH grava layer.overrides apontando
   * pra template antigo que ainda nao subiu.
   */
  async function flushPendingAssetPuts(): Promise<void> {
    clearTimeout(lastOverridePutTimer.current)
    clearTimeout(assetContentPutTimer.current)
    const promises: Promise<any>[] = []
    const p1 = lastOverridePendingPayload.current
    if (p1) {
      lastOverridePendingPayload.current = null
      promises.push(fetch(`/api/campaigns/${campaignId}/assets/${p1.aid}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p1.payload),
      }).catch(err => console.warn("[flush lastOverride] failed:", err)))
    }
    const p2 = assetContentPendingPayload.current
    if (p2) {
      assetContentPendingPayload.current = null
      promises.push(fetch(`/api/campaigns/${campaignId}/assets/${p2.aid}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p2.payload),
      }).catch(err => console.warn("[flush assetContent] failed:", err)))
    }
    if (promises.length > 0) await Promise.all(promises)
  }

  async function performSave() {
    // Guard 0: durante apply de undo/redo, NUNCA salva. loadFromJSON dispara
    // object:added/modified que poderiam acionar saves com canvas em estado
    // transitorio (sem __assetId restaurados, sem bg, etc).
    if (isApplyingHistory.current) {
      editorLog("[performSave] abortado — undo/redo em andamento")
      return
    }
    // Guard 1: se o init nao terminou (ou se o cleanup ja rodou), aborta.
    // Sem isso, um timer pendurado dispararia depois do useEffect re-rodar
    // mas antes do init recarregar layers, gravando layers: [] no banco.
    if (!isInitialized.current) {
      editorLog("[performSave] abortado — init nao terminou (canvas em re-mount)")
      return
    }
    // Se ha propagacao de texto em curso (PUT asset migrando styles em todos
    // escopos), adia o save: rodar agora salvaria layers com styles em
    // indices errados.
    if (pendingTextPropagation.current) {
      saveTimer.current = setTimeout(performSave, 200)
      return
    }
    // Serializacao via saveQ.runExclusive (audit #6). Hook substituiu mutex
    // busy-wait + flag que tinha race entre callers paralelos. Tambem
    // COALESCE redundantes: se houver save enfileirado, novos chamadores
    // compartilham a mesma promise (ja vai rodar com canvas atual).
    await saveQ.runExclusive(async () => {
    setSaving(true)
    try {
    // Flush sincrono de PUTs de asset pendentes ANTES de gravar peca/KV.
    // Sem isso, layer.overrides poderia referenciar template antigo do asset
    // (lastOverride debounceado nao subiu ainda).
    try { await flushPendingAssetPuts() } catch {}
    const fc = fabricRef.current
    if (!fc) return

    if (pieceId && pieceRef.current) {
      // MODO PEÇA v2: salva layers[] com posicoes + overrides
      const p = pieceRef.current
      const oldData = typeof p.data === "string" ? JSON.parse(p.data) : (p.data ?? {})

      const newLayers = fc.getObjects()
        .filter((o: any) => {
          if (o.__isBg) return false
          if ((o as any).__isStrokeGhost === true) return false
          if (o.__isBleedOverlay) return false
          // Layer valido: __assetId (linkado) ou __embedded (PSD avulso importado).
          // Sem essas flags eh fantasma. Loga warning pra detectar caminhos
          // problematicos (paste mal feito, drag-from-asset com bug, etc).
          if (!o.__assetId && !o.__embedded) {
            editorLog("[PIECE-SAVE] objeto sem __assetId nem __embedded BLOQUEADO:", {
              type: o.type, text: (o as any).text?.slice(0, 30),
              left: o.left, top: o.top,
            })
            return false
          }
          return true
        })
        .map((o: any, i: number) => {
          const layer: any = {
            posX: Math.round(o.left ?? 0),
            posY: Math.round(o.top ?? 0),
            scaleX: o.scaleX ?? 1,
            scaleY: o.scaleY ?? 1,
            ...(o.skewX ? { skewX: o.skewX } : {}),
            ...(o.skewY ? { skewY: o.skewY } : {}),
            rotation: o.angle ?? 0,
            zIndex: i,
            width: Math.round(o.width ?? 400),
            height: Math.round(o.height ?? 100),
            overrides: {},
          }
          // Linkado a um asset: grava assetId.
          if (o.__assetId) layer.assetId = o.__assetId
          // Visibilidade e lock: persiste se diferente do default.
          if (o.__hidden === true) layer.hidden = true
          if (o.__locked === true) layer.locked = true
          // DEBUG: log do que tah indo pra peca
          console.log("[SAVE-PIECE] layer", i, "type:", o.type, "__hidden:", o.__hidden, "__locked:", o.__locked, "-> hidden:", layer.hidden, "locked:", layer.locked)
          // Embedded: grava flag + conteudo cru (sem asset).
          if (o.__embedded) {
            layer.__embedded = true
            if (o.type === "textbox" || o.type === "i-text") {
              layer.type = "TEXT"
              layer.text = o.text ?? ""
              layer.fontFamily = o.fontFamily
              layer.fontSize = o.fontSize
              layer.fontWeight = o.fontWeight
              layer.fill = o.fill
              if (o.textAlign) layer.textAlign = o.textAlign
            } else if (o.type === "image") {
              layer.type = "IMAGE"
              if ((o as any).imageDataUrl) {
                layer.imageDataUrl = (o as any).imageDataUrl
              } else if ((o as any).getSrc) {
                // Fallback: pega src atual da imagem (pode ser blob: ou data: URL)
                try { layer.imageDataUrl = (o as any).getSrc() } catch {}
              }
            }
          }
          // Metadados PSD (mask/hidden/locked/opacity/blendMode/effects/
          // nameSource/groupPath) via helper centralizado. Antes este site NAO
          // propagava __hidden/__locked (drift sutil) — agora alinhado com
          // PIECE/MATRIX saves.
          applyPsdLayerMetadata(o, layer)
          // Captura overrides para textos via helper centralizado
          if (o.type === "textbox" || o.type === "i-text") {
            Object.assign(layer.overrides, serializeTextboxOverrides(o, { preserveExplicitNewlinesOnly: true }))
          } else if ((o as any).__isShape === true || o.type === "path" || o.type === "Path") {
            // SHAPE override (doSave peca) via helper centralizado.
            Object.assign(layer.overrides, serializeShapeOverrides(o))
          }
          return layer
        })

      // Circuit breaker: nao grava layers: [] sobre piece.data que tinha layers.
      // Race condition tipica: load do PSD importado retorna layer com schema
      // antigo, addAssetToCanvas/addEmbeddedLayer falham, canvas fica vazio,
      // doSave dispara e sobrescreve o data original com [] -> peca destruida.
      if (newLayers.length === 0) {
        const previousLayers = (oldData?.layers as any) ?? []
        const hadLayers = Array.isArray(previousLayers) && previousLayers.length > 0
        if (hadLayers) {
          editorLog("[doSave PIECE] abortado — tentaria gravar layers:[] sobre piece.data que tinha", previousLayers.length, "layers. Provavel race no load.")
          isDirtyRef.current = false
          setIsDirty(false)
          return
        }
      }

      // bgColor/bgOpacity DERIVADOS de bgLayers[0] — single source of truth
      // (ver fix 2026-05-28 em performSave).
      const __saveBgColor = bgLayerLegacyColor(bgLayersRef.current[0])
      const __saveBgOpacity = bgLayersRef.current[0]?.opacity ?? 1
      const newData: any = {
        ...oldData,
        version: 2,
        width: canvasWRef.current,
        height: canvasHRef.current,
        bgColor: __saveBgColor, bgOpacity: __saveBgOpacity, bgLayers: bgLayersRef.current,
        layers: newLayers,
      }
      // STEPS: se a peca tem multiplos steps, persiste TODOS em data.steps[].
      // Estrutura: data.steps eh um array onde steps[i] = { layers, bgColor }.
      // O step ativo eh sincronizado: pegamos newLayers (canvas atual) e
      // injetamos em steps[activeStepIndex]. Os outros vem do inactiveStepsRef.
      //
      // CRITICO: usa REFS (stepCountRef, activeStepIndexRef) pra ler valores
      // sincronos. React state \u00e9 batched e pode estar stale se essa funcao
      // foi chamada logo apos setStepCount/setActiveStepIndex.
      //
      // Pecas com 1 step soh: nao gravamos data.steps (compat formato legado).
      if (stepCountRef.current > 1) {
        // Monta array completo: steps[i] = se i==activeStepIndex, usa o canvas atual.
        // Senao usa inactiveStepsRef.current[mapInactive(i)].
        const fullSteps: any[] = []
        let inactiveCursor = 0
        // Le oldData.steps pra preservar imageUrl do step ativo no save.
        // Sem isso, toda vez que o user salva, o imageUrl do step ativo
        // some (o save sobrescreve com {layers, bgColor} sem imageUrl).
        const oldSteps: any[] = Array.isArray(oldData.steps) ? oldData.steps : []
        // Fallback: peca era single-step (sem data.steps), thumb esta em piece.imageUrl.
        const pieceImgFallback = (!oldSteps.length) ? ((pieceRef.current as any)?.imageUrl ?? null) : null
        for (let i = 0; i < stepCountRef.current; i++) {
          if (i === activeStepIndexRef.current) {
            const oldActive = oldSteps[i] ?? {}
            // DEEP CLONE bgLayers — sem isso, snapshot compartilha referencia
            // do array bgLayersRef. updateCurrentBg muta por indice e os
            // snapshots de outros steps veem a nova cor. User reportou:
            // 'a porra dos steps esta salvando o mesmo background nos 2 steps'.
            const bgClone = bgLayersRef.current.map(l => ({ ...l, stops: (l as any).stops ? (l as any).stops.map((s: any) => ({ ...s })) : undefined }))
            fullSteps.push({
              layers: newLayers,
              bgColor: __saveBgColor, bgOpacity: __saveBgOpacity, bgLayers: bgClone,
              imageUrl: oldActive.imageUrl ?? (i === 0 ? pieceImgFallback : null),
              thumbnailUrl: oldActive.thumbnailUrl ?? (i === 0 ? pieceImgFallback : null),
            })
          } else {
            fullSteps.push(inactiveStepsRef.current[inactiveCursor] ?? { layers: [], bgColor: "#ffffff" })
            inactiveCursor++
          }
        }
        newData.steps = fullSteps
        newData.activeStepIndex = activeStepIndexRef.current
      } else {
        delete newData.steps
        delete newData.activeStepIndex
      }
      await fetch(`/api/pieces/${pieceId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: JSON.stringify(newData) })
      })
      // CRITICO: atualiza pieceRef.current.data pra refletir o save (mesmo
      // motivo do saveNow PECA acima).
      if (pieceRef.current) {
        pieceRef.current = { ...pieceRef.current, data: JSON.stringify(newData) } as any
      }
      await uploadPieceThumb(fc, pieceId)
      // Re-fetch pra pegar imageUrl dos steps gerados pelo upload.
      try {
        const r = await fetch(`/api/pieces/${pieceId}`, { cache: "no-store" })
        if (r.ok) {
          const fresh = await r.json()
          if (pieceRef.current) pieceRef.current = fresh
        }
      } catch (e) { /* nao critico */ }
      isDirtyRef.current = false
      setIsDirty(false)
    } else {
      // MODO MATRIZ
      const layersToSave: any[] = fc.getObjects()
        .filter((o: any) => {
          if (o.__isBg) return false
          if ((o as any).__isStrokeGhost === true) return false
          if (!o.__assetId) {
            editorLog("[SAVE-MATRIX-2] objeto sem __assetId ignorado:", o.type, { left: o.left, top: o.top })
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
            ...(o.skewX ? { skewX: o.skewX } : {}),
            ...(o.skewY ? { skewY: o.skewY } : {}),
            rotation: o.angle ?? 0,
            zIndex: i,
            width: Math.round(o.width ?? 400),
            height: Math.round((o.height ?? 300) * (o.scaleY ?? 1)),
            overrides: {},
          }
          // Metadados PSD (mask/hidden/locked/opacity/blendMode/effects/
          // nameSource/groupPath) via helper centralizado. Antes este site
          // (doSave matriz, dispara logo apos import via dirty trigger) NAO
          // propagava __hidden/__locked — agora alinhado com PIECE/MATRIX.
          applyPsdLayerMetadata(o, layer)
          // Captura overrides para textos: cor, fonte, tamanho, peso, espacamento, alinhamento, styles per-char
          // Matriz: caracteres vem do asset. Helper centralizado captura tudo.
          if (o.type === "textbox" || o.type === "i-text") {
            Object.assign(layer.overrides, serializeTextboxOverrides(o, { preserveExplicitNewlinesOnly: true }))
          } else if ((o as any).__isShape === true || o.type === "path" || o.type === "Path") {
            // SHAPE override (doSave matriz) via helper centralizado.
            Object.assign(layer.overrides, serializeShapeOverrides(o))
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
          editorLog("[SAVE-MATRIX-2] abortado — tentaria gravar layers:[] sobre KV que tinha", previousLayers.length, "layers. Provavel race condition.")
          return
        }
      }
      await fetch(`/api/campaigns/${campaignId}/key-vision`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bgColor: bgLayerLegacyColor(bgLayersRef.current[0]), bgOpacity: bgLayersRef.current[0]?.opacity ?? 1, bgLayers: bgLayersRef.current, layers: layersToSave, width: canvasWRef.current, height: canvasHRef.current })
      })
      // Nota: lastOverride dos assets ja foi atualizado em tempo real via
      // updateAssetLastOverride() chamado em text:editing:exited e applyStyle.
      // Nao precisa propagar de novo aqui no doSave.

      // Gerar e enviar thumbnail do KV (max 960px maior lado, JPEG 0.82).
      // 2026-05-26: 1440→960 + PNG→JPEG (peca tem bg solido, alpha era luxo).
      try {
        const thumbScale = Math.min(960 / canvasWRef.current, 960 / canvasHRef.current, 1)
        // CROP da area da peca. Le offset real do viewportTransform pra
        // cortar exatamente onde a peca renderiza no canvas DOM.
        const z = zoomRef.current || 1
        const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
        const offsetX = vt[4] ?? 0
        const offsetY = vt[5] ?? 0
        // Guard fonts antes do toDataURL (sweep 2026-05-30).
        const { awaitFontsReadyAndRender } = await import("@/lib/awaitFontsReady")
        await awaitFontsReadyAndRender(fc)
        const dataUrl = fc.toDataURL({
          format: "jpeg",
          quality: 0.82,
          multiplier: thumbScale / z,
          left: offsetX,
          top: offsetY,
          width: canvasWRef.current * z,
          height: canvasHRef.current * z,
        })
        const blob = await (await fetch(dataUrl)).blob()
        const fd = new FormData()
        fd.append("thumbnail", blob, "kv-thumb.jpg")
        await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: fd })
        try {
          if (typeof BroadcastChannel !== "undefined") {
            const bc = new BroadcastChannel("zzosy:campaigns")
            bc.postMessage({ type: "kv-updated", campaignId, ts: Date.now() })
            bc.close()
          }
        } catch {}
      } catch (e) { console.warn("KV thumb upload failed:", e) }
      isDirtyRef.current = false
      setIsDirty(false)
    }
    } finally {
      // setSaving sempre cai pra false (sucesso, erro, ou early return).
      setSaving(false)
    }
    })
  }

  // Cria um asset TEXT novo na campanha + auto-seleciona ele no dropdown +
  // adiciona ao canvas. UX: usuário pode criar texto direto do editor sem
  // sair pra /campaigns/[id]/assets.
  async function createTextAssetAndAdd() {
    if (!campaignId) return
    const defaultText = "New text"
    const span = { text: defaultText, style: { color: "#111111", fontSize: 80, fontWeight: "normal", fontFamily: "Arial" } }
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "TEXT", label: defaultText, value: defaultText, content: [span] }),
      })
      if (!res.ok) {
        alert("Failed to create text asset")
        return
      }
      const created = await res.json()
      // Refetch campanha pra ter o novo asset no estado
      const campRes = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" })
      if (campRes.ok) {
        const camp = await campRes.json()
        setCampaign(camp)
        campaignRef.current = camp
      }
      // Seleciona o novo asset + adiciona ao canvas
      setAssetId(created.id)
      assetIdRef.current = created.id
      // pequeno delay pra o state propagar
      await new Promise(r => setTimeout(r, 50))
      await addLayer()
    } catch (e) {
      console.warn("[createTextAssetAndAdd] falhou:", e)
      alert("Error creating text")
    }
  }

  async function addLayer() {
    const fc = fabricRef.current
    const c = campaignRef.current
    const aid = assetIdRef.current
    if (!fc || !c || !aid) return
    const asset = c.assets.find((a: Asset) => a.id === aid)
    if (!asset) return

    // Modelo final: cada asset guarda seu lastOverride (ultimo template visual
    // aplicado na MATRIZ). Quando adiciona o asset no canvas (matriz ou peca),
    // vem com esse template. Se o asset nunca foi configurado, vem default.
    const templateOverrides = (asset.lastOverride && typeof asset.lastOverride === "object")
      ? { ...asset.lastOverride }
      : undefined

    // Width default: limita a 40% do canvas pra IMAGE evitar overflow visual
    // em peças pequenas (ex: Stories 1080x1920 com asset adicionado a width=400
    // ainda renderiza dentro; mas em peças 600x600 width=400 ocupa 66% e a
    // imagem natural pode ser scaled up). Tambem evita layers grudados na borda
    // direita ao adicionar em sequencia.
    const cw = canvasWRef.current
    const ch = canvasHRef.current
    const defaultImgWidth = Math.min(400, Math.round(cw * 0.4))
    const layerW = asset.type === "TEXT" ? Math.min(800, Math.round(cw * 0.6)) : defaultImgWidth
    // Estimativa de altura pra centralizar verticalmente. TEXT eh dificil
    // (depende de fontSize, lineHeight, wrap) — usa 200 como hint razoavel.
    // IMAGE/SMART_OBJECT: aspect ratio nao eh conhecido aqui, assume quadrado
    // (vai centralizar no centro do bbox quadrado; visualmente ok).
    const layerH = asset.type === "TEXT" ? 200 : layerW
    // User reportou 2026-05-30 "logo catavento esta entrando fora do canvas".
    // Antes posX/posY eram hardcoded 100/100 — em peca grande (1920x1080) a
    // layer caia colada no canto top-left; pior em peca pequena com canvas
    // viewport offset (BG nao alinhado a 0,0 em alguns casos) fazia cair
    // FORA da peca. Centralizar resolve em todos os casos.
    const posX = Math.max(0, Math.round((cw - layerW) / 2))
    const posY = Math.max(0, Math.round((ch - layerH) / 2))
    await addAssetToCanvas(fc, asset, {
      posX, posY,
      width: layerW,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      overrides: templateOverrides,
    })
    // Novo asset vai pro TOPO de todos layers (CLAUDE 2.2 + user 2026-05-30:
    // "adicionou embaixo de todos os layers, precisa ser o contrario").
    // addAssetToCanvas adiciona via fc.add() no FINAL do array — em Fabric
    // isso pinta POR CIMA, mas o painel Layers exibe ordem INVERSA (top do
    // array = bottom visual no painel). Pra ficar no topo do painel, precisa
    // garantir ordem visual: bringObjectToFront SEMPRE, e bleed overlays
    // re-elevados pra cima depois.
    try {
      const added = fc.getObjects().filter((o: any) => o.__assetId === aid).pop()
      if (added) {
        if ((fc as any).bringObjectToFront) (fc as any).bringObjectToFront(added)
        else (fc as any).bringToFront?.(added)
        // Re-eleva bleed overlays pra continuarem cobrindo (asset novo nao deve
        // ficar acima dos overlays de safe area).
        const overlays = fc.getObjects().filter((o: any) => o.__isBleedOverlay)
        for (const o of overlays) {
          try { (fc as any).bringObjectToFront ? (fc as any).bringObjectToFront(o) : (fc as any).bringToFront?.(o) } catch {}
        }
        fc.setActiveObject(added)
      }
    } catch (e) { editorLog("[addLayer bringToFront]", e) }
    fc.renderAll()
    doSave()
  }

  // Click-to-place text (user 2026-05-30): cria Fabric.Textbox vazio na
  // posicao do pointer + entra em edicao. Ao sair da edicao (handler em
  // text:editing:exited dentro do init), o texto vira ClientLibraryAsset
  // type=TEXT do CLIENTE da campanha — fica disponivel pra reuso global.
  async function placeTextAtPointer(x: number, y: number) {
    const fc = fabricRef.current
    if (!fc) return
    const fabric = (await import("fabric")) as any
    // Brand color do cliente como fill default (fonte unica da identidade).
    // Fallback preto se brand colors nao carregadas.
    const cliente = campaignRef.current?.client as any
    const brandColorsRaw = cliente?.brandColors
    const brandColors = typeof brandColorsRaw === "string"
      ? (() => { try { return JSON.parse(brandColorsRaw) } catch { return [] } })()
      : (brandColorsRaw ?? [])
    const defaultFill = (Array.isArray(brandColors) && brandColors[0]?.hex) || "#111111"
    const brandFont = (cliente?.brandFont as string | undefined) || "DM Sans"
    const Textbox = fabric.Textbox ?? fabric.fabric?.Textbox
    if (!Textbox) return
    const tb = new Textbox("", {
      left: x, top: y,
      width: Math.max(200, Math.round((canvasWRef.current ?? 1920) * 0.3)),
      fontFamily: brandFont,
      fontSize: 64,
      fontWeight: 400,
      fill: defaultFill,
      textAlign: "left",
      editable: true,
    })
    // Marca como "freshly placed" pra que text:editing:exited saiba criar
    // o Library asset depois (set de IDs cadastrado em placedTextIdsRef).
    const placedId = `placed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    ;(tb as any).__placedTextId = placedId
    placedTextIdsRef.current.add(placedId)
    fc.add(tb)
    fc.setActiveObject(tb)
    fc.renderAll()
    // Entra em edicao imediatamente — user comeca a digitar logo.
    try { tb.enterEditing?.(); tb.hiddenTextarea?.focus?.() } catch {}
  }

  // Atualiza ref toda render — useEffect mouse:down captura closure antiga,
  // entao precisamos do ref pra chamar a versao atual.
  useEffect(() => { placeTextAtPointerRef.current = placeTextAtPointer })

  // Indice do BG atualmente sendo editado no painel. Se um BG esta selecionado
  // no canvas, eh o __bgIdx dele. Senao, eh o 0 (fundo) — UX conservadora.
  function currentBgIdx(): number {
    const sel = selectedRef.current as any
    if (sel?.__isBg && typeof sel.__bgIdx === "number") return sel.__bgIdx
    return 0
  }

  // Helper unificado pra mutar o BG atualmente selecionado. Aplica updater no
  // bgLayersRef, recalcula fill (suporta solid + gradient via buildBgFill),
  // sincroniza espelhos legacy (BG[0]) e dispara save + re-render do painel.
  async function updateCurrentBg(updater: (layer: BgLayerData) => BgLayerData) {
    const fc = fabricRef.current
    if (!fc) return
    const idx = currentBgIdx()
    const current = bgLayersRef.current[idx]
    if (!current) return
    const next = updater(current)
    bgLayersRef.current[idx] = next
    const rect = bgRectsRef.current[idx]
    if (rect) {
      const fabricMod: any = await import("fabric")
      await syncBgLayerToRect(rect, next, canvasWRef.current, canvasHRef.current, fabricMod)
      fc.renderAll()
    }
    // Espelhos legacy (BG[0]) — save/export antigo continua funcionando.
    if (idx === 0) {
      bgOpacityRef.current = next.opacity
      bgColorRef.current = bgLayerLegacyColor(next)
    }
    if (next.kind === "solid") {
      setBgColor(next.color)
      setBgHexInput(next.color)
    }
    setBgOpacity(next.opacity)
    setSelectedTick(t => t + 1)
    // Snap pro undo stack ANTES do save. object:modified listener filtra __isBg,
    // entao mudanca de BG via painel nao entrava no historico — Cmd+Z nao
    // desfazia. Bug reportado 2026-05-28.
    pushHistory()
    doSave()
  }

  function changeBg(c: string, brandIdx?: number) {
    updateCurrentBg((l) => {
      // Brand ref: se foi clicado num swatch da Marca, marca colorBrandIdx
      // pra re-sync automatico. Senao, limpa pra desassociar.
      const bIdx = typeof brandIdx === "number" ? brandIdx : undefined
      if (l.kind === "solid") return { ...l, color: c, colorBrandIdx: bIdx }
      // Vinha de gradient/image — forca pra solid
      return { kind: "solid", color: c, colorBrandIdx: bIdx, opacity: l.opacity, hidden: l.hidden, locked: l.locked }
    })
  }

  function changeBgOpacity(op: number) {
    const v = Math.max(0, Math.min(1, op))
    updateCurrentBg((l) => ({ ...l, opacity: v }))
  }

  // BG-3/4: troca tipo do BG (solid/gradient/image). Preserva o que faz
  // sentido entre as conversoes. Pra image sem upload previo, deixa
  // imageDataUrl vazio — UI redireciona pro file picker.
  function changeBgKind(kind: "solid" | "gradient" | "image", opts?: { gradientType?: "linear" | "radial"; fit?: BgImageFit }) {
    updateCurrentBg((l) => {
      if (kind === "solid") {
        const color = l.kind === "solid"
          ? l.color
          : l.kind === "gradient" ? (l.stops[0]?.color ?? "#ffffff")
          : "#ffffff"
        return { kind: "solid", color, opacity: l.opacity, hidden: l.hidden, locked: l.locked }
      }
      if (kind === "gradient") {
        const gradientType = opts?.gradientType ?? (l.kind === "gradient" ? l.gradientType : "linear")
        if (l.kind === "gradient") return { ...l, gradientType }
        const baseColor = l.kind === "solid" ? l.color : "#ffffff"
        return {
          kind: "gradient", gradientType, angle: 90,
          stops: [{ offset: 0, color: baseColor }, { offset: 1, color: "#000000" }],
          opacity: l.opacity, hidden: l.hidden, locked: l.locked,
        }
      }
      // kind === "image"
      const fit = opts?.fit ?? (l.kind === "image" ? l.fit : "cover")
      const imageDataUrl = l.kind === "image" ? l.imageDataUrl : ""
      return { kind: "image", imageDataUrl, fit, opacity: l.opacity, hidden: l.hidden, locked: l.locked }
    })
  }

  // Le um File como dataURL e aplica como imagem do BG atual. Se o BG nao for
  // do tipo "image" ainda, converte automaticamente (intencao do user eh clara).
  function uploadBgImage(file: File, fit: BgImageFit = "cover") {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "")
      if (!dataUrl) return
      updateCurrentBg((l) => ({
        kind: "image", imageDataUrl: dataUrl, fit,
        opacity: l.opacity, hidden: l.hidden, locked: l.locked,
      }))
    }
    reader.onerror = () => alert("Failed to read image")
    reader.readAsDataURL(file)
  }

  function changeBgImageFit(fit: BgImageFit) {
    updateCurrentBg((l) => l.kind === "image" ? { ...l, fit } : l)
  }

  function changeBgBlendMode(blendMode: BgBlendMode) {
    updateCurrentBg((l) => ({ ...l, blendMode }))
  }

  // Adiciona/remove mascara no BG. Pra MVP, mascara default = retangulo
  // vetorial cobrindo metade superior da peca (UX pra ver que tem efeito;
  // user ajusta depois via MaskPanel ou Photoshop-style edicao).
  function setBgMaskDefault() {
    updateCurrentBg((l) => ({
      ...l,
      mask: {
        type: "vector" as const,
        enabled: true,
        vector: {
          path: `M 0 0 L ${canvasWRef.current} 0 L ${canvasWRef.current} ${canvasHRef.current / 2} L 0 ${canvasHRef.current / 2} Z`,
          posX: 0, posY: 0,
          width: canvasWRef.current, height: canvasHRef.current / 2,
        },
      },
    }))
  }

  function removeBgMask() {
    updateCurrentBg((l) => ({ ...l, mask: undefined }))
  }

  function toggleBgMaskEnabled() {
    updateCurrentBg((l) => {
      if (!l.mask) return l
      return { ...l, mask: { ...l.mask, enabled: !l.mask.enabled } }
    })
  }

  function changeBgGradientStop(stopIdx: number, patch: Partial<BgGradientStop>) {
    updateCurrentBg((l) => {
      if (l.kind !== "gradient") return l
      const stops = l.stops.map((s, i) => i === stopIdx ? { ...s, ...patch } : s)
        .sort((a, b) => a.offset - b.offset)
      return { ...l, stops }
    })
  }

  function changeBgGradientAngle(angle: number) {
    updateCurrentBg((l) => l.kind === "gradient" ? { ...l, angle } : l)
  }

  function addBgGradientStop() {
    updateCurrentBg((l) => {
      if (l.kind !== "gradient") return l
      // Adiciona stop no meio do espaco vazio mais largo entre stops vizinhos
      const sorted = [...l.stops].sort((a, b) => a.offset - b.offset)
      let bestGap = 0, bestMid = 0.5, bestColor = "#888888"
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = sorted[i + 1].offset - sorted[i].offset
        if (gap > bestGap) {
          bestGap = gap
          bestMid = (sorted[i].offset + sorted[i + 1].offset) / 2
          // Cor interpolada entre vizinhos (so visual; user pode trocar depois)
          bestColor = sorted[i].color
        }
      }
      return { ...l, stops: [...l.stops, { offset: bestMid, color: bestColor }].sort((a, b) => a.offset - b.offset) }
    })
  }

  function removeBgGradientStop(stopIdx: number) {
    updateCurrentBg((l) => {
      if (l.kind !== "gradient" || l.stops.length <= 2) return l
      return { ...l, stops: l.stops.filter((_, i) => i !== stopIdx) }
    })
  }

  // Adiciona um BG layer ACIMA do atualmente selecionado (ou do topo dos BGs
  // se nenhum estiver selecionado). Default: solid branco opacity 1.
  async function addBgLayer() {
    const fc = fabricRef.current
    if (!fc) return
    const { Rect } = await import("fabric")
    const insertAt = (() => {
      const sel = selectedRef.current as any
      if (sel?.__isBg && typeof sel.__bgIdx === "number") return sel.__bgIdx + 1
      return bgLayersRef.current.length
    })()
    const newLayer: BgLayerData = { kind: "solid", color: "#ffffff", opacity: 1 }
    bgLayersRef.current.splice(insertAt, 0, newLayer)
    const r = new Rect({
      left: 0, top: 0, width: canvasWRef.current, height: canvasHRef.current,
      fill: newLayer.color, opacity: newLayer.opacity,
      selectable: true, evented: true,
      hasControls: false, hasBorders: true,
      lockMovementX: true, lockMovementY: true,
      lockScalingX: true, lockScalingY: true, lockRotation: true,
      excludeFromExport: true,
    })
    ;(r as any).__isBg = true
    fc.add(r)
    bgRectsRef.current.splice(insertAt, 0, r)
    // Re-numera __bgIdx + labels + manda BGs pro fundo na ordem correta
    rebuildBgStack(fc)
    fc.setActiveObject(r)
    setSelected(r)
    refreshLayers(fc)
    doSave()
  }

  // Remove o BG layer no idx informado. Nao permite remover o ULTIMO (sempre
  // tem pelo menos 1 BG — igual o PS exige um Background na pilha).
  function removeBgLayer(idx: number) {
    const fc = fabricRef.current
    if (!fc) return
    if (bgLayersRef.current.length <= 1) return // protege o ultimo
    const rect = bgRectsRef.current[idx]
    if (rect) fc.remove(rect)
    bgLayersRef.current.splice(idx, 1)
    bgRectsRef.current.splice(idx, 1)
    rebuildBgStack(fc)
    setSelected(null)
    refreshLayers(fc)
    doSave()
  }

  // Substitui TODA a lista de BG layers da peca (usado pelo import PSD e
  // futuras features). Remove os Rects antigos, cria novos, atualiza
  // bgLayersRef + bgRectsRef + espelhos legacy.
  async function replaceBgLayers(layers: BgLayerData[]) {
    const fc = fabricRef.current
    if (!fc || layers.length === 0) return
    for (const r of bgRectsRef.current) fc.remove(r)
    bgRectsRef.current = []
    bgLayersRef.current = layers
    const fabricMod: any = await import("fabric")
    const { Rect } = fabricMod
    const newRects: any[] = []
    for (let i = 0; i < layers.length; i++) {
      const ld = layers[i]
      const r = new Rect({
        left: 0, top: 0, width: canvasWRef.current, height: canvasHRef.current,
        selectable: true, evented: true,
        hasControls: false, hasBorders: true,
        lockMovementX: true, lockMovementY: true,
        lockScalingX: true, lockScalingY: true, lockRotation: true,
        excludeFromExport: true,
      })
      await syncBgLayerToRect(r, ld, canvasWRef.current, canvasHRef.current, fabricMod)
      ;(r as any).__isBg = true
      ;(r as any).__bgIdx = i
      ;(r as any).__assetLabel = i === 0 ? "Background" : `Background ${i + 1}`
      ;(r as any).__hidden = ld.hidden === true
      ;(r as any).__locked = ld.locked === true
      fc.add(r)
      newRects.push(r)
    }
    bgRectsRef.current = newRects
    bgRef.current = newRects[0]
    // BGs sempre no fundo (idx 0 = mais embaixo)
    for (let i = newRects.length - 1; i >= 0; i--) fc.sendObjectToBack(newRects[i])
    // Espelhos legacy
    bgOpacityRef.current = layers[0].opacity
    setBgOpacity(layers[0].opacity)
    if (layers[0].kind === "solid") {
      const c = typeof layers[0].color === "string" ? layers[0].color : "#ffffff"
      bgColorRef.current = c
      setBgColor(c)
    } else if (layers[0].kind === "gradient") {
      const c = typeof layers[0].stops?.[0]?.color === "string" ? layers[0].stops[0].color : "#ffffff"
      bgColorRef.current = c
      setBgColor(c)
    }
    fc.renderAll()
  }

  // Re-numera __bgIdx + labels dos Rects BG e re-empilha no canvas (idx 0
  // no fundo, idx N no topo dos BGs mas abaixo de qualquer asset). Tambem
  // sincroniza bgColorRef/bgOpacityRef com o BG[0] (back-compat legacy).
  function rebuildBgStack(fc: any) {
    for (let i = 0; i < bgRectsRef.current.length; i++) {
      const r = bgRectsRef.current[i]
      ;(r as any).__bgIdx = i
      ;(r as any).__assetLabel = i === 0 ? "Background" : `Background ${i + 1}`
    }
    // sendObjectToBack do topo pro fundo deixa idx 0 no fundo absoluto
    for (let i = bgRectsRef.current.length - 1; i >= 0; i--) {
      fc.sendObjectToBack(bgRectsRef.current[i])
    }
    bgRef.current = bgRectsRef.current[0]
    if (bgLayersRef.current[0]) {
      bgColorRef.current = bgLayerLegacyColor(bgLayersRef.current[0])
      bgOpacityRef.current = bgLayersRef.current[0].opacity
    }
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

  // Sincroniza bgHexInput com bgColor. Defensiva: bgColor sempre string aqui.
  useEffect(() => { setBgHexInput(typeof bgColor === "string" ? bgColor : "#ffffff") }, [bgColor])

  // Auto-scroll: traz o row do layer selecionado pro foco no painel Layers.
  // Quando o user seleciona um obj no CANVAS (clicando direto nele), o
  // painel pode estar com scroll diferente e o row sumido. Smooth scroll
  // pra ficar evidente onde ele esta na arvore.
  // Tambem dispara pulse de glow no row pra chamar a atencao do user —
  // remonta a div via key={layerPulseKey} pra reiniciar a CSS animation.
  useEffect(() => {
    if (!selected) return
    setLayerPulseKey(k => k + 1)
    // rAF pra esperar o re-render terminar antes de medir o DOM
    requestAnimationFrame(() => {
      try {
        const el = document.querySelector<HTMLElement>('[data-layer-selected="1"]')
        if (!el) return
        // scrollIntoView com block: "nearest" so rola se necessario (UX boa)
        el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" })
      } catch {}
    })
  }, [selected, selectedTick])

  // Sincroniza bgColor/bgOpacity state com o BG layer ATUALMENTE selecionado.
  // Quando nada esta selecionado, mostra os valores do BG[0] (fundo) — UX
  // conservadora: o painel sempre mostra ALGUM BG, igual antes.
  useEffect(() => {
    const obj = selected as any
    let idx = 0
    if (obj?.__isBg && typeof obj.__bgIdx === "number") idx = obj.__bgIdx
    const layer = bgLayersRef.current[idx]
    if (!layer) return
    setBgColor(bgLayerLegacyColor(layer))
    setBgOpacity(layer.opacity)
  }, [selected, selectedTick])

  // Sincroniza fontSizeInput com o tamanho efetivo do objeto selecionado.
  // - Se ha selecao parcial dentro do textbox: usa fontSize do caractere selecionado
  // - Se nao: usa fontSize raw (sem scale, igual Photoshop mostra)
  // selectedTick refresca em mouseup/keyup/object:modified, garantindo update apos
  // qualquer interacao (mover cursor, escalar pelo box, etc).
  // SKIP se o usuario esta digitando num input do painel — evita sobrescrever digitacao
  // em curso (ex: user tipo "8", reload do useEffect colocaria "5" antigo).
  useEffect(() => {
    if (!selected) return
    // Se algum input numérico do painel está em digitação, NÃO sincroniza —
    // sobrescrever fontSizeInput/leadingInput durante a digitação reseta o
    // input pro valor antigo e quebra o input visualmente.
    // Ref é mais confiável que document.activeElement (que pode estar stale
    // entre renders concorrentes do React 18).
    if (numericInputFocusedRef.current) return

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

    // Sincroniza leadingInput tambem (Adobe-style: leadingPt explicito ou Auto = 1:1 com fontSize)
    if (isText) {
      const lh = obj.lineHeight ?? 1.0
      const leadingPt = obj.leadingPt
      const effectiveLeading = (leadingPt === undefined || leadingPt === null)
        ? Math.round(lh * fs)
        : leadingPt
      setLeadingInput(String(Math.round(effectiveLeading)))
      // charSpacing (entreletra, PSD tracking) — 0 = sem espaco extra
      const cs = typeof obj.charSpacing === "number" ? obj.charSpacing : 0
      setCharSpacingInput(String(Math.round(cs)))
      // Baseline shift: le do range selecionado (per-char deltaY) ou box-level.
      // Fabric deltaY (positive=down) → PSD-style baselineShift (positive=up).
      // Inverte o sinal pra exibir Adobe-style no input.
      let bs = 0
      try {
        if (obj.isEditing && obj.selectionStart !== obj.selectionEnd) {
          const styles = obj.getSelectionStyles?.(obj.selectionStart, obj.selectionEnd) ?? []
          const dys = new Set(styles.map((s: any) => s?.deltaY ?? 0))
          if (dys.size === 1) bs = -([...dys][0] as number)
        } else if (obj.isEditing) {
          const idx = (obj.selectionStart ?? 1) > 0 ? obj.selectionStart - 1 : 0
          const text: string = obj.text ?? ""
          if (idx < text.length) {
            const styles = obj.getSelectionStyles?.(idx, idx + 1) ?? []
            if (styles[0]?.deltaY !== undefined) bs = -styles[0].deltaY
          }
        }
      } catch {}
      setBaselineShiftInput(String(Math.round(bs)))
    }
  }, [selected, selectedTick])

  /**
   * Atualiza o lastOverride do asset (so na MATRIZ).
   * lastOverride = template visual que vai ser aplicado quando o asset for
   * adicionado em outro canvas ou via swap. Pecas NAO atualizam isso.
   */
  function updateAssetLastOverride(obj: any) {
    if (pieceId) return // peca nao atualiza lastOverride
    const aid = obj?.__assetId
    if (!aid) return
    const isText = obj.type === "textbox" || obj.type === "i-text"
    if (!isText) return // por ora so texto tem lastOverride

    const lastOverride: any = {}
    if (obj.fill !== undefined) lastOverride.fill = obj.fill
    if (obj.fontSize !== undefined) lastOverride.fontSize = obj.fontSize
    if (obj.fontFamily !== undefined) lastOverride.fontFamily = obj.fontFamily
    if (obj.fontWeight !== undefined) lastOverride.fontWeight = obj.fontWeight
    if (obj.charSpacing !== undefined) lastOverride.charSpacing = obj.charSpacing
    if (obj.lineHeight !== undefined) lastOverride.lineHeight = obj.lineHeight
    if (obj.textAlign !== undefined) lastOverride.textAlign = obj.textAlign
    if ((obj as any).leadingPt !== undefined && (obj as any).leadingPt !== null) {
      lastOverride.leadingPt = (obj as any).leadingPt
    }
    // Styles per-caractere (cores/tamanhos por letra). Sem salvar isso, swap perderia
    // a config quando usuario pinta letras individuais via duplo-clique + selecao.
    if (obj.styles && typeof obj.styles === "object" && Object.keys(obj.styles).length > 0) {
      lastOverride.styles = obj.styles
    }
    // BOX overrides: largura e altura da caixa de texto. Importante pra reset textos
    // ao swap (Photoshop-style: cada texto tem sua propria largura/altura de caixa).
    if (obj.width !== undefined) lastOverride.width = obj.width
    if (obj.height !== undefined) lastOverride.height = obj.height
    // Atualiza tambem o cache local pra swap funcionar dentro da mesma sessao
    const c = campaignRef.current
    if (c?.assets) {
      const asset = c.assets.find((a: Asset) => a.id === aid)
      if (asset) (asset as any).lastOverride = lastOverride
    }
    // Persiste no banco com DEBOUNCE 400ms: sliders/inputs em sequencia rapida
    // antes acumulavam 1 PUT por mudanca, sobrecarregando a API. O ultimo PUT
    // ganha (mantem payload mais recente).
    lastOverridePendingPayload.current = { aid, payload: { lastOverride } }
    clearTimeout(lastOverridePutTimer.current)
    lastOverridePutTimer.current = setTimeout(() => {
      const pending = lastOverridePendingPayload.current
      if (!pending) return
      lastOverridePendingPayload.current = null
      fetch(`/api/campaigns/${campaignId}/assets/${pending.aid}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending.payload),
      }).catch(err => console.warn("[updateAssetLastOverride] failed:", err))
    }, 400)
  }

  // Matriz: propaga caracteres editados pro asset.content (fonte da verdade
  // dos caracteres em TODAS as pecas geradas — atuais e futuras). Chamado em
  // text:editing:exited junto com updateAssetLastOverride.
  // IMPORTANTE: quebras de linha (\n) sao STRIPADAS aqui — o asset nunca tem
  // \n. Quebras ficam locais a matriz (em layer.overrides.text) e a cada peca
  // (em layer.overrides.text na peca). Novas pecas geradas herdam o \n da
  // matriz via spread em GeneratePiecesModal; depois disso ficam independentes.
  // Cuidado com o \n entre palavras: se o user seleciona o espaco e aperta
  // Enter ("Hello World" -> "Hello\nWorld"), strip puro vira "HelloWorld" e
  // come o espaco. Solucao: \n entre dois nao-whitespace vira " "; entre
  // whitespace+algo, e' removido (o whitespace ja separa as palavras).
  function updateAssetContent(obj: any) {
    if (pieceId) return // peca nao propaga pro asset
    const aid = obj?.__assetId
    if (!aid) return
    const isText = obj.type === "textbox" || obj.type === "i-text"
    if (!isText) return
    const fullText: string = obj.text ?? ""
    // CORE 1 (2026-05-28): asset.content e FONTE CANONICA de per-char styles.
    // Antes strippavamos per-char aqui (deixava 1 span uniforme). Isso quebrava
    // o caminho de edit via /assets: rebuildSpans la so via 1 span e produzia
    // newSpans uniformes; migrateStyles entao precisava do per-char vir de
    // lastOverride.styles que so era populado em casos especificos (timing
    // de debounce). Resultado: peca gerada antes do save de lastOverride
    // ficava com todas letras mesma cor pos edit do asset.
    //
    // Agora: spans codificam per-char COMPLETO. defaultStyle = obj.fill. Per-char
    // styles do textbox (obj.styles) entram nos spans via buildSpansFromPerChar.
    // Spans consecutivos com mesmo style sao agrupados (otimiza serializacao).
    const defaultStyle = {
      color: obj.fill ?? "#111111",
      fontSize: obj.fontSize ?? 80,
      fontWeight: obj.fontWeight ?? "normal",
      fontFamily: obj.fontFamily ?? "Arial",
    }
    // obj.styles do Fabric: {lineIdx:{colIdx:{fill, fontSize, ...}}}. Normaliza
    // fill -> color (asset.content usa style.color, Fabric usa fill).
    const perChar: any = {}
    if (obj.styles && typeof obj.styles === "object") {
      for (const lineKey of Object.keys(obj.styles)) {
        const line = obj.styles[lineKey]
        if (!line || typeof line !== "object") continue
        const newLine: any = {}
        for (const colKey of Object.keys(line)) {
          const cs = line[colKey]
          if (!cs || typeof cs !== "object") continue
          const norm: any = { ...cs }
          if (norm.fill && !norm.color) { norm.color = norm.fill; delete norm.fill }
          newLine[colKey] = norm
        }
        if (Object.keys(newLine).length > 0) perChar[lineKey] = newLine
      }
    }
    const finalSpans: TextSpan[] = buildSpansFromPerChar(fullText, defaultStyle, perChar)
    // Atualiza cache local pra que swaps/reloads na mesma sessao usem o texto novo
    const c = campaignRef.current
    if (c?.assets) {
      const asset = c.assets.find((a: Asset) => a.id === aid)
      if (asset) (asset as any).content = finalSpans
    }
    // PUT debounceado 400ms — content do asset dispara TRANSACTION pesada
    // (migra styles em todas pecas + matriz). Sem debounce, sair de edicao
    // rapida em multiplos textboxes acumulava 1 transaction por exit.
    assetContentPendingPayload.current = { aid, payload: { content: finalSpans } }
    clearTimeout(assetContentPutTimer.current)
    assetContentPutTimer.current = setTimeout(() => {
      const pending = assetContentPendingPayload.current
      if (!pending) return
      assetContentPendingPayload.current = null
      fetch(`/api/campaigns/${campaignId}/assets/${pending.aid}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending.payload),
      }).catch(err => console.warn("[updateAssetContent] failed:", err))
    }, 400)
  }

  /**
   * Substitui cirurgicamente uma fonte missing por outra disponivel em TODOS
   * os textboxes do canvas que usam essa variante exata (family + weight + style).
   * Adobe-style "Replace Missing Fonts": preserva textos que usam outras variantes
   * da mesma familia (ex: substituir Sicredi Sans Bold Italic nao mexe em
   * Sicredi Sans Regular). Per-char styles tambem sao varridos.
   *
   * Persiste via doSave; canvas re-mede com initDimensions.
   */
  function substituteFontInCanvas(
    oldFamily: string,
    oldWeight: number,
    oldStyle: "normal" | "italic",
    newFamily: string,
  ) {
    const fc = fabricRef.current
    if (!fc) return
    const weightToNum = (w: any): number => {
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
    const styleToCanon = (s: any): "normal" | "italic" =>
      typeof s === "string" && /italic|oblique/i.test(s) ? "italic" : "normal"
    let touched = 0
    for (const o of fc.getObjects()) {
      if (o.type !== "textbox" && o.type !== "i-text") continue
      const tb = o as any
      // CRITICO: captura defaults ORIGINAIS antes de mexer — fallback per-char
      // precisa comparar contra o que estava antes da substituicao, nao depois.
      const originalDefaultFamily = tb.fontFamily
      const originalDefaultWeight = tb.fontWeight
      const originalDefaultStyle = tb.fontStyle
      // Default do textbox: troca se a variante bate exatamente
      if (originalDefaultFamily === oldFamily
          && weightToNum(originalDefaultWeight) === oldWeight
          && styleToCanon(originalDefaultStyle) === oldStyle) {
        tb.set("fontFamily", newFamily)
        touched++
      }
      // Per-char: itera styles e troca cada char que bate
      const styles = tb.styles
      if (styles && typeof styles === "object") {
        for (const lineKey of Object.keys(styles)) {
          const line = styles[lineKey]
          if (!line || typeof line !== "object") continue
          for (const colKey of Object.keys(line)) {
            const cs = line[colKey]
            if (!cs) continue
            const charFamily = cs.fontFamily ?? originalDefaultFamily
            const charWeight = weightToNum(cs.fontWeight ?? originalDefaultWeight)
            const charStyle = styleToCanon(cs.fontStyle ?? originalDefaultStyle)
            if (charFamily === oldFamily && charWeight === oldWeight && charStyle === oldStyle) {
              cs.fontFamily = newFamily
              touched++
            }
          }
        }
      }
      if ((tb as any).initDimensions) (tb as any).initDimensions()
      tb.setCoords()
    }
    if (touched > 0) {
      fc.requestRenderAll()
      isDirtyRef.current = true
      setIsDirty(true)
      if (isInitialized.current && !isApplyingHistory.current) pushHistory()
      doSave()
    }
    return touched
  }

  function applyStyle(key: string, val: any, brandIdx?: number) {
    const fc = fabricRef.current; const obj = selected
    if (!fc || !obj) return
    const value = key === "fontSize" ? Number(val) : val
    const styleKey = key === "fill" ? "fill" : key
    // Brand ref: ao clicar num swatch de Marca, marca __fillBrandIdx. Em
    // qualquer outra mudanca de fill (color picker, hex, swatch padrao),
    // limpa pra desassociar. Persiste em overrides.fillBrandIdx no save.
    if (key === "fill") {
      if (typeof brandIdx === "number") {
        ;(obj as any).__fillBrandIdx = brandIdx
      } else {
        delete (obj as any).__fillBrandIdx
      }
    }
    // DS link: mudanca via Properties Panel em campos tipograficos quebra o
    // vinculo com o Design System (esse layer fica "customizado"). Scale,
    // posicao, rotacao, fill NAO quebram — soh esses 5 campos centrais:
    // fontFamily/fontWeight/fontSize/leadingPt/charSpacing (+ fontStyle).
    // Bolinha no painel de layers vira vermelha. Setado APENAS quando o
    // user atua via UI (esta funcao), nao em re-set programatico de save/load.
    // INCLUI fill (cor) quando aplicado SEM brandIdx — cor custom (hex picker)
    // quebra link com DS. Cor de swatch da marca (brandIdx setado) mantem link.
    // Sem isso, server propagava preset e sobrescrevia override de cor sem
    // detectar que o user havia customizado.
    const breaksDsLink =
      key === "fontFamily" || key === "fontWeight" || key === "fontStyle"
      || key === "fontSize" || key === "leadingPt" || key === "charSpacing"
      || (key === "fill" && typeof brandIdx !== "number")
    if (breaksDsLink) {
      ;(obj as any).__dsLinked = false
    }

    const isText = obj.type === "textbox" || obj.type === "i-text"
    const isEditing = (obj as any).isEditing
    const saved = savedTextSelection.current
    const hasSavedSel = !!(saved && saved.obj === obj && saved.start !== saved.end)
    const selStart = isEditing ? (obj.selectionStart ?? 0) : (hasSavedSel ? saved!.start : 0)
    const selEnd = isEditing ? (obj.selectionEnd ?? 0) : (hasSavedSel ? saved!.end : 0)
    const hasSelection = (isEditing || hasSavedSel) && selStart !== selEnd

    if (isText && hasSelection) {
      // Photoshop: aplica so nos caracteres selecionados
      // Brand ref per-char: quando fill vem via swatch Marca + tem seleção,
      // grava `fillBrandIdx` JUNTO no style do char pra que o cascade possa
      // re-resolver no futuro. Sem isso, char fica com fill literal e
      // perdemos o vinculo com a brand.
      const charStyle: any = { [styleKey]: value }
      if (key === "fill") {
        if (typeof brandIdx === "number") charStyle.fillBrandIdx = brandIdx
        else charStyle.fillBrandIdx = null // sinaliza pro merge desabilitar ref antigo
      }
      obj.setSelectionStyles(charStyle, selStart, selEnd)
      // Limpa fillBrandIdx=null nos styles (Fabric guarda null como valor real;
      // pra "nao ter" o campo, deletar). Itera styles afetados.
      if (key === "fill" && typeof brandIdx !== "number") {
        try {
          const styles = (obj as any).styles ?? {}
          for (const lineKey of Object.keys(styles)) {
            for (const colKey of Object.keys(styles[lineKey])) {
              if (styles[lineKey][colKey]?.fillBrandIdx === null) {
                delete styles[lineKey][colKey].fillBrandIdx
              }
            }
          }
        } catch {}
      }
      // initDimensions so eh necessario quando mudanca afeta layout (fontSize, fontFamily).
      // Mudar cor (fill) nao muda layout — chamar initDimensions a toa pode trigger bugs
      // (ex: ate observado que pode "comer" espacos em algumas situacoes de styles per-char).
      if (styleKey !== "fill" && (obj as any).initDimensions) (obj as any).initDimensions()
      // CRITICO: Fabric objectCaching default=true → fc.renderAll() blita o
      // cache antigo sem refletir a mudanca de cor per-char. Marca dirty pra
      // invalidar cache + re-render real. Sem isso, color picker parece
      // "preview only" — save persiste mas canvas mostra cor antiga ate
      // close+reopen do editor. Bug reportado 2026-05-25.
      ;(obj as any).dirty = true
    } else if (isText) {
      // Aplica como default do textbox. Caracteres com override per-char MANTEM
      // seu estilo PRA COR (Photoshop: mudar cor padrao nao apaga cores das
      // letras especificas). MAS pra fontSize/fontFamily/fontWeight sem
      // selecao parcial, o user esperava "mudar tudo" — sintoma reportado:
      // "nao consigo alterar o tamanho da fonte do titulo". Removemos os
      // per-char overrides desses campos pra que o set() default tenha efeito
      // visual completo.
      // Strip per-char override do styleKey atual quando o user aplica
      // SEM selecao — comportamento esperado "mudar tudo". Antes era so
      // pra fontSize/Family/Weight/Style/charSpacing; user reportou
      // 2026-05-26 que mudar cor pra branco voltava preto apos reload
      // porque os per-char fills do PSD original ganhavam precedencia.
      // Pra `fill` precisa strippar TAMBEM `fillBrandIdx` per-char (senao
      // o cascade reaplica a brand color antiga apos save/reload).
      const STRIP_KEYS_NO_SEL = ["fontSize", "fontFamily", "fontWeight", "fontStyle", "charSpacing", "fill"]
      if (STRIP_KEYS_NO_SEL.includes(styleKey)) {
        const styles = (obj as any).styles
        if (styles && typeof styles === "object") {
          for (const lineKey of Object.keys(styles)) {
            const line = styles[lineKey]
            if (!line || typeof line !== "object") continue
            for (const colKey of Object.keys(line)) {
              if (line[colKey] && Object.prototype.hasOwnProperty.call(line[colKey], styleKey)) {
                delete line[colKey][styleKey]
              }
              // Pra fill, tambem strippa fillBrandIdx (vinculo de brand color
              // per-char que sobrescreveria a cor padrao no proximo render).
              if (styleKey === "fill" && line[colKey] && Object.prototype.hasOwnProperty.call(line[colKey], "fillBrandIdx")) {
                delete line[colKey].fillBrandIdx
              }
              // Limpa entry vazio pra nao deixar lixo
              if (line[colKey] && Object.keys(line[colKey]).length === 0) delete line[colKey]
            }
            if (Object.keys(line).length === 0) delete styles[lineKey]
          }
        }
      }
      obj.set(styleKey, value)
      // Adobe-style: leading e fontSize sao independentes. Quando muda fontSize, o leadingPt
      // (em pontos absolutos) fica congelado, mas o lineHeight do Fabric (multiplicador)
      // precisa recalcular pra renderizar com o leading correto.
      if (styleKey === "fontSize") syncLineHeightFromLeading(obj)
      if (styleKey !== "fill" && (obj as any).initDimensions) (obj as any).initDimensions()
      // Fabric objectCaching: marca dirty pra invalidar cache em mudancas de fill.
      ;(obj as any).dirty = true
    } else {
      obj.set(styleKey, value)
    }

    obj.setCoords()
    fc.renderAll()
    setSelectedTick(t => t + 1)

    // Atualiza lastOverride do asset (so na matriz). Define o template visual
    // que sera aplicado em swaps futuros e novas pecas.
    if (isText) updateAssetLastOverride(obj)

    // History: applyStyle modifica obj via setSelectionStyles/.set, e Fabric
    // NAO dispara object:modified em mudancas programaticas (so em mouse
    // drag/resize/rotate). Sem push explicito, mudanças de cor/fontSize/
    // fontFamily/charSpacing/lineHeight/textAlign nao entram no undo stack.
    // Sintoma reportado: "undo desfaz config do texto que nao foi tocado
    // nessa acao" — porque o snap anterior nem capturou o estado COM config.
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    // Modelo final: styles editados via painel direito sao SEMPRE locais
    // (override do layer), tanto na matriz quanto na peca. Nao propaga pro asset.
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
    // History: mudanca programatica nao dispara object:modified.
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  /**
   * Aplica blend mode (PSD-style) no objeto selecionado. Canvas usa nomes
   * `globalCompositeOperation` (multiply, screen, overlay, etc). Persistido
   * no save como layer.blendMode (round-trip pro PSD).
   *
   * "source-over" = Normal (default). Outros valores ativam blending no
   * canvas Fabric. Funciona pra qualquer tipo de objeto (texto, imagem, etc).
   */
  function changeObjectBlendMode(mode: string) {
    const fc = fabricRef.current; const obj = selected
    if (!fc || !obj) return
    ;(obj as any).set("globalCompositeOperation", mode)
    fc.requestRenderAll()
    setSelectedTick(t => t + 1)
    isDirtyRef.current = true
    setIsDirty(true)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  /**
   * Opacidade 0..1 do objeto selecionado. Round-trip: vira layer.opacity
   * (preservado no PSD export).
   */
  function changeObjectOpacity(opacity: number) {
    const fc = fabricRef.current; const obj = selected
    if (!fc || !obj) return
    const clamped = Math.max(0, Math.min(1, opacity))
    ;(obj as any).set("opacity", clamped)
    fc.requestRenderAll()
    setSelectedTick(t => t + 1)
    isDirtyRef.current = true
    setIsDirty(true)
    if (isInitialized.current && !isApplyingHistory.current) pushHistory()
    doSave()
  }

  /**
   * Sincroniza Fabric.lineHeight a partir do modelo de tipografia (Adobe-style):
   *   - Se leadingPt definido: lineHeight = leadingPt / fontSize
   *   - Se Auto (leadingPt undefined/null): lineHeight = 1.0 (1:1 com fontSize)
   *
   * Detalhe interno do motor — chamado quando muda leadingPt OU quando muda fontSize.
   * Usuario nao "sente" isso, ele soh pensa em pontos absolutos ou Auto.
   */
  function syncLineHeightFromLeading(obj: any) {
    if (!obj) return
    const isText = obj.type === "textbox" || obj.type === "i-text"
    if (!isText) return
    const leadingPt = obj.leadingPt
    if (leadingPt === undefined || leadingPt === null) {
      // Auto leading — usa default Fabric 1.0 (no extra multiplier).
      obj.set("lineHeight", 1.0)
    } else {
      // applyLeadingPtToFabric MEDE o factor real do Fabric — match exato
      // baseline-to-baseline com Photoshop.
      applyLeadingPtToFabric(obj, leadingPt)
    }
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
    // DS link: alterar leading via Properties Panel quebra o vinculo.
    obj.__dsLinked = false
    syncLineHeightFromLeading(obj)
    if (obj.initDimensions) obj.initDimensions()
    obj.setCoords()
    // dirty=true forca invalidacao do object cache (objectCaching default true).
    obj.dirty = true
    fc.requestRenderAll()
    // NAO disparar setSelectedTick aqui — isso re-roda o useEffect que
    // reescreve `leadingInput` no meio da digitacao, quebrando o input.
    // O reset ao Auto (botao "A") usa um caminho separado que sincroniza.
    if (pt === null) setSelectedTick(t => t + 1)
    doSave()
  }

  /**
   * Define charSpacing (tracking/entreletra) em milesimos de em (Adobe-style).
   * Mesma unidade do PSD tracking — 0 = sem espaco extra, positivo = afastadas,
   * negativo = mais juntas.
   */
  function setCharSpacingProp(units: number) {
    const fc = fabricRef.current; const obj = selected as any
    if (!fc || !obj) return
    const isText = obj.type === "textbox" || obj.type === "i-text"
    if (!isText) return
    // Detecta range selection. Como o foco no input tira isEditing antes do
    // onChange disparar, fallback pra savedTextSelection (capturada onMouseDown).
    const saved = savedTextSelection.current
    const hasLiveRange = obj.isEditing && obj.selectionStart !== obj.selectionEnd
    const hasSavedRange = !!(saved && saved.obj === obj && saved.start !== saved.end)
    const useRange = hasLiveRange || hasSavedRange
    const rangeStart = hasLiveRange ? obj.selectionStart : (hasSavedRange ? saved!.start : 0)
    const rangeEnd = hasLiveRange ? obj.selectionEnd : (hasSavedRange ? saved!.end : 0)

    // Helper: mapeia char-index ABSOLUTO (sem \n) pra {line, col} respeitando
    // quebras de linha do texto. setSelectionStyles do Fabric ja faz isso
    // internamente, mas mutamos obj.styles diretamente como fallback pra
    // garantir que per-char persista no save (savedSelectionStyles as vezes
    // limpa styles "redundantes" em alguns codepaths).
    function indexToLineCol(text: string, absIdx: number): { line: number; col: number } {
      let line = 0, col = 0
      for (let i = 0; i < absIdx && i < text.length; i++) {
        if (text[i] === "\n") { line++; col = 0 } else { col++ }
      }
      return { line, col }
    }

    if (useRange) {
      // PER-CHAR no range. Aplica via setSelectionStyles (API oficial Fabric)
      // E TAMBEM mutacao manual pra garantir que persiste no obj.styles —
      // setSelectionStyles em algumas versoes do Fabric "limpa" styles
      // identicos ao default, removendo o per-char.
      try { obj.setSelectionStyles({ charSpacing: units }, rangeStart, rangeEnd) }
      catch (e) { console.warn("[setCharSpacingProp] setSelectionStyles falhou:", e) }
      const text: string = obj.text ?? ""
      if (!obj.styles) obj.styles = {}
      for (let i = rangeStart; i < rangeEnd; i++) {
        if (text[i] === "\n") continue
        const { line, col } = indexToLineCol(text, i)
        if (!obj.styles[line]) obj.styles[line] = {}
        const existing = obj.styles[line][col] && typeof obj.styles[line][col] === "object"
          ? obj.styles[line][col]
          : {}
        existing.charSpacing = units
        obj.styles[line][col] = existing
      }
    } else {
      // Sem range: aplica box-level + propaga pra TODOS per-char existentes.
      // Sem propagar, PSD imports (que gravam per-char) ignoram mudanca no box.
      obj.set("charSpacing", units)
      const styles = obj.styles
      if (styles && typeof styles === "object") {
        for (const lineKey of Object.keys(styles)) {
          const line = styles[lineKey]
          if (!line || typeof line !== "object") continue
          for (const colKey of Object.keys(line)) {
            if (line[colKey] && typeof line[colKey] === "object") {
              line[colKey].charSpacing = units
            }
          }
        }
      }
    }
    obj.__dsLinked = false
    // NAO chamar initDimensions aqui — algumas versoes do Fabric resetam
    // styles per-char durante recompute de _textLines. _forceClearCache
    // forca re-medicao na proxima render sem mexer em styles.
    if (obj._forceClearCache !== undefined) obj._forceClearCache = true
    obj.setCoords()
    obj.dirty = true
    fc.requestRenderAll()
    doSave()
  }

  /**
   * Define baseline shift per-char (Adobe-style PSD baselineShift). Input em
   * PONTOS positivos = char SUBE, negativos = char DESCE (igual Photoshop).
   * Mapeado pra Fabric textbox.styles[line][col].deltaY com SINAL INVERTIDO
   * (Fabric deltaY positive = desce). Per-char only — sem aplicacao box-level
   * (Adobe nao tem baseline shift box-wide, so per-char).
   */
  function setBaselineShiftProp(pts: number) {
    const fc = fabricRef.current; const obj = selected as any
    if (!fc || !obj) return
    const isText = obj.type === "textbox" || obj.type === "i-text"
    if (!isText) return
    const saved = savedTextSelection.current
    const hasLiveRange = obj.isEditing && obj.selectionStart !== obj.selectionEnd
    const hasSavedRange = !!(saved && saved.obj === obj && saved.start !== saved.end)
    const useRange = hasLiveRange || hasSavedRange
    if (!useRange) return // baselineShift sem range nao faz sentido (Adobe parity)
    const rangeStart = hasLiveRange ? obj.selectionStart : (hasSavedRange ? saved!.start : 0)
    const rangeEnd = hasLiveRange ? obj.selectionEnd : (hasSavedRange ? saved!.end : 0)
    // PSD positive = up → Fabric deltaY negative = up. Inverte.
    const deltaY = -pts
    function indexToLineCol(text: string, absIdx: number): { line: number; col: number } {
      let line = 0, col = 0
      for (let i = 0; i < absIdx && i < text.length; i++) {
        if (text[i] === "\n") { line++; col = 0 } else { col++ }
      }
      return { line, col }
    }
    try { obj.setSelectionStyles({ deltaY }, rangeStart, rangeEnd) }
    catch (e) { console.warn("[setBaselineShiftProp] setSelectionStyles falhou:", e) }
    const text: string = obj.text ?? ""
    if (!obj.styles) obj.styles = {}
    for (let i = rangeStart; i < rangeEnd; i++) {
      if (text[i] === "\n") continue
      const { line, col } = indexToLineCol(text, i)
      if (!obj.styles[line]) obj.styles[line] = {}
      const existing = obj.styles[line][col] && typeof obj.styles[line][col] === "object"
        ? obj.styles[line][col]
        : {}
      if (deltaY === 0) delete existing.deltaY
      else existing.deltaY = deltaY
      obj.styles[line][col] = existing
    }
    obj.__dsLinked = false
    if (obj._forceClearCache !== undefined) obj._forceClearCache = true
    obj.setCoords()
    obj.dirty = true
    fc.requestRenderAll()
    doSave()
  }

  function changeZoom(delta: number) {
    const fc = fabricRef.current; if (!fc) return
    applyZoom(fc, Math.min(16, Math.max(0.05, zoomRef.current + delta)))
  }

  /**
   * Centraliza a peca no viewport com zoom fit — mesma logica do init: reserva
   * HANDLE_MARGIN ao redor da peca pros handles aparecerem mesmo em objetos
   * que extrapolam o artboard. applyZoom recalcula offset + overlays. Util
   * quando o user faz pan/zoom e quer voltar ao estado inicial.
   *
   * Atalho: Shift+1 (estilo Figma) ou clica em "Centralizar" na barra.
   */
  function centerView() {
    const fc = fabricRef.current; if (!fc) return
    const fullW = (fabricRef as any).__canvasFullW ?? fc.getWidth()
    const fullH = (fabricRef as any).__canvasFullH ?? fc.getHeight()
    const cw = canvasWRef.current
    const ch = canvasHRef.current
    const HANDLE_MARGIN = 120
    const z = Math.round(Math.min(0.8,
      Math.max(0.05, (fullW - HANDLE_MARGIN * 2) / cw),
      Math.max(0.05, (fullH - HANDLE_MARGIN * 2) / ch),
    ) * 100) / 100
    applyZoom(fc, z)
  }

  /**
   * Alinha o objeto selecionado ao centro da PECA (artboard), tanto horizontal
   * quanto verticalmente. Usa aCoords pra bbox real (respeita scale + rotacao);
   * fallback pra left/top/width/height quando aCoords nao disponivel.
   *
   * Importante: aqui "centro do canvas" eh o CENTRO DA PECA (coords do mundo
   * Fabric: cw/2, ch/2), nao o centro do canvas DOM. Sem isso, com zoom/pan
   * arbitrarios, o objeto cairia em pixels que nao tem nada a ver com a peca.
   *
   * Suporta ActiveSelection: move todo o grupo preservando spacing relativo.
   */
  /**
   * Encaixa o objeto selecionado no canvas — escala pra que ele ocupe o
   * canvas inteiro preservando aspect ratio + posiciona no centro.
   * User pediu 2026-05-27: 'botoes de fit e center no properties'.
   */
  function fitSelectedToCanvas() {
    const fc = fabricRef.current; if (!fc) return
    const active = fc.getActiveObject() as any
    if (!active) return
    if (active.__isBg || active.__isBleedOverlay) return
    const cw = canvasWRef.current
    const ch = canvasHRef.current
    // dims intrinsecos do obj (sem scale)
    const ow = active.width ?? 100
    const oh = active.height ?? 100
    if (ow <= 0 || oh <= 0) return
    const scale = Math.min(cw / ow, ch / oh)
    active.set({ scaleX: scale, scaleY: scale })
    active.setCoords()
    // Recentra apos scale
    const newW = ow * scale
    const newH = oh * scale
    active.set({ left: (cw - newW) / 2, top: (ch - newH) / 2 })
    active.setCoords()
    fc.fire("object:modified", { target: active })
    fc.requestRenderAll?.()
  }

  // Wrapper pro botao 'Centralizar' do properties — mesma logica do
  // shortcut Cmd+Shift+C que ja existia (centerObjectInCanvas).
  function centerSelectedOnCanvas() {
    centerObjectInCanvas("both")
  }

  // axis: "x" centraliza so horizontalmente (eixo X), "y" so vertical, "both"
  // ambos. User pediu 2026-05-29 separados ("cade o center da imagem") porque
  // Photoshop/Illustrator alinha so um eixo de cada vez. Cmd+Shift+C continua
  // disparando "both" pra preservar habito antigo.
  function centerObjectInCanvas(axis: "x" | "y" | "both" = "both") {
    const fc = fabricRef.current; if (!fc) return
    const active = fc.getActiveObject() as any
    if (!active) return
    if ((active as any).__isBg || (active as any).__isBleedOverlay) return
    const cw = canvasWRef.current
    const ch = canvasHRef.current
    // Pega bbox em coords do mundo
    let bx: number, by: number, bw: number, bh: number
    if (active.aCoords) {
      const br = active.aCoords
      const xs = [br.tl.x, br.tr.x, br.bl.x, br.br.x]
      const ys = [br.tl.y, br.tr.y, br.bl.y, br.br.y]
      bx = Math.min(...xs); by = Math.min(...ys)
      bw = Math.max(...xs) - bx; bh = Math.max(...ys) - by
    } else {
      bx = active.left ?? 0
      by = active.top ?? 0
      bw = (active.width ?? 100) * (active.scaleX ?? 1)
      bh = (active.height ?? 100) * (active.scaleY ?? 1)
    }
    // Delta pra centralizar bbox no centro da peca (so eixo pedido)
    const dx = axis === "y" ? 0 : (cw - bw) / 2 - bx
    const dy = axis === "x" ? 0 : (ch - bh) / 2 - by
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
    active.set({
      left: (active.left ?? 0) + dx,
      top: (active.top ?? 0) + dy,
    })
    active.setCoords()
    fc.fire("object:modified", { target: active })
    fc.requestRenderAll?.()
  }

  /**
   * Zoom-to-selection (estilo Figma Shift+2): ajusta zoom e pan pra que o
   * objeto ativo (ou ActiveSelection) preencha o viewport com margem. Se nada
   * estiver selecionado, faz o mesmo que centerView (fit da peca).
   *
   * Atalho: Shift+2.
   */
  function zoomToSelection() {
    const fc = fabricRef.current; if (!fc) return
    const active = fc.getActiveObject() as any
    if (!active) { centerView(); return }
    // bbox em coords do mundo
    const br = active.aCoords ?? null
    let minX: number, minY: number, maxX: number, maxY: number
    if (br) {
      minX = Math.min(br.tl.x, br.tr.x, br.bl.x, br.br.x)
      maxX = Math.max(br.tl.x, br.tr.x, br.bl.x, br.br.x)
      minY = Math.min(br.tl.y, br.tr.y, br.bl.y, br.br.y)
      maxY = Math.max(br.tl.y, br.tr.y, br.bl.y, br.br.y)
    } else {
      const l = active.left ?? 0, t = active.top ?? 0
      const w = (active.width ?? 100) * (active.scaleX ?? 1)
      const h = (active.height ?? 100) * (active.scaleY ?? 1)
      minX = l; minY = t; maxX = l + w; maxY = t + h
    }
    const bw = Math.max(1, maxX - minX)
    const bh = Math.max(1, maxY - minY)
    const fullW = (fabricRef as any).__canvasFullW ?? fc.getWidth()
    const fullH = (fabricRef as any).__canvasFullH ?? fc.getHeight()
    // Margem maior pro objeto nao encostar nas bordas
    const PAD = 160
    const z = Math.round(Math.min(16,
      Math.max(0.05, (fullW - PAD * 2) / bw),
      Math.max(0.05, (fullH - PAD * 2) / bh),
    ) * 100) / 100
    // Aplica zoom (recria overlays + setViewportTransform). Depois ajusta vt
    // pra centralizar o objeto especifico no canvas DOM.
    applyZoom(fc, z)
    const vt = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    vt[4] = fullW / 2 - cx * z
    vt[5] = fullH / 2 - cy * z
    fc.setViewportTransform(vt)
    fc.requestRenderAll?.()
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

    // Flush de qualquer save pendente antes de trocar — garante que overrides atuais estão no banco
    clearTimeout(saveTimer.current)

    // MODELO FINAL: cada asset tem seu lastOverride (template visual). Ao swap,
    // o novo asset vem com SEU lastOverride — nao herda os styles do asset
    // anterior. Isso permite swap de ida e volta entre ABC (amarelo) e DEF (azul).
    // Se o novo asset nunca foi configurado, vem default.
    //
    // IMPORTANTE: lastOverride guarda os valores da MATRIZ (ex: fontSize 80). Se
    // estamos numa PECA menor (ex: fontSize 40 = matriz_80 * 0.5), aplicar
    // lastOverride direto cresceria o texto. Calcular a proporcao atual da peca
    // a partir do currentObj e aplicar no newOverrides.
    const newAssetOverridesRaw: any = (newAsset.lastOverride && typeof newAsset.lastOverride === "object")
      ? { ...newAsset.lastOverride }
      : {}
    const newAssetOverrides: any = { ...newAssetOverridesRaw }

    // Descobre a proporcao atual: currentObj.fontSize / currentAsset.lastOverride.fontSize.
    // Se currentAsset tem lastOverride com fontSize, isso da a escala usada pra renderizar.
    // Aplicamos a mesma escala no fontSize do novo asset (se ele tem lastOverride.fontSize).
    if (pieceId) {
      const c = campaignRef.current
      const currentAsset = c?.assets.find((a: Asset) => a.id === currentObj.__assetId)
      const curTplFontSize = (currentAsset as any)?.lastOverride?.fontSize
      const curObjFontSize = currentObj.fontSize
      if (typeof curTplFontSize === "number" && curTplFontSize > 0 && typeof curObjFontSize === "number") {
        const ratio = curObjFontSize / curTplFontSize
        if (typeof newAssetOverrides.fontSize === "number") {
          newAssetOverrides.fontSize = newAssetOverrides.fontSize * ratio
        }
        if (typeof newAssetOverrides.leadingPt === "number") {
          newAssetOverrides.leadingPt = newAssetOverrides.leadingPt * ratio
        }
        if (newAssetOverrides.styles && typeof newAssetOverrides.styles === "object") {
          const scaledStyles: any = {}
          for (const lineKey of Object.keys(newAssetOverrides.styles)) {
            scaledStyles[lineKey] = {}
            for (const colKey of Object.keys(newAssetOverrides.styles[lineKey])) {
              const cs = { ...newAssetOverrides.styles[lineKey][colKey] }
              if (typeof cs.fontSize === "number") cs.fontSize = cs.fontSize * ratio
              scaledStyles[lineKey][colKey] = cs
            }
          }
          newAssetOverrides.styles = scaledStyles
        }
      }
    }

    // Box (width/height) do novo asset: usa lastOverride.width/height se existir,
    // escalado pela proporcao atual da peca. Senao mantem o width/height do textbox
    // atual (current). Modelo: cada asset texto tem sua propria caixa.
    let swapWidth = currentObj.width ?? 400
    let swapHeight = currentObj.height ?? 100
    if (pieceId) {
      const cAssets = campaignRef.current?.assets ?? []
      const curAsset = cAssets.find((a: Asset) => a.id === currentObj.__assetId)
      const curTplW = (curAsset as any)?.lastOverride?.width
      const curObjW = currentObj.width
      // ratio baseado em width (BOX): peca_w / matriz_w. Aplica em newAsset.lastOverride.width.
      const wRatio = (typeof curTplW === "number" && curTplW > 0 && typeof curObjW === "number")
        ? curObjW / curTplW : null
      const newTplW = (newAsset.lastOverride as any)?.width
      const newTplH = (newAsset.lastOverride as any)?.height
      if (typeof newTplW === "number" && wRatio !== null) swapWidth = newTplW * wRatio
      if (typeof newTplH === "number" && wRatio !== null) swapHeight = newTplH * wRatio
    } else {
      // Matriz: usa direto o lastOverride.width/height do novo asset (se existir)
      const newTplW = (newAsset.lastOverride as any)?.width
      const newTplH = (newAsset.lastOverride as any)?.height
      if (typeof newTplW === "number") swapWidth = newTplW
      if (typeof newTplH === "number") swapHeight = newTplH
    }

    // Captura BBOX EXATO do current antes de qualquer mudanca. User pediu
    // 2026-05-26: "quando troco a imagem ela perde a posicao do layer e as
    // mascara. preciso que so mude a imagem e que se mantenha na mesma
    // mascara, e nao indo para o topo do layer".
    //
    // Estrategia: novo asset HERDA exatamente bbox + posicao + angulo + z-order
    // + mask do current. Pra IMAGE, scale calculado pra que o naturalW/H da
    // imagem nova ocupe o MESMO bbox visual (pode esticar se aspect ratio
    // diferente — usuario quer isso pra encaixar na mesma mascara).
    const capturedBboxW = (currentObj.width ?? 100) * (currentObj.scaleX ?? 1)
    const capturedBboxH = (currentObj.height ?? 100) * (currentObj.scaleY ?? 1)
    const capturedLeft = currentObj.left ?? 0
    const capturedTop = currentObj.top ?? 0
    const capturedAngle = currentObj.angle ?? 0
    // Z-order: indice atual do objeto no canvas. Sem isso, addAssetToCanvas
    // adiciona no topo (fim do array = renderizado por ULTIMO).
    const oldZIndex = fc.getObjects().indexOf(currentObj)
    // Preserva mascara antes de remover (move pra o novo objeto).
    const preservedMask = (currentObj as any).__maskData
    const preservedMaskAnchor = (currentObj as any).__maskAnchor

    // Pra IMAGE/SO: pre-carrega imagem nova pra descobrir naturalW/H, depois
    // calcula scale COVER (preenche bbox completamente sem deformar, excesso
    // cortado pela mascara/bbox visual). User pediu 2026-05-26: "nao quero
    // que deforme nao, quero fit". Cover = aspect ratio preservado + bbox
    // completo + centrado.
    let imageLayerOverride: { posX: number; posY: number; scaleX: number; scaleY: number } | null = null
    if ((newAsset.type === "IMAGE" || newAsset.type === "SMART_OBJECT") && newAsset.imageUrl) {
      try {
        const naturalDims = await new Promise<{ w: number; h: number } | null>((resolve) => {
          const el = new window.Image()
          el.crossOrigin = "anonymous"
          el.onload = () => resolve({ w: el.naturalWidth || el.width || 1, h: el.naturalHeight || el.height || 1 })
          el.onerror = () => resolve(null)
          el.src = newAsset.imageUrl!
        })
        if (naturalDims) {
          // COVER scale: o MAIOR ratio garante que ambos os eixos preenchem.
          // O eixo sobrante "vaza" — recortado pela mascara que vem do current
          // ou simplesmente excede o bbox.
          const scale = Math.max(capturedBboxW / naturalDims.w, capturedBboxH / naturalDims.h)
          const scaledW = naturalDims.w * scale
          const scaledH = naturalDims.h * scale
          // Centra dentro do bbox antigo. Em IMAGE Fabric, left/top eh o
          // top-left do objeto sem transform — pra centrar, recua metade do
          // excesso.
          imageLayerOverride = {
            posX: capturedLeft - (scaledW - capturedBboxW) / 2,
            posY: capturedTop - (scaledH - capturedBboxH) / 2,
            scaleX: scale,
            scaleY: scale,
          }
        }
      } catch (e) { editorLog("[swapAsset] preload image falhou:", e) }
    }

    const layerSpec = imageLayerOverride ? {
      posX: imageLayerOverride.posX,
      posY: imageLayerOverride.posY,
      scaleX: imageLayerOverride.scaleX,
      scaleY: imageLayerOverride.scaleY,
      rotation: capturedAngle,
      overrides: newAssetOverrides,
    } : {
      // TEXT ou IMAGE com preload falhado: mantem transform exato do current.
      posX: capturedLeft,
      posY: capturedTop,
      width: swapWidth,
      height: swapHeight,
      scaleX: currentObj.scaleX ?? 1,
      scaleY: currentObj.scaleY ?? 1,
      rotation: capturedAngle,
      overrides: newAssetOverrides,
    }

    // Remove o atual e adiciona o novo asset com mesmo transform.
    const beforeIds = new Set(fc.getObjects())
    fc.remove(currentObj)
    await addAssetToCanvas(fc, newAsset, layerSpec)
    const newObj = fc.getObjects().find((o: any) => !beforeIds.has(o))

    if (newObj) {
      // PRESERVA Z-ORDER — addAssetToCanvas adiciona no fim do array (topo
      // visual). Move pro mesmo indice que o currentObj tinha antes.
      // Fabric v6.9.1 expoe moveObjectTo(obj, idx) — nao moveTo (esse so
      // existe em v7+ que nao usamos aqui). Outros sites do editor ja usam
      // moveObjectTo (line 5522, 5754, 5860).
      if (oldZIndex >= 0) {
        const currentNewIdx = fc.getObjects().indexOf(newObj)
        if (currentNewIdx !== oldZIndex) {
          try {
            ;(fc as any).moveObjectTo(newObj, oldZIndex)
          } catch (e) { editorLog("[swapAsset] moveObjectTo falhou:", e) }
        }
      }

      // PRESERVA MASCARA — mask segue o LAYER (posicao no canvas), nao o
      // asset. Re-aplica no novo obj. preservedMaskAnchor importante pra
      // tracking de drag (object:modified atualiza __maskData.raster.posX/Y
      // baseado no delta com anchor).
      if (preservedMask) {
        ;(newObj as any).__maskData = preservedMask
        if (preservedMaskAnchor) (newObj as any).__maskAnchor = preservedMaskAnchor
        const { Image: FabImage, Path } = await import("fabric")
        ;(newObj as any).clipPath = null
        await applyMaskToFabricObject({ Image: FabImage, Path }, newObj, preservedMask)
      }
    }

    fc.requestRenderAll()
    if (newObj) {
      fc.setActiveObject(newObj)
      fc.fire("object:modified", { target: newObj })
    }
  }

  if (!campaign) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#1a1a1a", color: "#888", fontSize: 14 }}>
      Loading...
    </div>
  )

  // GUARD ANTIGO REMOVIDO 2026-05-30: editor agora abre mesmo com 0 assets
  // — toolbar bottom-center (T placement + shapes) cria asset inline, dialog
  // "+ Criar novo asset" tambem. Forcar empty state aqui contradizia o flow
  // do botao "+ Novo KV" da campaign overview (que cria KV vazio e abre o
  // editor). User reportou: "cliquei em novo KV e cai aqui, que vergonha ne?".

  const isText = selected && (selected.type === "textbox" || selected.type === "i-text")
  const pS = { position: "fixed" as const, top: 0, bottom: 0, background: "rgba(18,18,18,0.97)", backdropFilter: "blur(12px)", zIndex: 100, display: "flex", flexDirection: "column" as const, overflowY: "auto" as const }
  // Estilo dos botoes da monitor toolbar — padronizado com os botoes da
  // esquerda (Steps nav) pra consistencia visual (user pedido 2026-05-23).
  const bS = { background: "transparent", border: "1px solid #444", borderRadius: 4, cursor: "pointer", color: "#aaa", fontSize: 11, fontWeight: 600, padding: "3px 10px", lineHeight: 1, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center" } as React.CSSProperties
  // inpS/secS/numInpS/numFieldGrid: fonte unica de verdade em lib/editorFieldStyles.ts.
  // Mudar dimensoes/cores ali = propaga pro editor inteiro. Anti-padrao
  // duplicacao no editor eliminado (user pediu 2026-05-22).

  return (
    <div ref={wrapperRef} style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden" }}>
      {/* CSS keyframes pra pulse de destaque do row selecionado no painel
          Layers. Usa CSS variable --zzosy-accent setada no row pra refletir
          a cor da marca atual. 3 batidas em 1.2s, depois descansa. */}
      <style>{`
        @keyframes zzosy-layer-pulse {
          0%   { box-shadow: 0 0 0 2px transparent; background: transparent; }
          15%  { box-shadow: 0 0 20px 4px var(--zzosy-accent-strong), inset 0 0 0 2px var(--zzosy-accent); background: var(--zzosy-accent-soft); }
          35%  { box-shadow: 0 0 8px 1px var(--zzosy-accent-soft); background: var(--zzosy-accent-faint); }
          55%  { box-shadow: 0 0 20px 4px var(--zzosy-accent-strong), inset 0 0 0 2px var(--zzosy-accent); background: var(--zzosy-accent-soft); }
          75%  { box-shadow: 0 0 8px 1px var(--zzosy-accent-soft); background: var(--zzosy-accent-faint); }
          100% { box-shadow: 0 0 0 2px transparent; background: var(--zzosy-accent-faint); }
        }
        /* Folder pulse contínuo: indica que selecao esta dentro do folder.
           User pediu 2026-05-23: "se estiver dentro de folder, deixar
           piscando no folder". Loop infinito sutil. */
        @keyframes zzosy-folder-pulse {
          0%   { background: var(--zzosy-accent-faint); }
          50%  { background: var(--zzosy-accent-soft); }
          100% { background: var(--zzosy-accent-faint); }
        }
      `}</style>
      <div style={{
        position: "absolute",
        left: effLayersPanelWidth, top: TH + BH, right: effPropsPanelWidth, bottom: 0,
        overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ lineHeight: 0, flexShrink: 0, cursor: placingText ? "crosshair" : undefined }}>
          <canvas ref={canvasRef} style={{ display: "block", cursor: placingText ? "crosshair" : undefined }} />
        </div>
        {/* Toolbar shapes Figma-style (user pedido 2026-05-30): floating
            bottom-center DENTRO do editor. Click cria SHAPE asset + adiciona
            ao canvas direto (sem reload). T (texto) entra em modo place:
            proximo click no canvas cria textbox + entra em edicao + ao sair
            vira ClientLibraryAsset type=TEXT. */}
        <div style={{
          position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)",
          zIndex: 100, display: "flex", gap: 4,
          background: "rgba(26,26,26,0.95)", border: "1px solid #2a2a2a",
          borderRadius: 10, padding: 6,
          boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
        }}>
          {/* T — modo "place text" */}
          <button
            type="button"
            title={placingText ? "Modo place-text ativo — clique no canvas pra inserir" : "Adicionar Texto (click no canvas pra posicionar)"}
            onClick={() => setPlacingText(v => !v)}
            style={{
              width: 36, height: 36, padding: 0,
              background: placingText ? "#F5C400" : "transparent",
              border: "1px solid " + (placingText ? "#F5C400" : "transparent"),
              borderRadius: 6, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.12s, border-color 0.12s",
            }}
            onMouseEnter={e => { if (!placingText) { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.borderColor = "#3a3a3a" } }}
            onMouseLeave={e => { if (!placingText) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent" } }}
          >
            <span style={{ fontSize: 20, fontWeight: 800, color: placingText ? "#111" : "#aaa", fontFamily: "Georgia, serif", lineHeight: 1 }}>T</span>
          </button>
          {/* Separador */}
          <div style={{ width: 1, background: "#3a3a3a", margin: "4px 2px" }} />
          {[
            { kind: "rectangle" as const, label: "Retangulo", icon: <rect x="3" y="5" width="18" height="14" fill="#aaa"/> },
            { kind: "roundedRect" as const, label: "Retangulo Arredondado", icon: <rect x="3" y="5" width="18" height="14" rx="3" fill="#aaa"/> },
            { kind: "ellipse" as const, label: "Elipse", icon: <ellipse cx="12" cy="12" rx="9" ry="7" fill="#aaa"/> },
          ].map(s => (
            <button
              key={s.kind}
              type="button"
              title={`Adicionar ${s.label}`}
              onClick={async () => {
                const { buildShapePath } = await import("@/lib/shapePaths")
                const W = 400, H = 300
                const cornerRadius = s.kind === "roundedRect" ? 20 : undefined
                const path = buildShapePath(s.kind, W, H, cornerRadius)
                const shape: any = {
                  kind: s.kind, path,
                  pathBbox: { left: 0, top: 0, right: W, bottom: H },
                  fill: { kind: "solid", color: "#4d4d4f" },
                  stroke: null, fillRule: "nonzero",
                }
                if (cornerRadius !== undefined) shape.cornerRadius = cornerRadius
                const res = await fetch(`/api/campaigns/${campaignId}/assets`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ type: "SHAPE", label: s.label, content: shape }),
                })
                if (!res.ok) { alert("Falha ao criar shape"); return }
                const newAsset = await res.json()
                // Atualiza state + ref pro addLayer encontrar o asset novo
                setCampaign(c => {
                  if (!c) return c
                  const updated = { ...c, assets: [...(c.assets ?? []), newAsset] }
                  campaignRef.current = updated as any
                  return updated as any
                })
                assetIdRef.current = newAsset.id
                setAssetId(newAsset.id)
                // Aguarda micro-tarefa pro state propagar antes do addLayer
                await new Promise(r => setTimeout(r, 30))
                await addLayer()
              }}
              style={{
                width: 36, height: 36, padding: 0,
                background: "transparent", border: "1px solid transparent", borderRadius: 6,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.12s, border-color 0.12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.borderColor = "#3a3a3a" }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent" }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                {s.icon}
              </svg>
            </button>
          ))}
        </div>
      </div>

      <div style={{ position: "fixed", top: 0, left: 0, right: 0, minHeight: TH, background: "rgba(17,17,17,0.98)", borderBottom: "1px solid #2a2a2a", display: "flex", flexWrap: "wrap", alignItems: "center", padding: "6px 16px", gap: 12, zIndex: 200 }}>
        <button onClick={async () => {
          const hash = from === "presentation" && isPieceMode && pieceId ? `#piece-${pieceId}` : ""
          const base = from === "presentation"
            ? `/campaigns/${campaignId}/presentation`
            : `/campaigns/${campaignId}`
          const dest = `${base}${hash}`
          // FORCA exit do modo edit de texto. Se o user estava editando um
          // texto inline e clicou Voltar sem clicar fora, text:editing:exited
          // nao dispara naturalmente. Sem isso, a edicao do texto eh perdida.
          try {
            const fc: any = fabricRef.current
            const active = fc?.getActiveObject?.()
            if (active && (active.isEditing || (active as any).isEditing)) {
              if (typeof (active as any).exitEditing === "function") (active as any).exitEditing()
            }
          } catch (e) { /* nao critico */ }
          // Pequeno delay pra o text:editing:exited handler rodar e setar dirty.
          await new Promise(r => setTimeout(r, 50))
          srvLog("Voltar-CLICKED", { isDirty: isDirtyRef.current, dest, savingInFlight: savingInFlightRef.current })
          const navigate = () => {
            srvLog("Voltar-NAVIGATING", { dest })
            // HARD navigation: window.location forca full reload, ignora cache
            // do App Router. Garante que a pagina destino re-monta com dados
            // frescos do servidor.
            if (typeof window !== "undefined") window.location.href = dest
          }
          // Pergunta SOMENTE quando ha mudancas pendentes. Se tudo salvo,
          // navega direto — perguntar "deseja sair" sem razao real era
          // interrupcao desnecessaria (user clicou em Voltar => quer voltar).
          // 2026-05-30: defensive flush. User reportou "KV nao salva ao fechar
          // o editor". Mesmo com isDirty=false, dispara saveNow pra garantir
          // que qualquer modificacao recente que nao virou dirty (race em
          // doSave debounceado, T placement async) seja persistida. saveNow
          // tem guards (init nao terminou, applying history) entao eh seguro.
          if (isDirtyRef.current) {
            setConfirmExit(() => navigate)
          } else {
            try { await saveNow() } catch (e) { console.warn("[Voltar] saveNow falhou:", e) }
            navigate()
          }
        }} style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "6px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#111" }}
          title={from === "presentation" ? "Back to presentation" : "Back to campaign"}>
          {from === "presentation" ? "← Back to presentation" : "← Back to campaign"}
        </button>
        {/* Nome + indicador "Salvo"/"Não salvo" removidos da topbar a pedido
            do user (2026-05-22) — info redundante; estado salvo continua
            refletido pelo proprio botao Salvar (disabled quando nada mudou). */}
        {/* Botao SALVAR manual. Editor nao salva mais automatico — user precisa
            clicar pra persistir. Disabled quando nada mudou OU ja esta salvando. */}
        <button
          onClick={() => { performSave() }}
          disabled={!isDirty || saving}
          title={!isDirty ? "Nothing to save" : saving ? "Please wait…" : "Save changes"}
          style={{
            background: (!isDirty || saving) ? "#1a1a1a" : "#F5C400",
            border: (!isDirty || saving) ? "1px solid #333" : "none",
            borderRadius: 6, padding: "6px 14px", marginLeft: 8,
            fontWeight: 700, fontSize: 13,
            cursor: (!isDirty || saving) ? "not-allowed" : "pointer",
            color: (!isDirty || saving) ? "#666" : "#111",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {/* Nome da peca ao lado do Save (user pediu 2026-05-26). Pra matriz,
            mostra "Matriz · <nome campanha>". Pra peca, "<nome peca>".
            Subtilo — peso normal, color suave, sem competir com o CTA. */}
        <div style={{
          marginLeft: 12,
          fontSize: 13, fontWeight: 500,
          color: "#bbb",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 320,
        }} title={isPieceMode ? (piece?.name ?? "") : (campaign?.name ? `Matriz · ${campaign.name}` : "Matriz")}>
          {isPieceMode ? (piece?.name ?? "") : (campaign?.name ? `Matriz · ${campaign.name}` : "Matriz")}
        </div>
        {/* Apresentacao movida pro fim (depois de Gerar Pecas) — botao amarelo
            destaque na extremidade direita da topbar (2026-05-22). */}
        {/* Steps nav movido pra monitor toolbar (2026-05-23). */}
        {isPieceMode && (
          <input
            ref={psdStepInputRef}
            type="file"
            accept=".psd,application/octet-stream,image/vnd.adobe.photoshop"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.currentTarget.value = ""
              if (!f) return
              if (!window.confirm(`Replace the content of Step ${activeStepIndex + 1} with the layers of "${f.name}"? The current content of this step will be discarded.`)) return
              await replaceStepFromPsd(f)
            }}
          />
        )}
        <div style={{ flex: 1 }} />
        {/* Resolução {canvasW} × {canvasH} removida a pedido do user (2026-05-22) —
            info ruidosa na topbar. Undo/Redo botoes tambem removidos (atalhos
            Cmd+Z / Cmd+Shift+Z continuam funcionando). */}
        {/* Botao Importar PSD movido pra coluna esquerda (abaixo de ASSETS)
            2026-05-28. Topbar fica reservada SO pra navegacao (regra 1.2.0).
            O <input> off-screen continua aqui pq psdImportInputRef.current
            .click() funciona independente de onde o input mora no DOM. */}
        <input
          ref={psdImportInputRef}
          type="file"
          accept=".psd"
          // display:none NAO usado — Chrome+Next 16 bloqueia .click() em
          // <input display:none> (comentario antigo de 2026-05-24 confirma).
          // Off-screen com opacity:0 + tabIndex:-1 funciona em todos os browsers.
          style={{ position: "absolute", left: -9999, top: -9999, width: 0, height: 0, opacity: 0 }}
          tabIndex={-1}
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (!f) return
            if (psdImporterRef.current?.isLoading()) return
            const doImport = async () => {
              try { await psdImporterRef.current?.importFile(f) }
              catch (err) { console.error("[Importar PSD] falhou:", err) }
            }
            if (isDirtyRef.current) setConfirmExit(() => doImport)
            else doImport()
          }}
        />
        {/* Botao Assets movido pro topo do Properties Panel (2026-05-22)
            pra reduzir poluicao visual da topbar. */}
        {isPieceMode && pieceId && (
          <button onClick={() => {
            const go = () => router.push(`/pieces/${pieceId}`)
            // Pergunta SO se tem mudancas pendentes.
            if (isDirtyRef.current) setConfirmExit(() => go)
            else go()
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(245,196,0,0.15)"; (e.currentTarget as HTMLButtonElement).style.color = "#F5C400" }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#bbb" }}
            style={{ background: "transparent", border: "1px solid #F5C400", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", color: "#bbb", display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}
            title="Open piece details page (captions, status, segment, name)">
            <span style={{ fontSize: 14 }}>📋</span>
            Piece details
          </button>
        )}
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
              if (!fc) { alert("Canvas unavailable"); return }
              const W = canvasWRef.current
              const H = canvasHRef.current
              const layers = fc.getObjects()
                .filter((o: any) => !o.__isBg && o.__assetId)
                .map((o: any, i: number) => {
                  const isText = o.type === "textbox" || o.type === "i-text"
                  const isShape = (o as any).__isShape === true || o.type === "path" || o.type === "Path"
                  // KV export usa helpers centralizados — text + shape capturam tudo
                  // num lugar so. SHAPE branch ANTES caia no else vazio → fill/stroke
                  // editados na matriz nao iam pro pseudoData → export usava cor
                  // ORIGINAL do asset.content (regressao 2026-05-22 reportada pelo
                  // user). preserveExplicit NewlinesOnly: false porque KV export
                  // precisa do texto live completo.
                  const overrides: any = isText
                    ? serializeTextboxOverrides(o, { preserveExplicitNewlinesOnly: false })
                    : isShape
                      ? serializeShapeOverrides(o)
                      : {}
                  // Propriedades de round-trip PSD (blendMode/opacity/effects/mask/
                  // groupPath/hidden/locked) precisam vir DO OBJETO FABRIC pro
                  // pseudoData do export. Sem isso, o export do KV gerava PSD
                  // com tudo no default ("normal", opacity 1, sem effects, sem
                  // folders) — perdia mudancas que o user fez no editor.
                  const blendMode = (typeof o.globalCompositeOperation === "string"
                    && o.globalCompositeOperation
                    && o.globalCompositeOperation !== "source-over")
                    ? o.globalCompositeOperation : undefined
                  const opacity = (typeof o.opacity === "number" && o.opacity < 1) ? o.opacity : undefined
                  const psdEffects = ((o as any).__psdEffects && typeof (o as any).__psdEffects === "object")
                    ? (o as any).__psdEffects : undefined
                  const maskData = ((o as any).__maskData && typeof (o as any).__maskData === "object")
                    ? (o as any).__maskData : undefined
                  const groupPath = Array.isArray((o as any).__groupPath) && (o as any).__groupPath.length > 0
                    ? (o as any).__groupPath : undefined
                  const hidden = (o as any).__hidden === true ? true : undefined
                  const locked = (o as any).__locked === true ? true : undefined
                  return {
                    assetId: o.__assetId,
                    posX: Math.round(o.left ?? 0),
                    posY: Math.round(o.top ?? 0),
                    scaleX: o.scaleX ?? 1,
                    scaleY: o.scaleY ?? 1,
                    ...(o.skewX ? { skewX: o.skewX } : {}),
                    ...(o.skewY ? { skewY: o.skewY } : {}),
                    rotation: o.angle ?? 0,
                    zIndex: i,
                    width: Math.round(o.width ?? 400),
                    height: Math.round(o.height ?? 100),
                    overrides,
                    ...(blendMode ? { blendMode } : {}),
                    ...(opacity !== undefined ? { opacity } : {}),
                    ...(psdEffects ? { effects: psdEffects } : {}),
                    ...(maskData ? { mask: maskData } : {}),
                    ...(groupPath ? { groupPath } : {}),
                    ...(hidden ? { hidden } : {}),
                    ...(locked ? { locked } : {}),
                  }
                })
              const pseudoData = {
                version: 2,
                width: W, height: H,
                bgColor: bgLayerLegacyColor(bgLayersRef.current[0]),
                bgOpacity: bgLayersRef.current[0]?.opacity ?? 1,
                bgLayers: bgLayersRef.current,
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
              alert("Failed to prepare Key Vision export")
            }
          }}
          style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "6px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", color: "#aaa" }}
          title={isPieceMode ? "Export this piece" : "Export Key Vision (matrix)"}
        >
          Export
        </button>
        {!isPieceMode && (
          <button onClick={() => setModal(true)} style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "6px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#111" }}>Generate Pieces</button>
        )}
        {/* Apresentacao — extremidade direita da topbar. Estilo amarelo igual
            Gerar Pecas pra destaque visual da acao principal (ver resultado). */}
        {campaignId && (
          <button
            onClick={() => {
              const navigate = () => {
                if (typeof window !== "undefined") window.location.href = `/campaigns/${campaignId}/presentation`
              }
              if (isDirtyRef.current) setConfirmExit(() => navigate)
              else navigate()
            }}
            title="Go directly to this campaign's presentation"
            style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "6px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#111", marginLeft: "auto" }}
          >
            Presentation
          </button>
        )}
        {/* Undo/Redo botoes removidos da topbar (2026-05-22) — atalhos
            Cmd+Z / Cmd+Shift+Z continuam funcionando. */}
      </div>

      {/* MONITOR TOOLBAR — so botoes relacionados ao canvas/zoom (user pedido
          2026-05-23: "central, so botoes relacionados ao monitor"). O Asset
          picker + "+ Add to canvas" vive no topo do painel Layers (esquerda)
          ao lado do botao ASSETS. */}
      <div style={{ position: "fixed", top: TH, left: effLayersPanelWidth, right: effPropsPanelWidth, minHeight: BH, background: "rgba(26,26,26,0.98)", borderBottom: "1px solid #2a2a2a", display: "flex", flexWrap: "wrap", alignItems: "center", padding: "6px 16px", gap: 8, zIndex: 200 }}>
        {/* STEPS NAVIGATION movido pra ca (user pedido 2026-05-23) — eh
            relacionado ao monitor/canvas, nao navegacao principal. */}
        {isPieceMode && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: "#0d0d0d", borderRadius: 6, border: "1px solid #2a2a2a" }}>
            {stepCount > 1 && (
              <>
                <button
                  onClick={() => switchToStep(activeStepIndex - 1)}
                  disabled={activeStepIndex === 0}
                  title="Previous step"
                  style={{ background: "transparent", border: "none", color: activeStepIndex === 0 ? "#333" : "#aaa", cursor: activeStepIndex === 0 ? "not-allowed" : "pointer", fontSize: 12, padding: "2px 6px", lineHeight: 1 }}
                >Previous</button>
                {/* Step X of Y — destaque pra info crítica (user pediu
                    2026-05-23: "destava Step 2, eh muito importante essa info").
                    Pill amarelo + texto bold. */}
                <span style={{
                  fontSize: 12, color: "#F5C400", fontWeight: 800,
                  background: "rgba(245,196,0,0.12)",
                  border: "1px solid rgba(245,196,0,0.4)",
                  borderRadius: 4,
                  padding: "3px 10px",
                  minWidth: 84, textAlign: "center",
                  letterSpacing: "0.3px",
                }}>
                  Step {activeStepIndex + 1} of {stepCount}
                </span>
                <button
                  onClick={() => switchToStep(activeStepIndex + 1)}
                  disabled={activeStepIndex >= stepCount - 1}
                  title="Next step"
                  style={{ background: "transparent", border: "none", color: activeStepIndex >= stepCount - 1 ? "#333" : "#aaa", cursor: activeStepIndex >= stepCount - 1 ? "not-allowed" : "pointer", fontSize: 12, padding: "2px 6px", lineHeight: 1 }}
                >Next</button>
                <div style={{ width: 1, height: 16, background: "#333", margin: "0 2px" }} />
              </>
            )}
            {/* Add/Remove step PAREADOS (user pedido 2026-05-23: "remove step
                deveria estar do lado de step"). Sao acoes opostas — agrupar
                fica mais intuitivo. PSD/External edit ficam depois. */}
            <button onClick={addStep} title="Add new step"
              style={{ background: "transparent", border: "1px solid #444", borderRadius: 4, color: "#F5C400", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 8px" }}
            >+ Step</button>
            {stepCount > 1 && (
              <button onClick={(e) => removeStep(activeStepIndex, e.altKey)} title="Remove step (Option+click skips confirm)"
                style={{ background: "transparent", border: "1px solid #553333", borderRadius: 4, color: "#f87171", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 8px" }}
              >Remove step</button>
            )}
            <div style={{ width: 1, height: 16, background: "#333", margin: "0 4px" }} />
            {/* PSD: overlay pattern (input absolute opacity:0). Antes era
                ref.click() programatico mas Chrome+Next 16 nao dispara picker
                via .click() em <input display:none>. 2026-05-24. */}
            {isPieceMode ? (
              <span style={{ position: "relative", display: "inline-flex" }}>
                <button
                  type="button"
                  title="Replace step with PSD"
                  style={{ background: "transparent", border: "1px solid #444", borderRadius: 4, color: "#aaa", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 8px" }}
                >PSD</button>
                <input
                  type="file"
                  accept=".psd,application/octet-stream,image/vnd.adobe.photoshop"
                  tabIndex={-1}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ""
                    if (!f) return
                    if (!window.confirm(`Replace the content of Step ${activeStepIndex + 1} with the layers of "${f.name}"? The current content of this step will be discarded.`)) return
                    await replaceStepFromPsd(f)
                  }}
                />
              </span>
            ) : (
              <button
                onClick={() => alert("PSD step replace is only available in piece editor — open a piece first.")}
                title="Only available in piece editor"
                style={{ background: "transparent", border: "1px solid #333", borderRadius: 4, color: "#555", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 8px" }}
              >PSD</button>
            )}
            <button onClick={(e) => openInExternalApp(e.altKey)} title={isPieceMode ? "External edit in Photoshop" : "Only available in piece editor"}
              disabled={!isPieceMode}
              style={{ background: "transparent", border: `1px solid ${isPieceMode ? "#444" : "#333"}`, borderRadius: 4, color: isPieceMode ? "#aaa" : "#555", cursor: isPieceMode ? "pointer" : "not-allowed", fontSize: 11, fontWeight: 600, padding: "3px 8px" }}
            >External edit</button>
            {externalPsdName && (
              <button onClick={syncFromExternalApp} title={`Re-import "${externalPsdName}"`}
                style={{ background: "#2a2a1a", border: "1px solid #F5C400", borderRadius: 4, color: "#F5C400", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 8px" }}
              >Sync</button>
            )}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {/* Center movido pro Properties panel 2026-05-26 — operacao de ASSET
            (centraliza o objeto selecionado no canvas), nao de view. */}
        <button onClick={centerView} style={bS} title="Fit the piece in the viewport (Shift+1)">Fit</button>
        <button onClick={zoomToSelection} style={bS} title="Focus on the selected object (Shift+2)">Focus selection</button>
        {/* Zoom: −/input/+ agrupados pra reduzir gap visual e tornar % editavel.
            Input numerico (5–1600), commit em Enter/blur. */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <button onClick={() => changeZoom(-0.1)} style={bS} title="Zoom out">−</button>
          <input
            type="number"
            min={5}
            max={1600}
            step={5}
            value={Math.round(zoom * 100)}
            onFocus={(e) => { numericInputFocusedRef.current = true; e.currentTarget.select() }}
            onBlur={() => { numericInputFocusedRef.current = false }}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              const z = Math.min(16, Math.max(0.05, n / 100))
              const fc = fabricRef.current
              if (fc) applyZoom(fc, z)
            }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
            title="Zoom (5–1600%)"
            style={{
              width: 56, height: 24,
              background: "transparent", border: "1px solid #2a2a2a",
              borderRadius: 4, padding: "0 4px",
              fontSize: 11, color: "#aaa", textAlign: "center",
              outline: "none",
            }}
          />
          <button onClick={() => changeZoom(+0.1)} style={bS} title="Zoom in">+</button>
        </div>
        {/* Toggle paineis laterais (Tab) — user pedido 2026-05-23. Esconde
            Layers + Properties pra preview limpo. */}
        <button
          onClick={() => setPanelsHidden(v => !v)}
          title={panelsHidden ? "Show side panels (Tab)" : "Hide side panels (Tab)"}
          style={{ ...bS, marginLeft: 4, background: panelsHidden ? "#F5C400" : "transparent", color: panelsHidden ? "#111" : "#aaa", borderColor: panelsHidden ? "#F5C400" : "#444" }}
        >
          {panelsHidden ? "▣" : "▢"}
        </button>
      </div>

      <div style={{ ...pS, left: 0, width: effLayersPanelWidth, borderRight: "1px solid #2a2a2a", paddingTop: TH, overflowY: (panelsHidden ? "hidden" : (pS.overflowY ?? "auto"))}}>
        {/* Drag handle de resize do painel — barra fininha na borda direita.
            Mouse-down marca posicao inicial; mousemove em window recalcula
            largura; mouse-up libera. localStorage persiste. Clamped [180,500]
            pra nao ficar minusculo nem esmagar o canvas. */}
        <div
          onMouseDown={onLayersDragStart}
          onDoubleClick={resetLayersWidth}
          title="Drag to resize · double-click to reset"
          style={{
            position: "absolute",
            top: 0, right: -3, bottom: 0,
            width: 6,
            cursor: "ew-resize",
            zIndex: 110,
            background: "transparent",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = accentRgba(0.18) }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
        />
        {/* Atalho Assets — botao DIFERENCIAL do ZZOSY (sem analogo direto em
            outros softwares de design). Stroke roxo + fill transparente +
            UPPERCASE pra destaque visual maximo. User pediu 2026-05-22:
            "Ele e um botao diferencial se relacionado aos outros softwares..
            Entao vamos dar super destaque para ele". Movido pro topo da
            coluna esquerda 2026-05-28 (assets/paginas/layers à esquerda,
            properties/ferramentas à direita). */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #2a2a2a", display: "flex", flexDirection: "column", gap: 6, position: "relative" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
          <button onClick={() => setShowAddAsset(v => !v)}
            onMouseEnter={(e) => { (e.currentTarget.style.background = "rgba(168,85,247,0.12)") }}
            onMouseLeave={(e) => { (e.currentTarget.style.background = "transparent") }}
            style={{
              flex: 1,
              background: showAddAsset ? "rgba(168,85,247,0.18)" : "transparent",
              border: "1px solid #a855f7",
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              color: "#aaa",
              textTransform: "uppercase",
              letterSpacing: "1.5px",
              textAlign: "center",
              transition: "background 0.15s ease",
            }}
            title="Selecionar asset existente pra adicionar ao canvas">
            Assets
          </button>
          <button onClick={() => setShowCreateAsset(true)}
            title="Criar novo asset (texto / imagem / forma)"
            style={{
              background: showCreateAsset ? "#a855f7" : "transparent",
              border: "1px solid #a855f7",
              borderRadius: 6,
              padding: "0 14px",
              fontSize: 18,
              fontWeight: 700,
              cursor: "pointer",
              color: showCreateAsset ? "#fff" : "#a855f7",
              lineHeight: 1,
              transition: "background 0.15s ease, color 0.15s ease",
            }}>+</button>
        </div>
          {showAddAsset && (
            <div
              onMouseEnter={clearAddAssetDismissTimer}
              onMouseLeave={startAddAssetDismissTimer}
              style={{
                position: "absolute", top: "calc(100% + 4px)", left: 14, right: 14,
                background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)", padding: 4, zIndex: 300,
                display: "flex", flexDirection: "column", maxHeight: 360, overflowY: "auto",
              }}>
              {(campaign.assets ?? []).length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "#666", textAlign: "center" }}>Nenhum asset</div>
              ) : (
                (campaign.assets ?? []).map((a: Asset) => {
                  const fc = fabricRef.current
                  const alreadyOnCanvas = a.type === "TEXT" && fc
                    ? fc.getObjects().some((o: any) => o.__assetId === a.id)
                    : false
                  const typeColor = a.type === "TEXT" ? "#F5C400" : a.type === "SHAPE" ? "#86efac" : "#a855f7"
                  let thumbContent: React.ReactNode
                  if ((a.type === "IMAGE" || a.type === "SMART_OBJECT") && a.imageUrl) {
                    // eslint-disable-next-line @next/next/no-img-element
                    thumbContent = <img src={a.imageUrl} alt={a.label} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                  } else if (a.type === "SHAPE") {
                    const shape: any = typeof a.content === "string" ? (() => { try { return JSON.parse(a.content as any) } catch { return null } })() : (a.content as any)
                    const path: string | null = shape?.path ?? null
                    const fill: string = shape?.fill?.color ?? "#888"
                    const bbox = shape?.pathBbox ?? null
                    const vw = bbox ? Math.max(1, bbox.right - bbox.left) : 100
                    const vh = bbox ? Math.max(1, bbox.bottom - bbox.top) : 100
                    thumbContent = path ? (
                      <svg viewBox={`${bbox?.left ?? 0} ${bbox?.top ?? 0} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%", display: "block" }}>
                        <path d={path} fill={fill} />
                      </svg>
                    ) : <span style={{ fontSize: 14, color: typeColor, fontWeight: 700 }}>◇</span>
                  } else {
                    thumbContent = <span style={{ fontSize: 16, color: typeColor, fontWeight: 800, fontFamily: "Georgia, serif" }}>T</span>
                  }
                  return (
                    <button
                      key={a.id}
                      disabled={alreadyOnCanvas}
                      onClick={() => {
                        if (alreadyOnCanvas) return
                        setAssetId(a.id); assetIdRef.current = a.id
                        void selectedTick
                        addLayer()
                        setShowAddAsset(false)
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: "6px 8px",
                        borderRadius: 4,
                        fontSize: 12,
                        color: alreadyOnCanvas ? "#555" : "#ddd",
                        cursor: alreadyOnCanvas ? "not-allowed" : "pointer",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        opacity: alreadyOnCanvas ? 0.5 : 1,
                        transition: "background 0.12s",
                      }}
                      onMouseEnter={e => { if (!alreadyOnCanvas) e.currentTarget.style.background = "#2a2a2a" }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent" }}
                    >
                      <div style={{
                        width: 28, height: 28, flexShrink: 0, borderRadius: 4,
                        border: `1px solid ${typeColor}40`,
                        background: "#1f1f1f",
                        backgroundImage: "linear-gradient(45deg, #2a2a2a 25%, transparent 25%), linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2a 75%), linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)",
                        backgroundSize: "8px 8px",
                        backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        overflow: "hidden", padding: 2,
                      }}>
                        {thumbContent}
                      </div>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.label}
                      </span>
                      {alreadyOnCanvas && <span style={{ fontSize: 10, color: "#666" }}>no canvas</span>}
                    </button>
                  )
                })
              )}
            </div>
          )}
          {/* Dialog "Criar novo asset" (user pedido 2026-05-30):
              + button → modal com 3 tipos (Texto/Imagem/Forma). Cria o
              asset via POST /api/campaigns/[id]/assets e abre popover de
              seleção pra user inserir no canvas em seguida. Imagem usa
              upload via /api/upload + cria asset com imageUrl.

              createPortal pra document.body: o painel pai do editor tem
              transform/will-change que cria containing block local, e
              position:fixed dentro ficava preso na coluna (user reportou
              "modal cortado/lateral"). Portal escapa pra root do DOM. */}
          {showCreateAsset && typeof document !== "undefined" && createPortal(
            <div onClick={() => !createAssetBusy && setShowCreateAsset(false)}
              style={{
                position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
                zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
              <div onClick={e => e.stopPropagation()}
                style={{
                  background: "#1a1a1a", border: "1px solid #2a2a2a",
                  borderRadius: 10, padding: 20, minWidth: 360, maxWidth: 480,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
                  {createAssetStep === "text" ? "Novo texto" : createAssetStep === "shape" ? "Nova forma" : "Criar novo asset"}
                </div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
                  {createAssetStep === "text"
                    ? "Digite o texto do asset:"
                    : createAssetStep === "shape"
                      ? "Escolha a forma:"
                      : "Que tipo de asset voce quer criar?"}
                </div>
                {/* STEP: text input inline (substitui prompt() nativo — user
                    2026-05-30: "a web nao pergunta, quem pergunta e o zzosy"). */}
                {createAssetStep === "text" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <input
                      autoFocus
                      type="text"
                      value={createAssetTextValue}
                      onChange={e => setCreateAssetTextValue(e.target.value)}
                      onKeyDown={async e => {
                        if (e.key === "Enter" && createAssetTextValue.trim() && !createAssetBusy) {
                          e.preventDefault()
                          const text = createAssetTextValue.trim()
                          setCreateAssetBusy(true)
                          try {
                            const res = await fetch(`/api/campaigns/${campaignId}/assets`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ type: "TEXT", label: text.slice(0, 30) || "Texto", content: [{ text, style: {} }] }),
                            })
                            if (!res.ok) { alert("Falha ao criar texto"); return }
                            setShowCreateAsset(false)
                            window.location.reload()
                          } finally { setCreateAssetBusy(false) }
                        } else if (e.key === "Escape") {
                          setCreateAssetStep("select")
                        }
                      }}
                      placeholder="Texto..."
                      style={{
                        background: "#222", border: "1px solid #2a2a2a", borderRadius: 6,
                        padding: "10px 12px", fontSize: 14, color: "#fff", outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>
                ) : createAssetStep === "shape" ? (
                  /* STEP: shape picker inline (substitui prompt rectangle/etc) */
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    {[
                      { kind: "rectangle" as const, label: "Retangulo", icon: <rect x="4" y="6" width="32" height="24" fill="#86efac"/> },
                      { kind: "roundedRect" as const, label: "Arredondado", icon: <rect x="4" y="6" width="32" height="24" rx="4" fill="#86efac"/> },
                      { kind: "ellipse" as const, label: "Elipse", icon: <ellipse cx="20" cy="18" rx="16" ry="12" fill="#86efac"/> },
                    ].map(s => (
                      <button
                        key={s.kind}
                        type="button"
                        disabled={createAssetBusy}
                        onClick={async () => {
                          setCreateAssetBusy(true)
                          try {
                            const { buildShapePath } = await import("@/lib/shapePaths")
                            const W = 400, H = 300
                            const cornerRadius = s.kind === "roundedRect" ? 20 : undefined
                            const path = buildShapePath(s.kind, W, H, cornerRadius)
                            const shape: any = {
                              kind: s.kind, path,
                              pathBbox: { left: 0, top: 0, right: W, bottom: H },
                              fill: { kind: "solid", color: "#4d4d4f" },
                              stroke: null, fillRule: "nonzero",
                            }
                            if (cornerRadius !== undefined) shape.cornerRadius = cornerRadius
                            const res = await fetch(`/api/campaigns/${campaignId}/assets`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ type: "SHAPE", label: s.label, content: shape }),
                            })
                            if (!res.ok) { alert("Falha ao criar forma"); return }
                            setShowCreateAsset(false)
                            window.location.reload()
                          } finally { setCreateAssetBusy(false) }
                        }}
                        style={{
                          background: "#222", border: "1px solid #2a2a2a", borderRadius: 8,
                          padding: "20px 12px", cursor: createAssetBusy ? "not-allowed" : "pointer",
                          color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                        }}
                        onMouseEnter={e => { if (!createAssetBusy) { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.borderColor = "#86efac" } }}
                        onMouseLeave={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.borderColor = "#2a2a2a" }}
                      >
                        <div style={{ height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="40" height="36" viewBox="0 0 40 36" xmlns="http://www.w3.org/2000/svg">{s.icon}</svg>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{s.label}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {/* TEXTO — abre sub-step "text" do dialog */}
                  <button
                    type="button"
                    disabled={createAssetBusy}
                    onClick={() => { setCreateAssetTextValue(""); setCreateAssetStep("text") }}
                    style={{
                      background: "#222", border: "1px solid #2a2a2a", borderRadius: 8,
                      padding: "20px 12px", cursor: createAssetBusy ? "not-allowed" : "pointer",
                      color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                      transition: "background 0.12s, border-color 0.12s",
                    }}
                    onMouseEnter={e => { if (!createAssetBusy) { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.borderColor = "#F5C400" } }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.borderColor = "#2a2a2a" }}>
                    {/* Icone com altura fixa 36px pra alinhar labels (user pedido). */}
                    <div style={{ height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: "#F5C400", fontFamily: "Georgia, serif", lineHeight: 1 }}>T</span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Texto</span>
                  </button>
                  {/* IMAGEM */}
                  <button
                    type="button"
                    disabled={createAssetBusy}
                    onClick={() => createAssetFileRef.current?.click()}
                    style={{
                      background: "#222", border: "1px solid #2a2a2a", borderRadius: 8,
                      padding: "20px 12px", cursor: createAssetBusy ? "not-allowed" : "pointer",
                      color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                      transition: "background 0.12s, border-color 0.12s",
                    }}
                    onMouseEnter={e => { if (!createAssetBusy) { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.borderColor = "#a855f7" } }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.borderColor = "#2a2a2a" }}>
                    {/* Wallpaper macOS-style: sky gradient + sol + montanhas.
                        Universal "imagem/foto" iconography (estilo Photos.app /
                        Preview.app do macOS) — user pediu pra substituir o
                        IMG texto. Altura fixa 36 alinha com T e Forma. */}
                    <div style={{ height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="44" height="32" viewBox="0 0 44 32" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                          <linearGradient id="zzosy-img-sky" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor="#5BA3DC"/>
                            <stop offset="0.7" stopColor="#E8B584"/>
                            <stop offset="1" stopColor="#F3C19A"/>
                          </linearGradient>
                          <clipPath id="zzosy-img-clip"><rect x="0" y="0" width="44" height="32" rx="4"/></clipPath>
                        </defs>
                        <g clipPath="url(#zzosy-img-clip)">
                          <rect x="0" y="0" width="44" height="32" fill="url(#zzosy-img-sky)"/>
                          <circle cx="32" cy="10" r="3.5" fill="#FFE08A"/>
                          {/* Montanha de tras */}
                          <polygon points="0,32 12,18 22,26 30,16 44,32" fill="#3D5A6C"/>
                          {/* Montanha da frente */}
                          <polygon points="0,32 8,24 18,32" fill="#6B8E7F"/>
                          <polygon points="20,32 28,22 36,30 44,32" fill="#6B8E7F"/>
                        </g>
                        <rect x="0.5" y="0.5" width="43" height="31" rx="3.5" fill="none" stroke="#a855f7" strokeWidth="1" opacity="0.4"/>
                      </svg>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Imagem</span>
                  </button>
                  <input
                    ref={createAssetFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    style={{ display: "none" }}
                    onChange={async e => {
                      const file = e.target.files?.[0]
                      e.target.value = ""
                      if (!file) return
                      setCreateAssetBusy(true)
                      try {
                        // 1. Upload bytes
                        const fd = new FormData()
                        fd.append("file", file)
                        const upRes = await fetch("/api/upload", { method: "POST", body: fd })
                        if (!upRes.ok) { alert("Falha no upload"); return }
                        const { url } = await upRes.json()
                        // 2. Cria asset
                        const label = file.name.replace(/\.[^.]+$/, "")
                        const res = await fetch(`/api/campaigns/${campaignId}/assets`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ type: "IMAGE", label, imageUrl: url }),
                        })
                        if (!res.ok) { alert("Falha ao criar asset"); return }
                        setShowCreateAsset(false)
                        window.location.reload()
                      } finally { setCreateAssetBusy(false) }
                    }}
                  />
                  {/* FORMA — abre sub-step "shape" do dialog */}
                  <button
                    type="button"
                    disabled={createAssetBusy}
                    onClick={() => setCreateAssetStep("shape")}
                    style={{
                      background: "#222", border: "1px solid #2a2a2a", borderRadius: 8,
                      padding: "20px 12px", cursor: createAssetBusy ? "not-allowed" : "pointer",
                      color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                      transition: "background 0.12s, border-color 0.12s",
                    }}
                    onMouseEnter={e => { if (!createAssetBusy) { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.borderColor = "#86efac" } }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.borderColor = "#2a2a2a" }}>
                    {/* Altura fixa 36 pra alinhar com Texto/Imagem. */}
                    <div style={{ height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 30, fontWeight: 800, color: "#86efac", lineHeight: 1 }}>◇</span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Forma</span>
                  </button>
                </div>
                )}
                {/* Footer: Cancelar sempre; em sub-steps tambem "← Voltar"; no
                    step text tambem "Criar" (Enter equivale). */}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, gap: 8 }}>
                  <button
                    type="button"
                    disabled={createAssetBusy}
                    onClick={() => createAssetStep === "select" ? setShowCreateAsset(false) : setCreateAssetStep("select")}
                    style={{
                      background: "transparent", border: "1px solid #333",
                      borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 600,
                      color: "#aaa", cursor: createAssetBusy ? "not-allowed" : "pointer",
                    }}>{createAssetStep === "select" ? "Cancelar" : "← Voltar"}</button>
                  {createAssetStep === "text" && (
                    <button
                      type="button"
                      disabled={createAssetBusy || !createAssetTextValue.trim()}
                      onClick={async () => {
                        const text = createAssetTextValue.trim()
                        if (!text) return
                        setCreateAssetBusy(true)
                        try {
                          const res = await fetch(`/api/campaigns/${campaignId}/assets`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ type: "TEXT", label: text.slice(0, 30) || "Texto", content: [{ text, style: {} }] }),
                          })
                          if (!res.ok) { alert("Falha ao criar texto"); return }
                          setShowCreateAsset(false)
                          window.location.reload()
                        } finally { setCreateAssetBusy(false) }
                      }}
                      style={{
                        background: createAssetTextValue.trim() ? "#F5C400" : "#333",
                        border: "none", borderRadius: 6, padding: "8px 16px",
                        fontSize: 12, fontWeight: 700,
                        color: createAssetTextValue.trim() ? "#111" : "#666",
                        cursor: (createAssetBusy || !createAssetTextValue.trim()) ? "not-allowed" : "pointer",
                      }}>Criar</button>
                  )}
                </div>
                {createAssetBusy && (
                  <div style={{ marginTop: 12, fontSize: 11, color: "#888", textAlign: "center" }}>Criando asset…</div>
                )}
              </div>
            </div>,
            document.body
          )}
          {/* Importar PSD: vive abaixo de Assets pq logicamente popula a
              matriz/peca a partir de um PSD — pertence ao grupo "assets/dados
              que entram", mesma coluna esquerda. Antes ficava na topbar mas
              violava a regra 1.2.0 (Linha 2 da pagina = SO navegacao). */}
          <button
            type="button"
            title="Import PSD for this campaign (replaces current Key Vision)"
            disabled={psdImporterRef.current?.isLoading() || false}
            style={{
              width: "100%",
              background: "transparent",
              border: "1px solid #333",
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 11,
              fontWeight: 600,
              cursor: psdImporterRef.current?.isLoading() ? "wait" : "pointer",
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
            onClick={() => {
              if (psdImporterRef.current?.isLoading()) return
              psdImportInputRef.current?.click()
            }}
          >
            {psdImporterRef.current?.isLoading() ? "Importando…" : "Importar PSD"}
          </button>
        </div>
        <div style={{ padding: "10px 14px", ...secS, borderBottom: "1px solid #2a2a2a", marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ flex: 1 }}>Layers</span>
          {/* Botao + Folder: cria folder novo movendo a selecao pra dentro.
              Sem selecao, mostra alerta orientando user a selecionar primeiro
              (Photoshop tambem nao cria folder vazio sem layer). */}
          <button
            title="New folder (moves selected layers into it)"
            onClick={() => {
              const name = window.prompt("Folder name:")
              if (name) createFolder(name)
            }}
            style={{
              background: "transparent", border: "1px solid #333", borderRadius: 4,
              padding: "2px 6px", fontSize: 10, color: "#aaa", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 3,
            }}>
            <span style={{ fontSize: 11 }}>+ Folder</span>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {!layers.length && <div style={{ fontSize: 11, color: "#444", textAlign: "center", padding: "24px 12px" }}>Add assets to canvas</div>}
          {/* Pre-processa: pra cada layer, calcula quais folder headers devem
              aparecer ANTES dele (entradas novas vs layer anterior) e se ele
              esta dentro de pasta recolhida. Faz isso fora do map pra que o
              JSX do layer fique limpo. */}
          {(() => {
            const meta: Array<{ headers: Array<{ key: string; name: string; depth: number; collapsed: boolean }>; indent: number; hidden: boolean }> = []
            let prevPath: string[] = []
            for (let i = 0; i < layers.length; i++) {
              const path: string[] = Array.isArray(layers[i].groupPath) ? layers[i].groupPath : []
              let commonDepth = 0
              while (commonDepth < prevPath.length && commonDepth < path.length && prevPath[commonDepth] === path[commonDepth]) commonDepth++
              const headers: Array<{ key: string; name: string; depth: number; collapsed: boolean }> = []
              for (let d = commonDepth; d < path.length; d++) {
                const key = path.slice(0, d + 1).join("›")
                // Pula header se algum ancestral esta collapsed — Photoshop hide
                // sub-folders inteiros quando o pai recolhe. Bug 2026-05-28:
                // antes os headers de descendente apareciam mesmo com pai
                // collapsed, dando sensacao "a seta recolhe mas continua aparecendo".
                let ancestorCollapsed = false
                for (let a = 0; a < d; a++) {
                  if (collapsedFolders.has(path.slice(0, a + 1).join("›"))) { ancestorCollapsed = true; break }
                }
                if (ancestorCollapsed) continue
                headers.push({ key, name: path[d], depth: d, collapsed: collapsedFolders.has(key) })
              }
              const hidden = path.some((_, idx) => collapsedFolders.has(path.slice(0, idx + 1).join("›")))
              meta.push({ headers, indent: path.length * 12, hidden })
              prevPath = path
            }
            ;(layers as any).__rowMeta = meta
            return null
          })()}
          {/* DROP ZONE TOPO: permite colocar layer ACIMA do primeiro (zIndex max).
              Aparece como uma faixa fina sempre que ha um drag ativo; durante
              dragOver mostra a linha amarela + abre espaco com magnify. */}
          {(dragLayerIdx !== null || dragFolderPath !== null) && layers.length > 0 && (
            <div
              onDragOver={e => {
                if (dragLayerIdx === null && !dragFolderPath) return
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
                if (dragOverIdx !== -1 || dropPosition !== "before") {
                  setDragOverIdx(-1)
                  setDropPosition("before")
                }
              }}
              onDragLeave={() => { if (dragOverIdx === -1) { setDragOverIdx(null); setDropPosition(null) } }}
              onDrop={e => {
                e.preventDefault()
                setDragOverIdx(null); setDropPosition(null)
                // Drop no TOPO do painel = sempre ROOT (Photoshop-style).
                // Antes herdava groupPath do primeiro layer — se topo era de
                // dentro de folder, drop "ao topo" levava layer pra DENTRO desse
                // folder, contra-intuitivo. Sintoma 2026-05-23: "drag layer
                // pra fora de folder volta sozinho" — user dropou no topo
                // esperando root, mas entrava em folder.
                const topPath: string[] = []
                if (dragFolderPath) {
                  const dragged = dragFolderPath
                  setDragFolderPath(null)
                  moveFolderTo(dragged, topPath)
                  return
                }
                const src = dragLayerIdx
                setDragLayerIdx(null)
                if (src === null) return
                const srcLayer = layers[src]
                if (srcLayer) reorderLayer(srcLayer.obj, 0, topPath)
              }}
              style={{
                height: dragOverIdx === -1 ? 16 : 8,
                position: "relative",
                transition: "height 140ms cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              {dragOverIdx === -1 && (
                <div style={{
                  position: "absolute", left: 8, right: 8, top: "50%", transform: "translateY(-50%)",
                  height: 3, borderRadius: 2, background: accentColor,
                  boxShadow: `0 0 8px ${accentRgba(0.9)}, 0 0 14px ${accentRgba(0.6)}`,
                  pointerEvents: "none",
                }} />
              )}
            </div>
          )}
          {layers.map((layer, i) => {
            const m = ((layers as any).__rowMeta ?? [])[i] ?? { headers: [], indent: 0, hidden: false }
            const headers = m.headers
            const indent = m.indent
            const hiddenByCollapse = m.hidden
            // Folder placeholder: renderiza headers (com onDrop/onDragOver normais
            // pra aceitar arrasto de layers reais pra dentro). A row em si vira
            // invisivel via flag isPlaceholder usado no return da row pra display:none.
            const isPlaceholder = (layer as any).isPlaceholder === true
            // Highlight verde: layer ativo OU membro de ActiveSelection (multi-
            // select via Shift+click). Sem o ramo do ActiveSelection, multi-
            // select selecionava os objetos no canvas mas o painel nao mostrava
            // visualmente quais estavam no grupo.
            const isSel = (() => {
              if (!selected) return false
              if (selected === layer.obj) return true
              if ((selected as any)?.type === "activeselection") {
                const objs = (selected as any).getObjects?.() ?? (selected as any)._objects ?? []
                return objs.includes(layer.obj)
              }
              return false
            })()
            const layerAssetId = layer.obj?.__assetId
            const isEditingThis = editingLayerAssetId && layerAssetId === editingLayerAssetId
            const maskData = (layer.obj as any)?.__maskData
            const hasMask = !!maskData
            const isHidden = layer.hidden === true
            const isLocked = layer.locked === true
            // GAP-BASED magnify: detecta qual GAP entre rows esta sendo alvo
            // (Photoshop-style: linha entre layers). Os 2 rows ADJACENTES ao
            // gap recebem magnify pra ABRIR ESPACO visualmente, deixando claro
            // onde o item vai cair. Diferente do row-target classico (em cima
            // de um), aqui o feedback eh "vai cair AQUI entre A e B".
            //
            // Mapeamento gap → rows afetados:
            //   dropPosition="before" e dragOverIdx=i → gap entre (i-1) e i
            //     → magnify em (i-1) com glow embaixo + i com glow em cima
            //   dropPosition="after" e dragOverIdx=i → gap entre i e (i+1)
            //     → magnify em i com glow embaixo + (i+1) com glow em cima
            const isAnyDrag = dragLayerIdx !== null || dragFolderPath !== null
            // Calcula posicoes do gap ativo (top index do gap = row acima, bot index = row abaixo)
            let gapTop = -1, gapBot = -1
            if (isAnyDrag && dragOverIdx !== null && dropPosition !== null) {
              if (dropPosition === "before") { gapTop = dragOverIdx - 1; gapBot = dragOverIdx }
              else { gapTop = dragOverIdx; gapBot = dragOverIdx + 1 }
            }
            const isAboveGap = i === gapTop
            const isBelowGap = i === gapBot
            const isAdjacentToGap = isAboveGap || isBelowGap
            // Distancia ate o gap pra magnify suave dos vizinhos mais distantes
            const distToGap = (gapTop < 0) ? 999 : Math.min(
              Math.abs(i - gapTop),
              Math.abs(i - gapBot),
            )
            const magnifyScale = isAdjacentToGap ? 1.04 : distToGap === 1 ? 1.015 : 1
            const magnifyShadow = isAdjacentToGap
              ? (isAboveGap
                  ? `0 4px 14px ${accentRgba(0.35)}, inset 0 -2px 0 ${accentRgba(0.9)}`
                  : `0 -4px 14px ${accentRgba(0.35)}, inset 0 2px 0 ${accentRgba(0.9)}`)
              : distToGap === 1 ? `0 2px 6px ${accentRgba(0.12)}` : "none"
            const magnifyZ = isAdjacentToGap ? 3 : distToGap === 1 ? 2 : 1
            // Margin extra no rows adjacentes pra ABRIR ESPACO entre eles —
            // efeito Photoshop "vai cair AQUI". Adicionamos no lado que toca
            // o gap (top do row de baixo, bottom do row de cima).
            const gapMarginTop = isBelowGap ? 6 : 0
            const gapMarginBottom = isAboveGap ? 6 : 0
            // Background pulse mais sutil nos rows adjacentes.
            // SELECAO: tint forte (22%) pra ser visivel em qualquer brand color
            // — antes (8%) ficava invisivel quando o brand era claro/desaturado.
            const dropBg = isAdjacentToGap ? accentRgba(0.10) : isSel ? accentRgba(0.22) : "transparent"
            // Linhas legadas (mantidas pra back-compat, mas com fallback p/ gap)
            const dragLineTop = false
            const dragLineBottom = false
            return (
              <React.Fragment key={`row-${i}`}>
                {/* Folder headers novos pra esta linha (entradas em pastas) */}
                {headers.map((h: { key: string; name: string; depth: number; collapsed: boolean }) => {
                  // Path completo deste folder pra calculo de visibility/lock em massa
                  // + drop target. Reconstroi do path do layer corrente.
                  const path: string[] = (Array.isArray(layer.groupPath) ? layer.groupPath : []).slice(0, h.depth + 1)
                  const folderHidden = isGroupHidden(path)
                  const folderLocked = isGroupLocked(path)
                  // Folder CONTEM o layer selecionado? Pulse pra deixar claro
                  // que a selecao esta dentro desse folder. User pedido 2026-05-23:
                  // "se estiver dentro de folder, deixar ele piscando no folder".
                  const selectedObj: any = selected
                  const selPath: string[] = Array.isArray(selectedObj?.__groupPath) ? selectedObj.__groupPath : []
                  const folderContainsSel = selPath.length >= path.length
                    && path.every((seg, idx) => selPath[idx] === seg)
                  return (
                  <div key={`folder-${h.key}-${i}`}
                    data-folder-key={h.key}
                    draggable
                    onDragStart={e => {
                      // Drag de FOLDER inteiro: marca o path. onDrop em outro
                      // folder/layer move o folder completo (com subfolders).
                      setDragFolderPath(path)
                      e.dataTransfer.effectAllowed = "move"
                      e.dataTransfer.setData("text/plain", `folder:${path.join("›")}`)
                      e.stopPropagation()
                    }}
                    onDragEnd={() => { setDragFolderPath(null); setDragOverFolderKey(null); setDropPosition(null) }}
                    onClick={() => {
                      // Click no header: SELECIONA todos os layers do folder no canvas
                      // (Photoshop-style — manipular o grupo move/escala/rotaciona
                      // todos juntos). Toggle do expand/collapse foi separado pro
                      // proprio triangulo abaixo. Sem isso, nao tinha como
                      // manipular o folder como composite.
                      if (!renamingFolderKey) selectFolderInCanvas(path)
                    }}
                    onDoubleClick={e => {
                      e.stopPropagation()
                      setRenamingFolderKey(h.key)
                    }}
                    onDragOver={e => {
                      // Aceita drop de layer OU de outro folder pra aninhar.
                      if (dragLayerIdx === null && !dragFolderPath) return
                      // Nao aceita drop de si mesmo ou descendente
                      if (dragFolderPath) {
                        const drag = dragFolderPath.join("›")
                        const cur = path.join("›")
                        if (drag === cur || cur.startsWith(drag + "›")) return
                      }
                      e.preventDefault()
                      e.dataTransfer.dropEffect = "move"
                      if (dragOverFolderKey !== h.key) setDragOverFolderKey(h.key)
                    }}
                    onDragLeave={() => { if (dragOverFolderKey === h.key) setDragOverFolderKey(null) }}
                    onDrop={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragOverFolderKey(null)
                      // Caso 1: dropping FOLDER em outro folder = nest (sub-folder)
                      if (dragFolderPath) {
                        const dragged = dragFolderPath
                        setDragFolderPath(null)
                        // Move dragged pra DENTRO do folder atual (vira sub-folder)
                        moveFolderTo(dragged, path)
                        return
                      }
                      // Caso 2: dropping LAYER em folder = mover layer pra dentro
                      const src = dragLayerIdx
                      setDragLayerIdx(null); setDragOverIdx(null)
                      if (src === null) return
                      const srcLayer = layers[src]
                      if (!srcLayer) return
                      reorderLayer(srcLayer.obj, i, path)
                    }}
                    style={(() => {
                      const isDraggedSelf = !!(dragFolderPath && dragFolderPath.join("›") === path.join("›"))
                      const isDropHere = dragOverFolderKey === h.key
                      return {
                        display: "flex", alignItems: "center", gap: 4,
                        padding: `6px 8px 6px ${12 + h.depth * 12}px`,
                        // pointer (mao pequena) > grab (mao gigante do macOS).
                        // Browser ativa grabbing automaticamente durante o drag HTML5.
                        cursor: "pointer",
                        fontSize: 10, fontWeight: 700,
                        textTransform: "uppercase", letterSpacing: "0.5px",
                        color: isDropHere ? "#fff" : (folderContainsSel ? "#fff" : "#888"),
                        background: isDropHere
                          ? accentRgba(0.20)
                          : (folderContainsSel ? accentRgba(0.10) : "rgba(255,255,255,0.02)"),
                        // Folder contem selecao: borderLeft acento + pulse contínuo.
                        borderLeft: folderContainsSel ? `4px solid ${accentColor}` : undefined,
                        animation: folderContainsSel ? "zzosy-folder-pulse 1600ms ease-in-out infinite" : undefined,
                        ["--zzosy-accent-soft" as any]: accentRgba(0.18),
                        ["--zzosy-accent-faint" as any]: accentRgba(0.05),
                        borderTop: "1px solid #222",
                        opacity: isDraggedSelf ? 0.3 : 1,
                        transform: isDropHere ? "scale(1.05)" : "scale(1)",
                        transformOrigin: "left center",
                        boxShadow: isDropHere
                          ? `0 4px 16px ${accentRgba(0.45)}, 0 0 0 2px ${accentRgba(0.85)}, inset 0 0 0 1px ${accentRgba(0.3)}`
                          : "none",
                        borderRadius: isDropHere ? 4 : 0,
                        zIndex: isDropHere ? 4 : 1,
                        position: "relative",
                        transition: "transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 120ms ease, background 100ms ease, color 100ms ease, border-radius 120ms ease",
                        willChange: dragLayerIdx !== null || dragFolderPath ? "transform" : "auto",
                      }
                    })()}
                    title={`Click: select all layers in group · drag to move/nest · double-click to rename`}>
                    <span
                      onClick={e => { e.stopPropagation(); toggleFolder(h.key) }}
                      title={h.collapsed ? "Expand" : "Collapse"}
                      style={{ width: 14, display: "inline-flex", justifyContent: "center", cursor: "pointer" }}
                    >{h.collapsed ? "▶" : "▼"}</span>
                    {/* Olho do folder — toggle em massa pros filhos */}
                    <button
                      onClick={e => { e.stopPropagation(); setGroupAttribute(path, "__hidden", !folderHidden) }}
                      title={folderHidden ? "Show all layers in folder" : "Hide all layers in folder"}
                      style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 2px", display: "flex", alignItems: "center", color: folderHidden ? "#444" : "#bbb" }}>
                      {folderHidden ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                    {/* Cadeado do folder — toggle em massa pros filhos */}
                    <button
                      onClick={e => { e.stopPropagation(); setGroupAttribute(path, "__locked", !folderLocked) }}
                      title={folderLocked ? "Unlock folder" : "Lock folder"}
                      style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 2px", display: "flex", alignItems: "center", color: folderLocked ? "#F5C400" : "#444" }}>
                      {folderLocked ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      ) : (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                        </svg>
                      )}
                    </button>
                    {renamingFolderKey === h.key ? (
                      <input
                        autoFocus
                        defaultValue={h.name}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            const v = (e.currentTarget as HTMLInputElement).value
                            if (v && v !== h.name) renameFolder(path, v)
                            setRenamingFolderKey(null)
                          } else if (e.key === "Escape") {
                            setRenamingFolderKey(null)
                          }
                        }}
                        onBlur={e => {
                          const v = e.currentTarget.value
                          if (v && v !== h.name) renameFolder(path, v)
                          setRenamingFolderKey(null)
                        }}
                        style={{
                          flex: 1, fontSize: 10, fontWeight: 700,
                          textTransform: "uppercase", letterSpacing: "0.5px",
                          background: "#0a0a0a", color: "#fff",
                          border: "1px solid #F5C400", borderRadius: 3,
                          padding: "1px 4px", outline: "none",
                          minWidth: 0,
                        }}
                      />
                    ) : (
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                    )}
                    {/* Botao + sub-folder: cria um folder filho dentro deste */}
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        const name = window.prompt(`Sub-folder name inside "${h.name}":`)
                        if (name) createFolder(name, path)
                      }}
                      title="Add sub-folder (moves selection into it)"
                      style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 2px", color: "#666", fontSize: 11, lineHeight: 1 }}>
                      +
                    </button>
                    {/* Botao deletar folder: move filhos pra parent (Alt+click apaga conteudo).
                        User pedido 2026-05-23: "lixo precisa aparecer pros grupos tambem" —
                        mesmo trash icon que layers individuais. */}
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        const altClick = (e as any).altKey === true
                        if (altClick) {
                          if (!confirm(`Delete folder "${h.name}" AND ALL its layers from the canvas?`)) return
                          deleteFolder(path, true)
                        } else {
                          if (!confirm(`Delete folder "${h.name}"? The layers will be moved to the parent folder.`)) return
                          deleteFolder(path, false)
                        }
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#e63946"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(230,57,70,0.1)" }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#888"; (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
                      title="Delete folder (children move to parent) · Alt+click to delete folder + all layers"
                      aria-label="Delete folder"
                      style={{ background: "transparent", border: "none", cursor: "pointer", padding: "3px 6px", color: "#888", fontSize: 14, lineHeight: 1, borderRadius: 3, transition: "color 120ms, background 120ms" }}>
                      🗑
                    </button>
                  </div>
                  )
                })}
                {/* Layer row (escondido se algum ancestral estiver collapsed) */}
                {!hiddenByCollapse && (
              <div
                draggable={!isEditingThis && !layer.isBg}
                onDragStart={e => {
                  if (isEditingThis || layer.isBg) { e.preventDefault(); return }
                  setDragLayerIdx(i)
                  e.dataTransfer.effectAllowed = "move"
                  // Firefox precisa de dataTransfer.setData pra ativar drag
                  e.dataTransfer.setData("text/plain", String(i))
                }}
                onDragEnd={() => { setDragLayerIdx(null); setDragOverIdx(null); setDragOverFolderKey(null); setDropPosition(null) }}
                onDragOver={e => {
                  // Aceita drop de layer ou de folder
                  if (dragLayerIdx === null && !dragFolderPath) return
                  if (dragLayerIdx === i) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = "move"
                  if (dragOverIdx !== i) setDragOverIdx(i)
                  // Detecta GAP: top half do row = drop ENTRE i-1 e i (before),
                  // bottom half = drop ENTRE i e i+1 (after). Photoshop usa
                  // linha azul fina; aqui usamos magnify dos 2 vizinhos pra
                  // abrir espaco visualmente claro.
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const y = e.clientY - rect.top
                  const pos: "before" | "after" = y < rect.height / 2 ? "before" : "after"
                  if (dropPosition !== pos) setDropPosition(pos)
                }}
                onDragLeave={() => { if (dragOverIdx === i) { setDragOverIdx(null); setDropPosition(null) } }}
                onDrop={e => {
                  e.preventDefault()
                  const pos = dropPosition
                  setDropPosition(null)
                  // Caso folder→layer: move folder pra mesma pasta do layer alvo
                  if (dragFolderPath) {
                    const dragged = dragFolderPath
                    setDragFolderPath(null); setDragOverIdx(null)
                    const targetParent: string[] = Array.isArray(layer.groupPath) ? layer.groupPath : []
                    moveFolderTo(dragged, targetParent)
                    return
                  }
                  const src = dragLayerIdx
                  setDragLayerIdx(null); setDragOverIdx(null)
                  if (src === null || src === i) return
                  const srcLayer = layers[src]
                  const targetPath: string[] = Array.isArray(layer.groupPath) ? layer.groupPath : []
                  // Ajusta o index visual baseado em "before/after": "after" = +1
                  // (cai abaixo do alvo), "before" = o proprio i. reorderLayer
                  // posiciona o src exatamente no targetVisualIndex.
                  const insertAt = pos === "after" ? i + 1 : i
                  if (srcLayer) reorderLayer(srcLayer.obj, insertAt, targetPath)
                }}
                onClick={async (e) => {
                  if (isEditingThis) return
                  const fc = fabricRef.current
                  if (!fc) return
                  // Multi-select estilo Photoshop/Figma:
                  //  - Shift+click: toggle do layer atual na selecao (acrescenta/remove).
                  //  - Click puro: substitui selecao por este unico layer.
                  // Sem isso, so dava pra selecionar multiplos via marquee no canvas
                  // — painel sempre selecionava um.
                  const additive = e.shiftKey || (e as any).metaKey || (e as any).ctrlKey
                  const target = layer.obj
                  if ((target as any).__isBg || (target as any).__isBleedOverlay) {
                    fc.setActiveObject(target)
                    fc.renderAll()
                    setSelected(target)
                    return
                  }
                  if (!additive) {
                    fc.discardActiveObject()
                    fc.setActiveObject(target)
                    fc.renderAll()
                    setSelected(target)
                    return
                  }
                  const fabricMod = await import("fabric") as any
                  const ActiveSelection = fabricMod.ActiveSelection
                  const active = fc.getActiveObject() as any
                  const currentObjs: any[] = active?.type === "activeselection"
                    ? [...(active.getObjects?.() ?? active._objects ?? [])]
                    : (active && active !== target ? [active] : [])
                  // Se ja existe nessa selecao, toggle off (remove). Senao, adiciona.
                  const exists = currentObjs.includes(target)
                  const next = exists
                    ? currentObjs.filter(o => o !== target)
                    : [...currentObjs, target]
                  fc.discardActiveObject()
                  if (next.length === 0) {
                    setSelected(null)
                  } else if (next.length === 1) {
                    fc.setActiveObject(next[0])
                    setSelected(next[0])
                  } else {
                    const sel = new ActiveSelection(next, { canvas: fc })
                    fc.setActiveObject(sel)
                    setSelected(sel)
                  }
                  fc.requestRenderAll?.()
                }}
                data-layer-row={i}
                data-layer-selected={isSel ? "1" : "0"}
                // Key muda a cada novo select pra reiniciar a CSS animation
                key={isSel ? `row-${i}-pulse-${layerPulseKey}` : `row-${i}`}
                style={{
                  // Placeholder de folder vazio: row invisivel. Headers do folder
                  // (acima nesta mesma row) continuam renderizando com onDrop normal.
                  display: isPlaceholder ? "none" : "flex",
                  alignItems: "center", gap: 4,
                  padding: `8px 8px 8px ${12 + indent}px`,
                  cursor: "default",
                  // Selecionado: barra colorida GROSSA (6px) na esquerda + bg
                  // mais intenso pra ficar CRYSTAL CLEAR qual layer esta ativo.
                  // User pedido 2026-05-23: "box colorido (com a cor principal
                  // do cliente), box a esquerda, deixando clarissimo".
                  borderLeft: isSel ? `6px solid ${accentColor}` : "6px solid transparent",
                  background: isSel ? accentRgba(0.18) : dropBg,
                  opacity: dragLayerIdx === i ? 0.3 : 1,
                  borderTop: dragLineTop ? `3px solid ${accentColor}` : "2px solid transparent",
                  borderBottom: dragLineBottom ? `3px solid ${accentColor}` : "2px solid transparent",
                  // CSS variables pra animation pulse (declaradas na <style> global do componente)
                  ["--zzosy-accent" as any]: accentColor,
                  ["--zzosy-accent-strong" as any]: accentRgba(0.55),
                  ["--zzosy-accent-soft" as any]: accentRgba(0.18),
                  ["--zzosy-accent-faint" as any]: accentRgba(0.08),
                  // Animation: dispara so quando isSel (key muda a cada selecao reinicia)
                  animation: isSel ? "zzosy-layer-pulse 1200ms ease-out" : undefined,
                  // Magnify dock-style: scale + shadow + z-index. Gap-based:
                  // rows adjacentes ao GAP target abrem espaco via marginTop/Bottom,
                  // ficando claro "vai cair NO MEIO desses dois".
                  transform: `scale(${magnifyScale})`,
                  transformOrigin: "left center",
                  // Combina magnify shadow + selection inset glow (accent color)
                  // pra que selecao seja visivel sob qualquer brand color.
                  boxShadow: isSel
                    ? `inset 0 0 0 1px ${accentRgba(0.45)}${magnifyShadow ? `, ${magnifyShadow}` : ""}`
                    : magnifyShadow,
                  zIndex: magnifyZ,
                  position: "relative",
                  borderRadius: isAdjacentToGap ? 4 : 0,
                  marginTop: gapMarginTop,
                  marginBottom: gapMarginBottom,
                  transition: "transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 140ms ease, background 100ms ease, border-radius 140ms ease, margin 140ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                  willChange: isAnyDrag ? "transform, margin" : "auto",
                }}
              >
                {/* Drop indicator: barra amarela com glow no GAP aberto entre
                    os dois rows adjacentes. Aparece SOMENTE no row de cima do
                    gap (isAboveGap), posicionada no bottom: -8px pra cair no
                    espaco aberto pelo marginBottom: 6px. */}
                {isAboveGap && (
                  <div style={{
                    position: "absolute",
                    left: 4 + indent,
                    right: 4,
                    bottom: -7,
                    height: 3,
                    borderRadius: 2,
                    background: accentColor,
                    boxShadow: `0 0 8px ${accentRgba(0.9)}, 0 0 14px ${accentRgba(0.6)}`,
                    pointerEvents: "none",
                    zIndex: 5,
                  }} />
                )}
                {/* Drag handle: 3 tracos horizontais (hamburger). Cursor grab
                    so neste icone, nao no row inteiro — antes o cursor de mao
                    aberta aparecia em todo o row (ficava grande, atrapalhando
                    leitura). Visual fica discreto mas claro como o que arrastar. */}
                {!layer.isBg && !isEditingThis && (
                  <div
                    title="Drag to reorder"
                    style={{
                      display: "flex", flexDirection: "column", justifyContent: "center",
                      // pointer pequeno e preciso > grab grande do macOS.
                      gap: 2, padding: "0 4px", cursor: "pointer",
                      color: dragLayerIdx === i ? accentColor : "#444",
                      flexShrink: 0,
                    }}
                    onMouseDown={e => e.stopPropagation()}
                  >
                    <span style={{ width: 10, height: 1.5, background: "currentColor", borderRadius: 1 }} />
                    <span style={{ width: 10, height: 1.5, background: "currentColor", borderRadius: 1 }} />
                    <span style={{ width: 10, height: 1.5, background: "currentColor", borderRadius: 1 }} />
                  </div>
                )}
                {/* Visibilidade (olho) — primeiro da row, igual Photoshop */}
                <button
                  title={isHidden ? "Show layer" : "Hide layer"}
                  onClick={e => { e.stopPropagation(); toggleLayerVisibility(layer.obj) }}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: "2px 4px", lineHeight: 1, width: 22, height: 22, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: isHidden ? "#444" : "#bbb",
                  }}
                >
                  {isHidden ? (
                    // Olho fechado (Photoshop: hidden)
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    // Olho aberto (Photoshop: visible)
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
                {/* Cadeado */}
                <button
                  title={isLocked ? "Unlock layer" : "Lock layer"}
                  onClick={e => { e.stopPropagation(); toggleLayerLock(layer.obj) }}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: "2px 4px", lineHeight: 1, width: 22, height: 22, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: isLocked ? "#F5C400" : "#444",
                  }}
                >
                  {isLocked ? (
                    // Cadeado fechado
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  ) : (
                    // Cadeado aberto
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                    </svg>
                  )}
                </button>
                {/* Thumb do layer (cor por tipo) */}
                <div style={{ width: 7, height: 7, borderRadius: 2, background: layer.type === "textbox" ? "#F5C400" : "#86efac", flexShrink: 0 }} />
                {/* Bolinha DS link status (so pra textboxes vinculados a preset
                    do Design System). Verde = mesmo do DS; Vermelha = customizado.
                    User customiza via Properties Panel; scale/posicao NAO quebram. */}
                {(layer.type === "textbox" || layer.type === "i-text") && (() => {
                  const obj: any = layer.obj
                  // So mostra a bolinha pra layers que tem assetId com brandPresetKey.
                  // Sem isso, qualquer texto teria bolinha — confunde o user (texto
                  // criado fora dos presets nao tem "link" pra DS pra checar).
                  const assetId = obj.__assetId
                  if (!assetId) return null
                  const asset = (campaign?.assets ?? []).find(a => a.id === assetId)
                  const lo: any = (asset as any)?.lastOverride
                  if (!lo?.brandPresetKey) return null
                  const linked = obj.__dsLinked !== false
                  return (
                    <div
                      title={linked ? "Synced with Design System" : "Customized — diverges from Design System"}
                      style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: linked ? "#22c55e" : "#ef4444",
                        flexShrink: 0,
                        marginLeft: 2,
                        boxShadow: linked ? "0 0 4px rgba(34,197,94,0.5)" : "0 0 4px rgba(239,68,68,0.5)",
                      }}
                    />
                  )
                })()}
                {/* Thumb da mascara (so aparece quando ha mascara). Igual Photoshop: */}
                {/* clique = seleciona; Shift+clique = toggle enabled; Alt+clique = invert. */}
                {/* Botao direito (oncontextmenu) = remover. */}
                {hasMask && (
                  <div
                    title={`${maskData.type} mask · click-toggle · Shift+click disable · Alt+click invert · right-click removes`}
                    onClick={e => {
                      e.stopPropagation()
                      if (e.shiftKey) {
                        // Toggle enabled (Photoshop: Shift+clique no mask thumb)
                        ;(async () => {
                          const m = { ...maskData, enabled: !maskData.enabled }
                          ;(layer.obj as any).__maskData = m
                          const { Image: FabImage, Path } = await import("fabric")
                          ;(layer.obj as any).clipPath = null
                          await applyMaskToFabricObject({ Image: FabImage, Path }, layer.obj, m)
                          fabricRef.current?.requestRenderAll()
                          refreshLayers(fabricRef.current!)
                          doSave()
                        })()
                      } else if (e.altKey && maskData.type !== "clipping") {
                        // Alt+clique: invert
                        ;(async () => {
                          const m = { ...maskData, inverted: !maskData.inverted }
                          ;(layer.obj as any).__maskData = m
                          const { Image: FabImage, Path } = await import("fabric")
                          ;(layer.obj as any).clipPath = null
                          await applyMaskToFabricObject({ Image: FabImage, Path }, layer.obj, m)
                          fabricRef.current?.requestRenderAll()
                          refreshLayers(fabricRef.current!)
                          doSave()
                        })()
                      } else {
                        // Clique normal: seleciona layer + ativa mask edit mode
                        // (banner "EDITING MASK" no topo). MaskPanel ja abre
                        // automatico via useEffect quando mask aparece.
                        // User pedido 2026-05-24: "clico no quadradinho da
                        // mask e nao mostra a mask" — antes so selecionava o
                        // layer sem indicacao visual de mask.
                        fabricRef.current?.setActiveObject(layer.obj)
                        setSelected(layer.obj)
                        if (layerAssetId) setMaskFocusAssetId(layerAssetId)
                      }
                    }}
                    onContextMenu={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      // Photoshop-style: botao direito no thumb da mascara remove direto.
                      // Sem confirm — destrutivo intencional, e undo (em breve) reverte.
                      ;(async () => {
                        delete (layer.obj as any).__maskData
                        ;(layer.obj as any).clipPath = null
                        ;(layer.obj as any).dirty = true
                        fabricRef.current?.requestRenderAll()
                        refreshLayers(fabricRef.current!)
                        doSave()
                      })()
                    }}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 2,
                      flexShrink: 0,
                      border: maskData.enabled ? "1.5px solid #F5C400" : "1.5px solid #555",
                      background: maskData.enabled ? "#1a1a1a" : "#0d0d0d",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: maskData.enabled ? "#F5C400" : "#555",
                      cursor: "pointer",
                      position: "relative",
                    }}
                  >
                    {maskData.type === "raster" ? "▦" : maskData.type === "vector" ? "▭" : "⌐"}
                    {!maskData.enabled && (
                      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#d33", pointerEvents: "none" }}>⊘</span>
                    )}
                  </div>
                )}
                {isEditingThis ? (
                  <input
                    autoFocus
                    defaultValue={layer.label}
                    onClick={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                    onBlur={async e => {
                      const el = e.currentTarget
                      if (!el || (el as any).__renameCommitted) return
                      ;(el as any).__renameCommitted = true
                      const v = (el.value ?? "").trim()
                      // Fecha edit mode PRIMEIRO (sync), depois async rename.
                      // Sem isso, rename mexe layers state mas input continua
                      // montado com defaultValue stale do layer antigo —
                      // proximo render mostra label antigo no span.
                      setEditingLayerAssetId(null)
                      if (v && v !== layer.label) await renameLayer(layer.obj, v)
                    }}
                    onKeyDown={async e => {
                      e.stopPropagation()
                      if (e.key === "Enter") {
                        e.preventDefault()
                        const el = e.currentTarget
                        ;(el as any).__renameCommitted = true
                        const v = (el.value ?? "").trim()
                        setEditingLayerAssetId(null)
                        if (v && v !== layer.label) await renameLayer(layer.obj, v)
                      } else if (e.key === "Escape") {
                        e.preventDefault()
                        ;(e.currentTarget as any).__renameCommitted = true
                        setEditingLayerAssetId(null)
                      }
                    }}
                    style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#fff", background: "#0d0d0d", border: "1px solid #F5C400", borderRadius: 3, padding: "2px 6px", outline: "none", fontFamily: "inherit" }}
                  />
                ) : (
                  <span
                    // KEY com layer.label: forca re-mount do span quando label muda.
                    // Sem isso, defensive in case React reuse o DOM node antigo com
                    // textContent stale (visto em rename → preview nao atualizava).
                    key={`label-${layer.label}-${layerVersion}`}
                    title="Double click to rename"
                    onDoubleClick={e => { e.stopPropagation(); if (layerAssetId) setEditingLayerAssetId(layerAssetId) }}
                    style={{ fontSize: 12, color: isSel ? "#fff" : "#888", fontWeight: isSel ? 700 : 400, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}
                  >{layer.label}</span>
                )}
                {/* Alpha channel thumbnail (Photoshop layer panel style) — so renderiza
                    quando o layer tem mask. Click ativa mask edit mode (overlay + brush). */}
                {(layer.obj as any)?.__maskData && (
                  <MaskThumb
                    mask={(layer.obj as any).__maskData}
                    obj={layer.obj}
                    fc={fabricRef.current}
                    focused={maskFocusAssetId === layerAssetId}
                    onFocus={() => {
                      setMaskFocusAssetId(prev => prev === layerAssetId ? null : layerAssetId)
                    }}
                  />
                )}
                {/* Lapis: SO layers tem botao pra abrir o mini-editor SO (Photoshop
                    "Edit Contents"). Stop propagation pra nao selecionar o layer ao clicar. */}
                {!layer.isBg && layerAssetId && (() => {
                  const a = (campaign?.assets ?? []).find(x => x.id === layerAssetId)
                  if (!a || a.type !== "SMART_OBJECT") return null
                  return (
                    <a
                      title="Editar Smart Object (abre nova aba)"
                      href={`/campaigns/${campaignId}/assets/${layerAssetId}/edit-so`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = "#F5C400"; (e.currentTarget as HTMLAnchorElement).style.background = "rgba(245,196,0,0.12)" }}
                      onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = "#888"; (e.currentTarget as HTMLAnchorElement).style.background = "transparent" }}
                      style={{ color: "#888", background: "transparent", border: "none", cursor: "pointer", padding: "3px 5px", lineHeight: 1, borderRadius: 3, transition: "color 120ms, background 120ms", display: "inline-flex", alignItems: "center", textDecoration: "none" }}
                      aria-label="Editar Smart Object"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                      </svg>
                    </a>
                  )
                })()}
                {!layer.isBg && (
                  <button title="Delete layer" onClick={e => { e.stopPropagation(); removeLayerWithUnclipCascade(layer.obj); fabricRef.current?.renderAll(); setSelected(null); doSave() }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#e63946"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(230,57,70,0.1)" }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#888"; (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
                    style={{ color: "#888", background: "transparent", border: "none", cursor: "pointer", fontSize: 14, padding: "3px 6px", lineHeight: 1, borderRadius: 3, transition: "color 120ms, background 120ms" }}
                    aria-label="Delete layer"
                  >🗑</button>
                )}
              </div>
            )}
            </React.Fragment>
            )
          })}
          {/* DROP ZONE FUNDO: permite colocar layer ABAIXO do ultimo (zIndex min).
              Mesma logica do topo, mas posicao = layers.length. */}
          {(dragLayerIdx !== null || dragFolderPath !== null) && layers.length > 0 && (
            <div
              onDragOver={e => {
                if (dragLayerIdx === null && !dragFolderPath) return
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
                if (dragOverIdx !== -2 || dropPosition !== "after") {
                  setDragOverIdx(-2)
                  setDropPosition("after")
                }
              }}
              onDragLeave={() => { if (dragOverIdx === -2) { setDragOverIdx(null); setDropPosition(null) } }}
              onDrop={e => {
                e.preventDefault()
                setDragOverIdx(null); setDropPosition(null)
                const lastIdx = layers.length - 1
                // Drop no FUNDO do painel = sempre ROOT (mesmo fix do topo).
                const bottomPath: string[] = []
                if (dragFolderPath) {
                  const dragged = dragFolderPath
                  setDragFolderPath(null)
                  moveFolderTo(dragged, bottomPath)
                  return
                }
                const src = dragLayerIdx
                setDragLayerIdx(null)
                if (src === null) return
                const srcLayer = layers[src]
                if (srcLayer) reorderLayer(srcLayer.obj, layers.length - 1, bottomPath)
              }}
              style={{
                height: dragOverIdx === -2 ? 16 : 8,
                position: "relative",
                transition: "height 140ms cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              {dragOverIdx === -2 && (
                <div style={{
                  position: "absolute", left: 8, right: 8, top: "50%", transform: "translateY(-50%)",
                  height: 3, borderRadius: 2, background: accentColor,
                  boxShadow: `0 0 8px ${accentRgba(0.9)}, 0 0 14px ${accentRgba(0.6)}`,
                  pointerEvents: "none",
                }} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* MASK EDIT MODE banner — fica fixo no topo do canvas quando user
          ativou edit de uma mask via click no MaskThumb. Indica modo + da
          opcao de sair. Brush real (pintar branco/preto sobre mask raster)
          eh Fase C — proxima iteracao com mouse handlers customizados. */}
      {maskFocusAssetId && (
        <div style={{
          position: "fixed", top: TH + 8, left: "50%", transform: "translateX(-50%)",
          background: "#F5C400", color: "#000", padding: "8px 14px",
          borderRadius: 6, fontSize: 12, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 12,
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)", zIndex: 200,
        }}>
          <span>EDITING MASK</span>
          <button onClick={() => setMaskFocusAssetId(null)}
            style={{
              background: "#000", color: "#F5C400", padding: "4px 10px",
              border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11, fontWeight: 700,
              fontFamily: "inherit",
            }}>Exit</button>
        </div>
      )}
      <div style={{ ...pS, right: 0, width: effPropsPanelWidth, borderLeft: "1px solid #2a2a2a", paddingTop: TH, overflowY: (panelsHidden ? "hidden" : (pS.overflowY ?? "auto"))}}>
        {/* Drag handle de resize do painel Properties — borda ESQUERDA. Mesmo
            padrao do layersPanelWidth (mirrored). */}
        <div
          onMouseDown={onPropsDragStart}
          onDoubleClick={resetPropsWidth}
          title="Drag to resize · double-click to reset"
          style={{
            position: "absolute",
            top: 0, left: -3, bottom: 0,
            width: 6,
            cursor: "ew-resize",
            zIndex: 110,
          }}
        />
        <div style={{ padding: "12px 16px", ...secS, borderBottom: "1px solid #2a2a2a", marginBottom: 0 }}>Properties</div>
        {(!selected || (selected as any).__isBg) ? (
          <div style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ ...secS, color: "#F5C400" }}>
                {(selected as any)?.__isBg && typeof (selected as any).__bgIdx === "number" && (selected as any).__bgIdx > 0
                  ? `Background ${((selected as any).__bgIdx as number) + 1}`
                  : "Background"}
                {bgLayersRef.current.length > 1 && (
                  <span style={{ color: "#555", marginLeft: 6, fontWeight: 400 }}>
                    ({((selected as any)?.__isBg && typeof (selected as any).__bgIdx === "number" ? (selected as any).__bgIdx : 0) + 1}/{bgLayersRef.current.length})
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button title="Add BG layer" onClick={() => addBgLayer()}
                  style={{ width: 22, height: 22, borderRadius: 4, background: "#1a1a1a", border: "1px solid #333", color: "#bbb", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>+</button>
                {bgLayersRef.current.length > 1 && (selected as any)?.__isBg && (
                  <button title="Remove this BG" onClick={() => removeBgLayer((selected as any).__bgIdx ?? 0)}
                    style={{ width: 22, height: 22, borderRadius: 4, background: "#1a1a1a", border: "1px solid #333", color: "#bbb", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 }}>✕</button>
                )}
              </div>
            </div>
            {/* Tipo do BG: Solid / Linear / Radial — so aparece quando user
                clica no swatch da cor (showBgTypeSelector toggle).
                User pedido 2026-05-23:
                  - "imagem nao existe para Background, igual photoshop"
                    → Image button REMOVIDO (PS bg eh cor pura)
                  - "solid/linear/radial so aparece depois que clico no box
                    da cor ou na linha com o codigo"
                    → escondido por default, expande ao click no swatch */}
            {showBgTypeSelector && (() => {
              const layer = bgLayersRef.current[currentBgIdx()]
              const kind = layer?.kind ?? "solid"
              const gType = layer?.kind === "gradient" ? layer.gradientType : null
              const btnS = (active: boolean) => ({
                flex: 1, padding: "6px 8px", fontSize: 11,
                background: active ? "#F5C400" : "#1a1a1a",
                color: active ? "#000" : "#888",
                border: "1px solid " + (active ? "#F5C400" : "#333"),
                borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
                textTransform: "uppercase" as const, letterSpacing: "0.5px",
              })
              return (
                <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
                  <button style={btnS(kind === "solid")} onClick={() => changeBgKind("solid")}>Solid</button>
                  <button style={btnS(kind === "gradient" && gType === "linear")} onClick={() => changeBgKind("gradient", { gradientType: "linear" })}>Linear</button>
                  <button style={btnS(kind === "gradient" && gType === "radial")} onClick={() => changeBgKind("gradient", { gradientType: "radial" })}>Radial</button>
                </div>
              )
            })()}
            {/* BLEND MODE acima da cor (user pedido 2026-05-23: 'poe blend
                para cima da cor'). Sai do agrupamento BlendMode+Mask original. */}
            {(() => {
              const layer = bgLayersRef.current[currentBgIdx()]
              if (!layer) return null
              const blend = layer.blendMode ?? "source-over"
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#888", marginBottom: 10 }}>
                  <span style={{ width: 56, textTransform: "uppercase", letterSpacing: "0.5px" }}>Blend</span>
                  <select value={blend}
                    onChange={e => changeBgBlendMode(e.target.value as BgBlendMode)}
                    style={{ flex: 1, padding: "4px 6px", fontSize: 11, background: "#0d0d0d",
                      color: "#bbb", border: "1px solid #333", borderRadius: 3,
                      fontFamily: "inherit", outline: "none" }}>
                    <option value="source-over">Normal</option>
                    <option value="multiply">Multiply</option>
                    <option value="screen">Screen</option>
                    <option value="overlay">Overlay</option>
                    <option value="darken">Darken</option>
                    <option value="lighten">Lighten</option>
                    <option value="color-dodge">Color Dodge</option>
                    <option value="color-burn">Color Burn</option>
                    <option value="hard-light">Hard Light</option>
                    <option value="soft-light">Soft Light</option>
                    <option value="difference">Difference</option>
                    <option value="exclusion">Exclusion</option>
                    <option value="hue">Hue</option>
                    <option value="saturation">Saturation</option>
                    <option value="color">Color</option>
                    <option value="luminosity">Luminosity</option>
                  </select>
                </div>
              )
            })()}
            {/* SOLID: ColorSwatchPicker (Figma-style — swatch + popup) */}
            {(() => {
              const layer = bgLayersRef.current[currentBgIdx()]
              if (layer?.kind !== "solid") return null
              const bgStr = typeof bgColor === "string" ? bgColor : "#ffffff"
              const activeBrand = layer?.colorBrandIdx
              return (
                <div style={{ marginBottom: 14 }}>
                  <ColorSwatchPicker
                    value={bgStr}
                    onChange={(hex, brandIdx) => changeBg(hex, brandIdx)}
                    brandColors={brandColors as any}
                    defaultSwatches={SWATCHES}
                    activeBrandIdx={typeof activeBrand === "number" ? activeBrand : undefined}
                    opacity={(bgOpacity ?? 1) * 100}
                    onOpacityChange={pct => changeBgOpacity(pct / 100)}
                  />
                </div>
              )
            })()}
            {/* GRADIENT: stops + angulo (se linear) */}
            {(() => {
              const layer = bgLayersRef.current[currentBgIdx()]
              if (layer?.kind !== "gradient") return null
              const stops = layer.stops
              return (
                <>
                  {/* Preview do gradient */}
                  <div style={{
                    height: 24, borderRadius: 4, border: "1px solid #333", marginBottom: 10,
                    background: layer.gradientType === "linear"
                      ? `linear-gradient(${layer.angle + 90}deg, ${stops.map(s => `${s.color} ${s.offset * 100}%`).join(", ")})`
                      : `radial-gradient(circle, ${stops.map(s => `${s.color} ${s.offset * 100}%`).join(", ")})`,
                  }} />
                  {/* Stops */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>Stops</span>
                      <button onClick={() => addBgGradientStop()}
                        style={{ background: "#1a1a1a", border: "1px solid #333", color: "#bbb", cursor: "pointer", fontSize: 11, padding: "2px 8px", borderRadius: 3 }}>+ Stop</button>
                    </div>
                    {stops.map((s, si) => (
                      <div key={si} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                        <label style={{ width: 24, height: 24, borderRadius: 4, background: s.color, border: "1px solid #333", flexShrink: 0, cursor: "pointer", position: "relative", overflow: "hidden" }}>
                          <input type="color"
                            value={/^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : "#ffffff"}
                            onChange={e => changeBgGradientStop(si, { color: e.target.value })}
                            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", border: 0 }} />
                        </label>
                        <input type="range" min={0} max={100} step={1}
                          value={Math.round(s.offset * 100)}
                          onChange={e => changeBgGradientStop(si, { offset: Number(e.target.value) / 100 })}
                          style={{ flex: 1 }} />
                        <span style={{ width: 32, textAlign: "right", color: "#bbb", fontFamily: "monospace", fontSize: 11 }}>{Math.round(s.offset * 100)}%</span>
                        {stops.length > 2 && (
                          <button title="Remove stop" onClick={() => removeBgGradientStop(si)}
                            style={{ width: 18, height: 18, borderRadius: 3, background: "transparent", border: "none", color: "#555", cursor: "pointer", fontSize: 11, padding: 0, lineHeight: 1 }}>✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Angulo (so linear) */}
                  {layer.gradientType === "linear" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#888", marginBottom: 14 }}>
                      <span style={{ width: 56, textTransform: "uppercase", letterSpacing: "0.5px" }}>Angle</span>
                      <input type="range" min={0} max={360} step={1}
                        value={Math.round(layer.angle)}
                        onChange={e => changeBgGradientAngle(Number(e.target.value))}
                        style={{ flex: 1 }} />
                      <span style={{ width: 36, textAlign: "right", color: "#bbb", fontFamily: "monospace" }}>{Math.round(layer.angle)}°</span>
                    </div>
                  )}
                </>
              )
            })()}
            {/* IMAGE: preview + upload + fit */}
            {(() => {
              const layer = bgLayersRef.current[currentBgIdx()]
              if (layer?.kind !== "image") return null
              const fitBtn = (f: BgImageFit, label: string) => (
                <button key={f} onClick={() => changeBgImageFit(f)}
                  style={{ flex: 1, padding: "5px 4px", fontSize: 10, borderRadius: 3, cursor: "pointer",
                    background: layer.fit === f ? "#F5C400" : "#1a1a1a",
                    color: layer.fit === f ? "#000" : "#888",
                    border: "1px solid " + (layer.fit === f ? "#F5C400" : "#333"),
                    fontFamily: "inherit", textTransform: "uppercase" as const, letterSpacing: "0.4px",
                  }}>{label}</button>
              )
              return (
                <>
                  {layer.imageDataUrl ? (
                    <div style={{
                      width: "100%", height: 120, borderRadius: 4, border: "1px solid #333",
                      marginBottom: 8, overflow: "hidden",
                      backgroundImage: `url(${layer.imageDataUrl})`,
                      backgroundSize: layer.fit === "tile" ? "auto" : (layer.fit === "fill" ? "100% 100%" : layer.fit),
                      backgroundRepeat: layer.fit === "tile" ? "repeat" : "no-repeat",
                      backgroundPosition: "center",
                      backgroundColor: "#0d0d0d",
                    }} />
                  ) : (
                    <div style={{ width: "100%", height: 120, borderRadius: 4, border: "1px dashed #444",
                      marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#555", fontSize: 11 }}>No image</div>
                  )}
                  <button onClick={() => {
                    const input = document.createElement("input")
                    input.type = "file"
                    input.accept = "image/*"
                    input.onchange = () => {
                      const f = input.files?.[0]
                      if (f) uploadBgImage(f, layer.fit)
                    }
                    input.click()
                  }}
                    style={{ width: "100%", padding: "6px 8px", fontSize: 11, marginBottom: 10,
                      background: "#1a1a1a", color: "#bbb", border: "1px solid #333",
                      borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
                      textTransform: "uppercase", letterSpacing: "0.5px",
                    }}>{layer.imageDataUrl ? "Replace image" : "Select image"}</button>
                  <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Fit</div>
                  <div style={{ display: "flex", gap: 3, marginBottom: 14 }}>
                    {fitBtn("cover", "Cover")}
                    {fitBtn("contain", "Contain")}
                    {fitBtn("fill", "Fill")}
                    {fitBtn("tile", "Tile")}
                  </div>
                </>
              )
            })()}
            {/* Opacity agora vive INLINE na linha do ColorSwatchPicker (Figma-style).
                Slider standalone removido. */}
            {/* Mask (BG-5) — Blend foi movido pra ANTES da cor (user 2026-05-23). */}
            {(() => {
              const layer = bgLayersRef.current[currentBgIdx()]
              if (!layer) return null
              return (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#888" }}>
                    <span style={{ width: 56, textTransform: "uppercase", letterSpacing: "0.5px" }}>Mask</span>
                    {layer.mask ? (
                      <div style={{ flex: 1, display: "flex", gap: 4 }}>
                        <button onClick={() => toggleBgMaskEnabled()}
                          title={layer.mask.enabled ? "Disable mask" : "Enable mask"}
                          style={{ flex: 1, padding: "4px 6px", fontSize: 11, background: layer.mask.enabled ? "#1a1a1a" : "#0d0d0d",
                            color: layer.mask.enabled ? "#F5C400" : "#666", border: "1px solid #333", borderRadius: 3, cursor: "pointer", fontFamily: "inherit" }}>
                          {layer.mask.enabled ? "Active" : "Disabled"}
                        </button>
                        <button onClick={() => removeBgMask()} title="Remove mask"
                          style={{ padding: "4px 8px", fontSize: 11, background: "#1a1a1a", color: "#bbb", border: "1px solid #333", borderRadius: 3, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setBgMaskDefault()}
                        style={{ flex: 1, padding: "4px 6px", fontSize: 11, background: "#1a1a1a", color: "#bbb", border: "1px solid #333", borderRadius: 3, cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        + Add
                      </button>
                    )}
                  </div>
                </>
              )
            })()}
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
            // fontWeight efetivo: pra Google Fonts (e custom uploadadas), o
            // peso vive aqui (numero CSS 100-900), nao no nome do fontFamily.
            // WeightPicker usa pra mostrar peso correto e trocar via onPickWeight.
            let effectiveFontWeight: string | number = (selected as any).fontWeight ?? "normal"
            // Detector de "valor misto" — quando o texto tem partes com fontes/tamanhos/cores
            // diferentes, painel mostra placeholder em vez de um valor incorreto.
            let mixedFontFamily = false
            let mixedFontSize = false
            let mixedFill = false
            // lineHeight e textAlign sao propriedades do textbox inteiro (Fabric nao suporta
            // per-char nelas), entao nao tentam ler de getSelectionStyles.
            const effectiveLineHeight: number = (selected as any).lineHeight ?? 1.0
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
                const boxWeight = (selected as any).fontWeight
                const fams = new Set<string>()
                const sizes = new Set<number>()
                const fills = new Set<string>()
                const weights = new Set<string | number>()
                for (const s of styles) {
                  fams.add(s.fontFamily ?? boxFont)
                  sizes.add(s.fontSize ?? boxSize)
                  fills.add(s.fill ?? boxFill)
                  weights.add(s.fontWeight ?? boxWeight ?? "normal")
                }
                return {
                  fontFamily: fams.size === 1 ? [...fams][0] : null,
                  fontSize: sizes.size === 1 ? [...sizes][0] : null,
                  fill: fills.size === 1 ? [...fills][0] : null,
                  fontWeight: weights.size === 1 ? [...weights][0] : null,
                  mixedFamily: fams.size > 1,
                  mixedSize: sizes.size > 1,
                  mixedFill: fills.size > 1,
                  mixedWeight: weights.size > 1,
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
                if (r.fontWeight !== null) effectiveFontWeight = r.fontWeight
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
                  if (r.fontWeight !== null) effectiveFontWeight = r.fontWeight
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
                  if (r.fontWeight !== null) effectiveFontWeight = r.fontWeight
                }
              }
            }
            return (
          <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
            {/* BLEND MODE + OPACITY — padrao ZZOSY: blend left, opacity right
                na MESMA linha (user pedido 2026-05-23). Padding/gap reduzidos
                radicalmente 2026-05-26 (user reportou panel muito espacado). */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 92px", gap: 8 }}>
              <div>
                <div style={secS}>Blend mode</div>
                <select
                  value={(selected as any).globalCompositeOperation ?? "source-over"}
                  onChange={e => changeObjectBlendMode(e.target.value)}
                  style={{ ...inpS, cursor: "pointer", appearance: "none", paddingRight: 20, width: "100%" }}
                  title="Layer blend mode (Photoshop-style)"
                >
                  <option value="source-over">Normal</option>
                  <option value="multiply">Multiply</option>
                  <option value="screen">Screen</option>
                  <option value="overlay">Overlay</option>
                  <option value="darken">Darken</option>
                  <option value="lighten">Lighten</option>
                  <option value="color-dodge">Color Dodge</option>
                  <option value="color-burn">Color Burn</option>
                  <option value="hard-light">Hard Light</option>
                  <option value="soft-light">Soft Light</option>
                  <option value="difference">Difference</option>
                  <option value="exclusion">Exclusion</option>
                  <option value="hue">Hue</option>
                  <option value="saturation">Saturation</option>
                  <option value="color">Color</option>
                  <option value="luminosity">Luminosity</option>
                  <option value="lighter">Linear Dodge</option>
                </select>
              </div>
              <div>
                <div style={secS}>Opacity</div>
                <div style={numFieldRight}>
                  <input
                    type="number" min={0} max={100} step={1}
                    value={Math.round(((selected as any).opacity ?? 1) * 100)}
                    onChange={e => changeObjectOpacity((Number(e.target.value) || 0) / 100)}
                    title="Opacity (0-100%)"
                    style={numInpS}
                  />
                  <span style={numFieldUnit}>%</span>
                </div>
              </div>
            </div>
            <div>
              <div style={secS}>Replace Asset</div>
              <select
                value={(selected as any).__assetId ?? ""}
                onChange={e => {
                  const newAsset = (campaign?.assets ?? []).find(a => a.id === e.target.value)
                  if (newAsset) {
                    const currentObj = fabricRef.current?.getActiveObject() ?? selected
                    swapAsset(currentObj, newAsset)
                  }
                }}
                style={{ ...inpS, cursor: "pointer", appearance: "none", paddingRight: 24 }}
              >
                {(() => {
                  // Regra: nao listar assets TEXT que ja estao em outros layers (cada
                  // asset texto so pode aparecer 1x no canvas). Mas SEMPRE incluir o
                  // asset atual (o selecionado), senao o swap perde a referencia visual.
                  const fc = fabricRef.current
                  const objs = fc ? fc.getObjects() : []
                  const usedIds = new Set(objs.map((o: any) => o.__assetId).filter(Boolean))
                  const currentId = (selected as any).__assetId
                  return (campaign?.assets ?? [])
                    .filter(a => a.type === "TEXT")
                    .filter(a => a.id === currentId || !usedIds.has(a.id))
                    .map(a => (
                      <option key={a.id} value={a.id}>{a.label || a.value || "Unnamed"}</option>
                    ))
                })()}
              </select>
            </div>
            <div>
              {/* Font header colapsivel (padrao Mask). Default recolhido. */}
              <div
                role="button"
                tabIndex={-1}
                onClick={() => setFontSectionOpen(o => !o)}
                style={{ ...secS, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, marginBottom: fontSectionOpen ? secS.marginBottom : 0, userSelect: "none" }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: fontSectionOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.12s", flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
                Font {mixedFontFamily && <span style={{ color: "#888", fontWeight: 400, fontStyle: "italic" }}>(multiple)</span>}
              </div>
              {fontSectionOpen && (
                <FontPicker
                  value={mixedFontFamily ? "" : effectiveFontFamily}
                  onChange={(f) => applyStyle("fontFamily", f)}
                  brandFont={campaignRef.current?.client?.brandFont ?? null}
                />
              )}
            </div>
            {fontSectionOpen && (<>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={secS}>Size {mixedFontSize && <span style={{ color: "#888", fontWeight: 400, fontStyle: "italic" }}>(mult.)</span>}</div>
                <input
                  type="number"
                  value={mixedFontSize ? "" : fontSizeInput}
                  placeholder={mixedFontSize ? "—" : ""}
                  onFocus={(e) => {
                    numericInputFocusedRef.current = true
                    // Seleciona tudo no focus — user digita o novo numero sem
                    // precisar apagar primeiro. Padrao Adobe/Figma.
                    e.currentTarget.select()
                  }}
                  onBlur={() => { numericInputFocusedRef.current = false }}
                  // Captura a seleção do textbox ANTES do click no input remover
                  // o foco (saindo do edit mode). Sem isso, applyStyle vê
                  // isEditing=false e savedTextSelection pode estar stale.
                  onMouseDown={() => {
                    const fc = fabricRef.current
                    const active = fc?.getActiveObject() as any
                    if (active?.isEditing && active.selectionStart !== active.selectionEnd) {
                      savedTextSelection.current = { obj: active, start: active.selectionStart, end: active.selectionEnd }
                    }
                  }}
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
                <div style={secS}>Weight</div>
                {/* WeightPicker tem dois modos:
                    - Sistema (Helvetica Neue Bold, Avenir Light): troca fontFamily.
                    - Google/custom (Exo 2, Manrope, fontes do cliente): mesma
                      familia, muda fontWeight numerico CSS via onPickWeight.
                    Decisao acontece dentro do WeightPicker baseado na presenca
                    da familia na lista de variantes do sistema. */}
                <WeightPicker
                  value={effectiveFontFamily}
                  fontWeight={effectiveFontWeight}
                  onChange={(f) => applyStyle("fontFamily", f)}
                  onPickWeight={(w) => applyStyle("fontWeight", w)}
                />
              </div>
            </div>
            {/* Tipografia avancada: entrelinha + entreletra + baseline shift.
                Adobe-style 3-col layout (Photoshop Char Panel: leading, tracking,
                baseline shift). Baseline shift per-char-only via Fabric deltaY. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <div style={secS}>Line height</div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input
                    type="number"
                    step="1"
                    value={leadingInput}
                    onFocus={(e) => {
                      numericInputFocusedRef.current = true
                      e.currentTarget.select()
                    }}
                    onBlur={() => { numericInputFocusedRef.current = false }}
                    onMouseDown={() => {
                      const fc = fabricRef.current
                      const active = fc?.getActiveObject() as any
                      if (active?.isEditing && active.selectionStart !== active.selectionEnd) {
                        savedTextSelection.current = { obj: active, start: active.selectionStart, end: active.selectionEnd }
                      }
                    }}
                    onChange={e => {
                      const raw = e.target.value
                      setLeadingInput(raw)
                      const n = Number(raw)
                      if (Number.isFinite(n) && n > 0) setLeading(n)
                    }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                    title={isLeadingAuto ? `Auto (${Math.round(effectiveLeadingPt)}pt) — Option+↑/↓ adjusts` : "Option+↑/↓ adjusts (Shift = 10pt)"}
                    style={{ ...inpS, color: isLeadingAuto ? "#888" : "white" }}
                  />
                  <button type="button" tabIndex={-1}
                    onClick={() => setLeading(null)}
                    disabled={isLeadingAuto}
                    title="Reset to Auto"
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
                <div style={secS}>Letter spacing</div>
                <input
                  type="number"
                  step="10"
                  value={charSpacingInput}
                  onFocus={(e) => {
                    numericInputFocusedRef.current = true
                    e.currentTarget.select()
                  }}
                  onBlur={() => { numericInputFocusedRef.current = false }}
                  onMouseDown={() => {
                    const fc = fabricRef.current
                    const active = fc?.getActiveObject() as any
                    if (active?.isEditing && active.selectionStart !== active.selectionEnd) {
                      savedTextSelection.current = { obj: active, start: active.selectionStart, end: active.selectionEnd }
                    }
                  }}
                  onChange={e => {
                    const raw = e.target.value
                    setCharSpacingInput(raw)
                    const n = Number(raw)
                    if (Number.isFinite(n)) setCharSpacingProp(n)
                  }}
                  onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                  title="Letter spacing (tracking) in thousandths of em — same unit as Photoshop"
                  style={inpS}
                />
              </div>
              <div>
                <div style={secS}>Baseline</div>
                <input
                  type="number"
                  step="1"
                  value={baselineShiftInput}
                  onFocus={(e) => {
                    numericInputFocusedRef.current = true
                    e.currentTarget.select()
                  }}
                  onBlur={() => { numericInputFocusedRef.current = false }}
                  onMouseDown={() => {
                    const fc = fabricRef.current
                    const active = fc?.getActiveObject() as any
                    if (active?.isEditing && active.selectionStart !== active.selectionEnd) {
                      savedTextSelection.current = { obj: active, start: active.selectionStart, end: active.selectionEnd }
                    }
                  }}
                  onChange={e => {
                    const raw = e.target.value
                    setBaselineShiftInput(raw)
                    const n = Number(raw)
                    if (Number.isFinite(n)) setBaselineShiftProp(n)
                  }}
                  onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                  title="Baseline shift in points — Adobe-style (positive raises, negative lowers). Per-char only — select chars first."
                  style={inpS}
                />
              </div>
            </div>

            {/* Alinhamento separado num grid full-width pra dar mais espaco */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              <div>
                <div style={secS}>Alignment</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {[
                    { v: "left", icon: "⫷", title: "Left (Cmd+Shift+L)" },
                    { v: "center", icon: "≡", title: "Center (Cmd+Shift+C)" },
                    { v: "right", icon: "⫸", title: "Right (Cmd+Shift+R)" },
                    { v: "justify", icon: "☰", title: "Justify (Cmd+Shift+J)" },
                  ].map(a => {
                    const active = effectiveTextAlign === a.v
                    return (
                      <button key={a.v} type="button" tabIndex={-1}
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

            {/* CASE TRANSFORM — UPPERCASE/lowercase/Title (user pedido 2026-05-23).
                Aplica direto no obj.text (canvas nao suporta CSS text-transform). */}
            <div>
              <div style={secS}>Case</div>
              <div style={{ display: "flex", gap: 4 }}>
                {[
                  { kind: "upper", label: "AA", title: "UPPERCASE" },
                  { kind: "lower", label: "aa", title: "lowercase" },
                  { kind: "title", label: "Aa", title: "Title Case" },
                ].map(c => (
                  <button key={c.kind} type="button" tabIndex={-1}
                    onClick={() => {
                      const obj = selected as any
                      if (!obj || (obj.type !== "textbox" && obj.type !== "i-text")) return
                      const cur = obj.text ?? ""
                      let next = cur
                      if (c.kind === "upper") next = cur.toUpperCase()
                      else if (c.kind === "lower") next = cur.toLowerCase()
                      else if (c.kind === "title") next = cur.replace(/\w\S*/g, (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                      if (next === cur) return
                      obj.set("text", next)
                      if (obj.initDimensions) obj.initDimensions()
                      obj.setCoords()
                      obj.dirty = true
                      fabricRef.current?.requestRenderAll()
                      setSelectedTick(t => t + 1)
                      isDirtyRef.current = true
                      setIsDirty(true)
                      if (isInitialized.current && !isApplyingHistory.current) pushHistory()
                      doSave()
                    }}
                    title={c.title}
                    style={{
                      flex: 1, height: 28,
                      background: "#111",
                      border: "1px solid #2a2a2a",
                      color: "white",
                      borderRadius: 4, cursor: "pointer",
                      fontSize: 13, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            </>)}

            <div>
              <div style={secS}>Color {mixedFill && <span style={{ color: "#888", fontWeight: 400, fontStyle: "italic" }}>(multiple)</span>}</div>
              <ColorSwatchPicker
                value={mixedFill ? "" : (effectiveFill || "")}
                onChange={(hex, brandIdx) => applyStyle("fill", hex, brandIdx)}
                brandColors={brandColors as any}
                defaultSwatches={SWATCHES}
                activeBrandIdx={typeof (selected as any).__fillBrandIdx === "number" ? (selected as any).__fillBrandIdx : undefined}
                opacity={((selected as any).opacity ?? 1) * 100}
                onOpacityChange={pct => changeObjectOpacity(pct / 100)}
                // CRITICO per-char: captura selection ANTES do click roubar
                // foco do textbox. Sem isso, applyStyle ve isEditing=false +
                // savedTextSelection stale → aplica fill no textbox INTEIRO
                // (perde colors per-char). Mesmo pattern do fontSize input
                // (linha ~9602).
                onMouseDownCapture={() => {
                  const fc = fabricRef.current
                  const active = fc?.getActiveObject() as any
                  if (active?.isEditing && active.selectionStart !== active.selectionEnd) {
                    savedTextSelection.current = { obj: active, start: active.selectionStart, end: active.selectionEnd }
                  }
                }}
              />
            </div>

            {/* SCALE PRESETS + FIT TO CANVAS — movido pra BAIXO de todas as
                settings de texto (user pedido 2026-05-23): "passe esse fit
                canvas para baixo de todos os settings de texto". tabIndex=-1
                pra Tab pular esses controles (Size→Line height→Letter spacing
                vai direto). */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                {[0.2, 0.4, 0.6, 0.8].map(pct => (
                  <button
                    key={pct}
                    type="button"
                    tabIndex={-1}
                    onClick={() => scaleLayerToCanvas(pct)}
                    title={`Scale the layer to ${Math.round(pct * 100)}% of canvas (centered)`}
                    style={{ background: "#222", border: "1px solid #2a2a2a", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#aaa" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.color = "#fff" }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.color = "#aaa" }}
                  >
                    {Math.round(pct * 100)}%
                  </button>
                ))}
              </div>
              <button onClick={fitLayerToCanvas} tabIndex={-1}
                style={{ background: "#F5C400", border: "none", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#111" }}
                title="Scale and center the layer inside the piece (100%)">
                Fit to canvas
              </button>
              {/* Center H + V separados (user 2026-05-29 "cade o center da
                  imagem") — Photoshop/Illustrator style: 2 botoes pra alinhar
                  so um eixo. "Center" sozinho continua via Cmd+Shift+C. */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                <button onClick={() => centerObjectInCanvas("x")} tabIndex={-1}
                  style={{ background: "#222", border: "1px solid #2a2a2a", borderRadius: 6, padding: "6px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#aaa" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.color = "#fff" }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.color = "#aaa" }}
                  title="Centralizar horizontalmente no canvas (eixo X)">
                  Center H
                </button>
                <button onClick={() => centerObjectInCanvas("y")} tabIndex={-1}
                  style={{ background: "#222", border: "1px solid #2a2a2a", borderRadius: 6, padding: "6px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#aaa" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.color = "#fff" }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.color = "#aaa" }}
                  title="Centralizar verticalmente no canvas (eixo Y)">
                  Center V
                </button>
              </div>
            </div>

            {/* ===== MÁSCARA (Photoshop-style) ===== */}
            <MaskPanel
              selected={selected}
              onAddClipping={addClippingMaskToSelected}
              onAddRectVector={(reveal) => addRectVectorMaskToSelected(reveal)}
              onAddEllipseVector={(reveal) => addEllipseVectorMaskToSelected(reveal)}
              onToggleEnabled={() => toggleMaskEnabled(selected)}
              onToggleInverted={() => toggleMaskInverted(selected)}
              onRemove={() => removeMaskFromObject(selected)}
              secS={secS}
            />
          </div>
            )
          })()
        ) : ((selected as any).__isShape === true || selected.type === "path" || selected.type === "Path") ? (
          /* SHAPE editor (Fabric.Path) — fill + stroke + stroke-width editaveis.
             Mantem o path vetorial vivo (sem rasterizar), preservando edicao
             Photoshop-like. Sincroniza com Fabric via .set + renderAll.

             Fill/Stroke OPACITIES sao INDEPENDENTES (Figma-style): codificadas
             no proprio color string como rgba(r,g,b,a). A opacity da CAMADA
             (objeto inteiro) multiplica ambas. Isso evita o bug "stroke=0
             apaga o fill" que tinha quando ambas amarravam a obj.opacity. */
          (() => {
            const fc = fabricRef.current
            // Color helpers — parse e (re)emite rgba/hex pra preservar alpha.
            function parseColor(c: string): { hex: string; alpha: number } {
              if (typeof c !== "string" || !c) return { hex: "", alpha: 1 }
              const hexM = /^#([0-9a-fA-F]{6})$/.exec(c.trim())
              if (hexM) return { hex: `#${hexM[1].toLowerCase()}`, alpha: 1 }
              const hex8 = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/.exec(c.trim())
              if (hex8) return { hex: `#${hex8[1].toLowerCase()}`, alpha: Math.round((parseInt(hex8[2], 16) / 255) * 1000) / 1000 }
              const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(c.trim())
              if (rgba) {
                const r = parseInt(rgba[1], 10), g = parseInt(rgba[2], 10), b = parseInt(rgba[3], 10)
                const a = rgba[4] ? parseFloat(rgba[4]) : 1
                const hex = `#${[r, g, b].map(n => n.toString(16).padStart(2, "0")).join("")}`
                return { hex, alpha: a }
              }
              return { hex: c, alpha: 1 }
            }
            function combineHexAlpha(hex: string, alpha: number): string {
              if (!hex) return ""
              const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
              if (!m) return hex
              if (alpha >= 0.999) return `#${m[1].toLowerCase()}`
              const n = parseInt(m[1], 16)
              const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff
              return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`
            }
            const fillParsed = parseColor(selected.fill ?? "")
            const strokeParsed = parseColor(selected.stroke ?? "")
            const currentFillHex = fillParsed.hex || "#000000"
            const currentFillAlpha = fillParsed.alpha
            const currentStrokeHex = strokeParsed.hex || ""
            const currentStrokeAlpha = strokeParsed.alpha
            // UI mostra o valor NATURAL (que o user setou), nao o dobrado pelo
            // hack visual de inside/outside. Sem isso, user via 20px quando
            // setou 10 + position=inside — confunde + slider re-aplica em
            // cima do dobrado virando 40px no proximo change.
            const currentStrokeWidth = typeof (selected as any).__naturalStrokeWidth === "number"
              ? (selected as any).__naturalStrokeWidth
              : ((selected as any).strokeWidth ?? 0)
            const shapeKind = (selected as any).__shapeKind as ("rectangle"|"roundedRect"|"ellipse"|undefined)
            const currentCornerRadius = (selected as any).__cornerRadius ?? 20
            // Dimensoes do shape: PRIORIDADE pro path interno (__pathBbox).
            // Antes usavamos so __pathBbox que ficava stale apos scaling. Agora
            // verificamos tambem obj.width/height (live Fabric path dims).
            const pathBboxRaw = (selected as any).__pathBbox ?? { left: 0, top: 0, right: 400, bottom: 300 }
            const bboxW = Math.max(1, (selected as any).width ?? ((pathBboxRaw.right ?? 400) - (pathBboxRaw.left ?? 0)))
            const bboxH = Math.max(1, (selected as any).height ?? ((pathBboxRaw.bottom ?? 300) - (pathBboxRaw.top ?? 0)))
            const maxRadius = Math.floor(Math.min(bboxW, bboxH) / 2)
            function setCornerRadius(r: number) {
              if (!fc || !selected) return
              // Clamp HARD pra evitar shape degenerado (circulo quando r >= min/2).
              // O input HTML max eh "soft" — user pode digitar valor maior.
              const clamped = Math.max(0, Math.min(r, maxRadius))
              // Promove rectangle pra roundedRect ao receber raio > 0 (Adobe-style:
              // user nao precisa "converter" antes — mexer no slider faz a conversao).
              // shapeKind ja era roundedRect: mantem. ellipse: nao se aplica (input
              // fica disabled mas se chegar aqui via codigo, ignora).
              const curKind = (selected as any).__shapeKind
              if (curKind === "ellipse") return
              const targetKind: "roundedRect" | "rectangle" = clamped > 0 ? "roundedRect" : "rectangle"
              const newPath = buildShapePath(targetKind, bboxW, bboxH, clamped)
              applyShapePathInPlace(selected, newPath)
              ;(selected as any).__shapeKind = targetKind
              ;(selected as any).__cornerRadius = clamped
              fc.requestRenderAll()
              setSelectedTick(t => t + 1)
              isDirtyRef.current = true
              setIsDirty(true)
              if (isInitialized.current && !isApplyingHistory.current) pushHistory()
              doSave()
            }
            function setShapeProp(key: "fill" | "stroke" | "strokeWidth" | "strokePosition", val: any) {
              if (!fc || !selected) return
              // strokePosition: salva como __strokePosition + reaplica visual
              if (key === "strokePosition") {
                if (val !== "inside" && val !== "center" && val !== "outside") return
                ;(selected as any).__strokePosition = val
                // Re-importa Path do fabric pra acessar o ctor
                import("fabric").then(fab => {
                  applyStrokePositionVisual(selected as any, val, fab.Path)
                  ;(selected as any).setCoords?.()
                  ;(selected as any).dirty = true
                  fc.requestRenderAll()
                  setSelectedTick(t => t + 1)
                  isDirtyRef.current = true
                  setIsDirty(true)
                  if (isInitialized.current && !isApplyingHistory.current) pushHistory()
                  doSave()
                })
                return
              }
              // Compensacao Photoshop-center: ao mudar strokeWidth, ajusta
              // left/top pra metade do delta em cada lado. Sem isso, Fabric
              // mantem o anchor top-left fixo e o bbox cresce pra direita+
              // baixo (path inside shifta visualmente). Com compensacao, o
              // path stays no mesmo lugar visual — comportamento Adobe-fiel.
              if (key === "strokeWidth") {
                const oldNat = (selected as any).__naturalStrokeWidth
                const oldW = typeof oldNat === "number" ? oldNat : ((selected as any).strokeWidth ?? 0)
                const newW = Number(val) || 0
                const delta = (newW - oldW) / 2
                if (delta !== 0) {
                  ;(selected as any).set({
                    left: ((selected as any).left ?? 0) - delta,
                    top: ((selected as any).top ?? 0) - delta,
                  })
                }
                // Atualiza natural pra que applyStrokePositionVisual reaja certo
                ;(selected as any).__naturalStrokeWidth = newW
                // Reaplica visual com novo width
                const pos = (selected as any).__strokePosition ?? "center"
                import("fabric").then(fab => {
                  applyStrokePositionVisual(selected as any, pos, fab.Path)
                  ;(selected as any).setCoords?.()
                  ;(selected as any).dirty = true
                  fc.requestRenderAll()
                  setSelectedTick(t => t + 1)
                  isDirtyRef.current = true
                  setIsDirty(true)
                  if (isInitialized.current && !isApplyingHistory.current) pushHistory()
                  doSave()
                })
                return
              }
              // Aqui key eh "fill" ou "stroke" (strokeWidth e strokePosition
              // ja tiveram early-return acima). Aplica direto.
              ;(selected as any).set(key, val)
              // strokeUniform pra qualquer mudanca de stroke
              if (key === "stroke") {
                ;(selected as any).set("strokeUniform", true)
              }
              ;(selected as any).setCoords?.() // recalc bbox + handles
              ;(selected as any).dirty = true
              fc.requestRenderAll()
              setSelectedTick(t => t + 1)
              isDirtyRef.current = true
              setIsDirty(true)
              if (isInitialized.current && !isApplyingHistory.current) pushHistory()
              doSave()
            }
            // Setters INDEPENDENTES: combinam hex novo com alpha atual (e vice-versa).
            const setFillHex = (hex: string) => setShapeProp("fill", combineHexAlpha(hex, currentFillAlpha))
            const setFillAlpha = (pct: number) => setShapeProp("fill", combineHexAlpha(currentFillHex, Math.max(0, Math.min(1, pct / 100))))
            const setStrokeHex = (hex: string) => setShapeProp("stroke", combineHexAlpha(hex, currentStrokeAlpha))
            const setStrokeAlpha = (pct: number) => setShapeProp("stroke", combineHexAlpha(currentStrokeHex, Math.max(0, Math.min(1, pct / 100))))
            return (
              <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
                {/* Label do layer removido (2026-05-22) — redundante com o
                    painel Layers que ja destaca o ativo. Padding reduzido
                    radical 2026-05-26. */}

                {/* BLEND MODE + OPACITY na mesma linha — padrao ZZOSY. */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 92px", gap: 8 }}>
                  <div>
                    <div style={secS}>Blend mode</div>
                    <select
                      value={(selected as any).globalCompositeOperation ?? "source-over"}
                      onChange={e => changeObjectBlendMode(e.target.value)}
                      style={{ ...inpS, cursor: "pointer", appearance: "none", paddingRight: 20, width: "100%" }}
                    >
                      <option value="source-over">Normal</option>
                      <option value="multiply">Multiply</option>
                      <option value="screen">Screen</option>
                      <option value="overlay">Overlay</option>
                      <option value="darken">Darken</option>
                      <option value="lighten">Lighten</option>
                      <option value="color-dodge">Color Dodge</option>
                      <option value="color-burn">Color Burn</option>
                      <option value="hard-light">Hard Light</option>
                      <option value="soft-light">Soft Light</option>
                      <option value="difference">Difference</option>
                      <option value="exclusion">Exclusion</option>
                    </select>
                  </div>
                  <div>
                    <div style={secS}>Opacity</div>
                    <div style={numFieldRight}>
                      <input type="number" min={0} max={100} step={1}
                        value={Math.round(((selected as any).opacity ?? 1) * 100)}
                        onChange={e => changeObjectOpacity((Number(e.target.value) || 0) / 100)}
                        style={numInpS} />
                      <span style={numFieldUnit}>%</span>
                    </div>
                  </div>
                </div>

                {/* FILL — ColorSwatchPicker Figma-style. Opacity INDEPENDENTE
                    (encodada em rgba do fill). Gradient/Pattern ainda nao
                    implementados pra shape — roadmap. User pode usar BG do
                    canvas pra gradients agora. */}
                <div>
                  <div style={secS}>Fill</div>
                  <ColorSwatchPicker
                    value={currentFillHex}
                    onChange={(hex) => setFillHex(hex)}
                    brandColors={brandColors as any}
                    defaultSwatches={SWATCHES}
                    allowEmpty
                    opacity={Math.round(currentFillAlpha * 100)}
                    onOpacityChange={pct => setFillAlpha(pct)}
                  />
                  <div style={{ fontSize: 10, color: "#555", marginTop: 4, fontStyle: "italic" }}
                    title="Gradient/Pattern fill em desenvolvimento. Por enquanto so cor solida. Pra gradients use o background do canvas (BG do KV).">
                    Gradient · em breve
                  </div>
                </div>

                {/* STROKE — cor (ColorSwatchPicker com opacity inline, mesmo
                    padrao Figma do FILL) + espessura abaixo. Opacity INDEPENDENTE
                    da fill — antes amarrava obj.opacity e zerar stroke escondia
                    tudo (bug reportado 2026-05-22). */}
                <div>
                  <div style={secS}>Stroke</div>
                  <ColorSwatchPicker
                    value={currentStrokeHex}
                    onChange={(hex) => {
                      setStrokeHex(hex)
                      // Setar stroke com width=0 deixa ele invisivel — auto-applica 1px
                      // pra user ver o stroke imediatamente.
                      if (hex && currentStrokeWidth === 0) setShapeProp("strokeWidth", 1)
                      // Limpar stroke (∅) zera width tambem.
                      if (!hex) setShapeProp("strokeWidth", 0)
                    }}
                    brandColors={brandColors as any}
                    defaultSwatches={SWATCHES}
                    allowEmpty
                    opacity={Math.round(currentStrokeAlpha * 100)}
                    onOpacityChange={pct => setStrokeAlpha(pct)}
                  />
                  {/* Espessura — slider + numero. Grid `1fr 92px` + gap 6 padronizado
                      com CAMADA pra alinhamento visual consistente do right column. */}
                  <div style={{ ...numFieldGrid, marginTop: 8 }}>
                    <input type="range" min={0} max={50} step={1}
                      value={currentStrokeWidth}
                      onChange={e => setShapeProp("strokeWidth", Number(e.target.value))}
                      style={{ width: "100%" }} />
                    <div style={numFieldRight}>
                      <input type="number" min={0} max={500} step={1}
                        value={currentStrokeWidth}
                        onChange={e => setShapeProp("strokeWidth", Number(e.target.value) || 0)}
                        style={numInpS} />
                      <span style={numFieldUnit}>px</span>
                    </div>
                  </div>
                </div>

                {/* RAIO DO CANTO — SEMPRE renderiza pra qualquer shape selecionado
                    (request user 2026-05-23: Fill/Stroke/Raio sao as 3 props basicas
                    de todo shape). Disable pra ellipse (nao se aplica) e arbitrary
                    path (sem __shapeKind — converter perderia o desenho original).
                    Pra rectangle, mexer no slider auto-promove a roundedRect. */}
                {(() => {
                  // Allow corner radius para: parametric rect/roundedRect E para
                  // PSD shapes sem kind (auto-promove pra roundedRect ao mexer —
                  // mesma logica que load detecta no userPromoted). So bloqueia
                  // ellipse (matematicamente nao se aplica). Sintoma reportado
                  // 2026-05-23: "nao consigo alterar CR no Properties" — input
                  // ficava disabled pra todo shape importado de PSD.
                  const radiusApplicable = shapeKind !== "ellipse"
                  const disabledTitle = shapeKind === "ellipse"
                    ? "Corner radius does not apply to ellipses"
                    : undefined
                  const displayRadius = radiusApplicable ? Math.min(currentCornerRadius, maxRadius) : 0
                  return (
                    <div>
                      <div style={secS}>Corner radius</div>
                      <div style={numFieldGrid}>
                        <input type="range"
                          min={0} max={maxRadius} step={1}
                          value={displayRadius}
                          disabled={!radiusApplicable}
                          title={disabledTitle}
                          onChange={e => setCornerRadius(Number(e.target.value))}
                          style={{ width: "100%", opacity: radiusApplicable ? 1 : 0.4, cursor: radiusApplicable ? "pointer" : "not-allowed" }} />
                        <div style={numFieldRight}>
                          <input type="number"
                            min={0} max={maxRadius} step={1}
                            value={displayRadius}
                            disabled={!radiusApplicable}
                            title={disabledTitle}
                            onChange={e => setCornerRadius(Number(e.target.value) || 0)}
                            style={{ ...numInpS, opacity: radiusApplicable ? 1 : 0.4, cursor: radiusApplicable ? "text" : "not-allowed" }} />
                          <span style={numFieldUnit}>px</span>
                        </div>
                      </div>
                    </div>
                  )
                })()}
                {/* POSITION 2026-05-27: Photoshop lineAlignment, abaixo do
                    corner radius (user pediu reorder). Save em ov.strokePosition
                    + writer PSD (vectorStroke.lineAlignment). No editor sempre
                    renderiza center-stroke; metadata so pra round-trip. */}
                {(() => {
                  const currentPos = (selected as any)?.__strokePosition ?? "center"
                  const opts: Array<"inside" | "center" | "outside"> = ["inside", "center", "outside"]
                  return (
                    <div>
                      <div style={secS}>Posição do stroke</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
                        {opts.map(p => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setShapeProp("strokePosition", p)}
                            style={{
                              padding: "6px 4px",
                              fontSize: 11,
                              fontWeight: 600,
                              background: currentPos === p ? "#F5C400" : "transparent",
                              color: currentPos === p ? "#111" : "#aaa",
                              border: `1px solid ${currentPos === p ? "#F5C400" : "#333"}`,
                              borderRadius: 4,
                              cursor: "pointer",
                            }}
                            title={
                              p === "inside" ? "Stroke todo dentro do path (PSD: lineAlignment inside)" :
                              p === "center" ? "Metade dentro / metade fora (PSD default)" :
                              "Stroke todo fora do path (PSD: lineAlignment outside)"
                            }
                          >
                            {p === "inside" ? "Dentro" : p === "center" ? "Centro" : "Fora"}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                {/* FIT TO CANVAS + CENTER NO CANVAS — user pediu 2026-05-27:
                    'quero os botoes de fit e center'. Aplica ao shape selecionado:
                    - Fit: ajusta scale pra ocupar 100% do canvas (mantem aspect)
                    - Center: posiciona shape no centro do canvas (mantem dims) */}
                <div>
                  <div style={secS}>Posicionar no canvas</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                    <button type="button"
                      onClick={() => fitSelectedToCanvas()}
                      style={{ padding: "6px 4px", fontSize: 11, fontWeight: 600,
                        background: "transparent", color: "#aaa",
                        border: "1px solid #333", borderRadius: 4, cursor: "pointer" }}
                      title="Ajusta o layer pra ocupar o canvas inteiro (preserva aspect ratio)"
                    >Encaixar</button>
                    {/* Center H/V separados — sweep do mesmo padrao dos paineis TEXT/IMAGE. */}
                    <button type="button"
                      onClick={() => centerObjectInCanvas("x")}
                      style={{ padding: "6px 4px", fontSize: 11, fontWeight: 600,
                        background: "transparent", color: "#aaa",
                        border: "1px solid #333", borderRadius: 4, cursor: "pointer" }}
                      title="Centraliza horizontalmente (eixo X)"
                    >Centro H</button>
                    <button type="button"
                      onClick={() => centerObjectInCanvas("y")}
                      style={{ padding: "6px 4px", fontSize: 11, fontWeight: 600,
                        background: "transparent", color: "#aaa",
                        border: "1px solid #333", borderRadius: 4, cursor: "pointer" }}
                      title="Centraliza verticalmente (eixo Y)"
                    >Centro V</button>
                  </div>
                </div>
              </div>
            )
          })()
        ) : (
          <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
            {/* Label do layer removido (2026-05-22) — painel Layers ja indica
                qual layer esta ativo, sem duplicar info aqui. */}
            {/* BLEND MODE + OPACITY na mesma linha — padrao ZZOSY. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 92px", gap: 8 }}>
              <div>
                <div style={secS}>Blend mode</div>
                <select
                  value={(selected as any).globalCompositeOperation ?? "source-over"}
                  onChange={e => changeObjectBlendMode(e.target.value)}
                  style={{ ...inpS, cursor: "pointer", appearance: "none", paddingRight: 20, width: "100%" }}
                  title="Layer blend mode (Photoshop-style)"
                >
                  <option value="source-over">Normal</option>
                  <option value="multiply">Multiply</option>
                  <option value="screen">Screen</option>
                  <option value="overlay">Overlay</option>
                  <option value="darken">Darken</option>
                  <option value="lighten">Lighten</option>
                  <option value="color-dodge">Color Dodge</option>
                  <option value="color-burn">Color Burn</option>
                  <option value="hard-light">Hard Light</option>
                  <option value="soft-light">Soft Light</option>
                  <option value="difference">Difference</option>
                  <option value="exclusion">Exclusion</option>
                  <option value="hue">Hue</option>
                  <option value="saturation">Saturation</option>
                  <option value="color">Color</option>
                  <option value="luminosity">Luminosity</option>
                  <option value="lighter">Linear Dodge</option>
                </select>
              </div>
              <div>
                <div style={secS}>Opacity</div>
                <div style={numFieldRight}>
                  <input
                    type="number" min={0} max={100} step={1}
                    value={Math.round(((selected as any).opacity ?? 1) * 100)}
                    onChange={e => changeObjectOpacity((Number(e.target.value) || 0) / 100)}
                    title="Opacity (0-100%)"
                    style={numInpS}
                  />
                  <span style={numFieldUnit}>%</span>
                </div>
              </div>
            </div>
            <div>
              <div style={secS}>Replace Asset</div>
              <select
                value={(selected as any).__assetId ?? ""}
                onChange={e => {
                  const newAsset = (campaign?.assets ?? []).find(a => a.id === e.target.value)
                  if (newAsset) {
                    const currentObj = fabricRef.current?.getActiveObject() ?? selected
                    swapAsset(currentObj, newAsset)
                  }
                }}
                style={{ ...inpS, cursor: "pointer", appearance: "none", paddingRight: 24 }}
              >
                {(campaign?.assets ?? [])
                  .filter(a => a.type === "IMAGE" || a.type === "SMART_OBJECT")
                  .map(a => (
                    <option key={a.id} value={a.id}>{a.label || "Unnamed"}</option>
                  ))
                }
              </select>
            </div>
            {(() => {
              // "Edit Smart Object" — quando o asset selecionado eh um SO, abre
              // o mini-editor /edit-so (Photoshop "Edit Contents" equivalente).
              const assetId = (selected as any).__assetId
              const asset = (campaign?.assets ?? []).find(a => a.id === assetId)
              if (!asset || asset.type !== "SMART_OBJECT") return null
              return (
                <a
                  href={`/campaigns/${campaignId}/assets/${assetId}/edit-so`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "block", textAlign: "center",
                    background: "#F5C400", border: "none", borderRadius: 6,
                    padding: "8px 12px", fontSize: 12, fontWeight: 700,
                    color: "#111", textDecoration: "none",
                  }}
                  title="Abrir editor do Smart Object (Photoshop: Edit Contents) — propaga ao salvar"
                >
                  ✎ Editar Smart Object
                </a>
              )
            })()}
            <div style={{ color: "#444", fontSize: 11 }}>Move and resize on canvas.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
              {[0.2, 0.4, 0.6, 0.8].map(pct => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => scaleLayerToCanvas(pct)}
                  title={`Scale the layer to ${Math.round(pct * 100)}% of canvas (centered)`}
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
              title="Scale and center the layer inside the piece (100%)">
              Fit to canvas
            </button>
            {/* Center H + V separados (user 2026-05-29 "cade o center da
                imagem") — Photoshop/Illustrator style. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              <button onClick={() => centerObjectInCanvas("x")}
                style={{ background: "#222", border: "1px solid #2a2a2a", borderRadius: 6, padding: "6px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#aaa" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.color = "#fff" }}
                onMouseLeave={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.color = "#aaa" }}
                title="Centralizar horizontalmente no canvas (eixo X)">
                Center H
              </button>
              <button onClick={() => centerObjectInCanvas("y")}
                style={{ background: "#222", border: "1px solid #2a2a2a", borderRadius: 6, padding: "6px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#aaa" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#2a2a2a"; e.currentTarget.style.color = "#fff" }}
                onMouseLeave={e => { e.currentTarget.style.background = "#222"; e.currentTarget.style.color = "#aaa" }}
                title="Centralizar verticalmente no canvas (eixo Y)">
                Center V
              </button>
            </div>

            {/* ===== MÁSCARA (Photoshop-style) ===== */}
            <MaskPanel
              selected={selected}
              onAddClipping={addClippingMaskToSelected}
              onAddRectVector={(reveal) => addRectVectorMaskToSelected(reveal)}
              onAddEllipseVector={(reveal) => addEllipseVectorMaskToSelected(reveal)}
              onToggleEnabled={() => toggleMaskEnabled(selected)}
              onToggleInverted={() => toggleMaskInverted(selected)}
              onRemove={() => removeMaskFromObject(selected)}
              secS={secS}
            />
          </div>
        )}
      </div>

      {confirmExit && (() => {
        // Adapta texto/botoes ao estado: dirty mostra 3 opcoes (Cancelar/Descartar/
        // Salvar e sair); limpo NAO pergunta (CLAUDE.md 2.1) — sai direto.
        // Caso comum: user clicou Voltar com isDirty=true mas saveNow async
        // resetou pra false antes do render do dialog (race). Aqui detectamos
        // e auto-exit sem incomodar.
        const dirty = isDirtyRef.current || isDirty
        if (!dirty) {
          const go = confirmExit
          // setConfirmExit em microtask pra nao rodar setState durante render
          Promise.resolve().then(() => {
            setConfirmExit(null)
            try { go() } catch (e) { console.warn("[ConfirmExit] auto-exit go() falhou:", e) }
          })
          return null
        }
        return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#1a1a1a", borderRadius: 10, padding: 24, width: 420, border: "1px solid #333" }}>
            <div style={{ color: "white", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              {dirty ? "Save changes?" : "Back to campaign?"}
            </div>
            <div style={{ color: "#888", fontSize: 13, marginBottom: 18 }}>
              {dirty
                ? "You have unsaved changes. What would you like to do?"
                : "All saved. Do you want to exit the editor?"}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmExit(null)}
                style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "8px 14px", color: "#888", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              {dirty && (
                <button onClick={() => {
                  const go = confirmExit
                  setConfirmExit(null)
                  // Reseta isDirty ANTES de navegar pra que o beforeunload
                  // listener do browser nao dispare o "Leave site?" nativo
                  // (user ja decidiu via nosso dialog).
                  isDirtyRef.current = false
                  setIsDirty(false)
                  if (go) go()
                }}
                  style={{ background: "transparent", border: "1px solid #d33", borderRadius: 6, padding: "8px 14px", color: "#d33", fontSize: 13, cursor: "pointer" }}>Discard</button>
              )}
              <button onClick={async () => {
                const go = confirmExit
                setConfirmExit(null)
                if (dirty) {
                  try {
                    await saveNow()
                    console.log("[ConfirmExit] save completo, navegando…")
                  } catch (e) {
                    console.warn("[ConfirmExit] saveNow falhou:", e)
                  }
                }
                if (go) {
                  try { go() } catch (e) { console.warn("[ConfirmExit] go() falhou:", e) }
                }
              }}
                style={{ background: accentColor, border: "none", borderRadius: 6, padding: "8px 14px", color: "#111", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {dirty ? "Save" : "Exit"}
              </button>
            </div>
          </div>
        </div>
        )
      })()}

      {exportOpen && exportPieces.length > 0 && (
        <ExportDialog
          pieces={exportPieces}
          campaignName={(campaign as any)?.title ?? (campaign as any)?.name}
          onClose={() => { setExportOpen(false); setExportPieces([]) }}
        />
      )}

      {modal && <GeneratePiecesModal
        campaignId={campaignId}
        fabricRef={fabricRef}
        onClose={() => setModal(false)}
        onGenerated={() => { setModal(false); router.push(`/pieces?campaignId=${campaignId}`) }}
        ensureSaved={async () => {
          // performSave() faz o flush sincrono REAL pro DB (doSaveNow so
          // marca dirty). User reportou 2026-05-30 que pecas geradas vinham
          // sem assets recem-adicionados — race entre addLayer (async save
          // debounceado) e o fetch do modal. performSave aguarda PUT
          // terminar antes do generate prosseguir.
          try { await performSave() } catch (e) { console.warn("[ensureSaved] performSave falhou:", e) }
        }}
      />}

      {/* PsdImporter renderizado escondido — usado pelo botao "Importar PSD"
          da topbar via ref.importFile(file). Sem isso, teriamos que duplicar
          toda a logica de upload + assets + smart objects do PsdImporter. */}
      <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", visibility: "hidden", pointerEvents: "none" }}>
        <PsdImporter
          ref={psdImporterRef}
          campaignId={campaignId}
          onImported={() => {
            // Recarrega o editor com a nova KV. window.location forca full reload
            // (App Router fetch revalida o `/api/campaigns/:id` + KV).
            if (typeof window !== "undefined") window.location.reload()
          }}
        />
      </div>

      {/* Banner de fontes ausentes — aparece quando uma fonte usada por algum
          asset NAO esta disponivel no browser (Google Fonts 404 silencioso ou
          fonte custom nunca uploadada). Sintoma sem este banner: preview do KV
          (raster PSD) vem perfeito, mas Textbox cai em Arial sem o user saber.
          Botao "Subir fonte" usa o mesmo fluxo do PsdImporter modal — file
          picker .ttf/.otf, salva em customFontFiles do cliente, recarrega a
          familia in-tab. */}
      {missingFonts.length > 0 && (
        <div style={{
          position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)",
          maxWidth: 720, width: "calc(100% - 32px)",
          background: "#1a1a1a", border: "1px solid #facc15", borderLeft: "4px solid #facc15",
          borderRadius: 8, padding: "12px 16px", zIndex: 9000,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#facc15", marginBottom: 2 }}>
              Fonts not found — {missingFonts.length} variant{missingFonts.length > 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: 12, color: "#ccc", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {missingFonts.slice(0, 3).map(f => f.label).join(", ")}{missingFonts.length > 3 ? `, +${missingFonts.length - 3}` : ""}
            </div>
          </div>
          <button
            onClick={() => setFontsModalOpen(true)}
            disabled={!campaign?.client?.id}
            title={campaign?.client?.id ? "Open missing fonts manager" : "Client not identified"}
            style={{
              background: campaign?.client?.id ? "#facc15" : "#333",
              color: campaign?.client?.id ? "#000" : "#666",
              border: "none", borderRadius: 6,
              padding: "8px 14px", fontSize: 12, fontWeight: 700,
              cursor: campaign?.client?.id ? "pointer" : "not-allowed", flexShrink: 0,
            }}
          >
            Resolve fonts
          </button>
          <button
            onClick={() => setMissingFonts([])}
            title="Close notice (does not resolve, only hides)"
            style={{
              background: "transparent", border: "none", color: "#666",
              fontSize: 18, cursor: "pointer", padding: "0 4px", lineHeight: 1, flexShrink: 0,
            }}
          >×</button>
        </div>
      )}

      {/* Modal de gerenciamento de fontes ausentes — estilo Adobe "Find Font".
          Pra cada variante missing: nome + dropdown "Substituir por..." +
          botao de upload do arquivo .ttf/.otf. Substituir aplica imediato no
          canvas; upload registra como customFontFile do cliente. */}
      {fontsModalOpen && missingFonts.length > 0 && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setFontsModalOpen(false) }}
          style={{
            position: "fixed", inset: 0, zIndex: 9500,
            background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
        >
          <div style={{
            background: "#1a1a1a", color: "#fff",
            borderRadius: 12, border: "1px solid #333",
            width: "100%", maxWidth: 760, maxHeight: "85vh",
            display: "flex", flexDirection: "column",
            boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          }}>
            <div style={{ padding: "18px 20px", borderBottom: "1px solid #2a2a2a" }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                Missing fonts
              </div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.5 }}>
                Each variant from the PSD that is not available in the browser. Replace with
                an already installed font or upload the exact <code style={{ background: "#0f0f0f", padding: "1px 5px", borderRadius: 3 }}>.ttf</code>/<code style={{ background: "#0f0f0f", padding: "1px 5px", borderRadius: 3 }}>.otf</code> file.
                Replacement affects only the texts that use this specific variant.
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
              {/* Sub-header das colunas — Adobe-style alinhamento visual */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 170px 130px 100px 100px",
                gap: 8, alignItems: "center",
                padding: "6px 8px",
                fontSize: 9, color: "#666", fontWeight: 700,
                textTransform: "uppercase", letterSpacing: 0.6,
              }}>
                <div>Missing font</div>
                <div>Replace family</div>
                <div>Weight / style</div>
                <div></div>
                <div></div>
              </div>
              {missingFonts.map((mf, idx) => {
                const familyOptions: Array<{ value: string; label: string; group: string }> = []
                const brandFont = campaign?.client?.brandFont
                if (typeof brandFont === "string" && brandFont.trim()) {
                  familyOptions.push({ value: brandFont, label: brandFont, group: "Brand" })
                }
                const SYSTEM = ["Arial", "Helvetica", "Times New Roman", "Georgia", "Verdana", "Tahoma", "Courier New"]
                for (const s of SYSTEM) {
                  if (s !== brandFont) familyOptions.push({ value: s, label: s, group: "System" })
                }
                for (const g of GOOGLE_FONTS) {
                  if (g.name !== brandFont) familyOptions.push({ value: g.name, label: g.name, group: "Google Fonts" })
                }
                const groups = ["Brand", "System", "Google Fonts"] as const
                // 9 pesos × 2 estilos. Label legivel mantem a paridade com Adobe.
                const WEIGHT_STYLE_OPTIONS: Array<{ value: string; label: string }> = [
                  { value: "100|normal", label: "Thin" },
                  { value: "100|italic", label: "Thin Italic" },
                  { value: "200|normal", label: "ExtraLight" },
                  { value: "200|italic", label: "ExtraLight Italic" },
                  { value: "300|normal", label: "Light" },
                  { value: "300|italic", label: "Light Italic" },
                  { value: "400|normal", label: "Regular" },
                  { value: "400|italic", label: "Italic" },
                  { value: "500|normal", label: "Medium" },
                  { value: "500|italic", label: "Medium Italic" },
                  { value: "600|normal", label: "SemiBold" },
                  { value: "600|italic", label: "SemiBold Italic" },
                  { value: "700|normal", label: "Bold" },
                  { value: "700|italic", label: "Bold Italic" },
                  { value: "800|normal", label: "ExtraBold" },
                  { value: "800|italic", label: "ExtraBold Italic" },
                  { value: "900|normal", label: "Black" },
                  { value: "900|italic", label: "Black Italic" },
                ]
                const choice = replacementChoices[mf.label] ?? {}
                // Default do dropdown de peso: peso da fonte missing (Adobe-style:
                // se voce esta substituindo Bold Italic, comeca em Bold Italic).
                const effectiveWeight = choice.weight ?? mf.weight
                const effectiveStyle = choice.style ?? mf.style
                const currentWeightValue = `${effectiveWeight}|${effectiveStyle}`
                const canApply = !!choice.family

                async function applySubstitution(family: string, weight: number, style: "normal" | "italic") {
                  try {
                    const { loadGoogleFont, forceLoadFontFaces } = await import("@/lib/google-fonts")
                    const isGoogle = GOOGLE_FONTS.some(g => g.name === family)
                    if (isGoogle) {
                      loadGoogleFont(family)
                      await forceLoadFontFaces([family], 4000)
                    }
                  } catch {}
                  // Aplica trocando a familia E sincronizando weight+style nos
                  // textos afetados — Photoshop-style "replace with this weight".
                  const fc = fabricRef.current
                  if (fc) {
                    const weightToNum = (w: any): number => {
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
                    const styleToCanon = (s: any): "normal" | "italic" =>
                      typeof s === "string" && /italic|oblique/i.test(s) ? "italic" : "normal"
                    let touched = 0
                    for (const o of fc.getObjects()) {
                      if (o.type !== "textbox" && o.type !== "i-text") continue
                      const tb = o as any
                      // Snapshot defaults antes de mexer — fallback per-char tem
                      // que comparar contra valor original, nao o ja substituido.
                      const origFamily = tb.fontFamily
                      const origWeight = tb.fontWeight
                      const origStyle = tb.fontStyle
                      const matchesDefault = origFamily === mf.family
                        && weightToNum(origWeight) === mf.weight
                        && styleToCanon(origStyle) === mf.style
                      if (matchesDefault) {
                        tb.set("fontFamily", family)
                        tb.set("fontWeight", weight)
                        tb.set("fontStyle", style)
                        touched++
                      }
                      const styles = tb.styles
                      if (styles && typeof styles === "object") {
                        for (const lineKey of Object.keys(styles)) {
                          const line = styles[lineKey]
                          if (!line || typeof line !== "object") continue
                          for (const colKey of Object.keys(line)) {
                            const cs = line[colKey]
                            if (!cs) continue
                            const charFamily = cs.fontFamily ?? origFamily
                            const charWeight = weightToNum(cs.fontWeight ?? origWeight)
                            const charStyle = styleToCanon(cs.fontStyle ?? origStyle)
                            if (charFamily === mf.family && charWeight === mf.weight && charStyle === mf.style) {
                              cs.fontFamily = family
                              cs.fontWeight = weight
                              cs.fontStyle = style
                              touched++
                            }
                          }
                        }
                      }
                      if ((tb as any).initDimensions) (tb as any).initDimensions()
                      tb.setCoords()
                    }
                    if (touched > 0) {
                      fc.requestRenderAll()
                      isDirtyRef.current = true
                      setIsDirty(true)
                      if (isInitialized.current && !isApplyingHistory.current) pushHistory()
                      doSave()
                    }
                    console.log("[font-substitute]", mf.label, "→", `${family} ${weight} ${style}`, `(${touched} alvos)`)
                  }

                  // Propagacao no banco: substituicao deve persistir em
                  // asset.content (spans) E asset.lastOverride pra que ao
                  // reabrir o editor, o detection nao volte a reportar a
                  // mesma fonte como missing. Sem isso, o save do canvas
                  // atualizava so o layer.overrides do KV/Piece, mas as
                  // spans do asset (fonte da verdade dos chars) continuavam
                  // referenciando a familia missing.
                  try {
                    const weightToNumOuter = (w: any): number => {
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
                    const styleToCanonOuter = (s: any): "normal" | "italic" =>
                      typeof s === "string" && /italic|oblique/i.test(s) ? "italic" : "normal"
                    const matchesVariant = (entry: any): boolean => {
                      if (!entry || typeof entry !== "object") return false
                      const f = entry.fontFamily
                      if (typeof f !== "string" || f !== mf.family) return false
                      return weightToNumOuter(entry.fontWeight) === mf.weight
                        && styleToCanonOuter(entry.fontStyle) === mf.style
                    }
                    const replaceFields = (entry: any) => {
                      entry.fontFamily = family
                      entry.fontWeight = weight
                      entry.fontStyle = style
                    }
                    const assetsToPatch: Array<{ id: string; content: any; lastOverride: any }> = []
                    for (const a of (campaign?.assets ?? [])) {
                      if (a.type !== "TEXT") continue
                      let assetDirty = false
                      // 1) Spans em content
                      const spansRaw: any = typeof a.content === "string"
                        ? (() => { try { return JSON.parse(a.content as any) } catch { return [] } })()
                        : a.content
                      let newContent: any = spansRaw
                      if (Array.isArray(spansRaw)) {
                        const newSpans = spansRaw.map((s: any) => {
                          if (matchesVariant(s?.style)) {
                            const ns = { ...s.style }
                            replaceFields(ns)
                            assetDirty = true
                            return { ...s, style: ns }
                          }
                          return s
                        })
                        newContent = newSpans
                      }
                      // 2) lastOverride: default + styles per-char.
                      // CRITICO: o matchesVariant per-char usa `lo` (original)
                      // como fallback pros campos nao setados, NAO `newLO` (que
                      // ja foi atualizado se default match). Senao chars sem
                      // fontFamily explicito (herdam do default original) deixam
                      // de bater apos o default ja ter sido reescrito.
                      const lo: any = (a as any).lastOverride
                      let newLO: any = lo
                      if (lo && typeof lo === "object") {
                        newLO = { ...lo }
                        const defaultMatched = matchesVariant(lo)
                        if (defaultMatched) {
                          replaceFields(newLO)
                          assetDirty = true
                        }
                        if (lo.styles && typeof lo.styles === "object") {
                          const newStyles: any = {}
                          let stylesDirty = false
                          for (const lineKey of Object.keys(lo.styles)) {
                            const line = lo.styles[lineKey]
                            if (!line || typeof line !== "object") {
                              newStyles[lineKey] = line
                              continue
                            }
                            const newLine: any = {}
                            for (const colKey of Object.keys(line)) {
                              const cs = line[colKey]
                              if (cs && matchesVariant({
                                fontFamily: cs.fontFamily ?? lo.fontFamily,
                                fontWeight: cs.fontWeight ?? lo.fontWeight,
                                fontStyle: cs.fontStyle ?? lo.fontStyle,
                              })) {
                                const nc = { ...cs }
                                replaceFields(nc)
                                newLine[colKey] = nc
                                stylesDirty = true
                              } else {
                                newLine[colKey] = cs
                              }
                            }
                            newStyles[lineKey] = newLine
                          }
                          if (stylesDirty) {
                            newLO.styles = newStyles
                            assetDirty = true
                          }
                        }
                      }
                      if (assetDirty) {
                        assetsToPatch.push({ id: a.id, content: newContent, lastOverride: newLO })
                      }
                    }
                    if (assetsToPatch.length > 0) {
                      // PATCH em paralelo (asset endpoint aceita content e lastOverride
                      // via PATCH simples — sem migrate de overrides do KV/Piece pois
                      // estes ja foram atualizados pelo doSave do canvas).
                      await Promise.all(assetsToPatch.map(p =>
                        fetch(`/api/campaigns/${campaignId}/assets/${p.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            content: typeof p.content === "string" ? p.content : JSON.stringify(p.content),
                            lastOverride: p.lastOverride,
                          }),
                        }).catch(err => console.warn("[font-substitute] PATCH asset falhou:", p.id, err))
                      ))
                      // Atualiza campaignRef em-memoria pra o proximo detection
                      // dentro da MESMA sessao nao re-reportar a fonte velha.
                      if (campaignRef.current && Array.isArray(campaignRef.current.assets)) {
                        const patchedMap = new Map(assetsToPatch.map(p => [p.id, p]))
                        campaignRef.current = {
                          ...campaignRef.current,
                          assets: campaignRef.current.assets.map((a: any) => {
                            const p = patchedMap.get(a.id)
                            if (!p) return a
                            return { ...a, content: p.content, lastOverride: p.lastOverride }
                          }),
                        }
                      }
                      console.log("[font-substitute] PATCH em", assetsToPatch.length, "assets")
                    }
                  } catch (e) {
                    console.warn("[font-substitute] propagacao no banco falhou:", e)
                  }

                  setMissingFonts(prev => prev.filter(x => x.label !== mf.label))
                  setReplacementChoices(prev => { const c = { ...prev }; delete c[mf.label]; return c })
                  // Familia substituida → libera o clamp de tracking negativo.
                  // Forca re-render de todos os textboxes pra que o novo
                  // measureText calcule largura correta.
                  try {
                    const { clearFontFallback } = await import("@/lib/fabricCharSpacingPatch")
                    clearFontFallback(mf.family)
                    const fc = fabricRef.current
                    if (fc) {
                      fc.getObjects().forEach((o: any) => {
                        if (o.type === "textbox" || o.type === "text" || o.type === "i-text") {
                          o.initDimensions?.()
                          o.set("dirty", true)
                        }
                      })
                      fc.requestRenderAll()
                    }
                  } catch (e) { editorLog("[font-fallback-clear] falha:", e) }
                  // CRITICO 2026-05-28: persiste KV/peca AGORA, sem esperar
                  // user clicar "Salvar". Sem isso, layers[].overrides no banco
                  // continuavam apontando pra fonte missing → ao reabrir o
                  // editor, detection re-reportava a mesma fonte como missing.
                  // User reportou: "substitui a fonte... fecho o editor e
                  // volto, ele pede a fonte de novo".
                  try {
                    await performSave()
                  } catch (e) { editorLog("[font-substitute] performSave falha:", e) }
                }

                return (
                  <div key={mf.label}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 170px 130px 100px 100px",
                      gap: 8, alignItems: "center",
                      padding: "10px 8px",
                      borderTop: idx === 0 ? "none" : "1px solid #232323",
                    }}>
                    {/* Coluna 1: nome + indicador */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, color: "#fff", fontWeight: 600,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {mf.label}
                      </div>
                      <div style={{ fontSize: 10, color: "#f87171", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#f87171" }} />
                        Missing · falls back
                      </div>
                    </div>
                    {/* Coluna 2: dropdown FAMILIA */}
                    <select
                      value={choice.family ?? ""}
                      onChange={(e) => {
                        const val = e.target.value
                        setReplacementChoices(prev => ({
                          ...prev,
                          [mf.label]: { ...prev[mf.label], family: val || undefined },
                        }))
                      }}
                      style={{
                        background: "#0f0f0f", color: "#fff",
                        border: "1px solid #333", borderRadius: 6,
                        padding: "7px 8px", fontSize: 12, cursor: "pointer",
                        outline: "none", fontFamily: "inherit", minWidth: 0,
                      }}
                    >
                      <option value="">Family…</option>
                      {groups.map(g => {
                        const inGroup = familyOptions.filter(o => o.group === g)
                        if (inGroup.length === 0) return null
                        return (
                          <optgroup key={g} label={g}>
                            {inGroup.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </optgroup>
                        )
                      })}
                    </select>
                    {/* Coluna 3: dropdown PESO/ESTILO. Default = peso da fonte
                        missing (Bold Italic substituido por outra fonte comeca
                        em Bold Italic). User pode mudar livremente. */}
                    <select
                      value={currentWeightValue}
                      onChange={(e) => {
                        const [wStr, sStr] = e.target.value.split("|")
                        const weight = Number(wStr)
                        const style: "normal" | "italic" = sStr === "italic" ? "italic" : "normal"
                        setReplacementChoices(prev => ({
                          ...prev,
                          [mf.label]: { ...prev[mf.label], weight, style },
                        }))
                      }}
                      style={{
                        background: "#0f0f0f", color: "#fff",
                        border: "1px solid #333", borderRadius: 6,
                        padding: "7px 8px", fontSize: 12, cursor: "pointer",
                        outline: "none", fontFamily: "inherit",
                      }}
                    >
                      {WEIGHT_STYLE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {/* Coluna 4: botao APLICAR substituicao */}
                    <button
                      onClick={() => {
                        if (!choice.family) return
                        applySubstitution(choice.family, effectiveWeight, effectiveStyle)
                      }}
                      disabled={!canApply}
                      title={canApply ? `Replace ${mf.label} with ${choice.family} ${effectiveWeight} ${effectiveStyle === "italic" ? "Italic" : ""}` : "Choose the family first"}
                      style={{
                        background: canApply ? "#facc15" : "#2a2a2a",
                        color: canApply ? "#000" : "#555",
                        border: "none", borderRadius: 6,
                        padding: "8px 10px", fontSize: 11, fontWeight: 700,
                        cursor: canApply ? "pointer" : "not-allowed",
                      }}
                    >
                      Apply
                    </button>
                    {/* Coluna 5: botao SUBIR ARQUIVO. Loading state quando
                        em upload — feedback visual pra user nao achar que
                        nao aconteceu nada (reportado 2026-05-28). */}
                    <button
                      onClick={() => {
                        if (uploadingFonts.has(mf.label)) return
                        pendingFontUpload.current = mf
                        fontUploadInputRef.current?.click()
                      }}
                      disabled={uploadingFonts.has(mf.label)}
                      title={`Upload .ttf/.otf file for "${mf.label}"`}
                      style={{
                        background: uploadingFonts.has(mf.label) ? "#2a2a2a" : "transparent",
                        color: uploadingFonts.has(mf.label) ? "#888" : "#facc15",
                        border: `1px solid ${uploadingFonts.has(mf.label) ? "#444" : "#facc15"}`,
                        borderRadius: 6,
                        padding: "8px 10px", fontSize: 11, fontWeight: 700,
                        cursor: uploadingFonts.has(mf.label) ? "wait" : "pointer",
                      }}
                    >
                      {uploadingFonts.has(mf.label) ? "Enviando…" : "Upload"}
                    </button>
                  </div>
                )
              })}
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid #2a2a2a", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11, color: "#666", flex: 1, minWidth: 200 }}>
                Substituicoes e uploads sao salvos no cliente — disponiveis em campanhas futuras.
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* Multi-upload (2026-05-28): subir varias fontes de uma vez.
                    Auto-match por filename → atribui peso/estilo detectados.
                    Resolve quantas missings o filename bater. */}
                <button
                  onClick={() => fontUploadMultiInputRef.current?.click()}
                  disabled={uploadingFonts.size > 0}
                  title="Subir varios .ttf/.otf de uma vez (auto-match por nome de arquivo)"
                  style={{
                    background: "transparent",
                    color: uploadingFonts.size > 0 ? "#555" : "#facc15",
                    border: `1px solid ${uploadingFonts.size > 0 ? "#444" : "#facc15"}`,
                    borderRadius: 6,
                    padding: "8px 14px", fontSize: 12, fontWeight: 700,
                    cursor: uploadingFonts.size > 0 ? "wait" : "pointer",
                  }}
                >
                  {uploadingFonts.size > 0 ? "Enviando…" : "Subir varias fontes"}
                </button>
                <button
                  onClick={() => setFontsModalOpen(false)}
                  style={{
                    background: "#facc15", color: "#000",
                    border: "none", borderRadius: 6,
                    padding: "8px 18px", fontSize: 12, fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <input
        ref={fontUploadInputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          const pending = pendingFontUpload.current
          pendingFontUpload.current = null
          const clientId = campaign?.client?.id
          if (!file || !pending || !clientId) return
          setUploadingFonts(prev => { const s = new Set(prev); s.add(pending.label); return s })
          try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const r = new FileReader()
              r.onload = () => resolve(r.result as string)
              r.onerror = () => reject(new Error("read fail"))
              r.readAsDataURL(file)
            })
            const { detectFontMetadata, loadCustomFontFamily } = await import("@/lib/google-fonts")
            const meta = detectFontMetadata(file.name)
            const family = pending.family
            const cRes = await fetch(`/api/clients/${clientId}`)
            const cData = await cRes.json()
            const existingFiles: any[] = Array.isArray(cData.customFontFiles) ? cData.customFontFiles : []
            const newFile = { url: dataUrl, weight: meta.weight, style: meta.style, fileName: file.name }
            const updatedFiles = [...existingFiles, newFile]
            const patchBody: any = { customFontFiles: updatedFiles }
            if (!cData.brandFont || cData.brandFont.trim() === "") patchBody.brandFont = family
            await fetch(`/api/clients/${clientId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patchBody),
            })
            loadCustomFontFamily(family, updatedFiles)
            try {
              const probeCanvas = document.createElement("canvas")
              const ctx = probeCanvas.getContext("2d")
              if (ctx) {
                const SAMPLE = "mwiI@#$%MNOQRS 1234567890"
                const FALLBACKS = ["serif", "sans-serif", "monospace"]
                const stillMissing = missingFonts.filter(mf => {
                  const escFamily = mf.family.replace(/"/g, '\\"')
                  for (const fb of FALLBACKS) {
                    ctx.font = `${mf.style} ${mf.weight} 72px ${fb}`
                    const baseW = ctx.measureText(SAMPLE).width
                    ctx.font = `${mf.style} ${mf.weight} 72px "${escFamily}", ${fb}`
                    const testW = ctx.measureText(SAMPLE).width
                    if (Math.abs(testW - baseW) > 0.5) return false
                  }
                  return true
                })
                setMissingFonts(stillMissing)
              } else {
                setMissingFonts(prev => prev.filter(mf => mf.label !== pending.label))
              }
            } catch {
              setMissingFonts(prev => prev.filter(mf => mf.label !== pending.label))
            }
            const fc = fabricRef.current
            if (fc) {
              const objs = fc.getObjects()
              for (const o of objs) {
                if ((o.type === "textbox" || o.type === "i-text") && (o as any).initDimensions) {
                  ;(o as any).initDimensions()
                }
              }
              fc.requestRenderAll()
            }
            // CRITICO 2026-05-28: salva KV/peca agora pra que ao reabrir, o
            // canvas use o customFontFile (KV layers overrides ja apontam pra
            // family que agora carrega via loadCustomFontFamily). Sem isso,
            // ao reabrir o detection ainda achava a fonte missing porque ela
            // SO existia no client.customFontFiles, mas o canvas precisa de
            // KV salvo pra refletir o estado atual.
            try { await performSave() } catch (e) { editorLog("[font-upload] performSave falha:", e) }
          } catch (err) {
            console.warn("[font-upload] falhou:", err)
            alert("Falha no upload da fonte. Verifique se eh um .ttf ou .otf valido.")
          } finally {
            setUploadingFonts(prev => { const s = new Set(prev); s.delete(pending.label); return s })
          }
        }}
      />
      {/* Input MULTI 2026-05-28: aceita N arquivos de uma vez. Auto-match
          por filename (detectFontMetadata → weight+style) cruzado com a
          familia da missing. Arquivos sem match sao adicionados como
          customFontFiles do cliente mas nao "resolvem" missings (ficam
          disponiveis pra uso futuro). */}
      <input
        ref={fontUploadMultiInputRef}
        type="file"
        multiple
        accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf"
        style={{ display: "none" }}
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ""
          const clientId = campaign?.client?.id
          if (files.length === 0 || !clientId) return
          // Marca TODAS as missings como uploading enquanto processa
          const allMissingLabels = missingFonts.map(m => m.label)
          setUploadingFonts(prev => { const s = new Set(prev); allMissingLabels.forEach(l => s.add(l)); return s })
          try {
            const { detectFontMetadata, loadCustomFontFamily } = await import("@/lib/google-fonts")
            const cRes = await fetch(`/api/clients/${clientId}`)
            const cData = await cRes.json()
            const existingFiles: any[] = Array.isArray(cData.customFontFiles) ? cData.customFontFiles : []
            const newFiles: any[] = []
            const familiesAffected = new Set<string>()
            for (const file of files) {
              try {
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  const r = new FileReader()
                  r.onload = () => resolve(r.result as string)
                  r.onerror = () => reject(new Error("read fail"))
                  r.readAsDataURL(file)
                })
                const meta = detectFontMetadata(file.name)
                // Match: procura uma missing cujo family bata com o filename
                // (case-insensitive, ignorando espacos). Sem match, atribui
                // a primeira missing family (palpite) — usuario sempre pode
                // re-organizar editando os arquivos do cliente depois.
                const baseName = file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, "")
                const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "")
                const nBase = normalize(baseName)
                const matched = missingFonts.find(mf => nBase.includes(normalize(mf.family)))
                const family = matched?.family ?? (missingFonts[0]?.family ?? baseName)
                familiesAffected.add(family)
                newFiles.push({ url: dataUrl, weight: meta.weight, style: meta.style, fileName: file.name })
              } catch (e) {
                console.warn("[font-multi-upload] arquivo falhou:", file.name, e)
              }
            }
            if (newFiles.length === 0) {
              alert("Nenhum arquivo valido foi processado.")
              return
            }
            const updatedFiles = [...existingFiles, ...newFiles]
            const patchBody: any = { customFontFiles: updatedFiles }
            if (!cData.brandFont || cData.brandFont.trim() === "") {
              const firstFamily = Array.from(familiesAffected)[0]
              if (firstFamily) patchBody.brandFont = firstFamily
            }
            await fetch(`/api/clients/${clientId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patchBody),
            })
            // Registra @font-face pra cada family afetada
            for (const fam of familiesAffected) {
              loadCustomFontFamily(fam, updatedFiles)
            }
            // Re-checa via measureText TODAS as missings de uma vez
            try {
              const probeCanvas = document.createElement("canvas")
              const ctx = probeCanvas.getContext("2d")
              if (ctx) {
                const SAMPLE = "mwiI@#$%MNOQRS 1234567890"
                const FALLBACKS = ["serif", "sans-serif", "monospace"]
                const stillMissing = missingFonts.filter(mf => {
                  const escFamily = mf.family.replace(/"/g, '\\"')
                  for (const fb of FALLBACKS) {
                    ctx.font = `${mf.style} ${mf.weight} 72px ${fb}`
                    const baseW = ctx.measureText(SAMPLE).width
                    ctx.font = `${mf.style} ${mf.weight} 72px "${escFamily}", ${fb}`
                    const testW = ctx.measureText(SAMPLE).width
                    if (Math.abs(testW - baseW) > 0.5) return false
                  }
                  return true
                })
                setMissingFonts(stillMissing)
              }
            } catch (e) { editorLog("[font-multi-upload] re-check falha:", e) }
            const fc = fabricRef.current
            if (fc) {
              fc.getObjects().forEach((o: any) => {
                if ((o.type === "textbox" || o.type === "i-text") && o.initDimensions) o.initDimensions()
              })
              fc.requestRenderAll()
            }
            try { await performSave() } catch (e) { editorLog("[font-multi-upload] performSave falha:", e) }
          } catch (err) {
            console.warn("[font-multi-upload] falhou:", err)
            alert("Falha no upload das fontes.")
          } finally {
            setUploadingFonts(prev => { const s = new Set(prev); allMissingLabels.forEach(l => s.delete(l)); return s })
          }
        }}
      />
    </div>
  )
}
