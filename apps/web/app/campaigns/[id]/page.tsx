"use client"
import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { useSetActiveClient } from "@/lib/activeClientContext"
import { StatusBadge } from "@/components/pieces/StatusBadge"
import { SegmentPicker } from "@/components/pieces/SegmentPicker"
import { DeliveryDialog } from "@/components/deliveries/DeliveryDialog"
import { ExportDialog } from "@/components/pieces/ExportDialog"
import { EditableText } from "@/components/EditableText"
import { PIECE_STATUS_LIST, USER_SELECTABLE_STATUSES, statusMeta } from "@/lib/pieceStatus"
import { FilterPill } from "@/components/ui/FilterPill"
import { sortPieces, toggleSort, SortCol, SortDir } from "@/lib/sortPieces"
import { RowThumb } from "@/components/ui/RowThumb"
import { PsdImporter, type PsdImporterHandle } from "@/components/campaign/PsdImporter"
import { PsdPieceImporter, type PsdPieceImporterHandle } from "@/components/campaign/PsdPieceImporter"
import { Button } from "@/components/ui/Button"
import { DuplicateFormatDialog } from "@/components/pieces/DuplicateFormatDialog"

interface Asset { id: string; type: string; label: string }
interface Campaign {
  id: string
  name: string
  code?: string | null
  client: { id: string; name: string; logoUrl?: string | null; brandColors?: Array<{ hex: string; name?: string | null; role?: string | null }> | null }
  psdName?: string | null
  assets: Asset[]
  keyVision?: { width?: number; height?: number; bgColor?: string; thumbnailUrl?: string | null; updatedAt?: string } | null
}
interface Piece {
  id: string
  name: string
  format: string
  width: number
  height: number
  status: string
  segment?: string | null
  // Fallback do segmento herdado do MediaFormat associado (read-only).
  // Usado pelo SegmentPicker quando piece.segment esta vazio.
  mediaFormatSegment?: string | null
  // Veiculo (= mediaFormat.vehicle || mediaFormat.media), enriquecido server-side.
  media?: string | null
  imageUrl?: string | null
  copy?: string | null
  data?: any
  createdAt: string
  updatedAt?: string
  stepCount?: number
  // Step thumbs enriquecidos em /api/pieces (route.ts ~linha 66).
  // Cada step tem index + imageUrl/thumbnailUrl ja stampado com ?v=updatedAt.
  steps?: Array<{ index: number; imageUrl?: string | null; thumbnailUrl?: string | null }> | null
  // Flags anti-falhas (enriquecidos em /api/pieces):
  // isEmpty=true: piece.data com layers=[] (provavel corrupcao)
  // hasBackup=true: tem piece.dataBackup salvo (pode restaurar via UI)
  // maskCount=N: numero de layers com mask field (raster/vector/clipping).
  //   Usado pra mostrar banner "X pecas sem mascara — rode Re-aplicar".
  isEmpty?: boolean
  hasBackup?: boolean
  maskCount?: number
}

export default function CampaignOverviewPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  // Hookea cliente da campaign no TopNav (logo da empresa substitui ZZOSY)
  useSetActiveClient(campaign?.client ? {
    id: campaign.client.id,
    name: campaign.client.name ?? "",
    brandLogoUrl: (campaign.client as any)?.brandLogoUrl,
  } : null)
  const [pieces, setPieces] = useState<Piece[]>([])
  const [loading, setLoading] = useState(true)
  const [loadTs, setLoadTs] = useState(Date.now())
  const [deliveryOpen, setDeliveryOpen] = useState(false)
  const [view, setView] = useState<"grid" | "list">("list")
  const [selected, setSelectedRaw] = useState<string[]>([])
  // Wrapper de debug temporario pra rastrear quem zera selected
  const setSelected = (next: string[] | ((prev: string[]) => string[])) => {
    if (typeof next === "function") {
      setSelectedRaw(prev => {
        const result = next(prev)
        if (Array.isArray(result) && result.length === 0 && prev.length > 0) {
          console.log("[SEL-CLEAR] (function form)", { prev, stack: new Error().stack?.split("\n").slice(1, 5).join("\n") })
        }
        return result
      })
    } else {
      if (Array.isArray(next) && next.length === 0) {
        console.log("[SEL-CLEAR] (direct)", { stack: new Error().stack?.split("\n").slice(1, 5).join("\n") })
      }
      setSelectedRaw(next)
    }
  }
  const [exportOpen, setExportOpen] = useState(false)
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>("ALL")
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir } | null>({ col: "name", dir: "asc" })
  // Progress da regen automatica de thumbs (perf indicator)
  const [regenProgress, setRegenProgress] = useState<{ done: number; total: number } | null>(null)
  // Loading state dos botoes de recovery (repatch-masks, server-render-thumbs)
  // Sem isso, user clica e fica achando que travou (request 30+ segundos).
  const [recoveryWorking, setRecoveryWorking] = useState<null | "masks" | "thumbs">(null)
  const [codeSuggestions, setCodeSuggestions] = useState<string[]>([])
  const [segmentSuggestions, setSegmentSuggestions] = useState<string[]>([])
  // Drag-and-drop de PSD direto no preview do KV (matriz) e na lista de peças.
  // Refs nos importers expoem handlers que disparamos via dragEnd. Sem isso o
  // user teria que clicar nos botoes Importar — drop-zone agiliza fluxo.
  const psdMatrixImporterRef = useRef<PsdImporterHandle>(null)
  const psdPieceImporterRef = useRef<PsdPieceImporterHandle>(null)
  // Input fisico pra disparar file picker do "Import PSD" da matriz. Ficar
  // ESCONDIDO via positioning (NAO display:none — Chrome bloqueia click()
  // programatico em subtree display:none). 2026-05-24 fix.
  const psdMatrixPickerRef = useRef<HTMLInputElement>(null)
  const [kvDragOver, setKvDragOver] = useState(false)
  const [piecesDragOver, setPiecesDragOver] = useState(false)

  async function loadAll() {
    // Guard: id ainda nao resolvido pelo useParams. Acontece em transicao
    // rapida (back/forward). Sair silenciosamente — proximo render dispara
    // loadAll de novo com id correto.
    if (!id) return
    // PERF 2026-05-27: ?lite=true (skip KV.data/layers — 98KB+ raster mask).
    // Overview nao usa esses campos. Editor passa sem lite quando abre.
    const url = `/api/campaigns/${id}?lite=true`
    let cRes: Response
    try { cRes = await fetch(url, { cache: "no-store" }) }
    catch (e) { console.warn("[LOAD-ALL] fetch falhou:", e); setLoading(false); return }
    let c: any = null
    try {
      const text = await cRes.text()
      if (text) c = JSON.parse(text)
    } catch { /* body vazio ou nao-JSON — c fica null, tratado abaixo */ }
    let p: any = []
    try {
      const pRes = await fetch(`/api/pieces?campaignId=${id}`, { cache: "no-store" })
      const ptxt = await pRes.text()
      p = ptxt ? JSON.parse(ptxt) : []
    } catch (e) { console.warn("[LOAD-ALL] pieces fetch falhou:", e) }
    // Resposta valida = tem client.
    if (c && !c.error && c.client) {
      setCampaign(c)
    } else {
      // Resposta com erro esperado (401/404/etc) ou body vazio: nao polui
      // console com error vermelho. Logado em warn pra debugar se precisar.
      if (cRes.status !== 200) {
        console.warn("[LOAD-ALL] campanha indisponivel — status", cRes.status, c?.error ?? "")
      } else if (c && Object.keys(c).length > 0) {
        // Status 200 mas body sem client: caso anomalo real.
        console.warn("[LOAD-ALL] resposta 200 sem client:", c)
      }
      setCampaign(null)
    }
    setPieces(Array.isArray(p) ? p : [])
    setLoadTs(Date.now())
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [id])

  // REGEN INTELIGENTE 2026-05-27: ref-guard por piece.id (session-level).
  //
  // BUG ANTERIOR (loop infinito 2026-05-27 identificado via Playwright):
  // regenSeenRef cacheava por id+updatedAt. Mas regeneratePieceThumb faz
  // POST /thumbnail que ATUALIZA piece.updatedAt no DB. loadAll() refetcha,
  // novo updatedAt ≠ cached → useEffect dispara DE NOVO → regen → loop
  // infinito (~70 fetches/seg). Causava UI travada + server saturado.
  //
  // Fix: tracking session-level (id apenas). Cada peca eh regenerada UMA vez
  // por session. Edits do editor disparam re-regen via BroadcastChannel
  // (mais explicito, sem race) — ja coberto em outro useEffect.
  const regenSeenRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (pieces.length === 0) return
    const seen = regenSeenRef.current
    const toRegen = pieces.filter(p => !seen.has(p.id))
    if (toRegen.length === 0) return
    // Sort: pieces sem imageUrl primeiro (urgente). Resto depois.
    toRegen.sort((a, b) => {
      const aHas = a.imageUrl ? 1 : 0
      const bHas = b.imageUrl ? 1 : 0
      return aHas - bHas  // 0 (sem) vem antes de 1 (com)
    })
    let cancelled = false
    setRegenProgress({ done: 0, total: toRegen.length })
    ;(async () => {
      const { regeneratePieceThumb } = await import("@/lib/regenerateThumbs")

      // PRE-WARM 2026-05-27: ANTES do primeiro render, dispara HEAD requests
      // pras imagens dos assets em paralelo. Quando regeneratePieceThumb
      // chama buildPieceCanvas, browser ja tem as imgs no HTTP cache.
      // Elimina latencia de network do hot path (cada piece reusa cache).
      try {
        const campAssets = (campaign?.assets ?? []) as any[]
        const imgUrls = campAssets
          .map(a => a.imageUrl)
          .filter((u): u is string => typeof u === "string" && u.length > 0)
        // Promise.all sem await — fire-and-forget. Render comeca em paralelo.
        Promise.all(imgUrls.map(url => fetch(url, { method: "GET", cache: "force-cache" }).catch(() => {})))
      } catch { /* warm-up nao critico */ }

      // BATCH 6 → 10 (perf 2026-05-27 round 2): com pre-warm de assets,
      // hardware aguenta mais renders paralelos. ~30% mais rapido vs round 1.
      // PROGRESS PER-PIECE (2026-05-27): antes incrementava por batch — com
      // batch=10 + 6 pieces, 0/6 ficava preso ate todas as 6 terminarem.
      // Agora atualiza assim que cada uma completa.
      // TIMEOUT 45s por peca: regeneratePieceThumb usa Fabric+canvas que
      // pode travar em font load ou image fetch. Sem timeout, 1 peca travada
      // bloqueia todas as outras do batch (Promise.allSettled aguarda todas).
      const BATCH = 10
      const PIECE_TIMEOUT_MS = 45_000
      let doneCount = 0
      for (let i = 0; i < toRegen.length; i += BATCH) {
        if (cancelled) break
        const chunk = toRegen.slice(i, i + BATCH)
        await Promise.allSettled(chunk.map(async p => {
          try {
            await Promise.race([
              regeneratePieceThumb(p.id),
              new Promise<boolean>((_, reject) =>
                setTimeout(() => reject(new Error(`piece timeout ${PIECE_TIMEOUT_MS/1000}s`)), PIECE_TIMEOUT_MS)
              ),
            ])
            seen.add(p.id)
          } catch (e) {
            console.warn("[smart-regen]", p.id, e)
            seen.add(p.id)
          } finally {
            doneCount++
            if (!cancelled) setRegenProgress({ done: doneCount, total: toRegen.length })
          }
        }))
      }
      // Quando termina, limpa progress + refetch pra mostrar thumbs novos
      if (!cancelled) {
        setRegenProgress(null)
        await loadAll()
      }
    })()
    return () => { cancelled = true }
  }, [pieces])

  // Sugestoes de codigo (datalist)
  useEffect(() => {
    fetch("/api/campaigns/codes", { cache: "no-store" })
      .then(r => r.ok ? r.json() : { codes: [] })
      .then(d => setCodeSuggestions(Array.isArray(d.codes) ? d.codes : []))
      .catch(() => {})
  }, [])

  // Sugestoes de segmento (cards das pecas)
  useEffect(() => {
    fetch("/api/pieces/segments", { cache: "no-store" })
      .then(r => r.ok ? r.json() : { segments: [] })
      .then(d => setSegmentSuggestions(Array.isArray(d.segments) ? d.segments : []))
      .catch(() => {})
  }, [])

  // Sempre que a overview volta a ficar ativa, recarrega para pegar thumb novo do KV/peças.
  // Cobre todos os cenarios: troca de aba, navegacao SPA, back/forward, etc.
  // + BroadcastChannel: editor faz postMessage REALTIME quando salva peca/KV
  // (mesma aba OU outra aba same-origin). Sem isso o overview ficava stale ate
  // o user trocar de aba pra disparar o focus event.
  useEffect(() => {
    function refetch() { loadAll() }
    window.addEventListener("focus", refetch)
    const onVis = () => { if (document.visibilityState === "visible") refetch() }
    document.addEventListener("visibilitychange", onVis)
    window.addEventListener("pageshow", refetch)

    let bcPieces: BroadcastChannel | null = null
    let bcCamps: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== "undefined") {
        bcPieces = new BroadcastChannel("zzosy:pieces")
        bcPieces.onmessage = (ev) => {
          const m = ev.data
          if (!m || m.type !== "piece-updated") return
          if (m.campaignId === id) refetch()
        }
        bcCamps = new BroadcastChannel("zzosy:campaigns")
        bcCamps.onmessage = (ev) => {
          const m = ev.data
          if (!m) return
          if ((m.type === "kv-updated" || m.type === "campaign-updated") && m.campaignId === id) refetch()
        }
      }
    } catch {}

    return () => {
      window.removeEventListener("focus", refetch)
      document.removeEventListener("visibilitychange", onVis)
      window.removeEventListener("pageshow", refetch)
      try { bcPieces?.close() } catch {}
      try { bcCamps?.close() } catch {}
    }
  }, [id])

  async function deletePiece(pieceId: string, skipConfirm = false) {
    if (!skipConfirm && !confirm("Apagar esta peça? Esta ação não pode ser desfeita.")) return
    await fetch(`/api/pieces/${pieceId}`, { method: "DELETE" })
    setPieces(p => p.filter(x => x.id !== pieceId))
  }

  function toggleSelect(pieceId: string) {
    setSelected(s => s.includes(pieceId) ? s.filter(x => x !== pieceId) : [...s, pieceId])
  }
  function isSelected(pieceId: string) { return selected.includes(pieceId) }

  async function deleteSelected(skipConfirm = false) {
    if (selected.length === 0) return
    if (!skipConfirm && !confirm(`Apagar ${selected.length} peça(s)? Esta ação não pode ser desfeita.`)) return
    await Promise.all(selected.map(id => fetch(`/api/pieces/${id}`, { method: "DELETE" })))
    setPieces(prev => prev.filter(p => !selected.includes(p.id)))
    setSelected([])
  }

  // Dialog: ao duplicar, pergunta qual formato a copia deve ter. Default = o
  // formato original; user pode trocar pra qualquer MediaFormat cadastrado.
  // Sem modal aberto, dupDialog = null.
  const [dupDialog, setDupDialog] = useState<{ ids: string[]; originalFormat?: string } | null>(null)

  function duplicateOne(id: string) {
    const p = pieces.find(x => x.id === id)
    setDupDialog({ ids: [id], originalFormat: p?.format })
  }

  // Regenera piece.data a partir da matriz atual. Util pra restaurar pecas
  // corrompidas (layers vazios) sem perder name/segment/copy/status.
  // User pediu 2026-05-26 apos reportar 8 pecas com piece.data zerado.
  async function regenFromMatrix(id: string) {
    if (!confirm("Regenerar layers desta peça a partir da matriz atual? O conteúdo atual será SUBSTITUÍDO.")) return
    try {
      const r = await fetch(`/api/pieces/${id}/regenerate-from-matrix`, { method: "POST" })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        alert(`Erro ao regenerar: ${err?.error ?? r.statusText}`)
        return
      }
      await loadAll()
    } catch (e: any) {
      alert(`Erro: ${e?.message ?? e}`)
    }
  }

  async function regenSelectedFromMatrix() {
    if (selected.length === 0) return
    if (!confirm(`Regenerar layers de ${selected.length} peça(s) a partir da matriz atual? O conteúdo atual delas será SUBSTITUÍDO.`)) return
    try {
      // Promise.all com erro reportado per-piece — espelhando restoreSelected.
      // Antes Promise.all dos fetches engolia 4xx/5xx silenciosamente (r.ok
      // nunca verificado), entao bulk "regen" parecia ok mas algumas falhavam.
      const results = await Promise.all(selected.map(id =>
        fetch(`/api/pieces/${id}/regenerate-from-matrix`, { method: "POST" })
          .then(async r => ({ id, ok: r.ok, body: await r.json().catch(() => ({})) }))
      ))
      const failed = results.filter(r => !r.ok)
      if (failed.length > 0) {
        const sample = failed[0].body?.error ?? "erro desconhecido"
        alert(`${failed.length} peça(s) falharam: ${sample}. Restantes regeneradas.`)
      }
      setSelected([])
      await loadAll()
    } catch (e: any) {
      alert(`Erro: ${e?.message ?? e}`)
    }
  }

  // Restore previous version — reverte piece.data pra dataBackup. Swap, entao
  // clicar de novo desfaz. User pediu 2026-05-26 anti-falhas robusto.
  async function restoreSelectedPrevious() {
    if (selected.length === 0) return
    if (!confirm(`Restaurar versão anterior de ${selected.length} peça(s)? Cada peça volta pro estado salvo ANTES do último save. Clique de novo desfaz.`)) return
    try {
      const results = await Promise.all(selected.map(id =>
        fetch(`/api/pieces/${id}/restore-previous`, { method: "POST" }).then(async r => ({ id, ok: r.ok, body: await r.json().catch(() => ({})) }))
      ))
      const failed = results.filter(r => !r.ok)
      if (failed.length > 0) {
        alert(`${failed.length} peça(s) sem backup disponível. Restantes restauradas.`)
      }
      setSelected([])
      await loadAll()
    } catch (e: any) {
      alert(`Erro: ${e?.message ?? e}`)
    }
  }

  function duplicateSelected() {
    if (selected.length === 0) return
    setDupDialog({ ids: selected })
  }

  async function confirmDuplicate(mediaFormatId: string | null) {
    if (!dupDialog) return
    try {
      const body: any = { ids: dupDialog.ids }
      if (mediaFormatId) body.mediaFormatId = mediaFormatId
      const r = await fetch(`/api/pieces/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        alert(`Erro ao duplicar: ${err?.error ?? r.statusText}`)
        return
      }
      // Se duplicou bulk, limpa selecao. Individual nao afeta selecao.
      if (dupDialog.ids.length > 1) setSelected([])
      setDupDialog(null)
      await loadAll()
    } catch (e: any) {
      alert(`Erro ao duplicar: ${e?.message ?? e}`)
    }
  }

  async function bulkSetStatus(status: string) {
    if (selected.length === 0) return
    await Promise.all(selected.map(id =>
      fetch(`/api/pieces/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
    ))
    setPieces(prev => prev.map(p => selected.includes(p.id) ? { ...p, status } : p))
    setBulkStatusOpen(false)
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "80vh", color: "#888" }}>Carregando...</div>
    </div>
  )

  if (!campaign) return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "80vh", color: "#888" }}>Campanha não encontrada.</div>
    </div>
  )

  const kvW = campaign.keyVision?.width ?? 1920
  const kvH = campaign.keyVision?.height ?? 1080
  const kvBg = campaign.keyVision?.bgColor ?? "#ffffff"

  return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ maxWidth: 1600, margin: "0 auto", padding: "16px 24px" }}>

        {/* Header: titulo a esquerda + "← Campanhas" amarelo a direita 2026-05-24 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            {campaign.code && campaign.code.trim() && (
              <div style={{ flexShrink: 0, color: "#999" }}>
                <EditableText
                  value={campaign.code}
                  variant="h1"
                  suggestions={codeSuggestions}
                  onSave={async (v) => {
                    const newCode = v.trim() || null
                    const res = await fetch(`/api/campaigns/${id}`, {
                      method: "PATCH", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ code: newCode }),
                    })
                    if (!res.ok) throw new Error()
                    setCampaign(c => c ? { ...c, code: newCode } : c)
                  }}
                />
              </div>
            )}
            <h1 style={{ margin: 0, textAlign: "left" }}>
              <EditableText
                value={campaign.name}
                variant="h1"
                onSave={async (newName) => {
                  const res = await fetch(`/api/campaigns/${id}`, {
                    method: "PATCH", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: newName }),
                  })
                  if (!res.ok) throw new Error()
                  setCampaign(c => c ? { ...c, name: newName } : c)
                }}
              />
            </h1>
          </div>
          {/* Header so com nav ZZOSY isolada — regra CLAUDE.md 1.2.1 (user
              pediu 2026-05-26): "botao Campanhas que e navegacao do zzosy
              nunca deve ter outro botao na mesma linha". Cartucho movido pra
              row de actions abaixo (toolbar da lista). */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {campaign.client?.id && (
              <Button
                variant="primary"
                size="md"
                onClick={() => router.push(`/campaigns?clientId=${campaign.client!.id}`)}
                title="Voltar para Campanhas"
              >
                ← Campanhas
              </Button>
            )}
          </div>
        </div>

        {/* Row de actions globais da campanha — separada do header de
            navegacao por regra ZZOSY 1.2.1. */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <Button
            variant="secondary"
            size="md"
            onClick={() => router.push(`/campaigns/${id}/cartridges`)}
            title="Browse cartucho — assets do library do cliente com filtros + add em lote"
          >
            Cartucho
          </Button>
        </div>

        {/* Subnav REMOVIDO 2026-05-24 (user pedido). Agora cada botao vai
            pra seu contexto correto na sidebar: Assets+KV em MATRIZ, Pecas
            removido (ja tem PECAS GERADAS embaixo), Apresentacao em ENTREGA. */}

        {/* Layout 2026-05-25 (user pedido): KV box em COLUNA na esquerda
            (preview em cima, acoes embaixo, ambos stacked), lista de pecas
            ocupa a coluna da direita. Garante mais espaco vertical pra peca
            list e densidade maior na KV. Breakpoint <900px volta a stack. */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 240px) 1fr", gap: 14, alignItems: "start" }}>
        {/* Preview KV + actions sidebar — agora em coluna (preview + acoes stacked) */}
        <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", padding: "12px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              onClick={() => { if (campaign.keyVision?.thumbnailUrl) router.push(`/editor?campaignId=${id}`) }}
              title={campaign.keyVision?.thumbnailUrl ? "Abrir editor da matriz (ou arraste um .psd pra importar)" : "Arraste um .psd aqui ou clique em Importar PSD"}
              onDragOver={e => { e.preventDefault(); if (!kvDragOver) setKvDragOver(true) }}
              onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setKvDragOver(false)
              }}
              onDrop={async e => {
                e.preventDefault()
                setKvDragOver(false)
                const file = Array.from(e.dataTransfer.files).find(f => /\.psd$/i.test(f.name))
                if (!file) { alert("Arraste um arquivo .psd"); return }
                await psdMatrixImporterRef.current?.importFile(file)
              }}
              style={{
                flex: 1, display: "flex", alignItems: "stretch", justifyContent: "center",
                color: "#aaa", fontSize: 13,
                cursor: campaign.keyVision?.thumbnailUrl ? "pointer" : "default",
                transition: "outline 0.15s ease",
                outline: kvDragOver ? "2px dashed #F09300" : "2px dashed transparent",
                outlineOffset: 4,
                borderRadius: 8,
              }}
            >
              {campaign.keyVision?.thumbnailUrl ? (
                <img src={`${campaign.keyVision.thumbnailUrl}?v=${loadTs}`} alt="KV preview"
                  loading="lazy" decoding="async"
                  style={{ maxWidth: "100%", maxHeight: 130, objectFit: "contain", borderRadius: 6, border: "1px solid #E0E0E0", margin: "auto" }} />
              ) : (
                <div
                  onClick={e => { e.stopPropagation(); psdMatrixPickerRef.current?.click() }}
                  style={{
                    flex: 1, width: "100%",
                    background: "#FAFAFA", borderRadius: 6, border: "1px dashed #C0C0C0",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: 8, padding: 16, cursor: "pointer",
                  }}>
                  <Button variant="primary" size="md"
                    onClick={e => { e.stopPropagation(); psdMatrixPickerRef.current?.click() }}>
                    Import PSD
                  </Button>
                  <span style={{ fontSize: 11, color: "#888" }}>or drop a .psd file here</span>
                </div>
              )}
            </div>
            {/* PsdImporter montado OFF-SCREEN (NAO display:none — Chrome
                bloqueia click programatico em input dentro de display:none).
                Modais (missing fonts) se renderizam via position:fixed entao
                aparecem normalmente apesar do parent estar off-screen. */}
            <div style={{ position: "absolute", left: -9999, top: -9999, width: 0, height: 0, overflow: "hidden" }}>
              <PsdImporter ref={psdMatrixImporterRef} campaignId={id} onImported={loadAll} />
            </div>
            {/* Input dedicado pro botao "Import PSD" da matriz. Mais confiavel
                que delegar pra openFilePicker do PsdImporter (que tinha bugs
                de timing com refs encadeados). */}
            <input
              ref={psdMatrixPickerRef}
              type="file"
              accept=".psd"
              style={{ position: "absolute", left: -9999, top: -9999, width: 0, height: 0, opacity: 0 }}
              tabIndex={-1}
              onChange={async e => {
                const f = e.target.files?.[0]
                e.target.value = ""
                if (f) await psdMatrixImporterRef.current?.importFile(f)
              }}
            />
          </div>
          {/* Coluna de AÇÕES da campanha (modificam dados — nao sao
              navegacao). Navegacao (Assets/KV/Pecas/Apresentacao) fica no
              CampaignSubnav no topo. Hierarquia visual: CTA principal eh
              o "proximo passo" do fluxo do user — depende do estado:
                - sem assets         → Importar PSD (primary)
                - com assets, sem pecas → Gerar peca (primary)
                - com pecas          → Entrega (primary)
              Outros ficam secondary. Reduz ruido visual e guia o user. */}
          {(() => {
            const hasAssets = !!campaign.assets && campaign.assets.length > 0
            const hasPieces = pieces.length > 0
            // Layout final 2026-05-24 (mockup user): TODOS botoes mesmo
            // estilo (secondary), com gap maior separando grupos visuais.
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Button variant="secondary" size="sm"
                  onClick={() => psdMatrixPickerRef.current?.click()}
                  title="Substitui a matriz (KV) com um novo PSD. Pecas existentes ficam, mas re-mapeadas pros novos assets.">
                  Import PSD
                </Button>
                <Button variant="secondary" size="sm"
                  onClick={() => router.push(`/campaigns/${id}/assets`)}
                  title="Lista de assets desta campanha">
                  Assets
                </Button>
                <Button variant="secondary" size="sm"
                  onClick={() => router.push(`/editor?campaignId=${id}`)}
                  disabled={!hasAssets}
                  title={!hasAssets ? "Importe um PSD ou adicione assets primeiro" : "Editor da Matriz (Key Vision)"}>
                  KV
                </Button>
                <Button variant="secondary" size="sm"
                  onClick={() => router.push(`/editor?campaignId=${id}&openGenerator=1`)}
                  disabled={!hasAssets}
                  title={!hasAssets ? "Importe um PSD ou adicione assets primeiro" : "Gerar nova peça a partir da matriz"}>
                  + Gerar peça
                </Button>
                <Button variant="secondary" size="sm"
                  onClick={() => router.push(`/campaigns/${id}/presentation`)}
                  disabled={!hasPieces}
                  title={!hasPieces ? "Gere peças primeiro" : "Ver apresentação da campanha"}>
                  Apresentação
                </Button>
                <Button variant="secondary" size="sm"
                  onClick={() => setDeliveryOpen(true)}
                  disabled={!hasPieces}
                  title={!hasPieces ? "Gere peças primeiro" : "Empacotar e enviar peças"}>
                  Entrega
                </Button>
              </div>
            )
          })()}
          </div>
        </div>

        {/* Lista de peças */}
        {(() => {
          const filteredPieces = statusFilter === "ALL" ? pieces : pieces.filter(p => p.status === statusFilter)
          const visiblePieces = sort ? sortPieces(filteredPieces, sort.col, sort.dir) : filteredPieces
          const counts: Record<string, number> = { ALL: pieces.length }
          for (const s of PIECE_STATUS_LIST) counts[s] = pieces.filter(p => p.status === s).length
          // toggleSelectAll opera sobre visiblePieces (so seleciona o que ta visivel)
          const allVisibleSelected = visiblePieces.length > 0 && visiblePieces.every(p => selected.includes(p.id))
          const toggleSelectAll = () => {
            if (allVisibleSelected) setSelected(s => s.filter(id => !visiblePieces.some(p => p.id === id)))
            else setSelected(s => Array.from(new Set([...s, ...visiblePieces.map(p => p.id)])))
          }
          return (
        <div
          onDragOver={e => {
            // So aceita drop quando ha assets — sem assets nao da pra
            // linkar layers do PSD (PsdPieceImporter exige campaignAssets).
            const hasAssets = !!campaign.assets && campaign.assets.length > 0
            if (!hasAssets) return
            e.preventDefault()
            if (!piecesDragOver) setPiecesDragOver(true)
          }}
          onDragLeave={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setPiecesDragOver(false)
          }}
          onDrop={async e => {
            e.preventDefault()
            setPiecesDragOver(false)
            const hasAssets = !!campaign.assets && campaign.assets.length > 0
            if (!hasAssets) { alert("Importe a matriz (PSD) primeiro — peças precisam de assets pra linkar"); return }
            const files = Array.from(e.dataTransfer.files).filter(f => /\.psd$/i.test(f.name))
            if (files.length === 0) { alert("Arraste 1 ou mais arquivos .psd"); return }
            await psdPieceImporterRef.current?.importFiles(files)
          }}
          style={{
            outline: piecesDragOver ? "2px dashed #F09300" : "2px dashed transparent",
            outlineOffset: 4,
            borderRadius: 8,
            transition: "outline 0.15s ease",
            padding: piecesDragOver ? 4 : 0,
          }}
        >
          {/* Banner anti-falhas: detecta pecas vazias (piece.data com layers=[])
              e oferece recovery imediato. User pediu 2026-05-26 — pieces
              corrompidas escondidas na lista, dificil de detectar. */}
          {(() => {
            const emptyPieces = visiblePieces.filter(p => p.isEmpty)
            const restorables = emptyPieces.filter(p => p.hasBackup)
            if (emptyPieces.length === 0) return null
            return (
              <div style={{ background: "#FFF3CD", border: "1px solid #FFE69C", borderRadius: 8, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 18 }}>⚠️</span>
                <div style={{ flex: 1, minWidth: 240, fontSize: 13, color: "#664D03" }}>
                  <strong>{emptyPieces.length} peça(s) sem conteúdo detectada(s)</strong>
                  {restorables.length > 0 && ` · ${restorables.length} com backup disponível`}
                </div>
                {restorables.length > 0 && (
                  <Button variant="secondary" size="sm" onClick={async () => {
                    if (!confirm(`Restaurar versão anterior de ${restorables.length} peça(s) com backup?`)) return
                    try {
                      const results = await Promise.all(restorables.map(p =>
                        fetch(`/api/pieces/${p.id}/restore-previous`, { method: "POST" })
                          .then(async r => ({ id: p.id, ok: r.ok, body: await r.json().catch(() => ({})) }))
                      ))
                      const failed = results.filter(r => !r.ok)
                      if (failed.length > 0) alert(`${failed.length} peça(s) falharam: ${failed[0].body?.error ?? "erro"}. Restantes restauradas.`)
                      await loadAll()
                    } catch (e: any) { alert(`Erro: ${e?.message ?? e}`) }
                  }}>↶ Restaurar backup ({restorables.length})</Button>
                )}
                <Button variant="secondary" size="sm" onClick={async () => {
                  if (!confirm(`Regenerar ${emptyPieces.length} peça(s) a partir da matriz atual?`)) return
                  try {
                    const results = await Promise.all(emptyPieces.map(p =>
                      fetch(`/api/pieces/${p.id}/regenerate-from-matrix`, { method: "POST" })
                        .then(async r => ({ id: p.id, ok: r.ok, body: await r.json().catch(() => ({})) }))
                    ))
                    const failed = results.filter(r => !r.ok)
                    if (failed.length > 0) alert(`${failed.length} peça(s) falharam: ${failed[0].body?.error ?? "erro"}. Restantes regeneradas.`)
                    await loadAll()
                  } catch (e: any) { alert(`Erro: ${e?.message ?? e}`) }
                }}>↻ Regenerar da matriz ({emptyPieces.length})</Button>
              </div>
            )
          })()}
          {/* Estado dos dados — banner sempre visivel pra user saber ANTES de
              exportar se mascaras estao presentes. User reportou 2026-05-27
              "exportei e veio tudo sem mascara" — sem essa visibilidade, o
              user descobre o problema so depois do export. */}
          {(() => {
            const totalPieces = visiblePieces.length
            if (totalPieces === 0) return null
            const piecesWithMasks = visiblePieces.filter(p => (p.maskCount ?? 0) > 0).length
            const piecesWithSteps = visiblePieces.filter(p => (p.stepCount ?? 1) > 1).length
            const totalMaskCount = visiblePieces.reduce((s, p) => s + (p.maskCount ?? 0), 0)
            const noMasks = piecesWithMasks === 0 && totalMaskCount === 0
            return (
              <div style={{ fontSize: 12, color: "#555", marginBottom: 8, padding: "8px 12px", background: noMasks ? "#FFF3CD" : "#F0F9FF", border: `1px solid ${noMasks ? "#FFE69C" : "#BAE6FD"}`, borderRadius: 6, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <span><strong>Estado:</strong></span>
                <span>🎭 Máscaras: <strong>{piecesWithMasks}/{totalPieces}</strong> peças ({totalMaskCount} total)</span>
                <span>🎞️ Multi-step: <strong>{piecesWithSteps}/{totalPieces}</strong> peças</span>
                {noMasks && <span style={{ color: "#664D03", fontWeight: 600 }}>⚠️ Nenhuma peça tem máscaras — clique &quot;Re-aplicar máscaras&quot; abaixo</span>}
              </div>
            )
          })()}
          {/* Toolbar de recovery — sempre visivel (independente de emptyPieces).
              Permite user re-aplicar masks + re-render thumbs server quando
              campaign passou por full-recover-from-psd + relink. User pediu
              2026-05-27 botoes diretos sem URL manual. */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Button variant="secondary" size="sm" loading={recoveryWorking === "masks"} disabled={recoveryWorking !== null} onClick={async () => {
              if (!confirm("Re-aplicar máscaras do PSD original em todas peças?")) return
              setRecoveryWorking("masks")
              try {
                const r = await fetch(`/api/campaigns/${id}/repatch-masks`, { method: "POST" })
                const j = await r.json()
                if (r.ok) {
                  // Diagnostico per-piece pra detectar mismatch (PSD com N
                  // layers vs piece com M layers — match por zIndex falha).
                  // User reportou "tudo sem mascara" — diagnostico ajuda a
                  // entender se foi mismatch ou outra causa.
                  const mismatches = Array.isArray(j.perPiece) ? j.perPiece.filter((p: any) => p.mismatch) : []
                  let detail = `Máscaras reaplicadas: ${j.masksReapplied} aplicações em ${j.piecesUpdated}/${j.perPiece?.length ?? "?"} peças.\n`
                  detail += `PSD tem ${j.psdLayerCount} layers, ${j.masksAvailable} com máscara.\n`
                  if (mismatches.length > 0) {
                    detail += `\n⚠️ ${mismatches.length} peças com layer count diferente do PSD (mask match por zIndex pode estar errado):\n`
                    detail += mismatches.slice(0, 5).map((p: any) => `  • ${p.name}: ${p.layers} layers (esperado ${j.psdLayerCount})`).join("\n")
                    if (mismatches.length > 5) detail += `\n  ... + ${mismatches.length - 5} outras`
                  }
                  detail += `\n\nProximo passo: clica "Render server thumbs" pra regenerar previews.`
                  console.log("[repatch-masks] resultado:", j)
                  alert(detail)
                } else alert("Erro: " + (j.error ?? "?"))
                await loadAll()
              } catch (e: any) { alert("Erro: " + (e?.message ?? e)) }
              finally { setRecoveryWorking(null) }
            }}>🎭 Re-aplicar máscaras</Button>
            <Button variant="secondary" size="sm" loading={recoveryWorking === "thumbs"} disabled={recoveryWorking !== null} onClick={async () => {
              if (!confirm("Render server-side todas thumbs sem imageUrl?")) return
              setRecoveryWorking("thumbs")
              try {
                const r = await fetch(`/api/campaigns/${id}/server-render-thumbs`, { method: "POST" })
                const j = await r.json()
                if (r.ok) alert(`Thumbs server-side: ${j.ok}/${j.total} em ${(j.durationMs/1000).toFixed(1)}s`)
                else alert("Erro: " + (j.error ?? "?"))
                await loadAll()
              } catch (e: any) { alert("Erro: " + (e?.message ?? e)) }
              finally { setRecoveryWorking(null) }
            }}>⚡ Render server thumbs</Button>
            {recoveryWorking && (
              <span style={{ fontSize: 12, color: "#0066CC", fontWeight: 600 }}>
                {recoveryWorking === "masks" ? "⏳ Lendo PSD + re-aplicando máscaras..." : "⏳ Renderizando previews server-side..."}
              </span>
            )}
          </div>
          <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #E0E0E0", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>
              Peças geradas ({visiblePieces.length})
              {piecesDragOver && <span style={{ marginLeft: 12, color: "#F09300", fontSize: 11 }}>Solte os PSDs aqui</span>}
              {regenProgress && regenProgress.total > 0 && (
                <span style={{ marginLeft: 12, color: "#0066CC", fontSize: 11, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>
                  ⟳ Regenerando previews: {regenProgress.done}/{regenProgress.total}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {visiblePieces.length > 0 && (
                <>
                  {selected.length > 0 && (
                    <>
                      <span style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>{selected.length} selecionada(s)</span>
                      <Button variant="secondary" size="sm" onClick={toggleSelectAll}>
                        {allVisibleSelected ? "Desmarcar tudo" : "Selecionar tudo"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Cancelar</Button>
                      <Button variant="danger" size="sm" onClick={(e) => deleteSelected(e.altKey)} title="Option/Alt+click pra apagar sem confirmação">Apagar ({selected.length})</Button>
                      <Button variant="info" size="sm" onClick={duplicateSelected} title="Duplica as peças selecionadas (status volta para Standby)">Duplicar ({selected.length})</Button>
                      <Button variant="secondary" size="sm" onClick={regenSelectedFromMatrix} title="Regenera os layers das peças selecionadas a partir da matriz atual (substitui o conteúdo). Útil pra recuperar peças corrompidas/vazias.">↻ Da matriz ({selected.length})</Button>
                      <Button variant="secondary" size="sm" onClick={restoreSelectedPrevious} title="Restaura versão anterior (estado salvo ANTES do último save). Clique de novo desfaz.">↶ Versão anterior ({selected.length})</Button>
                      <Button variant="secondary" size="sm" onClick={() => setBulkStatusOpen(o => !o)}>Status</Button>
                      <Button variant="primary" size="sm" onClick={() => setExportOpen(true)}>Exportar ({selected.length})</Button>
                    </>
                  )}
                  {/* Toggle de view (Grid/Lista) — top-right do box, segregado por
                      separador vertical pra deixar claro que e controle de view,
                      nao de bulk action. */}
                  <div style={{ width: 1, height: 20, background: "#E0E0E0", marginInline: 4 }} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <FilterPill active={view === "grid"} onClick={() => setView("grid")} size="sm">Grid</FilterPill>
                    <FilterPill active={view === "list"} onClick={() => setView("list")} size="sm">Lista</FilterPill>
                  </div>
                </>
              )}
            </div>
          </div>

          <div style={{ padding: 16 }}>

          {/* Mini menu pro bulk status */}
          {bulkStatusOpen && (
            <div style={{ background: "white", border: "1px solid #E0E0E0", borderRadius: 8, padding: 8, marginBottom: 10, display: "flex", gap: 6, flexWrap: "wrap", boxShadow: "0 2px 6px rgba(0,0,0,0.05)" }}>
              <span style={{ fontSize: 11, color: "#888", padding: "5px 8px" }}>Marcar como:</span>
              {USER_SELECTABLE_STATUSES.map(s => {
                const meta = statusMeta(s)
                return (
                  <button key={s} onClick={() => bulkSetStatus(s)}
                    style={{ background: meta.bg, color: meta.color, border: "none", borderRadius: 5, padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                    {meta.label}
                  </button>
                )
              })}
            </div>
          )}

          {/* Filtros por status REMOVIDOS 2026-05-24 (user pedido):
              "isso se refere a aprovacao, entao nao deve estar nessa pagina".
              Status filter agora vive na pagina /approvals (contexto correto). */}

          {visiblePieces.length === 0 ? (
            <div style={{ background: "white", border: "1px dashed #E0E0E0", borderRadius: 10, padding: 40, textAlign: "center", color: "#888", fontSize: 13 }}>
              {pieces.length === 0
                ? `Nenhuma peça gerada ainda. Abra o editor e clique em "Gerar Peças".`
                : `Nenhuma peça com este status.`}
            </div>
          ) : view === "grid" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(var(--zz-card-grid-min), 1fr))", gap: "var(--zz-card-grid-gap)" }}>
              {visiblePieces.map(p => (
                <div key={p.id}
                  style={{
                    background: "white", borderRadius: 10,
                    border: isSelected(p.id) ? "2px solid #F5C400" : "1px solid #E0E0E0",
                    display: "flex", flexDirection: "column", position: "relative",
                  }}>
                  {/* Checkbox top-right */}
                  <div onClick={(e) => { e.stopPropagation(); toggleSelect(p.id) }}
                    title={isSelected(p.id) ? "Desselecionar" : "Selecionar"}
                    style={{
                      position: "absolute", top: 8, right: 8, zIndex: 5,
                      width: 20, height: 20, borderRadius: 4, cursor: "pointer",
                      background: isSelected(p.id) ? "#F5C400" : "rgba(255,255,255,0.9)",
                      border: isSelected(p.id) ? "none" : "1px solid #E0E0E0",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                    {isSelected(p.id) && <span style={{ color: "white", fontSize: 14, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                  </div>
                  <div
                    onClick={() => router.push(`/editor?campaignId=${id}&pieceId=${p.id}`)}
                    title="Editar peça"
                    style={{ position: "relative", height: 180, background: "#F5F5F0", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: "pointer", borderRadius: "10px 10px 0 0", padding: 8 }}>
                    {p.imageUrl ? (
                      // Cache-bust com updatedAt — sem isso o browser usa thumb
                      // antigo do cache mesmo apos broadcast piece-updated +
                      // refetch (URL nao muda, server retorna mesmo /uploads/...).
                      // User reportou 2026-05-23: preview nao realtime.
                      <img src={`${p.imageUrl}?t=${new Date((p as any).updatedAt ?? Date.now()).getTime()}`} alt={p.name}
                        loading="lazy" decoding="async"
                        style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", objectFit: "contain", display: "block" }} />
                    ) : (
                      <div style={{ textAlign: "center", color: "#aaa", fontSize: 11 }}>
                        <div style={{ fontWeight: 600 }}>{p.format}</div>
                        <div>{p.width} × {p.height}</div>
                      </div>
                    )}
                    {/* Badge de steps top-left: peca multi-step mostra "N steps" */}
                    {(p.stepCount ?? 1) > 1 && (
                      <div style={{
                        position: "absolute", top: 6, left: 6,
                        background: "rgba(0,0,0,0.75)", color: "#fff",
                        fontSize: 10, fontWeight: 700,
                        padding: "3px 7px", borderRadius: 4,
                        letterSpacing: 0.3,
                        fontFamily: "system-ui, -apple-system, sans-serif",
                      }}>
                        {p.stepCount} steps
                      </div>
                    )}
                  </div>
                  <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#222", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>{p.width} × {p.height}</div>
                      <StatusBadge pieceId={p.id} status={p.status ?? "STANDBY"} size="sm" onChange={(s) => setPieces(prev => prev.map(x => x.id === p.id ? { ...x, status: s } : x))} />
                    </div>
                    <SegmentPicker
                      pieceId={p.id}
                      initial={p.segment ?? p.mediaFormatSegment ?? null}
                      suggestions={segmentSuggestions}
                      onChange={(next) => {
                        setPieces(prev => prev.map(x => x.id === p.id ? { ...x, segment: next } : x))
                        // Adiciona ao pool de sugestoes localmente
                        if (next && !segmentSuggestions.includes(next)) {
                          setSegmentSuggestions(prev => [...prev, next])
                        }
                      }}
                    />
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginTop: "auto", gap: "var(--zz-btn-compact-gap)", flexWrap: "nowrap" }}>
                      {/* Botoes compactos via design tokens — editor em /admin/settings/design-tokens */}
                      <Button variant="danger" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={(e) => deletePiece(p.id, e.altKey)} title="Option/Alt+click pra apagar sem confirmação">Apagar</Button>
                      <Button variant="info" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={() => duplicateOne(p.id)} title="Duplicar peça (cópia entra em Standby)">Duplicar</Button>
                      <Button variant="secondary" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={() => router.push(`/pieces/${p.id}`)} title="Pagina detalhada (legenda, copy, detalhes, export)">Editar</Button>
                      <Button variant="view" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={() => router.push(`/editor?campaignId=${id}&pieceId=${p.id}`)} title="Abrir no editor de canvas">Entrar</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ background: "#fafafa", borderBottom: "1px solid #E0E0E0" }}>
                  <tr>
                    <th style={{ padding: "10px 12px", textAlign: "left", width: 32 }}>
                      <div onClick={toggleSelectAll}
                        style={{
                          width: 18, height: 18, borderRadius: 3, cursor: "pointer",
                          background: allVisibleSelected ? "#F5C400" : "white",
                          border: allVisibleSelected ? "none" : "1px solid #E0E0E0",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                        {allVisibleSelected && <span style={{ color: "white", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                      </div>
                    </th>
                    {(() => {
                      const SortHeader = ({ col, label, align = "left" }: { col: SortCol; label: string; align?: "left" | "right" }) => {
                        const active = sort?.col === col
                        const arrow = !active ? "" : sort.dir === "asc" ? " ↑" : " ↓"
                        return (
                          <th style={{ padding: "10px 12px", textAlign: align, fontSize: 11, fontWeight: 600, color: active ? "#111" : "#666", cursor: "pointer", userSelect: "none" }}
                            onClick={() => setSort(toggleSort(sort, col))}>
                            {label}{arrow}
                          </th>
                        )
                      }
                      return (
                        <>
                          <th style={{ padding: "10px 8px", textAlign: "left", width: 72 }}></th>
                          <SortHeader col="name" label="Nome" />
                          <SortHeader col="size" label="Tamanho" />
                          <SortHeader col="media" label="Veículo" />
                          <SortHeader col="segment" label="Segmento" />
                          <th style={{ padding: "10px 12px", textAlign: "right" }}></th>
                        </>
                      )
                    })()}
                  </tr>
                </thead>
                <tbody>
                  {visiblePieces.map(p => (
                    <tr key={p.id}
                      style={{ borderBottom: "1px solid #f0f0f0", background: isSelected(p.id) ? "#fffaeb" : "transparent" }}>
                      <td style={{ padding: "10px 12px" }}>
                        <div onClick={() => toggleSelect(p.id)}
                          style={{
                            width: 18, height: 18, borderRadius: 3, cursor: "pointer",
                            background: isSelected(p.id) ? "#F5C400" : "white",
                            border: isSelected(p.id) ? "none" : "1px solid #E0E0E0",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                          {isSelected(p.id) && <span style={{ color: "white", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                        </div>
                      </td>
                      <td style={{ padding: "8px 8px", cursor: "pointer" }}
                        onClick={() => router.push(`/editor?campaignId=${id}&pieceId=${p.id}`)}>
                        {/* Multi-step: linha de thumbs (1 por step) lado a lado.
                            Single-step: RowThumb normal. User pediu 2026-05-27
                            'preview dos steps um do lado do outro na linha de
                            cada peca'. */}
                        {Array.isArray(p.steps) && p.steps.length >= 2 ? (
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            {p.steps.map(s => (
                              <div
                                key={s.index}
                                role="button"
                                tabIndex={0}
                                title={`Abrir step ${s.index + 1} no editor`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  router.push(`/editor?campaignId=${id}&pieceId=${p.id}&stepIndex=${s.index}`)
                                }}
                                style={{ cursor: "pointer", lineHeight: 0 }}
                              >
                                <RowThumb
                                  src={s.thumbnailUrl ?? s.imageUrl ?? null}
                                  alt={`${p.name} step ${s.index + 1}`}
                                  fallbackText={`${s.index + 1}`}
                                  size={40}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <RowThumb src={p.imageUrl ?? null} alt={p.name} fallbackText={p.format} />
                        )}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                        onClick={() => router.push(`/editor?campaignId=${id}&pieceId=${p.id}`)}>
                        {p.name}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "#666" }}>{p.width} × {p.height}</td>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "#666" }}>{p.media || "—"}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <SegmentPicker
                          pieceId={p.id}
                          initial={p.segment ?? p.mediaFormatSegment ?? null}
                          suggestions={segmentSuggestions}
                          onChange={(next) => {
                            setPieces(prev => prev.map(x => x.id === p.id ? { ...x, segment: next } : x))
                            if (next && !segmentSuggestions.includes(next)) {
                              setSegmentSuggestions(prev => [...prev, next])
                            }
                          }}
                        />
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "var(--zz-btn-compact-gap)" }}>
                          {/* Botoes compactos via design tokens */}
                          <Button variant="danger" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={(e) => deletePiece(p.id, e.altKey)} title="Option/Alt+click pra apagar sem confirmação">Apagar</Button>
                          <Button variant="info" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={() => duplicateOne(p.id)} title="Duplicar peça (cópia entra em Standby)">Duplicar</Button>
                          <Button variant="secondary" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={() => router.push(`/pieces/${p.id}`)} title="Pagina detalhada (legenda, copy, detalhes, export)">Editar</Button>
                          <Button variant="view" size="sm" style={{ padding: "var(--zz-btn-compact-py) var(--zz-btn-compact-px)", fontSize: "var(--zz-btn-compact-fs)", lineHeight: 1.2 }} onClick={() => router.push(`/editor?campaignId=${id}&pieceId=${p.id}`)} title="Abrir no editor de canvas">Entrar</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>
          </div>
        </div>
          )
        })()}
        </div>
      </div>

      {deliveryOpen && (
        <DeliveryDialog
          campaignId={id}
          campaignName={campaign.name}
          campaignCode={campaign.code ?? null}
          onClose={() => setDeliveryOpen(false)}
          onCreated={() => loadAll()}
        />
      )}

      {exportOpen && selected.length > 0 && (
        <ExportDialog
          pieces={pieces.filter(p => selected.includes(p.id)).map(p => ({ id: p.id, name: p.name, data: p.data, width: p.width, height: p.height }))}
          campaignName={campaign.name}
          onClose={() => setExportOpen(false)}
        />
      )}

      {dupDialog && (
        <DuplicateFormatDialog
          count={dupDialog.ids.length}
          originalFormat={dupDialog.originalFormat ?? null}
          onCancel={() => setDupDialog(null)}
          onConfirm={confirmDuplicate}
        />
      )}
    </div>
  )
}

// DuplicateFormatDialog: agora vive em components/pieces/DuplicateFormatDialog.tsx
// (compartilhado com /pieces/page.tsx).

/**
 * Editor inline pra campo copy da peca. Auto-save com debounce de 600ms,
 * sem botao explicito. Vai pra /api/pieces/[id] PATCH e atualiza state local
 * pra refletir a mudanca em tempo real.
 *
 * Usado tanto no grid quanto na lista de pecas em /campaigns/[id].
 */
// SegmentPicker movido pra components/pieces/SegmentPicker.tsx (compartilhado
// com /pieces page).

function CopyEditor({ pieceId, initial, onChange }: { pieceId: string; initial: string; onChange: (next: string) => void }) {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  const timerRef = useRef<any>(null)

  // Sincroniza state local quando initial muda (ex: ao mudar de peca por re-render)
  useEffect(() => { setValue(initial) }, [initial, pieceId])

  function handleChange(next: string) {
    setValue(next)
    onChange(next) // atualiza state pai imediatamente pra ver no preview
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setSaving(true)
      try {
        await fetch(`/api/pieces/${pieceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ copy: next }),
        })
      } catch (e) { console.warn("[CopyEditor] save fail:", e) }
      finally { setSaving(false) }
    }, 600)
  }

  return (
    <div style={{ position: "relative" }}>
      <textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Legenda, texto de apoio…"
        rows={2}
        style={{
          width: "100%", padding: "6px 8px", borderRadius: 4,
          border: "1px solid #E0E0E0", fontSize: 11, fontFamily: "inherit",
          resize: "vertical", minHeight: 36, color: "#555",
          outline: "none",
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "#F5C400" }}
        onBlur={(e) => { e.currentTarget.style.borderColor = "#E0E0E0" }}
      />
      {saving && (
        <span style={{ position: "absolute", right: 8, top: 8, fontSize: 9, color: "#aaa" }}>salvando…</span>
      )}
    </div>
  )
}

/* ApplyCartridgeButton extraido pra components/campaign/ApplyCartridgeButton.tsx */
