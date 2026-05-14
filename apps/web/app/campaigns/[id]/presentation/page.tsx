"use client"
import { useEffect, useState, useRef } from "react"
import { useRouter, useParams } from "next/navigation"
import { PageShell } from "@/components/layout/PageShell"
import { Button } from "@/components/ui/Button"
import { SlideCover, SlideCode, SlideSegment, SlidePiece, SlideThanks } from "@/components/presentation/Slides"

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
  const [regening, setRegening] = useState(false)
  const [regenProgress, setRegenProgress] = useState({ current: 0, total: 0 })
  const regenContainerRef = useRef<HTMLDivElement | null>(null)
  const autoRegenDoneRef = useRef(false)

  // Funcao de refetch reutilizavel (botao manual + focus + visibilidade).
  async function refetchAll() {
    const ts = Date.now()
    try {
      const [c, p] = await Promise.all([
        fetch(`/api/campaigns/${id}?_t=${ts}`, { cache: "no-store" }).then(r => r.json()),
        fetch(`/api/pieces?campaignId=${id}&_t=${ts}`, { cache: "no-store" }).then(r => r.json()),
      ])
      setCampaign(c)
      setPieces(Array.isArray(p) ? p : [])
    } catch (e) { console.warn("[refetchAll] falhou:", e) }
  }

  // Detecta pecas com steps faltando thumb e regenera via iframe oculto.
  // O iframe carrega /editor com a peca, autoGen roda dentro do editor
  // (gera+sobe os thumbs), depois iframe eh descartado. Tudo silencioso.
  async function regenStalePieces(piecesList: Piece[]) {
    if (typeof window === "undefined") return
    const stale = piecesList.filter((p: any) => {
      // Multi-step com algum step sem imageUrl
      if (Array.isArray(p.steps) && p.steps.length > 1) {
        return p.steps.some((s: any) => !s.imageUrl && !s.thumbnailUrl)
      }
      // Single-step sem thumb
      return !p.imageUrl
    })
    if (!stale.length) return
    console.log(`[regen] ${stale.length} pecas com thumbs stale, regerando...`)
    setRegening(true)
    setRegenProgress({ current: 0, total: stale.length })

    for (let idx = 0; idx < stale.length; idx++) {
      const piece = stale[idx]
      setRegenProgress({ current: idx + 1, total: stale.length })
      try {
        // Cria iframe oculto que carrega a peca no editor. autoGen dentro
        // do editor detecta thumbs faltando e gera+sobe. Esperamos ~6s
        // por peca (load + render + uploads). Se peca tem muitos steps,
        // pode demorar mais.
        const iframe = document.createElement("iframe")
        iframe.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:1280px;height:800px;border:0;"
        iframe.src = `/editor?campaignId=${id}&pieceId=${piece.id}&silent=1`
        document.body.appendChild(iframe)
        // Espera load + autoGen (renderiza N steps + uploads). Conservador.
        const waitMs = 2000 + ((piece as any).stepCount ?? 1) * 1500
        await new Promise(r => setTimeout(r, waitMs))
        document.body.removeChild(iframe)
      } catch (e) {
        console.warn("[regen] falha em", piece.id, e)
      }
    }

    console.log("[regen] terminou. Recarregando previews.")
    setRegening(false)
    await refetchAll()
  }

  useEffect(() => {
    async function load() {
      try {
        await refetchAll()
      } finally {
        setLoading(false)
      }
    }
    load()
    function onVisibilityChange() {
      if (document.visibilityState === "visible") refetchAll()
    }
    window.addEventListener("focus", refetchAll)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.removeEventListener("focus", refetchAll)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [id])

  // Auto-regen: roda 1x apos o primeiro load. Detecta pecas multi-step com
  // step.imageUrl null (caso classico: usuario mudou texto no asset, banco
  // invalidou os thumbs, mas autoGen do editor nao rodou ainda).
  useEffect(() => {
    if (loading || autoRegenDoneRef.current) return
    autoRegenDoneRef.current = true
    regenStalePieces(pieces).catch(e => console.warn("[auto-regen] falha:", e))
  }, [loading, pieces])

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
      const { generateCampaignPresentation } = await import("@/lib/generatePresentation")
      await generateCampaignPresentation({
        name: campaign.name,
        code: campaign.code ?? null,
        pieces: orderedPieces.map(p => ({
          id: p.id, name: p.name, segment: p.segment ?? null, copy: p.copy ?? null,
          imageUrl: p.imageUrl ?? null, width: p.width, height: p.height,
        })),
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

  let slideNum = 0

  return (
    <PageShell>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {regening && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666", padding: "0 12px" }}>
              <span className="spinner" style={{
                width: 12, height: 12, borderRadius: "50%",
                border: "2px solid #ddd", borderTopColor: "#F5C400",
                animation: "spin 0.8s linear infinite",
              }} />
              Regenerando preview {regenProgress.current}/{regenProgress.total}
            </div>
          )}
          <Button variant="secondary" size="md" onClick={refetchAll} title="Recarrega previews do servidor">
            ↻ Atualizar
          </Button>
          <Button variant="primary" size="md" onClick={() => router.push(`/campaigns/${id}`)}>Voltar</Button>
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
          display: "flex", flexDirection: "column", gap: 24,
          maxWidth: 935, margin: "0 auto",
        }}>
          <SlideRow num={++slideNum} total={totalSlides} label="Capa">
            <SlideCover />
          </SlideRow>

          <SlideRow num={++slideNum} total={totalSlides} label="Código + Nome da campanha">
            <SlideCode campaignName={campaign.name} code={campaign.code ?? null} />
          </SlideRow>

          {groups.map((group, gi) => (
            <div key={gi} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {group.segment !== null && (
                <SlideRow num={++slideNum} total={totalSlides} label={`Segmento: ${group.segment}`}>
                  <SlideSegment segment={group.segment} />
                </SlideRow>
              )}
              {group.pieces.flatMap(p => {
                const slides = chunkPieceSteps(p)
                return slides.map((slide, si) => {
                  // Nome: se a peca foi quebrada, mostra "Nome (Parte N/M)".
                  const displayName = slide.totalChunks > 1
                    ? `${p.name || "Peça"} (Parte ${slide.chunkIndex + 1}/${slide.totalChunks})`
                    : (p.name || "Peça sem nome")
                  // Re-indexa os steps do chunk pra label "Step N" comecar
                  // do indice global (nao reseta a cada slide).
                  const stepsForSlide = slide.stepsChunk
                    ? slide.stepsChunk.map((s: any, i: number) => ({
                        ...s,
                        index: slide.chunkIndex * STEPS_PER_SLIDE + i,
                      }))
                    : null
                  // hideCard: chunks NAO-finais escondem a legenda. So o
                  // ultimo chunk mostra (mais natural visualmente — legenda
                  // vem depois de todos os steps).
                  const isLastChunk = slide.chunkIndex === slide.totalChunks - 1
                  return (
                    <SlideRow key={`${p.id}-${si}`} id={si === 0 ? `piece-${p.id}` : undefined} num={++slideNum} total={totalSlides} label={displayName}>
                      <SlidePiece
                        name={displayName}
                        width={p.width}
                        height={p.height}
                        widthValue={p.widthValue}
                        heightValue={p.heightValue}
                        widthUnit={p.widthUnit}
                        heightUnit={p.heightUnit}
                        imageUrl={p.imageUrl ?? null}
                        steps={stepsForSlide}
                        copy={p.copy ?? null}
                        pieceId={p.id}
                        hideCard={!isLastChunk}
                        onCopyChange={(next) => setPieces(prev => prev.map(x => x.id === p.id ? { ...x, copy: next } : x))}
                        onClick={() => router.push(`/editor?campaignId=${id}&pieceId=${p.id}&from=presentation`)}
                      />
                    </SlideRow>
                  )
                })
              })}
            </div>
          ))}

          <SlideRow num={++slideNum} total={totalSlides} label="Obrigado">
            <SlideThanks />
          </SlideRow>
        </div>
      </div>
    </PageShell>
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
