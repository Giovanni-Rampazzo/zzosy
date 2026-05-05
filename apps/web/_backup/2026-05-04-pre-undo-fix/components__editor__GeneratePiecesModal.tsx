"use client"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/Button"

interface MediaFormat {
  id: string
  vehicle: string
  media: string
  format: string
  width: number
  height: number
  dpi: number
  category: "DIGITAL" | "OFFLINE"
}

interface Props {
  campaignId: string
  fabricRef: React.RefObject<any>
  onClose: () => void
  onGenerated: () => void
}

// Renderiza preview de UMA peca: cria canvas no tamanho da peca e desenha os
// objetos da matriz com escala pelo MENOR LADO (preserva proporcao do layout)
async function renderPieceThumb(
  matrixCanvas: any,
  pieceW: number,
  pieceH: number,
  matrixW: number,
  matrixH: number
): Promise<Blob | null> {
  try {
    const fabric = await import("fabric")
    const StaticCanvas = (fabric as any).StaticCanvas
    const el = document.createElement("canvas")
    el.width = pieceW; el.height = pieceH

    const fc = new StaticCanvas(el, { width: pieceW, height: pieceH, enableRetinaScaling: false, backgroundColor: matrixCanvas.backgroundColor ?? "#fff" })

    // Escala pelo MENOR lado (uma dimensao cabe, layout preservado)
    const scale = Math.min(pieceW / matrixW, pieceH / matrixH)
    const offsetX = (pieceW - matrixW * scale) / 2
    const offsetY = (pieceH - matrixH * scale) / 2

    // Serializa matriz e carrega no canvas da peca
    const json = matrixCanvas.toJSON(["__assetId", "__assetLabel", "__isBg", "__isImage"])
    await new Promise<void>((resolve) => {
      const r = fc.loadFromJSON(json, () => resolve())
      if (r && typeof r.then === "function") r.then(() => resolve())
    })
    await new Promise(r => setTimeout(r, 200))

    // Aplica escala em todos os objetos
    for (const obj of fc.getObjects()) {
      if ((obj as any).__isBg) {
        obj.set({ left: 0, top: 0, width: pieceW, height: pieceH, scaleX: 1, scaleY: 1 })
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
    fc.renderAll()

    // Tamanho menor para thumbnail (max 480px no maior lado)
    const thumbScale = Math.min(480 / pieceW, 480 / pieceH, 1)
    const dataUrl = fc.toDataURL({ format: "jpeg", quality: 0.85, multiplier: thumbScale })
    fc.dispose()
    const res = await fetch(dataUrl)
    return await res.blob()
  } catch (e) {
    console.warn("thumb fail:", e)
    return null
  }
}

export function GeneratePiecesModal({ campaignId, fabricRef, onClose, onGenerated }: Props) {
  const [formats, setFormats] = useState<MediaFormat[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState("")

  useEffect(() => {
    fetch("/api/medias").then(r => r.json()).then(d => { setFormats(d); setLoading(false) })
  }, [])

  function isSelected(id: string) { return selected.includes(id) }
  function toggle(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function toggleAll(category: "DIGITAL" | "OFFLINE") {
    const ids = formats.filter(f => f.category === category).map(f => f.id)
    const allSelected = ids.every(id => selected.includes(id))
    if (allSelected) setSelected(prev => prev.filter(id => !ids.includes(id)))
    else setSelected(prev => [...prev, ...ids.filter(id => !prev.includes(id))])
  }

  async function generate() {
    if (selected.length === 0) return
    setGenerating(true)

    const fc = fabricRef.current
    if (!fc) { setGenerating(false); return }

    const selectedFormats = formats.filter(f => selected.includes(f.id))

    // Le matriz: dimensoes + layers (do bg + objetos) com posicoes
    const bg = fc.getObjects().find((o: any) => o.__isBg)
    const matrixW = bg?.width ?? fc.getWidth() / fc.getZoom()
    const matrixH = bg?.height ?? fc.getHeight() / fc.getZoom()
    const bgColor = bg?.fill ?? "#ffffff"

    // Carregar key-vision atual do banco para pegar os layers (mais confiavel que ler do canvas)
    const campRes = await fetch(`/api/campaigns/${campaignId}`)
    const camp = await campRes.json()
    const matrixLayers = (camp.keyVision?.layers ?? []) as any[]

    let i = 0
    for (const f of selectedFormats) {
      i++
      setProgress(`${i}/${selectedFormats.length} — ${f.format}`)

      // Calcula posicoes adaptadas (escala pelo menor lado)
      const scale = Math.min(f.width / matrixW, f.height / matrixH)
      const offsetX = (f.width - matrixW * scale) / 2
      const offsetY = (f.height - matrixH * scale) / 2

      const pieceLayers = matrixLayers.map((l: any) => ({
        assetId: l.assetId,
        posX: Math.round((l.posX ?? 0) * scale + offsetX),
        posY: Math.round((l.posY ?? 0) * scale + offsetY),
        scaleX: (l.scaleX ?? 1) * scale,
        scaleY: (l.scaleY ?? 1) * scale,
        rotation: l.rotation ?? 0,
        zIndex: l.zIndex ?? 0,
        width: l.width ?? 400,
        height: l.height ?? 100,
        // overrides vazios inicialmente
        overrides: {},
      }))

      // Cria a peca com NOVO formato: layers + dimensoes + bgColor
      const pieceData = {
        version: 2,  // marca novo formato
        width: f.width,
        height: f.height,
        bgColor,
        layers: pieceLayers,
        format: f.format,
        dpi: f.dpi,
        sourceWidth: matrixW,
        sourceHeight: matrixH,
      }

      const res = await fetch("/api/pieces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          name: `${f.vehicle} — ${f.format}`,
          mediaFormatId: f.id,
          data: pieceData,
          status: "DRAFT",
        }),
      })
      const piece = await res.json()

      // Gera thumbnail no tamanho/proporcao da peca
      const thumb = await renderPieceThumb(fc, f.width, f.height, matrixW, matrixH)
      if (thumb && piece?.id) {
        const fd = new FormData()
        fd.append("thumbnail", thumb, "thumb.jpg")
        await fetch(`/api/pieces/${piece.id}/thumbnail`, { method: "POST", body: fd })
      }
    }

    setGenerating(false)
    setProgress("")
    onGenerated()
  }

  const digital = formats.filter(f => f.category === "DIGITAL")
  const offline = formats.filter(f => f.category === "OFFLINE")

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
      <div className="bg-[#1a1a1a] rounded-xl w-[560px] max-h-[80vh] flex flex-col border border-[#333333]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#333333]">
          <span className="font-bold text-white text-base">Selecionar formatos</span>
          <button onClick={onClose} className="text-[#555555] hover:text-white bg-transparent border-0 text-xl cursor-pointer">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="text-center py-8 text-[#555555]">Carregando formatos...</div>
          ) : (
            <>
              {[{ label: "Digital", data: digital, cat: "DIGITAL" as const }, { label: "Offline", data: offline, cat: "OFFLINE" as const }].map(({ label, data, cat }) => (
                <div key={cat} className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#555555]">{label}</span>
                    <button onClick={() => toggleAll(cat)} className="text-xs text-[#F5C400] bg-transparent border-0 cursor-pointer">
                      {data.every(f => selected.includes(f.id)) ? "Desmarcar todos" : "Selecionar todos"}
                    </button>
                  </div>
                  {data.map(f => (
                    <label key={f.id} className="flex items-center gap-3 py-2.5 border-b border-[#2a2a2a] cursor-pointer hover:bg-white/5 -mx-2 px-2 rounded">
                      <input type="checkbox" checked={isSelected(f.id)} onChange={() => toggle(f.id)} className="w-4 h-4 cursor-pointer" />
                      <span className="text-sm text-white flex-1">{f.vehicle} — {f.format}</span>
                      <span className="text-xs text-[#555555]">{f.width}×{f.height}</span>
                    </label>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#333333] flex justify-between items-center">
          <span className="text-xs text-[#555555]">{generating ? progress : `${selected.length} formato(s) selecionado(s)`}</span>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onClose} className="text-[#888888]">Cancelar</Button>
            <Button onClick={generate} loading={generating} disabled={selected.length === 0}>
              ▶ Gerar {selected.length > 0 ? `${selected.length} ` : ""}peças
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
