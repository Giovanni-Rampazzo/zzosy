"use client"
import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import TopNav from "@/components/TopNav"
import { PIECE_STATUS_LIST, statusMeta } from "@/lib/pieceStatus"
import { Button } from "@/components/ui/Button"

interface Piece {
  id: string
  name: string
  segment?: string | null
  copy?: string | null
  status: string
  campaignId: string
  mediaFormatId: string | null
  data: any
  imageUrl: string | null
  createdAt: string
}

// ENTREGUE eh marcador automatico (set apenas pelo backend ao criar entrega).
const STATUS_OPTIONS = PIECE_STATUS_LIST.filter(s => s !== "ENTREGUE").map(s => ({ value: s, label: statusMeta(s).label }))

export default function PiecePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [piece, setPiece] = useState<Piece | null>(null)
  const [name, setName] = useState("")
  const [segment, setSegment] = useState("")
  const [segmentSuggestions, setSegmentSuggestions] = useState<string[]>([])
  const [copy, setCopy] = useState("")
  const [status, setStatus] = useState("STANDBY")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  // Refs pra auto-save com debounce. Sem isso, cada keystroke dispararia
  // uma chamada PATCH separada — sobrecarrega backend + concorrencia bagunca
  // a ordem das atualizacoes no servidor.
  const saveTimerRef = useRef<any>(null)
  const isMountedRef = useRef(false)
  const savingInFlightRef = useRef(false)

  useEffect(() => {
    fetch(`/api/pieces/${id}`).then(r => r.json()).then(d => {
      if (d.error) return
      setPiece(d)
      setName(d.name ?? "")
      setSegment(d.segment ?? "")
      setCopy(d.copy ?? "")
      setStatus(d.status ?? "STANDBY")
      // Marca como montado apos load inicial. O auto-save abaixo so dispara
      // depois disso pra nao salvar os valores vazios durante o setState do load.
      isMountedRef.current = true
    })
  }, [id])

  // Sugestoes de segmento (datalist)
  useEffect(() => {
    fetch("/api/pieces/segments", { cache: "no-store" })
      .then(r => r.ok ? r.json() : { segments: [] })
      .then(d => setSegmentSuggestions(Array.isArray(d.segments) ? d.segments : []))
      .catch(() => {})
  }, [])

  // Auto-save: dispara 600ms apos qualquer mudanca nos campos editaveis.
  // Sem isso, o usuario precisa clicar 'Salvar' explicitamente — o que vai
  // contra o padrao do app (editor, copy inline, etc).
  useEffect(() => {
    if (!isMountedRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { save() }, 600)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, segment, copy, status])

  async function save() {
    if (savingInFlightRef.current) return // evita PATCH concorrente
    savingInFlightRef.current = true
    setSaving(true)
    try {
      await fetch(`/api/pieces/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          status,
          segment: segment.trim() || null,
          copy: copy.trim() || null,
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) { console.warn("[piece save] fail:", e) }
    finally {
      setSaving(false)
      savingInFlightRef.current = false
    }
  }

  // Volta pra campanha da peca, esperando save pendente terminar primeiro.
  async function safeBack() {
    // Cancela debounce e forca save imediato se ha algo pra salvar
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      await save()
    }
    // Aguarda qualquer save em flight terminar (max 3s)
    const start = Date.now()
    while (savingInFlightRef.current && Date.now() - start < 3000) {
      await new Promise(r => setTimeout(r, 50))
    }
    router.push(piece?.campaignId ? `/campaigns/${piece.campaignId}` : "/pieces")
  }

  async function deletePiece(skipConfirm = false) {
    if (!skipConfirm && !confirm("Apagar esta peça?")) return
    await fetch(`/api/pieces/${id}`, { method: "DELETE" })
    router.push(piece?.campaignId ? `/pieces?campaignId=${piece.campaignId}` : "/pieces")
  }

  async function duplicatePiece() {
    if (duplicating) return
    setDuplicating(true)
    try {
      const res = await fetch("/api/pieces/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      })
      if (!res.ok) throw new Error("Falha")
      const data = await res.json()
      // Endpoint retorna {ok, count, pieces: [...]}
      const newId = data?.pieces?.[0]?.id
      if (newId) {
        router.push(`/pieces/${newId}`)
      } else {
        // Fallback: volta pra lista da campanha
        router.push(piece?.campaignId ? `/pieces?campaignId=${piece.campaignId}` : "/pieces")
      }
    } catch {
      alert("Falha ao duplicar peça")
    } finally {
      setDuplicating(false)
    }
  }

  if (!piece) return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "80vh", color: "#888" }}>Carregando...</div>
    </div>
  )

  return (
    <div style={{ minHeight: "100vh", background: "#F8F9FA" }}>
      <TopNav />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          <div>
            <button onClick={() => router.push(piece?.campaignId ? `/pieces?campaignId=${piece.campaignId}` : "/pieces")} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13, marginBottom: 8, padding: 0 }}>
              ← Peças
            </button>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Editar Peça</h1>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {saving && <span style={{ fontSize: 11, color: "#888" }}>Salvando…</span>}
            {!saving && saved && <span style={{ fontSize: 11, color: "#15803d" }}>✓ Salvo</span>}
            <Button variant="danger" onClick={(e) => deletePiece(e.altKey)} title="Option/Alt+click pra apagar sem confirmação">Apagar</Button>
            <Button variant="info" onClick={duplicatePiece} loading={duplicating}>Duplicar</Button>
            <Button variant="primary" onClick={safeBack} title="Voltar para a campanha (salva alteracoes pendentes antes)">← Voltar</Button>
          </div>
        </div>

        {/* PREVIEW DA PEÇA — em cima, compacto pra dar foco no copy abaixo */}
        <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", padding: 12, marginBottom: 20 }}>
          <div style={{
            height: 140, background: "#F5F5F0", borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden",
          }}>
            {piece.imageUrl ? (
              <img src={`${piece.imageUrl}?v=${Date.now()}`} alt={piece.name ?? "Peça"}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            ) : (
              <div style={{ color: "#aaa", fontSize: 13 }}>Sem preview gerado ainda</div>
            )}
          </div>
        </div>

        {/* CAMPO LEGENDAS — hero da pagina: foco maximo aqui. Hora do redator brilhar */}
        <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", padding: 28, marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#888", display: "block", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Legenda / Copy
            <span style={{ fontSize: 10, color: "#bbb", fontWeight: 500, marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>
              {copy.length} {copy.length === 1 ? "caractere" : "caracteres"}
            </span>
          </label>
          <textarea
            value={copy}
            onChange={e => setCopy(e.target.value)}
            placeholder="Ex: Aproveite as ofertas exclusivas! 🛍️ Compre já no link da bio. #promo #black"
            rows={14}
            style={{
              width: "100%",
              padding: "14px 16px",
              border: "1px solid #E0E0E0",
              borderRadius: 6,
              fontSize: 15,
              lineHeight: 1.6,
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
              resize: "vertical",
              minHeight: 280,
            }}
          />
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}>
            Texto pra redes sociais. Aparece na apresentação ao lado da peça e vai num arquivo .txt na entrega.
          </div>
        </div>

        {/* Outros campos (nome, status, segmento) */}
        <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#888", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Nome da peça</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14, outline: "none", boxSizing: "border-box" }}
              placeholder="Ex: Instagram Feed - Versão A"
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#888", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Status</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14, outline: "none", background: "white" }}
            >
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#888", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Segmento</label>
            <input
              value={segment}
              onChange={e => setSegment(e.target.value)}
              list="piece-segments"
              placeholder="Ex: WhatsApp, Stories, Email…"
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 6, fontSize: 14, outline: "none", boxSizing: "border-box" }}
            />
            <datalist id="piece-segments">
              {segmentSuggestions.map(s => <option key={s} value={s} />)}
            </datalist>
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
              Usado pra agrupar peças na apresentação. Peças com mesmo segmento ficam juntas.
            </div>
          </div>

          <div style={{ padding: "12px 16px", background: "#F8F9FA", borderRadius: 6, fontSize: 12, color: "#888" }}>
            Criada em {new Date(piece.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>

        {/* Abrir editor */}
        <div style={{ marginTop: 16 }}>
          <Button variant="primary" size="lg" className="w-full" onClick={() => router.push(`/editor?campaignId=${piece.campaignId}&pieceId=${piece.id}`)}>Abrir no Editor</Button>
        </div>
      </div>
    </div>
  )
}
