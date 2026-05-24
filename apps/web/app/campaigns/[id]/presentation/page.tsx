"use client"
import { useEffect, useRef, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { PageShell } from "@/components/layout/PageShell"
import { Button } from "@/components/ui/Button"
import { SlideCover, SlideCode, SlideSegment, SlidePiece, SlideThanks } from "@/components/presentation/Slides"
import { useBrand } from "@/lib/useBrand"
import { loadGoogleFont, loadCustomFontFamily } from "@/lib/google-fonts"

interface Piece {
  id: string
  name: string
  format: string
  segment?: string | null
  copy?: string | null
  width: number
  height: number
  widthValue?: number | null
  heightValue?: number | null
  widthUnit?: string | null
  heightUnit?: string | null
  imageUrl?: string | null
  steps?: Array<{ index: number; thumbnailUrl?: string | null; imageUrl?: string | null }> | null
  createdAt: string
}

interface Campaign {
  id: string
  name: string
  code?: string | null
  client: { id: string; name: string }
}

/**
 * Agrupa pecas por segmento. Pecas sem segmento ficam num grupo "Sem segmento"
 * (que NAO recebe slide divisor — vao direto). Pecas com segmento sao agrupadas
 * e cada grupo recebe um slide divisor antes.
 *
 * Ordem dos grupos: alfabetica por nome do segmento; o grupo "sem segmento" vem
 * sempre primeiro (peças genericas antes das segmentadas).
 */
function groupPiecesBySegment(pieces: Piece[]): Array<{ segment: string | null; pieces: Piece[] }> {
  const map = new Map<string, Piece[]>()
  for (const p of pieces) {
    const key = (p.segment ?? "").trim() || ""
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(p)
  }
  const groups: Array<{ segment: string | null; pieces: Piece[] }> = []
  // Sem segmento primeiro
  if (map.has("")) groups.push({ segment: null, pieces: map.get("")! })
  // Outros segmentos em ordem alfabetica
  const segNames = [...map.keys()].filter(k => k !== "").sort((a, b) => a.localeCompare(b, "pt-BR"))
  for (const s of segNames) groups.push({ segment: s, pieces: map.get(s)! })
  return groups
}

export default function PresentationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [pieces, setPieces] = useState<Piece[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  // Modo apresentacao fullscreen
  const [presenting, setPresenting] = useState(false)
  const [presentIdx, setPresentIdx] = useState(0)
  const brand = useBrand()
  // brandFont do CLIENTE da campanha — fonte custom dos textos nos slides.
  // User pediu 2026-05-22: "na apresentacao todas as fontes precisam ser
  // a do cliente". Lazy-load via useEffect abaixo quando campaign carrega.
  const clientBrandFont = (campaign?.client as any)?.brandFont as string | undefined
  // Subset do brand passado aos slides (campos opcionais com fallback nos defaults).
  const slideBrand = {
    primaryColor: brand.raw.whiteLabelAccentColor ?? undefined,
    logoUrl: brand.raw.brandLogoUrl ?? undefined,
    secondaryLogoUrl: brand.raw.brandSecondaryLogoUrl ?? undefined,
    footerText: brand.raw.brandFooterText ?? undefined,
    fontFamily: clientBrandFont,
  }

  useEffect(() => {
    async function load() {
      try {
        const ts = Date.now()
        console.log("[PRESENTATION] mount/refetch", new Date().toISOString())
        const [c, p] = await Promise.all([
          fetch(`/api/campaigns/${id}?_t=${ts}`, { cache: "no-store" }).then(r => r.json()),
          fetch(`/api/pieces?campaignId=${id}&_t=${ts}`, { cache: "no-store" }).then(r => r.json()),
        ])
        console.log("[PRESENTATION] fetched", Array.isArray(p) ? p.length : 0, "pieces")
        if (Array.isArray(p)) {
          p.forEach((piece: any) => {
            if (piece.steps && piece.steps.length > 0) {
              console.log("[PRESENTATION] piece", piece.id, "steps:", piece.steps.map((s: any) => ({ i: s.index, hasImg: !!s.imageUrl })))
            }
          })
        }
        setCampaign(c)
        setPieces(Array.isArray(p) ? p : [])
        // Carrega a fonte do CLIENTE no document. Slides aplicam fontFamily
        // via CSS, mas sem injetar @font-face / <link> o browser cai em
        // fallback system. Mesma logica que /campaigns/[id]/assets/page.tsx.
        if (c?.client?.brandFont) {
          const files = c.client?.customFontFiles
          if (Array.isArray(files) && files.length > 0) loadCustomFontFamily(c.client.brandFont, files)
          else loadGoogleFont(c.client.brandFont)
        }
        // Garante step thumbs pra pecas multi-step que tem steps sem imageUrl.
        // Acontece quando user adiciona steps via editor mas nao re-abriu a
        // peca (autoGen do editor so roda na abertura). Roda em background
        // depois do render inicial; refetcha lista de pecas quando algum thumb
        // foi gerado, atualizando o preview sem reload manual.
        if (Array.isArray(p) && p.length > 0) {
          ;(async () => {
            try {
              const { ensureStepThumbsForPieces } = await import("@/lib/ensureStepThumbs")
              const touched = await ensureStepThumbsForPieces(
                p.map((piece: any) => ({ id: piece.id, campaignId: id, steps: piece.steps })),
                async (cid: string) => {
                  const r = await fetch(`/api/campaigns/${cid}`, { cache: "no-store" })
                  if (!r.ok) return []
                  const cdata = await r.json()
                  return Array.isArray(cdata?.assets) ? cdata.assets : []
                },
              )
              if (touched.length > 0) {
                console.log("[PRESENTATION] regenerou step thumbs em", touched.length, "pecas; refetching")
                const r = await fetch(`/api/pieces?campaignId=${id}`, { cache: "no-store" })
                if (r.ok) {
                  const fresh: any[] = await r.json()
                  setPieces(fresh)
                }
              }
            } catch (e) { console.warn("[PRESENTATION] ensureStepThumbs falhou:", e) }
          })()
        }
      } finally {
        setLoading(false)
      }
    }
    load()
    // Re-fetch sempre que a janela volta a ter foco (ex: usuario edita peca
    // em outra aba, volta pra apresentacao). Sem isso, thumbs gerados em
    // background no editor nao apareceriam na presentation ate F5.
    // Debounce de refetches concorrentes — varias triggers (broadcast + poll +
    // focus) podem disparar ao mesmo tempo. Se um esta em curso, ignora.
    let refetchInFlight = false
    let refetchQueued = false
    async function refetch() {
      if (refetchInFlight) { refetchQueued = true; return }
      refetchInFlight = true
      const ts = Date.now()
      try {
        const [c, p] = await Promise.all([
          fetch(`/api/campaigns/${id}?_t=${ts}`, { cache: "no-store" }).then(r => r.json()),
          fetch(`/api/pieces?campaignId=${id}&_t=${ts}`, { cache: "no-store" }).then(r => r.json()),
        ])
        setCampaign(c)
        setPieces(Array.isArray(p) ? p : [])
        // Re-carrega a fonte tambem no refetch (cliente pode ter trocado brandFont).
        if (c?.client?.brandFont) {
          const files = c.client?.customFontFiles
          if (Array.isArray(files) && files.length > 0) loadCustomFontFamily(c.client.brandFont, files)
          else loadGoogleFont(c.client.brandFont)
        }
      } catch {}
      finally {
        refetchInFlight = false
        if (refetchQueued) {
          refetchQueued = false
          refetch()
        }
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") refetch()
    }
    window.addEventListener("focus", refetch)
    window.addEventListener("pageshow", refetch)
    document.addEventListener("visibilitychange", onVisibilityChange)

    // === PREVIEW REAL-TIME ===
    // Multiple signals pra detectar save no editor:
    //  - BroadcastChannel zzosy:pieces (piece-updated) + zzosy:campaigns (kv-updated)
    //  - storage event (backup pra browsers/contextos sem BroadcastChannel)
    //  - polling agressivo 2s (catch-all pra mudancas externas)
    let bcPieces: BroadcastChannel | null = null
    let bcCampaigns: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== "undefined") {
        bcPieces = new BroadcastChannel("zzosy:pieces")
        bcPieces.onmessage = (ev) => {
          if (ev.data?.type === "piece-updated" && ev.data?.campaignId === id) refetch()
        }
        bcCampaigns = new BroadcastChannel("zzosy:campaigns")
        bcCampaigns.onmessage = (ev) => {
          const t = ev.data?.type
          if ((t === "kv-updated" || t === "campaign-updated") && ev.data?.campaignId === id) refetch()
        }
      }
    } catch {}
    // localStorage event como SINAL CROSS-TAB ALTERNATIVO. Editor pode escrever
    // em `zzosy:lastSave:<campaignId>` apos cada save — apresentacao ouve.
    function onStorage(ev: StorageEvent) {
      if (!ev.key) return
      if (ev.key === `zzosy:lastSave:${id}` || ev.key === `zzosy:lastKvSave:${id}`) refetch()
    }
    window.addEventListener("storage", onStorage)
    // Polling 2s (era 6s) pra captura rapida quando broadcast falha (e.g. same-tab
    // navigation). Apenas quando aba esta visivel — sem desperdicio em background.
    const poll = setInterval(() => { if (!document.hidden) refetch() }, 2000)

    return () => {
      window.removeEventListener("focus", refetch)
      window.removeEventListener("pageshow", refetch)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("storage", onStorage)
      clearInterval(poll)
      try { bcPieces?.close() } catch {}
      try { bcCampaigns?.close() } catch {}
    }
  }, [id])

  // REGEN ROLLBACK 2026-05-23: ver /campaigns/[id] pra explicacao do loop.
  useEffect(() => {
    if (pieces.length === 0) return
    const missing = pieces.filter((p: any) => !p.imageUrl && !p.thumbnailUrl).map((p: any) => p.id)
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      const { regeneratePieceThumb } = await import("@/lib/regenerateThumbs")
      for (const pid of missing) {
        if (cancelled) break
        try { await regeneratePieceThumb(pid) }
        catch (e) { console.warn("[lazy-regen]", pid, e) }
      }
    })()
    return () => { cancelled = true }
  }, [pieces])

  // Scroll automatico pro slide indicado no hash (#piece-{id}).
  // Acontece DEPOIS de pieces serem renderizadas (loading=false), pois antes
  // o elemento alvo nao existe no DOM. requestAnimationFrame garante que o
  // layout ja foi calculado antes do scroll.
  useEffect(() => {
    if (loading) return
    if (typeof window === "undefined") return
    const hash = window.location.hash
    if (!hash || hash.length < 2) return
    requestAnimationFrame(() => {
      const el = document.getElementById(hash.slice(1))
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }, [loading])

  // Ordena peças por formato + createdAt dentro de cada grupo
  const orderedPieces = [...pieces].sort((a, b) => {
    const fa = a.format || ""
    const fb = b.format || ""
    if (fa !== fb) return fa.localeCompare(fb)
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  const groups = groupPiecesBySegment(orderedPieces)

  // Steps por slide: max 4. Peças com mais steps quebram em múltiplos slides.
  // Retorna array de {piece, stepsChunk, chunkIndex, totalChunks}.
  const STEPS_PER_SLIDE = 4
  function chunkPieceSteps(p: Piece): Array<{ piece: Piece; stepsChunk: any[] | null; chunkIndex: number; totalChunks: number }> {
    const steps = p.steps
    if (!Array.isArray(steps) || steps.length <= STEPS_PER_SLIDE) {
      return [{ piece: p, stepsChunk: steps ?? null, chunkIndex: 0, totalChunks: 1 }]
    }
    const chunks: any[] = []
    for (let i = 0; i < steps.length; i += STEPS_PER_SLIDE) {
      chunks.push(steps.slice(i, i + STEPS_PER_SLIDE))
    }
    return chunks.map((c, i) => ({ piece: p, stepsChunk: c, chunkIndex: i, totalChunks: chunks.length }))
  }

  // Conta o total real de slides considerando chunks de steps.
  const totalPieceSlides = orderedPieces.reduce((acc, p) => acc + chunkPieceSteps(p).length, 0)

  async function exportPPTX() {
    if (!campaign) return
    setExporting(true)
    try {
      // SEMPRE refetch antes do export pra pegar pieces frescas com steps
      // populados — pieces no state podiam ser de carga inicial onde steps
      // ainda nao tinham sido regeneradas/uploadadas (user reportou steps
      // sumindo no PPT).
      let piecesForPPT = orderedPieces
      try {
        const r = await fetch(`/api/pieces?campaignId=${campaign.id}`, { cache: "no-store" })
        if (r.ok) {
          const fresh: any[] = await r.json()
          const byId = new Map(fresh.map(p => [p.id, p]))
          piecesForPPT = orderedPieces.map(p => (byId.get(p.id) as Piece) ?? p)
        }
      } catch { /* segue com lista atual */ }
      console.log("[exportPPTX] pre-ensure pieces:", piecesForPPT.map(p => ({
        id: p.id, name: p.name,
        stepsLen: Array.isArray(p.steps) ? p.steps.length : 0,
        stepsImgUrls: Array.isArray(p.steps) ? p.steps.map(s => s.imageUrl ?? "null") : [],
      })))
      // Garante que steps de peças multi-step tenham thumb gerado antes do
      // PPT. Sem isso, peças que o usuário nunca abriu no editor saíam como
      // "(sem preview)" no slide.
      const { ensureStepThumbsForPieces } = await import("@/lib/ensureStepThumbs")
      const touched = await ensureStepThumbsForPieces(
        piecesForPPT.map(p => ({ id: p.id, campaignId: campaign.id, steps: p.steps })),
        async (cid) => {
          const r = await fetch(`/api/campaigns/${cid}`, { cache: "no-store" })
          if (!r.ok) return []
          const c = await r.json()
          return Array.isArray(c?.assets) ? c.assets : []
        },
      )
      console.log("[exportPPTX] ensureStepThumbs touched:", touched)
      // Refetch DE NOVO depois do ensure pra pegar imageUrls recem-geradas.
      if (touched.length > 0) {
        try {
          const r = await fetch(`/api/pieces?campaignId=${campaign.id}`, { cache: "no-store" })
          if (r.ok) {
            const fresh: any[] = await r.json()
            const byId = new Map(fresh.map(p => [p.id, p]))
            piecesForPPT = orderedPieces.map(p => (byId.get(p.id) as Piece) ?? p)
          }
        } catch { /* segue com lista atual */ }
      }
      console.log("[exportPPTX] FINAL pieces passadas pra generatePresentation:", piecesForPPT.map(p => ({
        id: p.id, name: p.name,
        stepsLen: Array.isArray(p.steps) ? p.steps.length : 0,
        stepsImgUrls: Array.isArray(p.steps) ? p.steps.map(s => s.imageUrl ?? "null") : [],
      })))

      const { generateCampaignPresentation } = await import("@/lib/generatePresentation")
      await generateCampaignPresentation({
        name: campaign.name,
        code: campaign.code ?? null,
        pieces: piecesForPPT.map(p => ({
          id: p.id, name: p.name, segment: p.segment ?? null, copy: p.copy ?? null,
          imageUrl: p.imageUrl ?? null, width: p.width, height: p.height,
          // CRITICO: passar steps[] — sem isso, generatePresentation nunca via
          // os steps e exportava como peça single-step (perdendo todos os steps).
          steps: p.steps ?? null,
        })),
        brand: slideBrand,
      })
    } catch (e: any) {
      console.error("[exportPPTX]", e)
      alert(`Erro ao exportar: ${e?.message ?? e}`)
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <PageShell>
        <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Carregando…</div>
      </PageShell>
    )
  }

  if (!campaign) {
    return (
      <PageShell>
        <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Campanha não encontrada</div>
      </PageShell>
    )
  }

  // Total de slides:
  //  - Capa (1) + Código (1) + grupos com segment + total de pecas (com chunks) + Obrigado (1)
  const segmentDividers = groups.filter(g => g.segment !== null).length
  const totalSlides = 2 + segmentDividers + totalPieceSlides + 1

  // === MONTA LISTA LINEAR DE SLIDES ===
  // Usada tanto pra render em scroll quanto pra modo apresentacao fullscreen.
  // Cada entry tem { node, label } pra exibir contador "X de N · Label".
  type SlideEntry = { node: React.ReactNode; label: string; id?: string }
  const slides: SlideEntry[] = []
  slides.push({ label: "Capa", node: <SlideCover brand={slideBrand} /> })
  slides.push({
    label: "Código + Nome da campanha",
    node: (
      <SlideCode
        campaignName={campaign.name}
        code={campaign.code ?? null}
        brand={slideBrand}
        campaignId={campaign.id}
        onCampaignChange={(next) => setCampaign(c => c ? { ...c, ...(next.name !== undefined ? { name: next.name } : {}), ...(next.code !== undefined ? { code: next.code } : {}) } : c)}
      />
    ),
  })
  for (const group of groups) {
    if (group.segment !== null) {
      slides.push({ label: `Segmento: ${group.segment}`, node: <SlideSegment segment={group.segment} brand={slideBrand} /> })
    }
    for (const p of group.pieces) {
      const chunks = chunkPieceSteps(p)
      chunks.forEach((slide, si) => {
        const displayName = slide.totalChunks > 1
          ? `${p.name || "Peça"} (Parte ${slide.chunkIndex + 1}/${slide.totalChunks})`
          : (p.name || "Peça sem nome")
        const stepsForSlide = slide.stepsChunk
          ? slide.stepsChunk.map((s: any, i: number) => ({ ...s, index: slide.chunkIndex * STEPS_PER_SLIDE + i }))
          : null
        const isLastChunk = slide.chunkIndex === slide.totalChunks - 1
        slides.push({
          label: displayName,
          id: si === 0 ? `piece-${p.id}` : undefined,
          node: (
            <SlidePiece
              name={displayName}
              width={p.width}
              height={p.height}
              widthValue={p.widthValue}
              heightValue={p.heightValue}
              widthUnit={p.widthUnit}
              heightUnit={p.heightUnit}
              imageUrl={p.imageUrl ? `${p.imageUrl}?t=${new Date((p as any).updatedAt ?? Date.now()).getTime()}` : null}
              steps={stepsForSlide}
              copy={p.copy ?? null}
              pieceId={p.id}
              hideCard={!isLastChunk}
              brand={slideBrand}
              onCopyChange={(next) => setPieces(prev => prev.map(x => x.id === p.id ? { ...x, copy: next } : x))}
              onClick={() => router.push(`/editor?campaignId=${id}&pieceId=${p.id}&from=presentation`)}
              onStepClick={(stepIndex) => router.push(`/editor?campaignId=${id}&pieceId=${p.id}&from=presentation&stepIndex=${stepIndex}`)}
            />
          ),
        })
      })
    }
  }
  slides.push({ label: "Obrigado", node: <SlideThanks brand={slideBrand} /> })

  return (
    <PageShell>
      {/* Toolbar abaixo do TopNav */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: "rgba(255,255,255,0.95)", backdropFilter: "blur(8px)",
        borderBottom: "1px solid #E5E5E5",
        padding: "12px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
              Apresentação
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>
              {campaign.name}
              <span style={{ fontSize: 12, color: "#888", fontWeight: 400, marginLeft: 8 }}>
                · {totalSlides} {totalSlides === 1 ? "slide" : "slides"}
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="primary" size="md" onClick={() => router.push(`/campaigns/${id}`)}>Voltar</Button>
          <Button variant="primary" size="md" onClick={() => { setPresentIdx(0); setPresenting(true) }}>Apresentar</Button>
          <Button variant="primary" size="md" onClick={exportPPTX} disabled={exporting}>
            {exporting ? "Exportando…" : "Exportar PPT"}
          </Button>
        </div>
      </div>

      {/* Lista de slides */}
      <div style={{
        background: "#1F1F1F",
        minHeight: "calc(100vh - 60px)",
        padding: "32px 24px 80px",
      }}>
        <div style={{
          display: "flex", flexDirection: "column", gap: 28,
          // Slides em 67% do tamanho anterior (1400 → 938). Preview compacto
          // que cabe melhor no viewport sem reduzir escala via transform
          // (preserva interatividade + qualidade de render).
          maxWidth: 938, width: "100%",
          margin: "0 auto",
        }}>
          {slides.map((s, idx) => (
            <SlideRow key={idx} id={s.id} num={idx + 1} total={slides.length} label={s.label}>
              {s.node}
            </SlideRow>
          ))}
        </div>
      </div>

      {/* MODO APRESENTAÇÃO FULLSCREEN — renderiza 1 slide por vez com setas */}
      {presenting && (
        <FullscreenPresenter
          slides={slides}
          index={presentIdx}
          onIndex={setPresentIdx}
          onExit={() => setPresenting(false)}
        />
      )}
    </PageShell>
  )
}

/**
 * Overlay fullscreen com 1 slide centralizado + setas < > + contador + ESC pra sair.
 * Usa Fullscreen API real do browser pra ocupar a tela toda (esconde barra do
 * sistema). Teclado: ←/→/Space/PageUp/PageDown navega; Esc/F sai.
 */
function FullscreenPresenter({ slides, index, onIndex, onExit }: {
  slides: Array<{ node: React.ReactNode; label: string; id?: string }>
  index: number
  onIndex: (i: number) => void
  onExit: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Entra em fullscreen ao montar; sai no unmount. Sincroniza estado com
  // fullscreenchange (caso user aperte F11 ou Esc nativo).
  useEffect(() => {
    const el = containerRef.current
    if (el && el.requestFullscreen) {
      el.requestFullscreen().catch(() => {})
    }
    function onFsChange() {
      if (!document.fullscreenElement) onExit()
    }
    document.addEventListener("fullscreenchange", onFsChange)
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange)
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Atalhos de teclado: navegacao + sair
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onExit(); return }
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown" || e.key === "ArrowDown") {
        e.preventDefault()
        onIndex(Math.min(slides.length - 1, index + 1))
      } else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "ArrowUp") {
        e.preventDefault()
        onIndex(Math.max(0, index - 1))
      } else if (e.key === "Home") {
        onIndex(0)
      } else if (e.key === "End") {
        onIndex(slides.length - 1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, slides.length, onIndex, onExit])

  const current = slides[index]
  if (!current) return null
  const atStart = index === 0
  const atEnd = index === slides.length - 1

  return (
    <div ref={containerRef} style={{
      position: "fixed", inset: 0,
      background: "#000",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 9999, padding: 32,
    }}>
      {/* Slide centralizado, mantendo aspecto 16:9 (igual SlideRow) */}
      <div style={{
        width: "min(96vw, calc(96vh * 16 / 9))",
        aspectRatio: "16 / 9",
        position: "relative",
      }}>
        {current.node}
      </div>

      {/* SETA ESQUERDA */}
      <button
        onClick={() => onIndex(Math.max(0, index - 1))}
        disabled={atStart}
        title="Anterior (←)"
        style={{
          position: "fixed", left: 24, top: "50%", transform: "translateY(-50%)",
          width: 56, height: 56, borderRadius: "50%",
          background: atStart ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.12)",
          border: "1px solid rgba(255,255,255,0.2)",
          color: atStart ? "#444" : "#fff",
          fontSize: 24, cursor: atStart ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(8px)",
          transition: "background 120ms ease, transform 120ms ease",
        }}
      >‹</button>

      {/* SETA DIREITA */}
      <button
        onClick={() => onIndex(Math.min(slides.length - 1, index + 1))}
        disabled={atEnd}
        title="Próximo (→)"
        style={{
          position: "fixed", right: 24, top: "50%", transform: "translateY(-50%)",
          width: 56, height: 56, borderRadius: "50%",
          background: atEnd ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.12)",
          border: "1px solid rgba(255,255,255,0.2)",
          color: atEnd ? "#444" : "#fff",
          fontSize: 24, cursor: atEnd ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(8px)",
          transition: "background 120ms ease, transform 120ms ease",
        }}
      >›</button>

      {/* CONTADOR + LABEL no rodape */}
      <div style={{
        position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
        border: "1px solid rgba(255,255,255,0.1)",
        padding: "8px 18px", borderRadius: 999,
        display: "flex", alignItems: "center", gap: 12,
        color: "#fff", fontSize: 13,
      }}>
        <span style={{ fontWeight: 700 }}>{index + 1} / {slides.length}</span>
        <span style={{ opacity: 0.6 }}>·</span>
        <span style={{ opacity: 0.85, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current.label}</span>
      </div>

      {/* BOTAO SAIR no canto superior direito */}
      <button
        onClick={onExit}
        title="Sair (Esc)"
        style={{
          position: "fixed", top: 20, right: 20,
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.15)",
          color: "#fff", padding: "6px 14px", borderRadius: 6,
          cursor: "pointer", fontSize: 12, fontWeight: 600,
        }}
      >Sair (Esc)</button>
    </div>
  )
}

function SlideRow({ id, num, total, label, children }: { id?: string; num: number; total: number; label: string; children: React.ReactNode }) {
  return (
    <div id={id} style={{ display: "flex", flexDirection: "column", gap: 8, scrollMarginTop: 80 }}>
      <div style={{
        display: "flex", alignItems: "baseline", gap: 8,
        fontSize: 12, color: "#888",
      }}>
        <span style={{ fontWeight: 700, color: "#E5E5E5" }}>Slide {num}</span>
        <span>·</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#999" }}>{label}</span>
      </div>
      {children}
    </div>
  )
}
