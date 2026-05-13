"use client"
import { useEffect, useState } from "react"
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

  useEffect(() => {
    async function load() {
      try {
        // Cache-bust: timestamp na URL forca fetch fresco mesmo se Next cachear
        // o componente no client-side router (router.push do editor pra presentation).
        const ts = Date.now()
        const [c, p] = await Promise.all([
          fetch(`/api/campaigns/${id}?_t=${ts}`, { cache: "no-store" }).then(r => r.json()),
          fetch(`/api/pieces?campaignId=${id}&_t=${ts}`, { cache: "no-store" }).then(r => r.json()),
        ])
        setCampaign(c)
        setPieces(Array.isArray(p) ? p : [])
      } finally {
        setLoading(false)
      }
    }
    load()
    // Re-fetch sempre que a janela volta a ter foco (ex: usuario edita peca
    // em outra aba, volta pra apresentacao). Sem isso, thumbs gerados em
    // background no editor nao apareceriam na presentation ate F5.
    function refetch() {
      const ts = Date.now()
      Promise.all([
        fetch(`/api/campaigns/${id}?_t=${ts}`, { cache: "no-store" }).then(r => r.json()),
        fetch(`/api/pieces?campaignId=${id}&_t=${ts}`, { cache: "no-store" }).then(r => r.json()),
      ]).then(([c, p]) => {
        setCampaign(c)
        setPieces(Array.isArray(p) ? p : [])
      }).catch(() => {})
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") refetch()
    }
    window.addEventListener("focus", refetch)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.removeEventListener("focus", refetch)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [id])

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
  //  - Capa (1) + Código (1) + grupos com segment (cada um 1 divisor) + todas pecas + Obrigado (1)
  const segmentDividers = groups.filter(g => g.segment !== null).length
  const totalSlides = 2 + segmentDividers + orderedPieces.length + 1

  let slideNum = 0

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
              {group.pieces.map(p => (
                <SlideRow key={p.id} id={`piece-${p.id}`} num={++slideNum} total={totalSlides} label={p.name || "Peça"}>
                  <SlidePiece
                    name={p.name || "Peça sem nome"}
                    width={p.width}
                    height={p.height}
                    widthValue={p.widthValue}
                    heightValue={p.heightValue}
                    widthUnit={p.widthUnit}
                    heightUnit={p.heightUnit}
                    imageUrl={p.imageUrl ?? null}
                    steps={p.steps ?? null}
                    copy={p.copy ?? null}
                    pieceId={p.id}
                    onCopyChange={(next) => setPieces(prev => prev.map(x => x.id === p.id ? { ...x, copy: next } : x))}
                    onClick={() => router.push(`/editor?campaignId=${id}&pieceId=${p.id}&from=presentation`)}
                  />
                </SlideRow>
              ))}
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
