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
  width: number
  height: number
  imageUrl?: string | null
  createdAt: string
}

interface Campaign {
  id: string
  name: string
  code?: string | null
  segment?: string | null
  client: { id: string; name: string }
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
        const [c, p] = await Promise.all([
          fetch(`/api/campaigns/${id}`).then(r => r.json()),
          fetch(`/api/pieces?campaignId=${id}`).then(r => r.json()),
        ])
        setCampaign(c)
        setPieces(Array.isArray(p) ? p : [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  // Ordena peças por formato + createdAt (igual a campanha)
  const orderedPieces = [...pieces].sort((a, b) => {
    const fa = a.format || ""
    const fb = b.format || ""
    if (fa !== fb) return fa.localeCompare(fb)
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  async function exportPPTX() {
    if (!campaign) return
    setExporting(true)
    try {
      const { generateCampaignPresentation } = await import("@/lib/generatePresentation")
      await generateCampaignPresentation({
        name: campaign.name,
        code: campaign.code ?? null,
        segment: campaign.segment ?? null,
        pieces: orderedPieces.map(p => ({
          id: p.id, name: p.name, imageUrl: p.imageUrl ?? null,
          width: p.width, height: p.height,
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

  // Contagem total de slides (capa + código + segmento + peças + obrigado)
  const totalSlides = 3 + orderedPieces.length + 1

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
          <Button variant="ghost" size="sm" onClick={() => router.push(`/campaigns/${id}`)}>← Voltar</Button>
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
          <Button variant="primary" size="md" onClick={exportPPTX} disabled={exporting}>
            {exporting ? "Exportando…" : "↓ Exportar PPT"}
          </Button>
        </div>
      </div>

      {/* Lista de slides */}
      <div style={{
        background: "#F5F5F5",
        minHeight: "calc(100vh - 60px)",
        padding: "32px 24px 80px",
      }}>
        <div style={{
          display: "flex", flexDirection: "column", gap: 24,
          maxWidth: 1100, margin: "0 auto",
        }}>
          <SlideRow num={1} total={totalSlides} label="Capa">
            <SlideCover />
          </SlideRow>

          <SlideRow num={2} total={totalSlides} label="Código + Nome da campanha">
            <SlideCode campaignName={campaign.name} code={campaign.code ?? null} />
          </SlideRow>

          <SlideRow num={3} total={totalSlides} label="Segmento">
            <SlideSegment segment={campaign.segment ?? null} />
          </SlideRow>

          {orderedPieces.map((p, i) => (
            <SlideRow key={p.id} num={4 + i} total={totalSlides} label={p.name || "Peça"}>
              <SlidePiece
                name={p.name || "Peça sem nome"}
                width={p.width}
                height={p.height}
                imageUrl={p.imageUrl ?? null}
                onClick={() => router.push(`/editor?campaignId=${id}&pieceId=${p.id}`)}
              />
            </SlideRow>
          ))}

          <SlideRow num={totalSlides} total={totalSlides} label="Obrigado">
            <SlideThanks />
          </SlideRow>
        </div>
      </div>
    </PageShell>
  )
}

function SlideRow({ num, total, label, children }: { num: number; total: number; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{
        display: "flex", alignItems: "baseline", gap: 8,
        fontSize: 12, color: "#888",
      }}>
        <span style={{ fontWeight: 700, color: "#111" }}>Slide {num}</span>
        <span>·</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>
      {children}
    </div>
  )
}
