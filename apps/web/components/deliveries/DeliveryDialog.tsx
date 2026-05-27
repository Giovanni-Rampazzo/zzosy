"use client"
import { useEffect, useState } from "react"
import { buildDeliveryZip, type ExportFormat } from "@/lib/exportPiece"
import { Button } from "@/components/ui/Button"
import { FilterPill } from "@/components/ui/FilterPill"
import { useModalEscape } from "@/lib/useModalEscape"

interface PieceLite {
  id: string
  name: string
  data: any
  width: number
  height: number
  status?: string
  segment?: string | null
  copy?: string | null
  media?: string
  imageUrl?: string | null
  steps?: Array<{ index: number; thumbnailUrl?: string | null; imageUrl?: string | null }> | null
  stepCount?: number
}

interface Props {
  campaignId: string
  campaignName?: string
  campaignCode?: string | null
  onClose: () => void
  onCreated?: () => void
}

const FORMATS: { v: ExportFormat; label: string }[] = [
  { v: "PSD", label: "PSD" },
  { v: "PNG", label: "PNG" },
  { v: "JPG", label: "JPG" },
  { v: "PDF", label: "PDF" },
]

export function DeliveryDialog({ campaignId, campaignName, campaignCode, onClose, onCreated }: Props) {
  const [allPieces, setAllPieces] = useState<PieceLite[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [formats, setFormats] = useState<Set<ExportFormat>>(new Set(["PSD"]))
  const [hideDelivered, setHideDelivered] = useState(false)
  const [includePresentation, setIncludePresentation] = useState(true)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState("")
  useModalEscape(!working, onClose)

  useEffect(() => {
    fetch(`/api/pieces?campaignId=${campaignId}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        setAllPieces(Array.isArray(d) ? d : [])
        setLoading(false)
      })
  }, [campaignId])

  const visible = hideDelivered
    ? allPieces.filter(p => p.status !== "ENTREGUE")
    : allPieces

  function toggle(id: string) {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id); else s.add(id)
    setSelected(s)
  }
  function toggleAll() {
    if (selected.size === visible.length) setSelected(new Set())
    else setSelected(new Set(visible.map(p => p.id)))
  }
  function toggleFormat(f: ExportFormat) {
    const s = new Set(formats)
    if (s.has(f)) s.delete(f); else s.add(f)
    setFormats(s)
  }

  async function handleExport() {
    if (selected.size === 0) { alert("Selecione pelo menos uma peça"); return }
    if (formats.size === 0) { alert("Selecione pelo menos um formato"); return }
    setWorking(true)
    try {
      // PERF 2026-05-26: /api/pieces lista agora retorna SEM piece.data (payload
      // 70% menor). Pra exportar precisamos do data — fetchamos por id em
      // paralelo aqui. Trade-off aceitavel: lista carrega muito mais rapido,
      // export tem um pequeno delay extra (paralelo, raramente >1s).
      const selectedPieces = allPieces.filter(p => selected.has(p.id))
      setProgress("Carregando peças...")
      const dataMap = new Map<string, string>()
      await Promise.all(selectedPieces.map(async p => {
        if (typeof p.data === "string" && p.data.length > 0) {
          dataMap.set(p.id, p.data)
          return
        }
        try {
          const r = await fetch(`/api/pieces/${p.id}`, { cache: "no-store" })
          if (r.ok) {
            const fresh = await r.json()
            if (typeof fresh.data === "string") dataMap.set(p.id, fresh.data)
          }
        } catch {}
      }))
      const piecesToExport = selectedPieces
        .map(p => ({ id: p.id, name: p.name, data: dataMap.get(p.id) ?? null, width: p.width, height: p.height, media: p.media }))

      // Se incluir apresentacao: gera o PPTX antes do ZIP pra empacotar em Deck/
      // O segment vem por peca (nao mais por campanha) — passamos cada um adiante.
      let extraFiles: Array<{ folder: string; name: string; blob: Blob }> = []
      if (includePresentation) {
        setProgress("Gerando apresentação...")
        const { buildCampaignPresentationBlob } = await import("@/lib/generatePresentation")
        const piecesForDeck = allPieces
          .filter(p => selected.has(p.id))
          .map(p => ({
            id: p.id, name: p.name, segment: p.segment ?? null, copy: p.copy ?? null,
            imageUrl: p.imageUrl ?? null, width: p.width, height: p.height,
            // BUG 2026-05-27: steps NAO estava sendo passado pro PPTX builder.
            // generatePresentation.ts:buildPptx ja tem logica multi-step (1 slide
            // por step ate 4, depois quebra em chunks), mas sem 'steps' no input
            // ela cai no fallback single-image. User reportou "sem porra dos
            // steps na apresentacao".
            steps: p.steps ?? null,
          }))
        // ANTI-TRAVA 2026-05-27: timeout TOTAL 90s pra PPTX. Se passar disso,
        // SKIP PPTX e continua delivery sem ele (mostra warning). Sem isso,
        // PPTX preso em "Gerando apresentacao..." trava entrega inteira.
        // User pediu "resolver exportacao" — entrega NAO pode falhar por PPTX.
        try {
          const pptxPromise = buildCampaignPresentationBlob({
            name: campaignName ?? "Campanha",
            code: campaignCode ?? null,
            pieces: piecesForDeck,
          }, setProgress)
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("PPTX timeout 90s")), 90_000)
          )
          const result = await Promise.race([pptxPromise, timeoutPromise]) as { blob: Blob; fileName: string }
          extraFiles.push({ folder: "Deck", name: result.fileName, blob: result.blob })
        } catch (e: any) {
          console.error("[DeliveryDialog] PPTX falhou:", e?.message ?? e)
          setProgress(`⚠️ Apresentação falhou (${e?.message ?? "erro"}). Continuando sem PPTX…`)
          // Aguarda 2s pro user ler a mensagem antes de prosseguir
          await new Promise(r => setTimeout(r, 2000))
        }
      }

      // Arquivos .txt com a legenda (copy) de cada peca que tiver. Vai pra pasta Copy/.
      // Nome do arquivo usa o nome da peca (sanitizado) + .txt. Util pra o cliente colar
      // direto nas redes sem precisar abrir o slide.
      const piecesWithCopy = allPieces.filter(p => selected.has(p.id) && p.copy && p.copy.trim().length > 0)
      for (const p of piecesWithCopy) {
        // ASCII normalize 2026-05-27: ZIP filenames com chars unicode (— ç ç̃)
        // viravam mojibake (Op+�+�o) ao abrir via unzip CLI / Windows Explorer.
        // NFD + strip combining marks + replace dashes pra evitar.
        const safeName = (p.name || "peca")
          .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
          .replace(/[—–]/g, "-") // em-dash, en-dash → ASCII hyphen
          .replace(/[\\/:*?"<>|]/g, "_")
          .replace(/[^\x20-\x7e]/g, "_") // qualquer non-ASCII restante vira _
          .trim() || "peca"
        const txtBlob = new Blob([p.copy!.trim()], { type: "text/plain;charset=utf-8" })
        extraFiles.push({ folder: "Copy", name: `${safeName}.txt`, blob: txtBlob })
      }

      // 1) Gerar ZIP no browser
      // Progress imediato pra eliminar gap entre "Apresentacao pronta" e
      // primeiro update do buildDeliveryZip. User reportou 2026-05-27 "para
      // em apresentacao pronta" — primeira peca de 30s parecia hang.
      setProgress(`Preparando export (${piecesToExport.length} peças × ${formats.size} formato(s))...`)
      const zipBlob = await buildDeliveryZip(piecesToExport, Array.from(formats), campaignName, setProgress, extraFiles.length > 0 ? extraFiles : undefined)

      // 2) Nome do ZIP usa codigo da campanha quando existir
      const codeForName = (campaignCode || "").trim()
      const safeCode = codeForName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "")
      // Data local (toISOString seria UTC -> em BRT vira o dia seguinte apos 21h)
      const now = new Date()
      const localYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
      const downloadName = safeCode
        ? `Entrega ${safeCode}.zip`
        : `Entrega-${localYmd}.zip`

      // 3) Download local pro user
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement("a"); a.href = url; a.download = downloadName
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)

      // 4) Salvar copia no servidor + criar Delivery + marcar pecas como ENTREGUE
      const sizeMb = (zipBlob.size / 1024 / 1024).toFixed(1)
      setProgress(`Enviando ZIP (${sizeMb} MB) pro servidor...`)
      const fd = new FormData()
      fd.append("zip", zipBlob, downloadName)
      fd.append("campaignId", campaignId)
      fd.append("pieceIds", JSON.stringify(Array.from(selected)))
      fd.append("formats", JSON.stringify(Array.from(formats)))
      fd.append("name", downloadName)
      // Timeout 5min — sem isso, fetch hang pra sempre se server demora
      // (e o user perde o download local que ja aconteceu).
      const ctrl = new AbortController()
      const uploadTimer = setTimeout(() => ctrl.abort(), 5 * 60 * 1000)
      let res: Response
      try {
        res = await fetch("/api/deliveries", { method: "POST", body: fd, signal: ctrl.signal })
        clearTimeout(uploadTimer)
      } catch (e: any) {
        clearTimeout(uploadTimer)
        if (e?.name === "AbortError") {
          alert("Upload do ZIP timeout (5min). Download local OK, mas servidor nao registrou — repete a entrega.")
        } else {
          alert("Upload falhou: " + (e?.message ?? e) + " — download local OK.")
        }
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert("Entrega salva localmente, mas falhou ao registrar no servidor: " + (err.detail ?? err.error ?? "?"))
      }

      onCreated?.()
      onClose()
    } catch (e: any) {
      alert("Falha na exportação: " + (e?.message ?? e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onMouseDown={(e) => { if (!working && e.target === e.currentTarget) onClose() }}>
      <div
        style={{ background: "#fff", borderRadius: 8, maxWidth: 720, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 20, borderBottom: "1px solid #eee" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Nova entrega</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>Selecione as peças e formatos para gerar o ZIP de entrega.</p>
        </div>

        <div style={{ padding: 20, flex: 1, overflowY: "auto" }}>
          {/* 1. Apresentação */}
          <div style={{ marginBottom: 16, padding: 12, background: "#fafafa", borderRadius: 6, border: "1px solid #eee" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              <input type="checkbox" checked={includePresentation} onChange={e => setIncludePresentation(e.target.checked)} />
              Incluir apresentação
            </label>
            <div style={{ fontSize: 11, color: "#888", marginTop: 4, marginLeft: 24 }}>
              Adiciona o .pptx da campanha numa pasta <strong>Deck/</strong> dentro do ZIP.
            </div>
          </div>

          {/* 2. Formatos */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Formatos a exportar</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {FORMATS.map(f => (
                <FilterPill key={f.v} active={formats.has(f.v)} onClick={() => toggleFormat(f.v)}>
                  {f.label}
                </FilterPill>
              ))}
            </div>
          </div>

          {/* 3. Toggle: ocultar entregues */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, color: "#555" }}>
            <input type="checkbox" checked={hideDelivered} onChange={e => setHideDelivered(e.target.checked)} />
            Ocultar peças já entregues
          </label>

          {/* 4. Lista de peças */}
          {loading ? <div style={{ color: "#888" }}>Carregando peças...</div> : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                <strong>{visible.length} peça(s)</strong>
                <button onClick={toggleAll} style={{ border: "none", background: "transparent", color: "#2563eb", cursor: "pointer", fontSize: 12 }}>
                  {selected.size === visible.length && visible.length > 0 ? "Desmarcar tudo" : "Selecionar tudo"}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 8 }}>
                {visible.map(p => {
                  const isSel = selected.has(p.id)
                  const isDelivered = p.status === "ENTREGUE"
                  return (
                    <div key={p.id} onClick={() => toggle(p.id)}
                      style={{
                        border: isSel ? "2px solid #F5C400" : "1px solid #eee",
                        borderRadius: 6, padding: 8, cursor: "pointer",
                        background: isSel ? "#fffbeb" : "#fff",
                        opacity: isDelivered ? 0.6 : 1,
                      }}>
                      <div style={{ aspectRatio: `${p.width || 1}/${p.height || 1}`, background: "#f5f5f5", marginBottom: 6, overflow: "hidden", borderRadius: 4 }}>
                        {p.imageUrl && <img src={p.imageUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: "#888" }}>{p.width}×{p.height}</div>
                      {isDelivered && <div style={{ fontSize: 10, color: "#4338ca", marginTop: 2 }}>✓ Entregue</div>}
                    </div>
                  )
                })}
                {visible.length === 0 && <div style={{ color: "#888", fontSize: 13, gridColumn: "1/-1" }}>Nenhuma peça disponível.</div>}
              </div>
            </>
          )}

        </div>

        {/* Footer fixo — progress sempre visivel (antes ficava DENTRO da area
            scrollavel das pieces, escondido apos scroll). User reportou
            "spinner rodando sem feedback". */}
        <div style={{ padding: 20, borderTop: "1px solid #eee", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 12, color: progress ? "#111" : "#888", fontWeight: progress ? 500 : 400, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {progress || (working ? "Preparando..." : "")}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <Button variant="secondary" onClick={onClose} disabled={working}>Cancelar</Button>
            <Button onClick={handleExport} loading={working} disabled={selected.size === 0}>{working ? "Exportando..." : `Exportar (${selected.size})`}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
